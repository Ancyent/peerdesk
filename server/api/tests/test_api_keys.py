import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_api_key(auth_client: AsyncClient):
    resp = await auth_client.post("/api-keys", json={"name": "Deploy Key"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["key"].startswith("pd_")
    assert data["name"] == "Deploy Key"
    assert data["auto_approve"] is False


@pytest.mark.asyncio
async def test_list_api_keys(auth_client: AsyncClient):
    await auth_client.post("/api-keys", json={"name": "Key A"})
    await auth_client.post("/api-keys", json={"name": "Key B"})
    resp = await auth_client.get("/api-keys")
    assert resp.status_code == 200
    assert len(resp.json()) >= 2


@pytest.mark.asyncio
async def test_revoke_api_key(auth_client: AsyncClient):
    create = await auth_client.post("/api-keys", json={"name": "Temp"})
    key_id = create.json()["id"]
    resp = await auth_client.delete(f"/api-keys/{key_id}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_list_api_keys_excludes_keys_from_another_account(auth_client: AsyncClient, db):
    """A multi-account user's key list must be scoped to the active account,
    not to every account they happen to belong to."""
    from sqlalchemy import select
    from models import User, Account, Membership

    result = await db.execute(select(User).where(User.email == "user@test.com"))
    user = result.scalar_one()

    other_account = Account(name="Other Account")
    db.add(other_account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=other_account.id, role="admin"))
    await db.commit()

    switch = await auth_client.post("/auth/switch-account", json={"account_id": other_account.id})
    other_token = switch.json()["access_token"]

    create = await auth_client.post(
        "/api-keys", json={"name": "Other Account Key"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert create.status_code == 201
    other_key_id = create.json()["id"]

    resp = await auth_client.get("/api-keys")
    assert resp.status_code == 200
    ids = [k["id"] for k in resp.json()]
    assert other_key_id not in ids


@pytest.mark.asyncio
async def test_revoke_api_key_from_another_account_returns_404(auth_client: AsyncClient, db):
    """Revoking a key that belongs to another of the caller's accounts must
    404, not succeed -- the active account, not the user, owns the key."""
    from sqlalchemy import select
    from models import User, Account, Membership

    result = await db.execute(select(User).where(User.email == "user@test.com"))
    user = result.scalar_one()

    other_account = Account(name="Other Account")
    db.add(other_account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=other_account.id, role="admin"))
    await db.commit()

    switch = await auth_client.post("/auth/switch-account", json={"account_id": other_account.id})
    other_token = switch.json()["access_token"]

    create = await auth_client.post(
        "/api-keys", json={"name": "Other Account Key"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert create.status_code == 201
    other_key_id = create.json()["id"]

    resp = await auth_client.delete(f"/api-keys/{other_key_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_register_machine_via_api_key_pending(client: AsyncClient, auth_client: AsyncClient):
    create = await auth_client.post("/api-keys", json={"name": "Test Key"})
    api_key = create.json()["key"]
    resp = await client.post(
        "/machines/register",
        json={"peer_id": "111222333", "name": "Test PC"},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["approval_status"] == "pending"
    assert data["peer_id"] == "111222333"


@pytest.mark.asyncio
async def test_register_machine_via_api_key_auto_approve(client: AsyncClient, auth_client: AsyncClient):
    create = await auth_client.post("/api-keys", json={"name": "Auto Key", "auto_approve": True})
    api_key = create.json()["key"]
    resp = await client.post(
        "/machines/register",
        json={"peer_id": "444555666", "name": "Auto PC"},
        headers={"X-API-Key": api_key},
    )
    assert resp.status_code == 201
    assert resp.json()["approval_status"] == "approved"


@pytest.mark.asyncio
async def test_approve_machine(auth_client: AsyncClient, client: AsyncClient):
    create_key = await auth_client.post("/api-keys", json={"name": "K"})
    api_key = create_key.json()["key"]
    reg = await client.post("/machines/register", json={"peer_id": "777888999"}, headers={"X-API-Key": api_key})
    machine_id = reg.json()["id"]
    resp = await auth_client.post(f"/machines/{machine_id}/approve")
    assert resp.status_code == 200
    assert resp.json()["approval_status"] == "approved"


@pytest.mark.asyncio
async def test_deny_machine(auth_client: AsyncClient, client: AsyncClient):
    create_key = await auth_client.post("/api-keys", json={"name": "K2"})
    api_key = create_key.json()["key"]
    reg = await client.post("/machines/register", json={"peer_id": "123123123"}, headers={"X-API-Key": api_key})
    machine_id = reg.json()["id"]
    resp = await auth_client.post(f"/machines/{machine_id}/deny")
    assert resp.status_code == 200
    assert resp.json()["approval_status"] == "denied"


@pytest.mark.asyncio
async def test_list_machines_filter_by_status(auth_client: AsyncClient, client: AsyncClient):
    create_key = await auth_client.post("/api-keys", json={"name": "K3"})
    api_key = create_key.json()["key"]
    await client.post("/machines/register", json={"peer_id": "991991991"}, headers={"X-API-Key": api_key})
    pending = await auth_client.get("/machines?status=pending")
    assert any(m["peer_id"] == "991991991" for m in pending.json())


@pytest.mark.asyncio
async def test_get_machine_approval_status(client: AsyncClient, auth_client: AsyncClient):
    create_key = await auth_client.post("/api-keys", json={"name": "K4"})
    api_key = create_key.json()["key"]
    await client.post("/machines/register", json={"peer_id": "556677889"}, headers={"X-API-Key": api_key})
    resp = await client.get("/machines/status/556677889", headers={"X-API-Key": api_key})
    assert resp.status_code == 200
    assert resp.json()["approval_status"] in ("pending", "approved", "denied")
