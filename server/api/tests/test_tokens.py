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
async def test_token_requires_auth(client):
    r = await client.post("/tokens", json={})
    assert r.status_code == 403


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
