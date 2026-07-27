from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_api_key, get_current_membership
from models import User, Machine, ApiKey, Company, Location, Group, Membership, SavedConnectPassword, utcnow
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


async def _saved_password_machine_ids(db: AsyncSession, membership: Membership) -> set[str]:
    """Which machines this caller has stored a password for. One query per
    request rather than one per machine."""
    result = await db.execute(
        select(SavedConnectPassword.machine_id).where(
            SavedConnectPassword.membership_id == membership.id
        )
    )
    return set(result.scalars().all())


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
    machines = _apply_online(result.scalars().all())
    saved = await _saved_password_machine_ids(db, membership)
    out = []
    for m in machines:
        item = MachineOut.model_validate(m)
        item.has_saved_password = m.id in saved
        out.append(item)
    return out


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
        # A member may enroll a machine but not approve it -- see
        # access.enrollment_status_for_role and visible_machines's pending
        # exception, which is what keeps this visible to a member who just
        # registered it.
        approval_status=access.enrollment_status_for_role(membership.role),
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
    response: Response,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """Agent self-registration — no user auth, uses X-API-Key header."""
    caller_account = api_key.account_id or await _account_id_for_creator(db, api_key.created_by)

    existing = (
        await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    ).scalar_one_or_none()

    if existing:
        # An agent keeps its peer_id across a reinstall, so a machine coming
        # back with a fresh API key is the normal case, not a conflict. If it
        # belongs to the caller's own account, adopt it: re-point it at the key
        # now in use and take the agent's current details.
        #
        # Refusing here used to dead-end the agent — it fell through to the
        # status check, which answered 404 because the machine still belonged
        # to the previous key, and it retried that forever.
        if not access.machine_belongs_to_account(existing, caller_account):
            # Somebody else's machine. Knowing a peer_id must never be enough
            # to pull it out of another account.
            raise HTTPException(409, "peer_id already registered")

        existing.api_key_id = api_key.id
        existing.name = body.name
        if body.os:
            existing.os = body.os
        # Reinstalling must not demote a machine that was already approved; an
        # auto-approving key still promotes one that was waiting.
        if api_key.auto_approve:
            existing.approval_status = "approved"

        await db.commit()
        await db.refresh(existing)
        response.status_code = 200   # adopted, not created
        return existing

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
    # Scoped by account, not by the individual key: a reinstalled agent holding
    # a newly issued key is still asking about its own account's machine, and
    # every other route here keys off account_id too. Keying off api_key.id
    # made a reinstall answer 404 forever.
    caller_account = api_key.account_id or await _account_id_for_creator(db, api_key.created_by)
    result = await db.execute(
        access.machines_in_account(caller_account).where(Machine.peer_id == peer_id)
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
    return await _to_machine_out(db, membership, machine)


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
    return await _to_machine_out(db, membership, machine)


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
    return await _to_machine_out(db, membership, machine)


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


async def _saved_password_row(
    db: AsyncSession, membership: Membership, machine_id: str
) -> SavedConnectPassword | None:
    result = await db.execute(
        select(SavedConnectPassword).where(
            SavedConnectPassword.membership_id == membership.id,
            SavedConnectPassword.machine_id == machine_id,
        )
    )
    return result.scalar_one_or_none()


async def _to_machine_out(db: AsyncSession, membership: Membership, machine: Machine) -> MachineOut:
    """Build a MachineOut for a single already-fetched Machine, filling in
    has_saved_password for the CALLER. Every route that hands back an existing
    ORM Machine under response_model=MachineOut must go through this (or
    list_machines' own per-caller batch lookup) — the field is not on the ORM
    object any more, so returning `machine` directly silently reports False
    for everyone, regardless of what the caller actually has stored."""
    item = MachineOut.model_validate(machine)
    item.has_saved_password = (await _saved_password_row(db, membership, machine.id)) is not None
    return item


@router.put("/{machine_id}/saved-password", status_code=204)
async def set_saved_password(
    machine_id: str,
    body: SavedPasswordIn,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Save (encrypted) the caller's connect password for a machine visible to
    them, so the web viewer can connect without re-typing it. Opt-in; overwrites
    any prior copy of theirs. Per-person storage (see models.SavedConnectPassword)
    so that revoking a grant can delete just their credential."""
    if not body.password:
        raise HTTPException(status_code=400, detail="Password required")
    await _owned_machine(machine_id, db, membership)  # 404s if not visible
    row = await _saved_password_row(db, membership, machine_id)
    encrypted = encrypt_secret(body.password)
    if row is None:
        db.add(SavedConnectPassword(
            membership_id=membership.id, machine_id=machine_id, password_enc=encrypted,
        ))
    else:
        row.password_enc = encrypted
        row.updated_at = utcnow()
    await db.commit()


@router.delete("/{machine_id}/saved-password", status_code=204)
async def clear_saved_password(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Forget the caller's saved connect password for a machine."""
    await _owned_machine(machine_id, db, membership)
    row = await _saved_password_row(db, membership, machine_id)
    if row is not None:
        await db.delete(row)
        await db.commit()


@router.get("/{machine_id}/saved-password", response_model=SavedPasswordOut)
async def get_saved_password(
    machine_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    """Return the caller's decrypted connect password so the web viewer can
    auto-connect. 404 if none saved (or the key rotated and it can't be
    decrypted)."""
    await _owned_machine(machine_id, db, membership)
    row = await _saved_password_row(db, membership, machine_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No saved password")
    password = decrypt_secret(row.password_enc)
    if password is None:
        # Key rotated or ciphertext corrupt — drop the stale value and report absent.
        await db.delete(row)
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
    # holds if the three describe one consistent path down the tree. Enforced
    # here, at one of the two places placement is written (create_token in
    # tokens.py is the other), via the shared helper in access.py so the two
    # call sites cannot drift.
    await access.assert_placement_consistent(db, body.company_id, body.location_id, body.group_id)

    machine.company_id = body.company_id
    machine.location_id = body.location_id
    machine.group_id = body.group_id
    await db.commit()
    await db.refresh(machine)

    # Moving a machine out of a granted company/location/group removes it
    # from every member granted that old node -- see
    # access.sync_saved_passwords_for_account for why this resyncs the whole
    # account rather than a computed affected set.
    await access.sync_saved_passwords_for_account(db, membership.account_id)

    return await _to_machine_out(db, membership, machine)
