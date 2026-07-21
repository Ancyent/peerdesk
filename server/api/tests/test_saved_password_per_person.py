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
