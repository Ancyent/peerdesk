import pytest


async def _register(client, email):
    r = await client.post("/auth/register", json={"email": email, "name": "U", "password": "pass1234"})
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _make_machine(client, headers, peer_id):
    r = await client.post("/machines", json={"peer_id": peer_id, "name": "PC"}, headers=headers)
    return r.json()["id"]


@pytest.mark.asyncio
async def test_save_get_and_clear_password(client):
    headers = await _register(client, "sp1@b.com")
    mid = await _make_machine(client, headers, "100000001")

    # Initially no saved password.
    lst = await client.get("/machines", headers=headers)
    assert lst.json()[0]["has_saved_password"] is False
    assert (await client.get(f"/machines/{mid}/saved-password", headers=headers)).status_code == 404

    # Save it.
    r = await client.put(f"/machines/{mid}/saved-password", json={"password": "Secret123"}, headers=headers)
    assert r.status_code == 204

    # Flag flips; plaintext round-trips back.
    lst = await client.get("/machines", headers=headers)
    assert lst.json()[0]["has_saved_password"] is True
    got = await client.get(f"/machines/{mid}/saved-password", headers=headers)
    assert got.status_code == 200 and got.json()["password"] == "Secret123"

    # Clear it.
    assert (await client.delete(f"/machines/{mid}/saved-password", headers=headers)).status_code == 204
    lst = await client.get("/machines", headers=headers)
    assert lst.json()[0]["has_saved_password"] is False
    assert (await client.get(f"/machines/{mid}/saved-password", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_saved_password_is_encrypted_at_rest(client, db):
    from sqlalchemy import select
    from models import Machine

    headers = await _register(client, "sp2@b.com")
    mid = await _make_machine(client, headers, "100000002")
    await client.put(f"/machines/{mid}/saved-password", json={"password": "PlainSecret"}, headers=headers)

    row = (await db.execute(select(Machine).where(Machine.id == mid))).scalar_one()
    assert row.saved_password_enc is not None
    assert "PlainSecret" not in row.saved_password_enc  # stored ciphertext, not plaintext


@pytest.mark.asyncio
async def test_saved_password_owner_only(client):
    h1 = await _register(client, "owner@b.com")
    h2 = await _register(client, "intruder@b.com")
    mid = await _make_machine(client, h1, "100000003")
    await client.put(f"/machines/{mid}/saved-password", json={"password": "Secret123"}, headers=h1)

    # A different user cannot read or set another owner's saved password.
    assert (await client.get(f"/machines/{mid}/saved-password", headers=h2)).status_code == 404
    assert (await client.put(f"/machines/{mid}/saved-password", json={"password": "x"}, headers=h2)).status_code == 404


@pytest.mark.asyncio
async def test_empty_password_rejected(client):
    headers = await _register(client, "sp4@b.com")
    mid = await _make_machine(client, headers, "100000004")
    r = await client.put(f"/machines/{mid}/saved-password", json={"password": ""}, headers=headers)
    assert r.status_code == 400
