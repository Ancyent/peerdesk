import pytest
from sqlalchemy import select
from models import Account, Machine, Membership, SavedConnectPassword, User
from crypto_box import encrypt_secret


@pytest.mark.asyncio
async def test_machines_from_another_account_are_invisible(auth_client, db):
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    db.add(Machine(peer_id="999999999", name="not-yours", account_id=other.id))
    await db.commit()

    r = await auth_client.get("/machines")
    assert r.status_code == 200
    assert "not-yours" not in [m["name"] for m in r.json()]


@pytest.mark.asyncio
async def test_fetching_another_accounts_machine_returns_404(auth_client, db):
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    m = Machine(peer_id="888888888", name="not-yours", account_id=other.id)
    db.add(m)
    await db.commit()

    r = await auth_client.get(f"/machines/{m.id}")
    assert r.status_code == 404, "must be 404, not 403 — existence itself is private"


@pytest.mark.asyncio
async def test_machine_owned_by_caller_but_moved_to_another_account_is_invisible(auth_client, db):
    """The load-bearing case for this task: authorization must key off account_id,
    not who created the machine. A machine the caller created (created_by_id),
    but that now belongs to a different account, must not be visible or
    reachable — proves the router no longer falls back to identity of the
    creator under the hood."""
    me = (await db.execute(select(User).where(User.email == "user@test.com"))).scalar_one()
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    m = Machine(peer_id="777777777", name="moved-away", account_id=other.id, created_by_id=me.id)
    db.add(m)
    await db.commit()

    r = await auth_client.get("/machines")
    assert r.status_code == 200
    assert "moved-away" not in [x["name"] for x in r.json()]

    r2 = await auth_client.get(f"/machines/{m.id}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_machine_owned_by_a_different_user_in_my_account_is_visible(auth_client, db):
    """The reciprocal case: a teammate's machine, registered under a different
    user id, must be visible to me as long as it's in my account — proves the
    router grants access by account_id rather than restricting to whoever
    created the machine."""
    me = (await db.execute(select(User).where(User.email == "user@test.com"))).scalar_one()
    my_membership = (await db.execute(select(Membership).where(Membership.user_id == me.id))).scalar_one()

    teammate = User(email="teammate@test.com", name="Teammate", password_hash="x")
    db.add(teammate)
    await db.flush()
    m = Machine(peer_id="666666666", name="teammates-pc", account_id=my_membership.account_id, created_by_id=teammate.id)
    db.add(m)
    await db.commit()

    r = await auth_client.get("/machines")
    assert r.status_code == 200
    assert "teammates-pc" in [x["name"] for x in r.json()]

    r2 = await auth_client.get(f"/machines/{m.id}")
    assert r2.status_code == 200


async def _other_account_machine(db, **kwargs) -> Machine:
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    m = Machine(
        peer_id=kwargs.pop("peer_id"),
        name=kwargs.pop("name", "not-yours"),
        account_id=other.id,
        **kwargs,
    )
    db.add(m)
    await db.commit()
    return m


@pytest.mark.asyncio
async def test_approving_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000001")
    r = await auth_client.post(f"/machines/{m.id}/approve")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_denying_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000002")
    r = await auth_client.post(f"/machines/{m.id}/deny")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_deleting_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000003")
    r = await auth_client.delete(f"/machines/{m.id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_placing_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000004")
    r = await auth_client.patch(f"/machines/{m.id}/placement", json={"company_id": None})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_setting_saved_password_on_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000005")
    r = await auth_client.put(f"/machines/{m.id}/saved-password", json={"password": "Secret123"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_clearing_saved_password_on_another_accounts_machine_returns_404(auth_client, db):
    m = await _other_account_machine(db, peer_id="700000006")
    r = await auth_client.delete(f"/machines/{m.id}/saved-password")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_getting_saved_password_on_another_accounts_machine_returns_404(auth_client, db):
    """The worst-case leak in this router: a saved connect password is
    plaintext once decrypted, so this route above all must not let a caller
    outside the machine's account reach it.

    Saved passwords are now per (membership, machine) (see
    models.SavedConnectPassword), so proving the leak is closed requires a
    real row belonging to a membership in the *other* account -- setting an
    attribute on the Machine instance, as the old per-machine-column version
    of this test did, would silently do nothing now that the column is gone."""
    m = await _other_account_machine(db, peer_id="700000007")
    other_user = User(email="otherowner@test.com", name="Other Owner", password_hash="x")
    db.add(other_user)
    await db.flush()
    other_membership = Membership(user_id=other_user.id, account_id=m.account_id, role="admin")
    db.add(other_membership)
    await db.flush()
    db.add(SavedConnectPassword(
        membership_id=other_membership.id,
        machine_id=m.id,
        password_enc=encrypt_secret("OtherAccountsSecret"),
    ))
    await db.commit()

    r = await auth_client.get(f"/machines/{m.id}/saved-password")
    assert r.status_code == 404
    assert "OtherAccountsSecret" not in r.text


@pytest.mark.asyncio
async def test_register_machine_stamps_account_id(auth_client, db):
    my_membership = (await db.execute(select(Membership))).scalars().first()
    r = await auth_client.post("/machines", json={"peer_id": "700000008", "name": "PC"})
    assert r.status_code == 201
    machine_id = r.json()["id"]

    row = (await db.execute(select(Machine).where(Machine.id == machine_id))).scalar_one()
    assert row.account_id == my_membership.account_id


@pytest.mark.asyncio
async def test_admin_registering_a_machine_directly_lands_approved(auth_client):
    """The admin path through POST /machines: an admin's enrollment is the
    perimeter decision already, so it lands approved -- see
    access.enrollment_status_for_role."""
    r = await auth_client.post("/machines", json={"peer_id": "700000009", "name": "Admin PC"})
    assert r.status_code == 201, r.text
    assert r.json()["approval_status"] == "approved"


@pytest.mark.asyncio
async def test_member_registering_a_machine_directly_lands_pending(member_client):
    """A member may enroll a machine but not approve it, so POST /machines
    called by a member (not just the token/redeem path) must also land
    pending -- see access.enrollment_status_for_role and its call in
    routers/machines.py's register_machine."""
    client, _ = member_client
    r = await client.post("/machines", json={"peer_id": "700000010", "name": "Member PC"})
    assert r.status_code == 201, r.text
    assert r.json()["approval_status"] == "pending"
