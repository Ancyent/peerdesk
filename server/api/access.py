"""The single place that decides what a caller may see.

Every authorization filter lives here. Routers must never build their own
`account_id` conditions: one forgotten endpoint is how a leak happens, and
Stage 2 adds per-member grants by changing this module alone.
"""
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, or_, select

from models import (
    AccessGrant, ApiKey, Branding, Company, Group, Invitation, Location, Machine, Membership,
    RegistrationToken, SavedConnectPassword, User,
)


async def get_membership(db, user_id: str, account_id: str) -> Membership | None:
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.account_id == account_id,
        )
    )
    return result.scalar_one_or_none()


def _granted(membership: Membership, column):
    """The set of ids of one target kind this membership holds grants on, as a
    correlated subquery. Returning a subquery rather than awaiting the ids keeps
    every visible_* helper synchronous, so the routers calling them are
    untouched."""
    return select(column).where(
        AccessGrant.membership_id == membership.id,
        column.is_not(None),
    )


def _is_admin(membership: Membership) -> bool:
    return membership.role == "admin"


def visible_machines(membership: Membership) -> Select:
    """Machines the caller may see, as a query to filter further.

    An admin sees the whole account. A member sees the union of their grants —
    grants are additive and there are no deny rules, so this is an OR — plus one
    deliberate exception: machines they enrolled themselves that are still
    awaiting approval. That exception exists because a member may enroll but not
    approve, and without it the machine they just registered would vanish.
    """
    base = select(Machine).where(Machine.account_id == membership.account_id)
    if _is_admin(membership):
        return base
    return base.where(
        or_(
            Machine.id.in_(_granted(membership, AccessGrant.machine_id)),
            Machine.company_id.in_(_granted(membership, AccessGrant.company_id)),
            Machine.location_id.in_(_granted(membership, AccessGrant.location_id)),
            Machine.group_id.in_(_granted(membership, AccessGrant.group_id)),
            and_(
                Machine.created_by_id == membership.user_id,
                Machine.approval_status == "pending",
            ),
        )
    )


def enrollment_status_for_role(role: str) -> str:
    """What approval_status a newly-enrolled machine should get, given the
    role of whoever enrolled it. A member may enroll a machine but not
    approve it -- admitting a machine into the account's perimeter is a
    decision about that perimeter, not fieldwork -- so a member's enrollment
    lands pending and waits in the admin's approval queue (see
    visible_machines's pending exception, which is what keeps it visible to
    them in the meantime). An admin's enrollment is the perimeter decision
    already, so it lands approved directly."""
    return "approved" if role == "admin" else "pending"


async def enrollment_status_for_token(db, reg: RegistrationToken) -> str:
    """The same decision as enrollment_status_for_role, but for
    POST /tokens/redeem -- an unauthenticated agent path with no caller
    membership of its own. The role has to be resolved from the token: who
    minted it (reg.created_by) and which account it belongs to
    (reg.account_id). That lookup goes through this module, not
    routers/tokens.py, like every other account_id/created_by comparison
    here (see the module docstring and tests/test_access.py's guard test).

    A token whose creator no longer holds a membership in that account (removed
    since the token was minted) resolves to "member" -- the safer default,
    since it leaves the machine in the approval queue rather than silently
    admitting it.
    """
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == reg.created_by,
            Membership.account_id == reg.account_id,
        )
    )
    membership = result.scalar_one_or_none()
    role = membership.role if membership is not None else "member"
    return enrollment_status_for_role(role)


def visible_companies(membership: Membership) -> Select:
    """Companies the caller may see.

    A node is visible if granted directly, if it is an ancestor of something
    granted, or if it is a descendant of something granted. For a company only
    the first two can apply — nothing sits above it. The ancestor rule is not
    cosmetic: a member holding machines in several companies cannot otherwise
    tell two identically-named machines apart.
    """
    base = select(Company).where(Company.account_id == membership.account_id)
    if _is_admin(membership):
        return base

    via_location = select(Location.company_id).where(
        Location.id.in_(_granted(membership, AccessGrant.location_id))
    )
    via_group = (
        select(Location.company_id)
        .join(Group, Group.location_id == Location.id)
        .where(Group.id.in_(_granted(membership, AccessGrant.group_id)))
    )
    via_machine = select(Machine.company_id).where(
        Machine.id.in_(_granted(membership, AccessGrant.machine_id)),
        Machine.company_id.is_not(None),
    )
    return base.where(
        or_(
            Company.id.in_(_granted(membership, AccessGrant.company_id)),
            Company.id.in_(via_location),
            Company.id.in_(via_group),
            Company.id.in_(via_machine),
        )
    )


def visible_locations(membership: Membership) -> Select:
    """Locations the caller may see. Locations reach the account through their
    company, so this joins Company.

    Descendant of a granted company, granted directly, ancestor of a granted
    group, or the placement of a granted machine.
    """
    base = (
        select(Location)
        .join(Company, Location.company_id == Company.id)
        .where(Company.account_id == membership.account_id)
    )
    if _is_admin(membership):
        return base

    via_group = select(Group.location_id).where(
        Group.id.in_(_granted(membership, AccessGrant.group_id))
    )
    via_machine = select(Machine.location_id).where(
        Machine.id.in_(_granted(membership, AccessGrant.machine_id)),
        Machine.location_id.is_not(None),
    )
    return base.where(
        or_(
            Location.company_id.in_(_granted(membership, AccessGrant.company_id)),
            Location.id.in_(_granted(membership, AccessGrant.location_id)),
            Location.id.in_(via_group),
            Location.id.in_(via_machine),
        )
    )


def visible_groups(membership: Membership) -> Select:
    """Groups the caller may see. Groups reach the account through their
    location, then that location's company.

    Descendant of a granted company or location, granted directly, or the
    placement of a granted machine. Groups are the bottom of the tree, so there
    is no ancestor case.
    """
    base = (
        select(Group)
        .join(Location, Group.location_id == Location.id)
        .join(Company, Location.company_id == Company.id)
        .where(Company.account_id == membership.account_id)
    )
    if _is_admin(membership):
        return base

    via_machine = select(Machine.group_id).where(
        Machine.id.in_(_granted(membership, AccessGrant.machine_id)),
        Machine.group_id.is_not(None),
    )
    return base.where(
        or_(
            Company.id.in_(_granted(membership, AccessGrant.company_id)),
            Location.id.in_(_granted(membership, AccessGrant.location_id)),
            Group.id.in_(_granted(membership, AccessGrant.group_id)),
            Group.id.in_(via_machine),
        )
    )


def visible_api_keys(membership: Membership) -> Select:
    """API keys the caller may see, as a query to filter further.

    Unlike the other visible_* helpers, this has no member case to handle:
    Task 2 makes API keys admin-only in full (see routers/api_keys.py), so a
    member never reaches this helper at all.
    """
    return select(ApiKey).where(ApiKey.account_id == membership.account_id)


def branding_for_account(account_id: str) -> Select:
    """The branding row for one account. Branding is a singleton per account —
    it has no company/location/group/machine grant tree to delegate to, so
    there is no visible_branding — but the account_id comparison still
    belongs here rather than hand-rolled in routers/branding.py, same as
    every other account_id filter in this codebase.
    """
    return select(Branding).where(Branding.account_id == account_id)


def assert_admin(membership: Membership) -> None:
    if membership.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def assert_in_account(membership: Membership, machine: Machine) -> None:
    """404, not 403 — a caller must not learn that a machine they cannot reach exists."""
    if machine.account_id != membership.account_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Machine not found")


async def assert_placement_consistent(db, company_id, location_id, group_id) -> None:
    """The three placement columns must describe one consistent path down the
    tree: company_id/location_id/group_id all naming the same branch. This is
    what makes visible_machines's single OR over the denormalized columns sound
    (see visible_machines) — a machine placed with group_id set while
    company_id/location_id are NULL or point elsewhere would be invisible to a
    grant on the company that actually contains it, or matched by the wrong
    grant.

    This is the one place the invariant is checked, called from both
    set_placement (PATCH /machines/{id}/placement) and create_token
    (POST /tokens) — the two writers of these columns — so it can never drift
    between them.
    """
    if group_id is not None:
        row = (
            await db.execute(
                select(Group.location_id, Location.company_id)
                .join(Location, Group.location_id == Location.id)
                .where(Group.id == group_id)
            )
        ).first()
        if row is None:
            raise HTTPException(400, "placement is inconsistent: group_id does not exist")
        group_location_id, group_company_id = row
        if location_id != group_location_id or company_id != group_company_id:
            raise HTTPException(
                400, "placement is inconsistent: group_id does not belong to location_id/company_id"
            )
    elif location_id is not None:
        location_company_id = (
            await db.execute(select(Location.company_id).where(Location.id == location_id))
        ).scalar_one_or_none()
        if location_company_id is None or company_id != location_company_id:
            raise HTTPException(
                400, "placement is inconsistent: location_id does not belong to company_id"
            )


async def sync_saved_passwords(db, membership: Membership) -> int:
    """Deletes this membership's stored passwords for machines they can no
    longer see. Returns the number deleted.

    Call after any grant change and after any role change. It recomputes rather
    than reacting to the specific grant that moved, because grants are additive:
    deleting one does not imply losing access, and a delete-on-any-change
    implementation would destroy working credentials.
    """
    visible_ids = select(visible_machines(membership).subquery().c.id)
    result = await db.execute(
        select(SavedConnectPassword).where(
            SavedConnectPassword.membership_id == membership.id,
            SavedConnectPassword.machine_id.not_in(visible_ids),
        )
    )
    stale = result.scalars().all()
    for row in stale:
        await db.delete(row)
    if stale:
        await db.commit()
    return len(stale)


async def sync_saved_passwords_for_account(db, account_id: str) -> int:
    """Runs sync_saved_passwords for every membership in one account. Returns
    the total number of stale rows deleted.

    Some changes can shrink more than one member's visible set at once, with
    no single target membership to resync:

    - Deleting a company/location/group. AccessGrant's tree FKs are
      ON DELETE CASCADE, so by the time the DELETE has committed, every grant
      that pointed at the deleted node or its descendants is already gone --
      there is nothing left to query to find out who held them.
    - Re-placing a machine (PATCH /machines/{id}/placement) out of a
      company/location/group. Any member granted the old node loses the
      machine.

    Pinpointing exactly which memberships were affected would mean walking
    the subtree and cross-referencing grants *before* the delete/update
    commits, then resyncing just that set -- more moving parts, and a second
    place that logic could drift from visible_machines itself. At this
    codebase's scale (a production account with a handful of members) it is
    simpler and cheap to resync every membership in the account instead, and
    it cannot be wrong the way a hand-computed affected-set could be:
    sync_saved_passwords recomputes each membership's visible set from
    scratch rather than reacting to what supposedly changed.
    """
    result = await db.execute(
        select(Membership).where(Membership.account_id == account_id)
    )
    total = 0
    for membership in result.scalars().all():
        total += await sync_saved_passwords(db, membership)
    return total


def visible_memberships(membership: Membership) -> Select:
    """Every membership in the caller's account, joined to its User. /team is
    admin-only (routers/team.py calls assert_admin before ever reaching this),
    so unlike visible_machines et al there is no member case to filter
    further -- an admin administers the whole account's roster."""
    return (
        select(Membership, User)
        .join(User, Membership.user_id == User.id)
        .where(Membership.account_id == membership.account_id)
    )


async def get_membership_in_account(db, membership: Membership, target_id: str) -> Membership:
    """Fetches a membership by id, scoped to the caller's account. 404 (not
    403) if it belongs to someone else's account or doesn't exist at all --
    an admin must not learn that a membership in another account exists."""
    result = await db.execute(
        select(Membership).where(
            Membership.id == target_id,
            Membership.account_id == membership.account_id,
        )
    )
    found = result.scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return found


async def count_admins(db, membership: Membership) -> int:
    """How many admins the caller's account currently has. routers/team.py
    uses this to enforce that an account can never lose its last admin --
    otherwise nobody could administer it and recovery would need database
    access.

    Takes a membership (like every other helper here), not a raw account id
    -- that shape stops a future caller from passing an account id it did not
    derive from the caller's own membership.

    Takes a row lock (`SELECT ... FOR UPDATE`) over the account's admin
    memberships rather than a plain COUNT. Under Postgres READ COMMITTED, two
    concurrent requests demoting/removing two different admins of a
    two-admin account would otherwise both read count == 2, both pass the
    "not the last admin" guard, and both commit -- leaving zero admins. The
    lock makes the second request block until the first commits, then
    re-count against the post-commit state (1 admin), so it correctly fails.
    This is a genuine no-op on SQLite, what the unit tests run against, so no
    unit test exercises the actual blocking; it is verified by reasoning
    about Postgres locking semantics only -- see task-4-report.md."""
    result = await db.execute(
        select(Membership).where(
            Membership.account_id == membership.account_id,
            Membership.role == "admin",
        ).with_for_update()
    )
    return len(result.scalars().all())


def visible_invitations(membership: Membership) -> Select:
    """Invitations in the caller's account that are still redeemable -- not
    accepted, not expired. /team/invitations is admin-only, so like
    visible_memberships there is no member case."""
    return select(Invitation).where(
        Invitation.account_id == membership.account_id,
        Invitation.accepted_at.is_(None),
        Invitation.expires_at > datetime.now(timezone.utc),
    )


async def get_invitation_in_account(db, membership: Membership, invitation_id: str) -> Invitation:
    """Fetches an invitation by id, scoped to the caller's account, regardless
    of whether it is still redeemable -- an admin revoking an already-expired
    or already-accepted invitation is harmless and still needs to find it.
    404 (not 403) if it belongs to another account or doesn't exist."""
    result = await db.execute(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.account_id == membership.account_id,
        )
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    return inv
