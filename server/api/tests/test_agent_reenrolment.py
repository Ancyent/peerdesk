"""Re-enrolling an agent that was already registered.

The real-world flow this covers: a machine is registered, later the client is
uninstalled and reinstalled, and the operator hands the fresh agent a NEW API
key from the same account.

Before this was fixed, that dead-ended. `POST /machines/register` rejected the
stored peer_id with 409 (its duplicate check was global), the agent fell through
to `GET /machines/status/{peer_id}`, and that query required the machine to
belong to the *calling key* — so it answered 404 forever. The operator saw
"status check failed: 404" with no way to act on it, for a machine sitting in
their own dashboard, approved.

Ownership is an account-level property. Which key enrolled a machine is
provenance, not authorisation — every other route in the machines router
already scopes by account_id.
"""
import pytest
from models import Account, Machine


async def _key(auth_client, name, auto_approve=False):
    r = await auth_client.post(
        "/api-keys", json={"name": name, "auto_approve": auto_approve}
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["key"]


@pytest.mark.asyncio
async def test_status_check_works_with_another_key_from_the_same_account(
    client, auth_client
):
    """The exact 404 the agent reported."""
    first = await _key(auth_client, "Original Key")
    reg = await client.post(
        "/machines/register",
        json={"peer_id": "501531939", "name": "WIN-BOX"},
        headers={"X-API-Key": first},
    )
    assert reg.status_code == 201

    # Client reinstalled; operator issues a fresh key from the same account.
    second = await _key(auth_client, "Replacement Key")

    r = await client.get("/machines/status/501531939", headers={"X-API-Key": second})
    assert r.status_code == 200, "a second key of the same account must see the machine"
    assert r.json()["approval_status"] == "pending"


@pytest.mark.asyncio
async def test_status_check_still_hidden_from_another_account(client, auth_client, db):
    """Account isolation is the boundary that matters and must not soften."""
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    db.add(Machine(peer_id="999000111", name="not-yours", account_id=other.id))
    await db.commit()

    mine = await _key(auth_client, "My Key")

    r = await client.get("/machines/status/999000111", headers={"X-API-Key": mine})
    assert r.status_code == 404, "must stay 404 — existence itself is private"


@pytest.mark.asyncio
async def test_reinstalling_with_a_new_key_re_enrols_the_machine(client, auth_client):
    first = await _key(auth_client, "Original Key")
    reg = await client.post(
        "/machines/register",
        json={"peer_id": "222333444", "name": "OLD-NAME"},
        headers={"X-API-Key": first},
    )
    assert reg.status_code == 201
    machine_id = reg.json()["id"]

    second = await _key(auth_client, "Replacement Key")
    again = await client.post(
        "/machines/register",
        json={"peer_id": "222333444", "name": "NEW-NAME"},
        headers={"X-API-Key": second},
    )

    assert again.status_code == 200, "re-enrolment should succeed, not 409"
    body = again.json()
    assert body["id"] == machine_id, "must adopt the existing machine, not create a second"
    assert body["name"] == "NEW-NAME", "the reinstalled agent's details should win"


@pytest.mark.asyncio
async def test_re_enrolment_keeps_an_approved_machine_approved(client, auth_client):
    """Reinstalling a client must not silently demote it back to pending."""
    first = await _key(auth_client, "Original Key", auto_approve=True)
    reg = await client.post(
        "/machines/register",
        json={"peer_id": "333444555", "name": "BOX"},
        headers={"X-API-Key": first},
    )
    assert reg.json()["approval_status"] == "approved"

    second = await _key(auth_client, "Manual Key", auto_approve=False)
    again = await client.post(
        "/machines/register",
        json={"peer_id": "333444555", "name": "BOX"},
        headers={"X-API-Key": second},
    )

    assert again.status_code == 200
    assert again.json()["approval_status"] == "approved"


@pytest.mark.asyncio
async def test_re_enrolment_under_an_auto_approve_key_approves_a_pending_machine(
    client, auth_client
):
    first = await _key(auth_client, "Manual Key", auto_approve=False)
    reg = await client.post(
        "/machines/register",
        json={"peer_id": "444555777", "name": "BOX"},
        headers={"X-API-Key": first},
    )
    assert reg.json()["approval_status"] == "pending"

    second = await _key(auth_client, "Auto Key", auto_approve=True)
    again = await client.post(
        "/machines/register",
        json={"peer_id": "444555777", "name": "BOX"},
        headers={"X-API-Key": second},
    )

    assert again.status_code == 200
    assert again.json()["approval_status"] == "approved"


@pytest.mark.asyncio
async def test_a_peer_id_owned_by_another_account_is_still_refused(
    client, auth_client, db
):
    """Adoption is scoped to the account. Knowing a peer_id must never be
    enough to pull a machine out of somebody else's account."""
    other = Account(name="Other Co")
    db.add(other)
    await db.flush()
    db.add(Machine(peer_id="555666888", name="not-yours", account_id=other.id))
    await db.commit()

    mine = await _key(auth_client, "My Key")
    r = await client.post(
        "/machines/register",
        json={"peer_id": "555666888", "name": "mine-now"},
        headers={"X-API-Key": mine},
    )

    assert r.status_code == 409, "cross-account peer_id must still be refused"
