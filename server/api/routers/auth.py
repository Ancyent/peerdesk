import uuid
import pyotp
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db
from models import User, AuthSession
from schemas import (
    UserRegister, UserLogin, TokenResponse, RefreshRequest, LoginStep2Request, LogoutRequest,
)
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    create_pending_2fa_token, decode_token, decode_refresh_token, hash_refresh_token,
    IDLE_TIMEOUT, ABSOLUTE_CAP,
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def create_session(db: AsyncSession, user_id: str, remember_me: bool) -> tuple[str, str]:
    sid = str(uuid.uuid4())
    refresh = create_refresh_token(user_id, sid)
    db.add(AuthSession(
        id=sid, user_id=user_id, token_hash=hash_refresh_token(refresh), remember_me=remember_me,
    ))
    await db.commit()
    return create_access_token(user_id), refresh


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    access, refresh = await create_session(db, user.id, body.remember_me)
    return TokenResponse(access_token=access, refresh_token=refresh)


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

    access, refresh = await create_session(db, user.id, body.remember_me)
    return TokenResponse(access_token=access, refresh_token=refresh)


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
    access, refresh = await create_session(db, user.id, body.remember_me)
    return TokenResponse(access_token=access, refresh_token=refresh)


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
    await db.commit()
    return TokenResponse(access_token=create_access_token(user_id), refresh_token=body.refresh_token)


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
