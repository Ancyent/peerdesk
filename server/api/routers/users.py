from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_current_user, get_db
from models import User
from schemas import UserOut, UserUpdate, PasswordChange, SUPPORTED_LANGUAGES
from auth import hash_password, verify_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.name is not None:
        current_user.name = body.name
    if body.email is not None:
        existing = await db.execute(
            select(User).where(User.email == body.email, User.id != current_user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, "Email already in use")
        current_user.email = body.email
    if body.language is not None:
        if body.language not in SUPPORTED_LANGUAGES:
            raise HTTPException(400, "Unsupported language")
        current_user.language = body.language
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/me/password", status_code=204)
async def change_password(
    body: PasswordChange,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()
