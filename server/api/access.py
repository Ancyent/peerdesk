"""The single place that decides what a caller may see.

Every authorization filter lives here. Routers must never build their own
`account_id` conditions: one forgotten endpoint is how a leak happens, and
Stage 2 adds per-member grants by changing this module alone.
"""
from fastapi import HTTPException, status
from sqlalchemy import Select, and_, or_, select

from models import AccessGrant, ApiKey, Branding, Company, Group, Location, Machine, Membership


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
