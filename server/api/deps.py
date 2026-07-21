from typing import AsyncGenerator
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import AsyncSessionLocal
from models import User, ApiKey, Membership
from auth import decode_token

bearer = HTTPBearer()
bearer_optional = HTTPBearer(auto_error=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = decode_token(credentials.credentials, "access")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Same identity resolution as get_current_user, but returns None instead
    of raising when no bearer token is present at all -- for POST
    /auth/accept-invite, where the common caller has no session yet. A
    well-formed `Authorization: Bearer <token>` header with an invalid or
    expired token still raises 401 rather than silently falling back to
    "anonymous": a caller presenting a broken bearer token gets an error,
    not a different code path. This does NOT cover every malformed header,
    though: HTTPBearer(auto_error=False) only recognizes the Bearer scheme,
    so e.g. `Authorization: Basic ...` (or any other/malformed scheme) is
    treated as "no credentials" by FastAPI before this function ever runs,
    and falls back to anonymous. That is not a privilege escalation -- the
    anonymous branch never authenticates as anyone -- but it does mean the
    401-not-anonymous guarantee is scoped to bearer tokens specifically.
    """
    if credentials is None:
        return None
    user_id = decode_token(credentials.credentials, "access")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_current_membership(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> Membership:
    from access import get_membership
    from auth import decode_access_claims

    claims = decode_access_claims(credentials.credentials)
    if not claims:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id, account_id = claims

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if account_id is None:
        result = await db.execute(select(Membership).where(Membership.user_id == user_id))
        memberships = result.scalars().all()
        if len(memberships) != 1:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Select an account")
        return memberships[0]

    membership = await get_membership(db, user_id, account_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this account")
    return membership


async def get_api_key(
    x_api_key: str = Header(..., alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    from datetime import datetime, timezone
    result = await db.execute(
        select(ApiKey).where(ApiKey.key == x_api_key, ApiKey.is_active == True)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    key.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return key
