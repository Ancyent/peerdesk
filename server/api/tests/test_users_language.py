import pytest


@pytest.mark.asyncio
async def test_language_defaults_to_null(auth_client):
    r = await auth_client.get("/users/me")
    assert r.status_code == 200
    assert r.json()["language"] is None


@pytest.mark.asyncio
async def test_patch_language_persists(auth_client):
    r = await auth_client.patch("/users/me", json={"language": "ro"})
    assert r.status_code == 200
    assert r.json()["language"] == "ro"
    # persisted across a fresh GET
    r2 = await auth_client.get("/users/me")
    assert r2.json()["language"] == "ro"


@pytest.mark.asyncio
async def test_patch_invalid_language_rejected(auth_client):
    r = await auth_client.patch("/users/me", json={"language": "xx"})
    assert r.status_code == 400
    # unchanged
    r2 = await auth_client.get("/users/me")
    assert r2.json()["language"] in (None, "en", "ro")


@pytest.mark.asyncio
async def test_patch_without_language_leaves_it(auth_client):
    await auth_client.patch("/users/me", json={"language": "en"})
    await auth_client.patch("/users/me", json={"name": "New Name"})
    r = await auth_client.get("/users/me")
    assert r.json()["language"] == "en"  # name-only update didn't clear it
