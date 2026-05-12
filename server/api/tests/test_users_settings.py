import pytest


@pytest.mark.asyncio
async def test_update_name(auth_client):
    r = await auth_client.patch("/users/me", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_update_email(auth_client):
    r = await auth_client.patch("/users/me", json={"email": "new@test.com"})
    assert r.status_code == 200
    assert r.json()["email"] == "new@test.com"


@pytest.mark.asyncio
async def test_change_password(auth_client):
    r = await auth_client.post("/users/me/password", json={
        "current_password": "Test1234!", "new_password": "NewPass5678!"
    })
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_change_password_wrong_current(auth_client):
    r = await auth_client.post("/users/me/password", json={
        "current_password": "WRONG", "new_password": "NewPass5678!"
    })
    assert r.status_code == 400
