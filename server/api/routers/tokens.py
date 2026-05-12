from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user
from models import RegistrationToken, Machine, User
from schemas import RegistrationTokenCreate, RegistrationTokenOut, TokenRedeemRequest, MachineOut

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.post("", response_model=RegistrationTokenOut, status_code=201)
async def create_token(
    body: RegistrationTokenCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reg = RegistrationToken(
        created_by=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        company_id=body.company_id,
        location_id=body.location_id,
        group_id=body.group_id,
    )
    db.add(reg)
    await db.commit()
    await db.refresh(reg)
    return reg


@router.post("/redeem", response_model=MachineOut, status_code=201)
async def redeem_token(body: TokenRedeemRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RegistrationToken).where(
            RegistrationToken.token == body.token,
            RegistrationToken.used_at.is_(None),
            RegistrationToken.expires_at > datetime.now(timezone.utc),
        )
    )
    reg = result.scalar_one_or_none()
    if not reg:
        raise HTTPException(400, "Invalid or expired token")

    existing = await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "peer_id already registered")

    machine = Machine(
        peer_id=body.peer_id, name=body.name, os=body.os,
        owner_id=reg.created_by,
        company_id=reg.company_id, location_id=reg.location_id, group_id=reg.group_id,
    )
    db.add(machine)
    reg.used_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(machine)
    return machine
