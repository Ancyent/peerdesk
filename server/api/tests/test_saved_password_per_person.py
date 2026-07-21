"""Saved connect passwords belong to a person, not to a machine.

The point is revocation. The password reaches the member's client either way --
connecting is client-side and the viewer sends the password to signaling -- so
hiding it from the UI would be decoration. What a per-person copy buys is that
removing someone's grant removes their stored credential.
"""
import pytest
from sqlalchemy import select

from models import AccessGrant, Membership, SavedConnectPassword


async def _grant_machine(db, membership_id, machine_id):
    db.add(AccessGrant(membership_id=membership_id, machine_id=machine_id))
    await db.commit()


async def _grant_company(db, membership_id, company_id):
    db.add(AccessGrant(membership_id=membership_id, company_id=company_id))
    await db.commit()


async def _reload(db, membership_id):
    return (await db.execute(
        select(Membership).where(Membership.id == membership_id)
    )).scalar_one()


async def test_two_people_hold_independent_copies(auth_client, member_client, db):
    """The admin's saved password is not the member's. If they shared a row,
    one clearing it would silently clear the other's."""
    client, membership_id = member_client
    r = await auth_client.post("/machines", json={"peer_id": "AAA-1111", "name": "M"})
    assert r.status_code == 201, r.text
    machine_id = r.json()["id"]
    await _grant_machine(db, membership_id, machine_id)

    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})
    await client.put(f"/machines/{machine_id}/saved-password", json={"password": "member-pw"})

    assert (await auth_client.get(f"/machines/{machine_id}/saved-password")).json()["password"] == "admin-pw"
    assert (await client.get(f"/machines/{machine_id}/saved-password")).json()["password"] == "member-pw"


async def test_clearing_one_copy_leaves_the_other(auth_client, member_client, db):
    client, membership_id = member_client
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "BBB-2222", "name": "M"}
    )).json()["id"]
    await _grant_machine(db, membership_id, machine_id)

    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})
    await client.put(f"/machines/{machine_id}/saved-password", json={"password": "member-pw"})

    await client.delete(f"/machines/{machine_id}/saved-password")

    assert (await auth_client.get(f"/machines/{machine_id}/saved-password")).status_code == 200
    assert (await client.get(f"/machines/{machine_id}/saved-password")).status_code == 404


async def test_has_saved_password_is_per_caller(auth_client, member_client, db):
    """MachineOut.has_saved_password used to read a column on the machine. It is
    now a fact about the caller, so the member must see false while the admin
    sees true for the same machine."""
    client, membership_id = member_client
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "CCC-3333", "name": "M"}
    )).json()["id"]
    await _grant_machine(db, membership_id, machine_id)
    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})

    assert (await auth_client.get(f"/machines/{machine_id}")).json()["has_saved_password"] is True
    assert (await client.get(f"/machines/{machine_id}")).json()["has_saved_password"] is False


async def test_revoking_the_grant_deletes_the_members_copy(auth_client, member_client, db):
    """This is what per-person storage is for. Deleting the grant must delete
    the credential, not merely hide the machine."""
    from access import sync_saved_passwords

    client, membership_id = member_client
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "DDD-4444", "name": "M"}
    )).json()["id"]
    await _grant_machine(db, membership_id, machine_id)
    await client.put(f"/machines/{machine_id}/saved-password", json={"password": "member-pw"})

    grant = (await db.execute(
        select(AccessGrant).where(AccessGrant.membership_id == membership_id)
    )).scalar_one()
    await db.delete(grant)
    await db.commit()

    deleted = await sync_saved_passwords(db, await _reload(db, membership_id))

    assert deleted == 1
    assert (await db.execute(
        select(SavedConnectPassword).where(SavedConnectPassword.membership_id == membership_id)
    )).scalars().all() == []


async def test_a_remaining_grant_keeps_the_copy(auth_client, member_client, db):
    """Grants are additive, so losing one does not imply losing access. A sync
    that deleted on any grant change would destroy working credentials."""
    from access import sync_saved_passwords

    client, membership_id = member_client
    company_id = (await auth_client.post("/companies", json={"name": "Co"})).json()["id"]
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "EEE-5555", "name": "M"}
    )).json()["id"]
    await auth_client.patch(f"/machines/{machine_id}/placement", json={"company_id": company_id})

    db.add(AccessGrant(membership_id=membership_id, machine_id=machine_id))
    db.add(AccessGrant(membership_id=membership_id, company_id=company_id))
    await db.commit()
    await client.put(f"/machines/{machine_id}/saved-password", json={"password": "member-pw"})

    machine_grant = (await db.execute(
        select(AccessGrant).where(
            AccessGrant.membership_id == membership_id,
            AccessGrant.machine_id == machine_id,
        )
    )).scalar_one()
    await db.delete(machine_grant)
    await db.commit()

    deleted = await sync_saved_passwords(db, await _reload(db, membership_id))

    assert deleted == 0
    assert (await client.get(f"/machines/{machine_id}/saved-password")).status_code == 200


async def test_approve_reports_the_callers_saved_password(auth_client, db):
    """approve_machine returns the ORM Machine straight through MachineOut.
    That object has no has_saved_password attribute any more (it moved to
    SavedConnectPassword), so the response must be built through
    _to_machine_out rather than handed back as-is, or it silently reports
    False no matter what the caller has stored."""
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "FFF-6666", "name": "M"}
    )).json()["id"]
    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})

    r = await auth_client.post(f"/machines/{machine_id}/approve")

    assert r.status_code == 200, r.text
    assert r.json()["has_saved_password"] is True


async def test_deny_reports_the_callers_saved_password(auth_client, db):
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "GGG-7777", "name": "M"}
    )).json()["id"]
    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})

    r = await auth_client.post(f"/machines/{machine_id}/deny")

    assert r.status_code == 200, r.text
    assert r.json()["has_saved_password"] is True


async def test_set_placement_reports_the_callers_saved_password(auth_client, db):
    company_id = (await auth_client.post("/companies", json={"name": "Co"})).json()["id"]
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "HHH-8888", "name": "M"}
    )).json()["id"]
    await auth_client.put(f"/machines/{machine_id}/saved-password", json={"password": "admin-pw"})

    r = await auth_client.patch(f"/machines/{machine_id}/placement", json={"company_id": company_id})

    assert r.status_code == 200, r.text
    assert r.json()["has_saved_password"] is True


# --- Finding 2: sync_saved_passwords was missing from paths that shrink
# access out from under a member without ever calling it. Each of these was
# a genuine revocation -- a grant moved or vanished -- that used to leave the
# member's stored credential live, ready to resurrect the moment the machine
# or node came back. ---


async def test_moving_a_machine_out_of_a_granted_company_deletes_the_saved_password(
    auth_client, member_client, db,
):
    """set_placement moving a machine out of a granted company must revoke
    every member granted that company, the same as any other access change
    -- see access.sync_saved_passwords_for_account and its call in
    routers/machines.py's set_placement."""
    client, membership_id = member_client
    company_a = (await auth_client.post("/companies", json={"name": "A"})).json()["id"]
    company_b = (await auth_client.post("/companies", json={"name": "B"})).json()["id"]
    machine_id = (await auth_client.post(
        "/machines", json={"peer_id": "III-1001", "name": "M"}
    )).json()["id"]
    await auth_client.patch(f"/machines/{machine_id}/placement", json={"company_id": company_a})
    await _grant_company(db, membership_id, company_a)
    await client.put(f"/machines/{machine_id}/saved-password", json={"password": "member-pw"})
    assert (await client.get(f"/machines/{machine_id}/saved-password")).status_code == 200

    r = await auth_client.patch(f"/machines/{machine_id}/placement", json={"company_id": company_b})
    assert r.status_code == 200, r.text

    remaining = (await db.execute(
        select(SavedConnectPassword).where(SavedConnectPassword.membership_id == membership_id)
    )).scalars().all()
    assert remaining == []


# The three delete tests below prove wiring (the router calls
# access.sync_saved_passwords_for_account) rather than exercising the actual
# cascade end-to-end. AccessGrant's tree FKs are ON DELETE CASCADE, enforced
# by Postgres (production) but NOT by SQLite (what this whole suite runs
# against, and deliberately so -- see the note below). Under SQLite, deleting
# the company/location/group here would leave the AccessGrant row dangling
# instead of cascading away, so a real end-to-end assertion ("the saved
# password is gone") would pass or fail for the wrong reason depending on a
# database quirk unrelated to the code under test. sync_saved_passwords_for_
# account's own cleanup logic (given a grant that is actually gone) is
# already proven directly by test_revoking_the_grant_deletes_the_members_copy
# above; what these three need to prove is narrower and DB-independent: that
# the router calls it at all.
#
# (Enabling `PRAGMA foreign_keys=ON` for the test engine was tried and
# reverted -- it surfaced 27 unrelated failures across test_grants.py and
# elsewhere, because SQLAlchemy's unit-of-work only orders inserts across
# mapper pairs that have a declared `relationship()`; Machine's placement
# columns are plain ForeignKey columns with none, so nothing orders
# Company/Location/Group inserts ahead of Machine inserts without an
# explicit intermediate flush(). Fixing that suite-wide is a real
# improvement but a separate, larger change, and this pass gates a
# production deploy -- not the moment to take on that blast radius.)


async def _spy_sync(monkeypatch):
    """Replaces access.sync_saved_passwords_for_account with a spy that
    records its account_id argument and does nothing else. Patched on the
    `access` module object itself (not the routers' `import access` names)
    so every router that does `access.sync_saved_passwords_for_account(...)`
    picks it up, matching how they actually call it."""
    import access as access_module
    calls = []

    async def fake(db_arg, account_id):
        calls.append(account_id)
        return 0

    monkeypatch.setattr(access_module, "sync_saved_passwords_for_account", fake)
    return calls


async def _account_id_of(db, membership_id):
    membership = (await db.execute(
        select(Membership).where(Membership.id == membership_id)
    )).scalar_one()
    return membership.account_id


async def test_deleting_a_company_syncs_saved_passwords_for_the_account(
    auth_client, member_client, db, monkeypatch,
):
    """AccessGrant's company_id FK is ON DELETE CASCADE, so deleting the
    company silently deletes every grant on it in production -- a revocation
    performed by the database with no sync unless delete_company calls
    access.sync_saved_passwords_for_account itself (see
    routers/companies.py)."""
    _, membership_id = member_client
    calls = await _spy_sync(monkeypatch)
    account_id = await _account_id_of(db, membership_id)
    company_id = (await auth_client.post("/companies", json={"name": "Co"})).json()["id"]

    r = await auth_client.delete(f"/companies/{company_id}")

    assert r.status_code == 204, r.text
    assert calls == [account_id]


async def test_deleting_a_location_syncs_saved_passwords_for_the_account(
    auth_client, member_client, db, monkeypatch,
):
    """Same as the company case, one level down the tree -- see
    routers/locations.py's delete_location."""
    _, membership_id = member_client
    company_id = (await auth_client.post("/companies", json={"name": "Co"})).json()["id"]
    location_id = (await auth_client.post(
        f"/companies/{company_id}/locations", json={"name": "HQ"}
    )).json()["id"]
    calls = await _spy_sync(monkeypatch)
    account_id = await _account_id_of(db, membership_id)

    r = await auth_client.delete(f"/locations/{location_id}")

    assert r.status_code == 204, r.text
    assert calls == [account_id]


async def test_deleting_a_group_syncs_saved_passwords_for_the_account(
    auth_client, member_client, db, monkeypatch,
):
    """Same again, at the bottom of the tree -- see routers/groups.py's
    delete_group."""
    _, membership_id = member_client
    company_id = (await auth_client.post("/companies", json={"name": "Co"})).json()["id"]
    location_id = (await auth_client.post(
        f"/companies/{company_id}/locations", json={"name": "HQ"}
    )).json()["id"]
    group_id = (await auth_client.post(
        f"/locations/{location_id}/groups", json={"name": "IT"}
    )).json()["id"]
    calls = await _spy_sync(monkeypatch)
    account_id = await _account_id_of(db, membership_id)

    r = await auth_client.delete(f"/groups/{group_id}")

    assert r.status_code == 204, r.text
    assert calls == [account_id]
