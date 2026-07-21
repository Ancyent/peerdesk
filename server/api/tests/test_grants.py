"""Grant logic, tested directly against the queries access.py builds.

Testing here rather than through endpoints is deliberate: the rule lives in
one module and is consumed by every router, so proving it once is worth more
than proving it twenty times through HTTP.
"""
from sqlalchemy import select

from access import visible_machines, visible_companies, visible_locations, visible_groups
from models import AccessGrant, Account, Company, Group, Location, Machine, Membership, User


async def _tree(db, account_id="acct"):
    """Builds, prefixed by account so two accounts can coexist:
    Company A [ Loc A1 [ Grp A1a ] ], Company B [ Loc B1 [ Grp B1a ] ],
    one machine in each group, plus a loose machine in Company A only."""
    db.add(Account(id=account_id, name="Acme"))
    p = account_id
    for co in ("A", "B"):
        db.add(Company(id=f"{p}:co-{co}", name=f"Company {co}", account_id=account_id))
        db.add(Location(id=f"{p}:loc-{co}1", name=f"Loc {co}1", company_id=f"{p}:co-{co}"))
        db.add(Group(id=f"{p}:grp-{co}1a", name=f"Grp {co}1a", location_id=f"{p}:loc-{co}1"))
        db.add(Machine(
            id=f"{p}:mach-{co}", peer_id=f"{co}{co}{p[:1]}-1111", name=f"Machine {co}",
            account_id=account_id, company_id=f"{p}:co-{co}",
            location_id=f"{p}:loc-{co}1", group_id=f"{p}:grp-{co}1a",
        ))
    db.add(Machine(
        id=f"{p}:mach-loose", peer_id=f"LO{p[:1]}-0000", name="Loose",
        account_id=account_id, company_id=f"{p}:co-A",
    ))
    await db.commit()


async def _member(db, account_id="acct", user_id="u-mem", role="member"):
    db.add(User(id=user_id, email=f"{user_id}@t.com", name="M", password_hash="h"))
    m = Membership(id=f"mem-{user_id}", user_id=user_id, account_id=account_id, role=role)
    db.add(m)
    await db.commit()
    return m


async def _ids(db, query):
    result = await db.execute(query)
    return {row.id for row in result.scalars().all()}


async def test_member_with_company_grant_sees_only_that_companys_machines(db):
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, company_id="acct:co-A"))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == {"acct:mach-A", "acct:mach-loose"}


async def test_admin_sees_every_machine_in_the_account(db):
    await _tree(db)
    m = await _member(db, user_id="u-adm", role="admin")

    assert await _ids(db, visible_machines(m)) == {
        "acct:mach-A", "acct:mach-B", "acct:mach-loose",
    }


async def test_member_with_no_grants_sees_nothing(db):
    await _tree(db)
    m = await _member(db)

    assert await _ids(db, visible_machines(m)) == set()


async def test_grant_on_a_group_reveals_its_ancestors_only(db):
    """The ancestor rule, and the sibling rule that pays for it: granting one
    group must surface the path down to it and nothing beside it. If Company B
    or Loc B1 appear here, an MSP's client A has just learned client B exists."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, group_id="acct:grp-A1a"))
    await db.commit()

    assert await _ids(db, visible_companies(m)) == {"acct:co-A"}
    assert await _ids(db, visible_locations(m)) == {"acct:loc-A1"}
    assert await _ids(db, visible_groups(m)) == {"acct:grp-A1a"}


async def test_grant_on_a_company_reveals_its_descendants(db):
    """The descendant rule: an empty location under a granted company stays
    visible, because a machine added there later is already inside the grant."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, company_id="acct:co-A"))
    await db.commit()

    assert await _ids(db, visible_locations(m)) == {"acct:loc-A1"}
    assert await _ids(db, visible_groups(m)) == {"acct:grp-A1a"}


async def test_machine_added_after_a_company_grant_is_reachable(db):
    """The distinction from a per-machine grant, and the one most easily lost
    if someone reimplements grants as a materialised list of machine ids."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, company_id="acct:co-A"))
    await db.commit()

    db.add(Machine(
        id="acct:mach-new", peer_id="NEW-9999", name="New",
        account_id="acct", company_id="acct:co-A",
    ))
    await db.commit()

    assert "acct:mach-new" in await _ids(db, visible_machines(m))


async def test_grants_are_additive(db):
    """Two grants give the union. There are no deny rules, so nothing a member
    holds can ever subtract from what another grant gave them."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-A"))
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-B"))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == {"acct:mach-A", "acct:mach-B"}


async def test_member_sees_own_pending_enrollment_without_a_grant(db):
    """The single exception to grant-only visibility. A member may enroll but
    not approve, so a machine they registered has no grant pointing at it yet."""
    await _tree(db)
    m = await _member(db)
    db.add(Machine(
        id="acct:mach-pending", peer_id="PEN-1234", name="Pending",
        account_id="acct", created_by_id=m.user_id, approval_status="pending",
    ))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == {"acct:mach-pending"}


async def test_member_does_not_see_someone_elses_pending_enrollment(db):
    """The exception is scoped to the enroller. If it leaked, every member would
    see every pending machine in the account."""
    await _tree(db)
    m = await _member(db)
    other = await _member(db, user_id="u-other")
    db.add(Machine(
        id="acct:mach-theirs", peer_id="OTH-1234", name="Theirs",
        account_id="acct", created_by_id=other.user_id, approval_status="pending",
    ))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == set()


async def test_grant_cannot_reach_into_another_account(db):
    """Cross-account isolation. Grants are anchored to membership_id, so this
    should be structurally impossible — the test proves the anchoring holds."""
    await _tree(db)
    await _tree(db, account_id="other")
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, company_id="acct:co-A"))
    await db.commit()

    for machine_id in await _ids(db, visible_machines(m)):
        row = (await db.execute(select(Machine).where(Machine.id == machine_id))).scalar_one()
        assert row.account_id == "acct"


async def test_counting_machines_uses_the_filtered_query(db):
    """A count is the kind of leak that survives a careful review of the list
    endpoint, because it is usually computed by a separate query. Counting off
    visible_machines rather than off Machine is the only thing that prevents it."""
    from sqlalchemy import func

    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-A"))
    await db.commit()

    total = (await db.execute(
        select(func.count()).select_from(Machine).where(Machine.account_id == "acct")
    )).scalar_one()
    visible = (await db.execute(
        select(func.count()).select_from(visible_machines(m).subquery())
    )).scalar_one()

    assert total == 3
    assert visible == 1, "a count built off visible_machines must not reveal hidden machines"


# --- Membership anchoring (Finding 1) ---------------------------------------

async def test_two_members_in_same_account_see_only_their_own_grants(db):
    """Cross-account isolation (test_grant_cannot_reach_into_another_account)
    is not the same property as this one. That test passes off the
    account_id filter alone, before any grant condition ever runs. This test
    forces the grant condition itself to do the work: two memberships in the
    SAME account hold DIFFERENT grants, so if `_granted()` ever drops its
    `AccessGrant.membership_id == membership.id` condition, each member
    inherits the union of every member's grants and this fails."""
    await _tree(db)
    m1 = await _member(db, user_id="u-1")
    m2 = await _member(db, user_id="u-2")
    db.add(AccessGrant(membership_id=m1.id, company_id="acct:co-A"))
    db.add(AccessGrant(membership_id=m2.id, company_id="acct:co-B"))
    await db.commit()

    assert await _ids(db, visible_machines(m1)) == {"acct:mach-A", "acct:mach-loose"}
    assert await _ids(db, visible_machines(m2)) == {"acct:mach-B"}


# --- Unpinned branches (Finding 2) ------------------------------------------

async def test_location_grant_reveals_machines_in_that_location(db):
    """Pins Machine.location_id.in_(...) in visible_machines: a location
    grant, with no matching company/group/machine grant, must still surface
    the machines placed in it."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, location_id="acct:loc-A1"))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == {"acct:mach-A"}


async def test_group_grant_reveals_machines_in_that_group(db):
    """Pins Machine.group_id.in_(...) in visible_machines."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, group_id="acct:grp-A1a"))
    await db.commit()

    assert await _ids(db, visible_machines(m)) == {"acct:mach-A"}


async def test_admin_sees_every_company_in_the_account(db):
    """The admin short-circuit in visible_companies. An admin holds no
    grants, so if `if _is_admin(membership): return base` were deleted, an
    admin would see zero companies -- silently, since an empty tree raises
    no error."""
    await _tree(db)
    m = await _member(db, user_id="u-adm", role="admin")

    assert await _ids(db, visible_companies(m)) == {"acct:co-A", "acct:co-B"}


async def test_admin_sees_every_location_in_the_account(db):
    """The admin short-circuit in visible_locations."""
    await _tree(db)
    m = await _member(db, user_id="u-adm", role="admin")

    assert await _ids(db, visible_locations(m)) == {"acct:loc-A1", "acct:loc-B1"}


async def test_admin_sees_every_group_in_the_account(db):
    """The admin short-circuit in visible_groups."""
    await _tree(db)
    m = await _member(db, user_id="u-adm", role="admin")

    assert await _ids(db, visible_groups(m)) == {"acct:grp-A1a", "acct:grp-B1a"}


async def test_member_with_no_grants_sees_no_companies(db):
    await _tree(db)
    m = await _member(db)

    assert await _ids(db, visible_companies(m)) == set()


async def test_member_with_no_grants_sees_no_locations(db):
    await _tree(db)
    m = await _member(db)

    assert await _ids(db, visible_locations(m)) == set()


async def test_member_with_no_grants_sees_no_groups(db):
    await _tree(db)
    m = await _member(db)

    assert await _ids(db, visible_groups(m)) == set()


async def test_company_grant_is_visible_in_visible_companies(db):
    """Pins Company.id.in_(_granted(..., AccessGrant.company_id)) in
    visible_companies -- distinct from test_grant_on_a_company_reveals_its_descendants,
    which asserts only the locations/groups a company grant reaches, never
    the granted company itself."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, company_id="acct:co-A"))
    await db.commit()

    assert await _ids(db, visible_companies(m)) == {"acct:co-A"}


async def test_location_grant_reveals_ancestor_company(db):
    """Pins the via_location branch in visible_companies: a location grant,
    with no company grant, must still surface its ancestor company."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, location_id="acct:loc-A1"))
    await db.commit()

    assert await _ids(db, visible_companies(m)) == {"acct:co-A"}


async def test_machine_grant_reveals_ancestor_company(db):
    """Pins the via_machine branch in visible_companies: a machine grant,
    with no company/location/group grant, must still surface its ancestor
    company."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-A"))
    await db.commit()

    assert await _ids(db, visible_companies(m)) == {"acct:co-A"}


async def test_location_grant_is_visible_in_visible_locations(db):
    """Pins Location.id.in_(_granted(..., AccessGrant.location_id)) in
    visible_locations -- a location grant with no company grant."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, location_id="acct:loc-A1"))
    await db.commit()

    assert await _ids(db, visible_locations(m)) == {"acct:loc-A1"}


async def test_machine_grant_reveals_ancestor_location(db):
    """Pins the via_machine branch in visible_locations: a machine grant,
    with no company/location/group grant, must still surface its ancestor
    location."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-A"))
    await db.commit()

    assert await _ids(db, visible_locations(m)) == {"acct:loc-A1"}


async def test_location_grant_reveals_child_groups(db):
    """Pins Location.id.in_(_granted(..., AccessGrant.location_id)) in
    visible_groups: a location grant, with no group grant, must still
    surface the groups under it."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, location_id="acct:loc-A1"))
    await db.commit()

    assert await _ids(db, visible_groups(m)) == {"acct:grp-A1a"}


async def test_machine_grant_reveals_ancestor_group(db):
    """Pins the via_machine branch in visible_groups: a machine grant, with
    no company/location/group grant, must still surface its ancestor
    group."""
    await _tree(db)
    m = await _member(db)
    db.add(AccessGrant(membership_id=m.id, machine_id="acct:mach-A"))
    await db.commit()

    assert await _ids(db, visible_groups(m)) == {"acct:grp-A1a"}
