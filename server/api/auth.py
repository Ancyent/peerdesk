import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7
IDLE_TIMEOUT = timedelta(hours=24)
ABSOLUTE_CAP = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
PENDING_2FA_TOKEN_EXPIRE_MINUTES = 5

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, account_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "account_id": account_id, "exp": expire, "type": "access"},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def decode_access_claims(token: str) -> Optional[tuple[str, Optional[str]]]:
    """Returns (user_id, account_id). account_id is None for tokens minted before
    accounts existed; the caller falls back to the user's sole membership so that
    nobody is logged out by this change."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            return None
        sub = payload.get("sub")
        if not sub:
            return None
        return sub, payload.get("account_id")
    except JWTError:
        return None


def create_refresh_token(user_id: str, sid: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "sid": sid, "exp": expire, "type": "refresh"},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def decode_refresh_token(token: str) -> Optional[tuple[str, str]]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            return None
        sub, sid = payload.get("sub"), payload.get("sid")
        if not sub or not sid:
            return None
        return sub, sid
    except JWTError:
        return None


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_pending_2fa_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=PENDING_2FA_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "pending_2fa"}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str, token_type: str = "access") -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != token_type:
            return None
        return payload.get("sub")
    except JWTError:
        return None
