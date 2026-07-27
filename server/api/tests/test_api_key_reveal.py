"""Revealing a stored API key, gated on the caller's password.

Possible only because keys are stored in plaintext — see docs/SECURITY-NOTES.md
for why that is a recorded, accepted risk rather than an oversight.
"""
import pytest
from models import Account, ApiKey

# The password conftest.py:51 registers for the auth_client user.
PASSWORD = "Test1234!"


@pytest.mark.asyncio
async def test_an_admin_with_the_right_password_sees_the_key(auth_client):
    created = await auth_client.post("/api-keys", json={"name": "K"})
    key_id = created.json()["id"]
    original = created.json()["key"]

    r = await auth_client.post(f"/api-keys/{key_id}/reveal", json={"password": PASSWORD})

    assert r.status_code == 200
    assert r.json()["key"] == original


@pytest.mark.asyncio
async def test_a_wrong_password_is_refused(auth_client):
    created = await auth_client.post("/api-keys", json={"name": "K"})
    key_id = created.json()["id"]

    r = await auth_client.post(
        f"/api-keys/{key_id}/reveal", json={"password": "not-my-password"}
    )

    assert r.status_code == 403
    assert "key" not in r.json()


@pytest.mark.asyncio
async def test_a_key_from_another_account_is_404_even_with_the_right_password(
    auth_client, db
):
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    theirs = ApiKey(name="theirs", created_by="someone", account_id=other.id)
    db.add(theirs)
    await db.commit()

    r = await auth_client.post(f"/api-keys/{theirs.id}/reveal", json={"password": PASSWORD})

    assert r.status_code == 404, "must be 404, not 403 — existence itself is private"


@pytest.mark.asyncio
async def test_a_non_admin_cannot_reveal(member_client, auth_client):
    created = await auth_client.post("/api-keys", json={"name": "K"})
    key_id = created.json()["id"]

    client, _ = member_client
    r = await client.post(f"/api-keys/{key_id}/reveal", json={"password": PASSWORD})

    assert r.status_code in (403, 404)
