import pytest
from sqlalchemy import select
from models import ApiKey, Machine, RegistrationToken


@pytest.mark.asyncio
async def test_create_token(auth_client):
    r = await auth_client.post("/tokens", json={})
    assert r.status_code == 201
    assert len(r.json()["token"]) == 9
    assert r.json()["token"][4] == "-"
    assert r.json()["used_at"] is None


@pytest.mark.asyncio
async def test_token_name_overrides_agent_name(auth_client, client):
    # A name set at token creation wins over the agent's hostname-derived name.
    token_val = (await auth_client.post("/tokens", json={"name": "Reception PC"})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "123456780", "name": "host-xyz (linux)", "os": "linux",
    })
    assert r.status_code == 201
    assert r.json()["name"] == "Reception PC"


@pytest.mark.asyncio
async def test_no_token_name_keeps_agent_name(auth_client, client):
    token_val = (await auth_client.post("/tokens", json={})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "123456781", "name": "host-abc (linux)", "os": "linux",
    })
    assert r.json()["name"] == "host-abc (linux)"


@pytest.mark.asyncio
async def test_redeem_token(auth_client, client):
    token_val = (await auth_client.post("/tokens", json={})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "123456789", "name": "Test-PC"
    })
    assert r.status_code == 201
    assert r.json()["peer_id"] == "123456789"


@pytest.mark.asyncio
async def test_redeem_twice_fails(auth_client, client):
    token_val = (await auth_client.post("/tokens", json={})).json()["token"]
    await client.post("/tokens/redeem", json={"token": token_val, "peer_id": "111111111", "name": "PC1"})
    r = await client.post("/tokens/redeem", json={"token": token_val, "peer_id": "222222222", "name": "PC2"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_redeem_invalid(client):
    r = await client.post("/tokens/redeem", json={"token": "XXXX-XXXX", "peer_id": "333333333", "name": "PC"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_create_token_rejects_inconsistent_placement(auth_client):
    """The three placement columns must describe one consistent path down the
    tree (see access.assert_placement_consistent) -- visible_machines matches
    them independently with an OR, so an inconsistent triple would be
    invisible to the grant that should cover it, or matched by the wrong one.
    Without this check at issue time, an admin could mint a token with a
    group_id that doesn't belong to the given company_id/location_id, and
    redeem_token would stamp that inconsistent triple straight onto the new
    machine -- the exact shape set_placement rejects, reachable through a path
    members are allowed to use."""
    co = (await auth_client.post("/companies", json={"name": "Real Co"})).json()
    other_co = (await auth_client.post("/companies", json={"name": "Wrong Co"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    grp = (await auth_client.post(f"/locations/{loc['id']}/groups", json={"name": "IT"})).json()

    # group_id's real company is `co`, but company_id claims `other_co`.
    r = await auth_client.post("/tokens", json={
        "company_id": other_co["id"], "location_id": loc["id"], "group_id": grp["id"],
    })
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    # Same bug, minimal form: group_id set, location_id/company_id both left NULL.
    r2 = await auth_client.post("/tokens", json={"group_id": grp["id"]})
    assert r2.status_code == 400, f"expected 400, got {r2.status_code}: {r2.text}"


@pytest.mark.asyncio
async def test_create_token_accepts_consistent_placement(auth_client, client):
    """The mirror of test_create_token_rejects_inconsistent_placement: a full,
    correct company_id/location_id/group_id triple is still accepted, and the
    redeemed machine carries that same consistent placement through."""
    co = (await auth_client.post("/companies", json={"name": "Real Co"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    grp = (await auth_client.post(f"/locations/{loc['id']}/groups", json={"name": "IT"})).json()

    r = await auth_client.post("/tokens", json={
        "company_id": co["id"], "location_id": loc["id"], "group_id": grp["id"],
    })
    assert r.status_code == 201, r.text
    token_val = r.json()["token"]

    r2 = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "444444444", "name": "PC-04", "os": "linux",
    })
    assert r2.status_code == 201, r2.text
    assert r2.json()["company_id"] == co["id"]
    assert r2.json()["location_id"] == loc["id"]
    assert r2.json()["group_id"] == grp["id"]


@pytest.mark.asyncio
async def test_token_requires_auth(client):
    r = await client.post("/tokens", json={})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_member_minted_token_redeems_to_pending(member_client, client):
    """A member may enroll a machine but not approve it (see access.
    enrollment_status_for_role): the machine a member's token redeems into
    must land pending, not approved. redeem_token has no caller membership of
    its own -- it's an unauthenticated agent path -- so it has to resolve the
    enroller's role from the token's stored created_by/account_id (see
    access.enrollment_status_for_token)."""
    m_client, _ = member_client
    token_val = (await m_client.post("/tokens", json={})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "500000001", "name": "Member-PC", "os": "linux",
    })
    assert r.status_code == 201, r.text
    assert r.json()["approval_status"] == "pending"


@pytest.mark.asyncio
async def test_admin_minted_token_redeems_to_approved(auth_client, client):
    """The mirror of test_member_minted_token_redeems_to_pending: an admin's
    enrollment is the perimeter decision already, so it lands approved."""
    token_val = (await auth_client.post("/tokens", json={})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "500000002", "name": "Admin-PC", "os": "linux",
    })
    assert r.status_code == 201, r.text
    assert r.json()["approval_status"] == "approved"


async def _second_member(db, auth_client, email):
    """Registers and returns an authenticated client for a second plain
    member of the same account auth_client administers -- the same recipe
    conftest.py's member_client fixture uses, inlined here because this test
    needs two independent members rather than the one member_client gives."""
    from httpx import AsyncClient, ASGITransport
    from sqlalchemy import select as _select
    from models import Membership as _Membership, User as _User
    from main import app as _app
    from deps import get_db as _get_db

    admin_user = (await db.execute(
        _select(_User).where(_User.email == "user@test.com")
    )).scalar_one()
    admin_mem = (await db.execute(
        _select(_Membership).where(_Membership.user_id == admin_user.id)
    )).scalar_one()

    async def override():
        yield db
    _app.dependency_overrides[_get_db] = override

    c = AsyncClient(transport=ASGITransport(app=_app), base_url="http://test")
    await c.post("/auth/register", json={"email": email, "name": "M2", "password": "Test1234!"})
    user = (await db.execute(_select(_User).where(_User.email == email))).scalar_one()
    mem = _Membership(user_id=user.id, account_id=admin_mem.account_id, role="member")
    db.add(mem)
    await db.commit()

    r = await c.post("/auth/login", json={"email": email, "password": "Test1234!"})
    r2 = await c.post(
        "/auth/switch-account",
        json={"account_id": admin_mem.account_id},
        headers={"Authorization": f"Bearer {r.json()['access_token']}"},
    )
    c.headers["Authorization"] = f"Bearer {r2.json()['access_token']}"
    return c


@pytest.mark.asyncio
async def test_members_own_pending_enrollment_visible_only_to_them(auth_client, member_client, client, db):
    """End-to-end version of access.py's
    test_member_sees_own_pending_enrollment_without_a_grant /
    test_member_does_not_see_someone_elses_pending_enrollment, exercised
    through the real token -> redeem -> list path rather than a hand-built
    Machine row. A second member in the same account must not see the first
    member's pending enrollment; the enroller must."""
    m_client, _ = member_client
    other_client = await _second_member(db, auth_client, "member2@test.com")

    token_val = (await m_client.post("/tokens", json={})).json()["token"]
    r = await client.post("/tokens/redeem", json={
        "token": token_val, "peer_id": "500000003", "name": "Member-PC-2", "os": "linux",
    })
    assert r.status_code == 201, r.text
    machine_id = r.json()["id"]
    assert r.json()["approval_status"] == "pending"

    mine = await m_client.get("/machines")
    assert machine_id in [m["id"] for m in mine.json()]

    theirs = await other_client.get("/machines")
    assert machine_id not in [m["id"] for m in theirs.json()]
    await other_client.aclose()


@pytest.mark.asyncio
async def test_redeem_issues_working_api_key(auth_client, db):
    r = await auth_client.post("/tokens", json={})
    assert r.status_code == 201, r.text
    token = r.json()["token"]

    r2 = await auth_client.post("/tokens/redeem", json={
        "token": token, "peer_id": "111111111", "name": "Test Machine", "os": "linux",
    })
    assert r2.status_code == 201, r2.text
    data = r2.json()
    assert data["peer_id"] == "111111111"
    assert data["api_key"].startswith("pd_")

    keys = (await db.execute(select(ApiKey))).scalars().all()
    assert len(keys) == 1
    assert keys[0].key == data["api_key"]
    assert keys[0].auto_approve is True

    machine = (await db.execute(select(Machine).where(Machine.peer_id == "111111111"))).scalar_one()
    assert machine.api_key_id == keys[0].id

    reg = (await db.execute(select(RegistrationToken).where(RegistrationToken.token == token))).scalar_one()
    assert reg.used_at is not None

    # a bogus X-API-Key must be rejected — proves the endpoint authenticates by key
    r_bad = await auth_client.post("/machines/register",
        headers={"X-API-Key": "pd_invalidkey000"},
        json={"peer_id": "999999999", "name": "Nope", "os": "linux"})
    assert r_bad.status_code == 401, r_bad.text

    # the returned key must authenticate a subsequent X-API-Key request
    r3 = await auth_client.post("/machines/register",
        headers={"X-API-Key": data["api_key"]},
        json={"peer_id": "222222222", "name": "Second", "os": "linux"})
    assert r3.status_code == 201, r3.text
