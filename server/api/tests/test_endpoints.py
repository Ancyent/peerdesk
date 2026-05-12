import pytest


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_register_and_login(client):
    r = await client.post("/auth/register", json={"email": "a@b.com", "name": "Alice", "password": "pass1234"})
    assert r.status_code == 201
    data = r.json()
    assert "access_token" in data
    assert "refresh_token" in data

    r2 = await client.post("/auth/login", json={"email": "a@b.com", "password": "pass1234"})
    assert r2.status_code == 200


async def test_duplicate_register(client):
    body = {"email": "dup@b.com", "name": "Dup", "password": "pass1234"}
    await client.post("/auth/register", json=body)
    r = await client.post("/auth/register", json=body)
    assert r.status_code == 409


async def test_wrong_password(client):
    await client.post("/auth/register", json={"email": "e@b.com", "name": "E", "password": "pass1234"})
    r = await client.post("/auth/login", json={"email": "e@b.com", "password": "wrong"})
    assert r.status_code == 401


async def test_token_refresh(client):
    r = await client.post("/auth/register", json={"email": "ref@b.com", "name": "Ref", "password": "pass1234"})
    refresh = r.json()["refresh_token"]
    r2 = await client.post("/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 200
    assert "access_token" in r2.json()


async def test_register_and_list_machines(client):
    r = await client.post("/auth/register", json={"email": "b@b.com", "name": "Bob", "password": "pass1234"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r2 = await client.post("/machines", json={"peer_id": "123456789", "name": "My PC"}, headers=headers)
    assert r2.status_code == 201
    assert r2.json()["peer_id"] == "123456789"

    r3 = await client.get("/machines", headers=headers)
    assert r3.status_code == 200
    assert len(r3.json()) == 1


async def test_get_me(client):
    r = await client.post("/auth/register", json={"email": "me@b.com", "name": "Me", "password": "pass1234"})
    token = r.json()["access_token"]
    r2 = await client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == "me@b.com"


async def test_machines_isolated_between_users(client):
    r1 = await client.post("/auth/register", json={"email": "u1@b.com", "name": "U1", "password": "pass1234"})
    t1 = r1.json()["access_token"]
    r2 = await client.post("/auth/register", json={"email": "u2@b.com", "name": "U2", "password": "pass1234"})
    t2 = r2.json()["access_token"]

    await client.post("/machines", json={"peer_id": "111111111"}, headers={"Authorization": f"Bearer {t1}"})
    r3 = await client.get("/machines", headers={"Authorization": f"Bearer {t2}"})
    assert r3.json() == []


async def test_get_turn_credentials(client):
    r = await client.post("/auth/register", json={"email": "turn@b.com", "name": "Turn", "password": "pass1234"})
    token = r.json()["access_token"]
    r2 = await client.get("/turn/credentials", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert "urls" in data
    assert len(data["urls"]) >= 1
    assert "username" in data
    assert "credential" in data
    assert ":" in data["username"]  # format: "<timestamp>:<user_id>"
    assert data["ttl"] == 3600


async def test_start_and_end_session(client):
    # Start a session
    r = await client.post("/sessions", json={
        "host_peer_id": "123456789",
        "connection_type": "p2p"
    })
    assert r.status_code == 201
    data = r.json()
    assert data["host_peer_id"] == "123456789"
    assert data["ended_at"] is None
    session_id = data["id"]

    # End the session
    r2 = await client.patch(f"/sessions/{session_id}/end")
    assert r2.status_code == 204


async def test_end_nonexistent_session(client):
    r = await client.patch("/sessions/nonexistent-id/end")
    assert r.status_code == 404
