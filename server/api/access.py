"""The single place that decides what a caller may see.

Every authorization filter lives here. Routers must never build their own
`account_id` conditions: one forgotten endpoint is how a leak happens, and
Stage 2 adds per-member grants by changing this module alone.
"""
from fastapi import HTTPException, status
from sqlalchemy import Select, select

from models import ApiKey, Company, Group, Location, Machine, Membership


async def get_membership(db, user_id: str, account_id: str) -> Membership | None:
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.account_id == account_id,
        )
    )
    return result.scalar_one_or_none()


def visible_machines(membership: Membership) -> Select:
    """Machines the caller may see, as a query to filter further.

    Stage 2 adds the grant condition for `role == "member"` here, so callers
    keep working unchanged.
    """
    return select(Machine).where(Machine.account_id == membership.account_id)


def visible_companies(membership: Membership) -> Select:
    """Companies the caller may see, as a query to filter further.

    Stage 2 adds the grant condition for `role == "member"` here, so callers
    keep working unchanged.
    """
    return select(Company).where(Company.account_id == membership.account_id)


def visible_locations(membership: Membership) -> Select:
    """Locations the caller may see, as a query to filter further. Locations
    reach the account through their company, so this joins `Company`.

    Stage 2 adds the grant condition for `role == "member"` here, so callers
    keep working unchanged.
    """
    return (
        select(Location)
        .join(Company, Location.company_id == Company.id)
        .where(Company.account_id == membership.account_id)
    )


def visible_groups(membership: Membership) -> Select:
    """Groups the caller may see, as a query to filter further. Groups reach
    the account through their location, then that location's company.

    Stage 2 adds the grant condition for `role == "member"` here, so callers
    keep working unchanged.
    """
    return (
        select(Group)
        .join(Location, Group.location_id == Location.id)
        .join(Company, Location.company_id == Company.id)
        .where(Company.account_id == membership.account_id)
    )


def visible_api_keys(membership: Membership) -> Select:
    """API keys the caller may see, as a query to filter further.

    Stage 2 adds the grant condition for `role == "member"` here, so callers
    keep working unchanged.
    """
    return select(ApiKey).where(ApiKey.account_id == membership.account_id)


def assert_admin(membership: Membership) -> None:
    if membership.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def assert_in_account(membership: Membership, machine: Machine) -> None:
    """404, not 403 — a caller must not learn that a machine they cannot reach exists."""
    if machine.account_id != membership.account_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Machine not found")
