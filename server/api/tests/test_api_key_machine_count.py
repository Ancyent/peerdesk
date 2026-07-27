"""The key list reports how many machines depend on each key.

Counted server-side. Deriving it in the client from the machines list would be
correct only if the client had loaded every machine, and would under-report
silently otherwise.
"""
import pytest
from models import Account, Machine


async def _key(auth_client, name):
    r = await auth_client.post("/api-keys", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


async def _list(auth_client):
    r = await auth_client.get("/api-keys")
    assert r.status_code == 200, r.text
    return {k["id"]: k for k in r.json()}


@pytest.mark.asyncio
async def test_an_unused_key_reports_zero(auth_client):
    created = await _key(auth_client, "Unused")

    listed = await _list(auth_client)

    assert listed[created["id"]]["machine_count"] == 0


@pytest.mark.asyncio
async def test_the_count_reflects_machines_registered_with_the_key(client, auth_client):
    created = await _key(auth_client, "Busy")
    for peer in ("111111111", "222222222", "333333333"):
        r = await client.post(
            "/machines/register",
            json={"peer_id": peer, "name": f"m{peer}"},
            headers={"X-API-Key": created["key"]},
        )
        assert r.status_code == 201

    listed = await _list(auth_client)

    assert listed[created["id"]]["machine_count"] == 3


@pytest.mark.asyncio
async def test_counts_do_not_bleed_between_keys(client, auth_client):
    first = await _key(auth_client, "First")
    second = await _key(auth_client, "Second")
    r = await client.post(
        "/machines/register",
        json={"peer_id": "444444444", "name": "only-on-first"},
        headers={"X-API-Key": first["key"]},
    )
    assert r.status_code == 201

    listed = await _list(auth_client)

    assert listed[first["id"]]["machine_count"] == 1
    assert listed[second["id"]]["machine_count"] == 0


@pytest.mark.asyncio
async def test_another_accounts_machines_are_not_counted(auth_client, db):
    created = await _key(auth_client, "Mine")
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    # Deliberately carries our key id while sitting in another account: the
    # count must be scoped by account, not by api_key_id alone.
    db.add(Machine(peer_id="555555555", name="not-yours",
                   account_id=other.id, api_key_id=created["id"]))
    await db.commit()

    listed = await _list(auth_client)

    assert listed[created["id"]]["machine_count"] == 0
