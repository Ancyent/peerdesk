from typing import AsyncGenerator
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import AsyncSessionLocal
from models import User, ApiKey
from auth import decode_token

bearer = HTTPBearer()


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
