import uuid
import pyotp
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_current_user_optional
from models import User, AuthSession, Account, Membership, Invitation
from schemas import (
    UserRegister, UserLogin, TokenResponse, RefreshRequest, LoginStep2Request, LogoutRequest,
    SwitchAccountIn, AccountMembershipOut, AcceptInviteRequest,
)
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    create_pending_2fa_token, decode_token, decode_refresh_token, hash_refresh_token,
    IDLE_TIMEOUT, ABSOLUTE_CAP,
)
from access import get_membership
from routers.team import hash_invite_token

router = APIRouter(prefix="/auth", tags=["auth"])


async def _account_id_for(db: AsyncSession, user_id: str) -> str:
    """The account a token should carry: the user's oldest membership, so their
    original account stays their default as further memberships are added."""
    result = await db.execute(
        select(Membership).where(Membership.user_id == user_id).order_by(Membership.created_at)
    )
    membership = result.scalars().first()
    if membership is None:
        raise HTTPException(status_code=401, detail="No account membership")
    return membership.account_id


async def create_session(db: AsyncSession, user_id: str, account_id: str, remember_me: bool) -> tuple[str, str]:
    sid = str(uuid.uuid4())
    refresh = create_refresh_token(user_id, sid)
    db.add(AuthSession(
        id=sid, user_id=user_id, token_hash=hash_refresh_token(refresh), remember_me=remember_me,
        account_id=account_id,
    ))
    await db.commit()
    return create_access_token(user_id, account_id), refresh


async def _issue_tokens(
    db: AsyncSession, user_id: str, account_id: str, remember_me: bool = False,
) -> TokenResponse:
    """The one place that mints an access/refresh pair and wraps it into a
    TokenResponse. register, login, login_2fa and accept_invite all end here
    -- three (now four) copies of session creation is how one of them
    drifts."""
    access, refresh = await create_session(db, user_id, account_id, remember_me)
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    account = Account(name=f"{user.name}'s Account")
    db.add(account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=account.id, role="admin"))
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(db, user.id, account.id, body.remember_me)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.totp_enabled:
        temp_token = create_pending_2fa_token(user.id)
        return TokenResponse(
            access_token="",
            refresh_token="",
            requires_2fa=True,
            temp_token=temp_token,
        )

    account_id = await _account_id_for(db, user.id)
    return await _issue_tokens(db, user.id, account_id, body.remember_me)


@router.post("/login/2fa", response_model=TokenResponse)
async def login_2fa(body: LoginStep2Request, db: AsyncSession = Depends(get_db)):
    user_id = decode_token(body.temp_token, "pending_2fa")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="User not found or 2FA not enabled")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid TOTP code")
    account_id = await _account_id_for(db, user.id)
    return await _issue_tokens(db, user.id, account_id, body.remember_me)


def _emails_match(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


@router.post("/accept-invite", response_model=TokenResponse)
async def accept_invite(
    body: AcceptInviteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Joins an existing account. Unlike /auth/register, this creates no new
    account -- that is the whole point of the endpoint.

    The bearer token is OPTIONAL (get_current_user_optional, not
    get_current_user): the common case is someone with no account yet.
    There are exactly two branches:

      - Caller is authenticated: attach the membership to THAT user. Any
        email in the body is ignored -- it is not the caller's word to give.
      - Caller is not authenticated: this must be a brand-new user, created
        from the body. If that email already belongs to a registered user,
        this returns the same 409 /auth/register uses rather than
        authenticating them here -- accept-invite must never become a second
        login path, since it has no 2FA step and login does.

    This endpoint used to accept a password for an already-registered email
    and log them straight in on a match, with no check for user.totp_enabled.
    That was a full second login path with the 2FA step missing: an attacker
    holding a leaked/reused password who cannot get past /auth/login could
    get a session here instead, and a failed guess didn't even consume the
    invitation, so it doubled as an unlimited password-guessing oracle. See
    Finding 1 in task-4-report.md.
    """
    result = await db.execute(
        select(Invitation).where(
            Invitation.token_hash == hash_invite_token(body.token),
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(timezone.utc),
        ).with_for_update()
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        # One message for expired, already-used, forged AND email-mismatched
        # (below), so the endpoint is not an oracle for which tokens exist or
        # who was invited.
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")

    if current_user is not None:
        if inv.email is not None and not _emails_match(inv.email, current_user.email):
            raise HTTPException(status_code=400, detail="Invalid or expired invitation")
        user = current_user
    else:
        if inv.email is not None and not _emails_match(inv.email, body.email):
            raise HTTPException(status_code=400, detail="Invalid or expired invitation")

        existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Email already registered")

        if not body.password or not body.name:
            raise HTTPException(status_code=400, detail="Name and password are required")
        user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
        db.add(user)
        await db.flush()

    if await get_membership(db, user.id, inv.account_id) is None:
        db.add(Membership(user_id=user.id, account_id=inv.account_id, role=inv.role))

    inv.accepted_at = datetime.now(timezone.utc)
    await db.commit()

    return await _issue_tokens(db, user.id, inv.account_id)


def _aware(dt: datetime) -> datetime:
    """Coerce a naive datetime to UTC-aware (SQLite returns naive datetimes)."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    decoded = decode_refresh_token(body.refresh_token)
    if not decoded:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user_id, sid = decoded
    result = await db.execute(select(AuthSession).where(AuthSession.id == sid))
    session = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if (
        session is None
        or session.revoked
        or session.user_id != user_id
        or session.token_hash != hash_refresh_token(body.refresh_token)
        or (now - _aware(session.created_at)) > ABSOLUTE_CAP
        or (now - _aware(session.last_used_at)) > IDLE_TIMEOUT
    ):
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    session.last_used_at = now

    # Prefer the account the session was last active in (set at login/2FA/register
    # and updated by /auth/switch-account) so a refresh doesn't silently throw the
    # user back to their oldest membership. Re-validate it on every refresh: someone
    # removed from the account must not keep refreshing into it. A NULL account_id
    # (sessions created before this column existed) falls back the same way an
    # invalidated one does.
    account_id = None
    if session.account_id is not None:
        membership = await get_membership(db, user_id, session.account_id)
        if membership is not None:
            account_id = session.account_id
    if account_id is None:
        account_id = await _account_id_for(db, user_id)
        session.account_id = account_id  # self-heal: backfill NULL/stale sessions going forward

    await db.commit()
    return TokenResponse(access_token=create_access_token(user_id, account_id), refresh_token=body.refresh_token)


@router.get("/accounts", response_model=list[AccountMembershipOut])
async def list_accounts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(Membership, Account)
        .join(Account, Account.id == Membership.account_id)
        .where(Membership.user_id == current_user.id)
    )
    return [
        AccountMembershipOut(account_id=a.id, name=a.name, role=m.role)
        for m, a in rows.all()
    ]


@router.post("/switch-account")
async def switch_account(
    body: SwitchAccountIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    membership = await get_membership(db, current_user.id, body.account_id)
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this account")

    # Persist the switch on every session still alive for this user, so the
    # new active account survives that session's next /auth/refresh instead
    # of reverting to the oldest membership.
    result = await db.execute(
        select(AuthSession).where(AuthSession.user_id == current_user.id, AuthSession.revoked == False)
    )
    for session in result.scalars().all():
        session.account_id = body.account_id
    await db.commit()

    return {"access_token": create_access_token(current_user.id, body.account_id)}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    decoded = decode_refresh_token(body.refresh_token)
    if decoded:
        _, sid = decoded
        result = await db.execute(select(AuthSession).where(AuthSession.id == sid))
        session = result.scalar_one_or_none()
        if session is not None:
            session.revoked = True
            await db.commit()
    return None
