from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_api_key, get_current_membership
from models import User, Machine, ApiKey, Company, Location, Group, Membership
from schemas import (
    MachineRegister, MachineOut, MachinePlacement, MachineRegisterViaKey,
    MachineApprovalStatus, SavedPasswordIn, SavedPasswordOut,
)
from crypto_box import encrypt_secret, decrypt_secret
from access import assert_admin
import access

router = APIRouter(prefix="/machines", tags=["machines"])

# A machine is "online" only if it sent a heartbeat recently. The agent beats
# every 30s; allow a few misses before showing it offline. Computed on read so
# a machine that stops (crash, app closed) goes offline on its own.
ONLINE_STALE_AFTER = timedelta(seconds=90)


def _apply_online(machines):
    now = datetime.now(timezone.utc)
    for m in machines:
        m.is_online = m.last_seen_at is not None and (now - m.last_seen_at) < ONLINE_STALE_AFTER
    return machines


@router.get("", response_model=list[MachineOut])
async def list_machines(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    query = access.visible_machines(membership)
    if status:
        query = query.where(Machine.approval_status == status)
    result = await db.execute(query)
    return _apply_online(result.scalars().all())


@router.post("", response_model=MachineOut, status_code=201)
async def register_machine(
    body: MachineRegister,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    existing = await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="peer_id already registered")
    machine = Machine(
        peer_id=body.peer_id,
        name=body.name,
        os=body.os,
        account_id=membership.account_id,
        created_by_id=current_user.id,
    )
    db.add(machine)
    await db.commit()
    await db.refresh(machine)
    return machine


async def _account_id_for_creator(db: AsyncSession, user_id: str) -> str:
    """Fallback for API keys created before account_id was stamped on them
    (pre-migration keys): resolve the account from the key creator's own
    (oldest) membership — mirrors routers/auth.py's _account_id_for, kept
    local to avoid a cross-router private import. Raises 401 rather than
    returning None, so a creator with no membership never yields a machine
    silently orphaned with account_id=NULL."""
    result = await db.execute(
        select(Membership).where(Membership.user_id == user_id).order_by(Membership.created_at)
    )
    membership = result.scalars().first()
    if membership is None:
        raise HTTPException(status_code=401, detail="No account membership")
    return membership.account_id


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
        account_id=api_key.account_id or await _account_id_for_creator(db, api_key.created_by),
        created_by_id=api_key.created_by,
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
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
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
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
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
    membership: Membership = Depends(get_current_membership),
):
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    _apply_online([machine])
    return machine


@router.delete("/{machine_id}", status_code=204)
async def delete_machine(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Remove a machine visible to the caller's account (forces a fresh re-registration)."""
    assert_admin(membership)
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    await db.delete(machine)
    await db.commit()


async def _owned_machine(machine_id: str, db: AsyncSession, membership: Membership) -> Machine:
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return machine


@router.put("/{machine_id}/saved-password", status_code=204)
async def set_saved_password(
    machine_id: str,
    body: SavedPasswordIn,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Save (encrypted) the connect password for a machine visible to the caller's
    account, so the web viewer can connect without re-typing it. Opt-in; overwrites
    any prior one."""
    if not body.password:
        raise HTTPException(status_code=400, detail="Password required")
    machine = await _owned_machine(machine_id, db, membership)
    machine.saved_password_enc = encrypt_secret(body.password)
    await db.commit()


@router.delete("/{machine_id}/saved-password", status_code=204)
async def clear_saved_password(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Forget a machine's saved connect password."""
    machine = await _owned_machine(machine_id, db, membership)
    machine.saved_password_enc = None
    await db.commit()


@router.get("/{machine_id}/saved-password", response_model=SavedPasswordOut)
async def get_saved_password(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Return the decrypted connect password so the web viewer can auto-connect.
    404 if none saved (or the key rotated and it can't be decrypted)."""
    machine = await _owned_machine(machine_id, db, membership)
    if not machine.saved_password_enc:
        raise HTTPException(status_code=404, detail="No saved password")
    password = decrypt_secret(machine.saved_password_enc)
    if password is None:
        # Key rotated or ciphertext corrupt — drop the stale value and report absent.
        machine.saved_password_enc = None
        await db.commit()
        raise HTTPException(status_code=404, detail="No saved password")
    return SavedPasswordOut(password=password)


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
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(
        access.visible_machines(membership).where(Machine.id == machine_id)
    )
    machine = result.scalar_one_or_none()
    if not machine:
        raise HTTPException(404, "Machine not found")

    # Verify each non-None placement target belongs to the caller's account, so a
    # user cannot place their machine into another account's company/location/group.
    # Goes through access.py's visible_* helpers so Stage 2's grant condition
    # applies here too, instead of hand-rolling the account_id filter.
    if body.company_id is not None:
        owned = await db.execute(
            access.visible_companies(membership).where(Company.id == body.company_id)
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Company not owned by user")
    if body.location_id is not None:
        owned = await db.execute(
            access.visible_locations(membership).where(Location.id == body.location_id)
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Location not owned by user")
    if body.group_id is not None:
        owned = await db.execute(
            access.visible_groups(membership).where(Group.id == body.group_id)
        )
        if not owned.scalar_one_or_none():
            raise HTTPException(403, "Group not owned by user")

    # The three columns are denormalized precisely so visible_machines can match
    # a grant with a single OR and no recursive walk (see access.py). That only
    # holds if the three describe one consistent path down the tree: a machine
    # placed with group_id set while company_id is NULL or points at a
    # different company would be invisible to a grant on the company that
    # actually contains it, or matched by the wrong grant. Enforce the
    # invariant here, at the only place placement is written, instead of
    # teaching visible_machines to walk the tree.
    if body.group_id is not None:
        row = (
            await db.execute(
                select(Group.location_id, Location.company_id)
                .join(Location, Group.location_id == Location.id)
                .where(Group.id == body.group_id)
            )
        ).first()
        group_location_id, group_company_id = row
        if body.location_id != group_location_id or body.company_id != group_company_id:
            raise HTTPException(
                400, "placement is inconsistent: group_id does not belong to location_id/company_id"
            )
    elif body.location_id is not None:
        location_company_id = (
            await db.execute(select(Location.company_id).where(Location.id == body.location_id))
        ).scalar_one()
        if body.company_id != location_company_id:
            raise HTTPException(
                400, "placement is inconsistent: location_id does not belong to company_id"
            )

    machine.company_id = body.company_id
    machine.location_id = body.location_id
    machine.group_id = body.group_id
    await db.commit()
    await db.refresh(machine)
    return machine
