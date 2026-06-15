from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_api_key
from models import User, Machine, ApiKey, Company, Location, Group
from schemas import MachineRegister, MachineOut, MachinePlacement, MachineRegisterViaKey, MachineApprovalStatus

router = APIRouter(prefix="/machines", tags=["machines"])


@router.get("", response_model=list[MachineOut])
async def list_machines(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Machine).where(Machine.owner_id == current_user.id)
    if status:
        query = query.where(Machine.approval_status == status)
    result = await db.execute(query)
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


@router.post("/register", response_model=MachineOut, status_code=201)
async def register_machine_via_key(
    body: MachineRegisterViaKey,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """Agent self-registration — no user auth, uses X-API-Key header."""
    existing = await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "peer_id already registered")
    status = "approved" if api_key.auto_approve else "pending"
    machine = Machine(
        peer_id=body.peer_id,
        name=body.name,
        os=body.os,
        owner_id=api_key.created_by,
        api_key_id=api_key.id,
        approval_status=status,
    )
    db.add(machine)
    await db.commit()
    await db.refresh(machine)
    return machine


@router.get("/status/{peer_id}", response_model=MachineApprovalStatus)
async def get_machine_approval_status(
    peer_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """Agent polls this to check if admin has approved the machine."""
    result = await db.execute(
        select(Machine).where(Machine.peer_id == peer_id, Machine.api_key_id == api_key.id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(404, "Machine not found")
    return MachineApprovalStatus(peer_id=peer_id, approval_status=machine.approval_status)


@router.post("/{machine_id}/approve", response_model=MachineOut)
async def approve_machine(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Machine).where(Machine.id == machine_id, Machine.owner_id == current_user.id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(404, "Machine not found")
    machine.approval_status = "approved"
    await db.commit()
    await db.refresh(machine)
    return machine


@router.post("/{machine_id}/deny", response_model=MachineOut)
async def deny_machine(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Machine).where(Machine.id == machine_id, Machine.owner_id == current_user.id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(404, "Machine not found")
    machine.approval_status = "denied"
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


@router.patch("/{machine_id}/placement", response_model=MachineOut)
async def set_placement(
    machine_id: str,
    body: MachinePlacement,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Machine).where(Machine.id == machine_id, Machine.owner_id == current_user.id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(404, "Machine not found")

    # Verify each non-None placement target is owned by the current user, so a
    # user cannot place their machine into another user's company/location/group.
    if body.company_id is not None:
        owned = await db.execute(
            select(Company).where(
                Company.id == body.company_id,
                Company.owner_id == current_user.id,
            )
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Company not owned by user")
    if body.location_id is not None:
        owned = await db.execute(
            select(Location)
            .join(Company, Location.company_id == Company.id)
            .where(
                Location.id == body.location_id,
                Company.owner_id == current_user.id,
            )
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Location not owned by user")
    if body.group_id is not None:
        owned = await db.execute(
            select(Group)
            .join(Location, Group.location_id == Location.id)
            .join(Company, Location.company_id == Company.id)
            .where(
                Group.id == body.group_id,
                Company.owner_id == current_user.id,
            )
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Group not owned by user")

    machine.company_id = body.company_id
    machine.location_id = body.location_id
    machine.group_id = body.group_id
    await db.commit()
    await db.refresh(machine)
    return machine
