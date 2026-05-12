import pytest


@pytest.mark.asyncio
async def test_create_token(auth_client):
    r = await auth_client.post("/tokens", json={})
    assert r.status_code == 201
    assert len(r.json()["token"]) == 9
    assert r.json()["token"][4] == "-"
    assert r.json()["used_at"] is None


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
