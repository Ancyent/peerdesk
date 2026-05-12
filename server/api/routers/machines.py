from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user
from models import User, Machine
from schemas import MachineRegister, MachineOut

router = APIRouter(prefix="/machines", tags=["machines"])


@router.get("", response_model=list[MachineOut])
async def list_machines(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Machine).where(Machine.owner_id == current_user.id))
    return result.scalars().all()


@router.post("", response_model=MachineOut, status_code=201)
async def register_machine(
    body: MachineRegister,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="peer_id already registered")
    machine = Machine(
        peer_id=body.peer_id,
        name=body.name,
        os=body.os,
        owner_id=current_user.id,
    )
    db.add(machine)
    await db.commit()
    await db.refresh(machine)
    return machine


@router.get("/{machine_id}", response_model=MachineOut)
async def get_machine(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Machine).where(
            Machine.id == machine_id,
            Machine.owner_id == current_user.id,
        )
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return machine


@router.patch("/{peer_id}/heartbeat", status_code=204)
async def machine_heartbeat(
    peer_id: str,
    online: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """Agent calls this to update online status — no auth required."""
    result = await db.execute(select(Machine).where(Machine.peer_id == peer_id))
    machine = result.scalar_one_or_none()
    if machine:
        machine.is_online = online
        machine.last_seen_at = datetime.now(timezone.utc)
        await db.commit()
