"""Members and invitations -- the two things an admin administers to bring a
colleague onto the account. All routes are admin-only; a member receives 403
and the UI never shows them the page.

Every account_id (and created_by_id/created_by) comparison here goes through
access.py's visible_* / get_*_in_account helpers rather than being hand-built
-- see access.py's module docstring and tests/test_access.py's guard test.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from access import (
    assert_admin, count_admins, get_invitation_in_account, get_membership_in_account,
    sync_saved_passwords, visible_companies, visible_groups, visible_invitations,
    visible_locations, visible_machines, visible_memberships,
)
from deps import get_current_membership, get_current_user, get_db
from models import AccessGrant, Company, Group, Invitation, Location, Machine, Membership, User
from schemas import (
    GrantIn, GrantOut, GrantsIn, InvitationCreate, InvitationCreatedOut, InvitationOut,
    TeamMemberOut, TeamMemberRoleUpdate,
)

router = APIRouter(prefix="/team", tags=["team"])

INVITE_TTL = timedelta(days=7)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _member_out(mem: Membership, user: User) -> TeamMemberOut:
    return TeamMemberOut(
        membership_id=mem.id, user_id=user.id, name=user.name,
        email=user.email, role=mem.role, created_at=mem.created_at,
    )


@router.get("/members", response_model=list[TeamMemberOut])
async def list_members(
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(visible_memberships(membership).order_by(Membership.created_at))
    return [_member_out(mem, user) for mem, user in result.all()]


@router.patch("/members/{membership_id}", response_model=TeamMemberOut)
async def update_member_role(
    membership_id: str,
    body: TeamMemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)

    if (target.role == "admin" and body.role != "admin"
            and await count_admins(db, membership) == 1):
        raise HTTPException(400, "An account must keep at least one admin")

    target.role = body.role
    await db.commit()

    # Demotion shrinks what they can see, so stored credentials for machines
    # they just lost must go. Promotion widens it and deletes nothing.
    await sync_saved_passwords(db, target)

    user = (await db.execute(select(User).where(User.id == target.user_id))).scalar_one()
    return _member_out(target, user)


@router.delete("/members/{membership_id}", status_code=204)
async def remove_member(
    membership_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)

    if target.role == "admin" and await count_admins(db, membership) == 1:
        raise HTTPException(400, "An account must keep at least one admin")

    # Grants and saved passwords are anchored to membership_id with ON DELETE
    # CASCADE, so removing the membership removes both.
    await db.delete(target)
    await db.commit()


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(visible_invitations(membership).order_by(Invitation.created_at.desc()))
    return list(result.scalars().all())


@router.post("/invitations", response_model=InvitationCreatedOut, status_code=201)
async def create_invitation(
    body: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    token = secrets.token_urlsafe(32)
    inv = Invitation(
        account_id=membership.account_id,
        token_hash=hash_invite_token(token),
        email=(body.email or None),
        role=body.role,
        expires_at=datetime.now(timezone.utc) + INVITE_TTL,
        created_by_id=user.id,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return InvitationCreatedOut(
        id=inv.id, email=inv.email, role=inv.role,
        expires_at=inv.expires_at, created_at=inv.created_at, token=token,
    )


@router.delete("/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    inv = await get_invitation_in_account(db, membership, invitation_id)
    await db.delete(inv)
    await db.commit()


@router.get("/members/{membership_id}/grants", response_model=list[GrantOut])
async def list_grants(
    membership_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)
    result = await db.execute(
        select(AccessGrant)
        .where(AccessGrant.membership_id == target.id)
        .order_by(AccessGrant.id)
    )
    return list(result.scalars().all())


def _dedup_grants(grants: list[GrantIn]) -> list[GrantIn]:
    """Collapses identical grants (same single target) to one row. Grants are
    a union for access purposes, so a duplicate is harmless there, but the
    endpoint's contract is "this is the desired state" and GET should not
    hand back two rows that mean the same thing."""
    seen: set[tuple[str | None, str | None, str | None, str | None]] = set()
    deduped = []
    for grant in grants:
        key = (grant.company_id, grant.location_id, grant.group_id, grant.machine_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(grant)
    return deduped


async def _assert_targets_visible(db: AsyncSession, membership: Membership, grants: list[GrantIn]) -> None:
    """The target ids are caller-supplied. 404, not 403 -- an admin must not
    learn that another tenant's company/location/group/machine exists from
    the response code.

    Batched into one IN query per target kind rather than one query per
    grant: with the per-grant version, a PUT with N grants ran N sequential
    round trips, each one held open inside the same transaction that also
    holds the membership row lock acquired in set_grants (see there) for the
    whole request.
    """
    checks = (
        (lambda g: g.company_id, visible_companies, Company),
        (lambda g: g.location_id, visible_locations, Location),
        (lambda g: g.group_id, visible_groups, Group),
        (lambda g: g.machine_id, visible_machines, Machine),
    )
    for target_id_of, visible, model in checks:
        target_ids = {target_id_of(g) for g in grants if target_id_of(g) is not None}
        if not target_ids:
            continue
        found = await db.execute(visible(membership).where(model.id.in_(target_ids)))
        found_ids = {row.id for row in found.scalars().all()}
        missing = target_ids - found_ids
        if missing:
            raise HTTPException(404, "Grant target not found")


@router.put("/members/{membership_id}/grants", response_model=list[GrantOut])
async def set_grants(
    membership_id: str,
    body: GrantsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    """Replaces the member's entire grant set.

    Whole-set replacement rather than add/remove deltas: the editor sends the
    desired state, so two admins editing at once cannot interleave into a
    half-applied list, and the endpoint has one meaning instead of three.
    """
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)

    grants = _dedup_grants(body.grants)
    await _assert_targets_visible(db, membership, grants)

    # Row-lock the membership for the rest of this transaction, BEFORE
    # reading the existing grant set. Without this, two concurrent PUTs to
    # the same member both SELECT the same pre-commit snapshot; the loser's
    # DELETE then matches zero rows once it re-evaluates after the winner
    # commits (it was deleting by primary key, and the winner's new rows
    # were never in the loser's snapshot to delete). AccessGrant has no
    # version_id_col, so SQLAlchemy treats that zero-rows-matched mismatch as
    # a warning, not a StaleDataError -- the loser's request still returns
    # 200, having merged its insert into the winner's set instead of
    # replacing it. The reachable bad state is therefore "union of both
    # admins' intents", not an empty grant set -- and critically, an admin
    # who PUT `{"grants": []}` to revoke a member can have that revocation
    # silently undone by an unrelated concurrent edit. Locking the row here
    # forces the second transaction's read to wait until the first commits,
    # so it starts from the true post-commit state instead of a stale one.
    #
    # A plain `DELETE ... WHERE membership_id = ...` in place of the ORM
    # delete below would NOT fix this on its own: under READ COMMITTED a
    # bulk DELETE still takes its own snapshot at statement start and can
    # still miss a concurrent transaction's not-yet-committed inserts. The
    # lock has to come first.
    #
    # `.with_for_update()` is a documented no-op on SQLite, which is what the
    # unit suite runs against, so no unit test exercises this line's actual
    # locking behavior -- see task-5-report.md for how it was verified
    # instead (a real two-connection Postgres check, plus reasoning about
    # what the lock guarantees).
    await db.execute(
        select(Membership.id).where(Membership.id == target.id).with_for_update()
    )

    existing = (await db.execute(
        select(AccessGrant)
        .where(AccessGrant.membership_id == target.id)
        .order_by(AccessGrant.id)
    )).scalars().all()
    for row in existing:
        await db.delete(row)

    for grant in grants:
        db.add(AccessGrant(
            membership_id=target.id,
            created_by_id=user.id,
            company_id=grant.company_id,
            location_id=grant.location_id,
            group_id=grant.group_id,
            machine_id=grant.machine_id,
        ))
    await db.commit()

    # Recompute rather than guess which machines were lost: grants are additive,
    # so only the resulting visible set is authoritative.
    await sync_saved_passwords(db, target)

    result = await db.execute(
        select(AccessGrant)
        .where(AccessGrant.membership_id == target.id)
        .order_by(AccessGrant.id)
    )
    return list(result.scalars().all())
