"""Team membership and invitations."""
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from models import Invitation, Membership, User


async def test_admin_can_invite_and_token_is_shown_once(auth_client, db):
    r = await auth_client.post("/team/invitations", json={"email": "new@test.com", "role": "member"})
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    assert token

    # Never stored in plaintext -- only its SHA-256.
    inv = (await db.execute(select(Invitation))).scalar_one()
    assert inv.token_hash == hashlib.sha256(token.encode()).hexdigest()

    # The list endpoint must not hand it back.
    listed = (await auth_client.get("/team/invitations")).json()
    assert "token" not in listed[0]


async def test_invitation_is_single_use(auth_client, client):
    token = (await auth_client.post(
        "/team/invitations", json={"email": "one@test.com", "role": "member"}
    )).json()["token"]

    r1 = await client.post("/auth/accept-invite", json={
        "token": token, "name": "One", "password": "Test1234!", "email": "one@test.com",
    })
    assert r1.status_code == 200, r1.text

    r2 = await client.post("/auth/accept-invite", json={
        "token": token, "name": "Two", "password": "Test1234!", "email": "two@test.com",
    })
    assert r2.status_code == 400


async def test_expired_invitation_is_refused(auth_client, client, db):
    token = (await auth_client.post(
        "/team/invitations", json={"email": "late@test.com", "role": "member"}
    )).json()["token"]
    inv = (await db.execute(select(Invitation))).scalar_one()
    inv.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.commit()

    r = await client.post("/auth/accept-invite", json={
        "token": token, "name": "Late", "password": "Test1234!", "email": "late@test.com",
    })
    assert r.status_code == 400


async def test_accepting_joins_the_inviting_account_not_a_new_one(auth_client, client, db):
    """The whole difference from /auth/register. If this creates a second
    account, the colleague is a separate tenant again and Stage 2 bought
    nothing."""
    admin_mem = (await db.execute(select(Membership))).scalars().first()
    token = (await auth_client.post(
        "/team/invitations", json={"email": "join@test.com", "role": "member"}
    )).json()["token"]

    await client.post("/auth/accept-invite", json={
        "token": token, "name": "Join", "password": "Test1234!", "email": "join@test.com",
    })

    joined = (await db.execute(select(User).where(User.email == "join@test.com"))).scalar_one()
    mems = (await db.execute(
        select(Membership).where(Membership.user_id == joined.id)
    )).scalars().all()
    assert len(mems) == 1
    assert mems[0].account_id == admin_mem.account_id
    assert mems[0].role == "member"


async def test_member_cannot_invite(member_client):
    client, _ = member_client
    r = await client.post("/team/invitations", json={"email": "x@test.com", "role": "member"})
    assert r.status_code == 403


async def test_member_cannot_list_the_team(member_client):
    """The team page is hidden from members entirely -- not rendered empty."""
    client, _ = member_client
    assert (await client.get("/team/members")).status_code == 403


async def test_last_admin_cannot_be_demoted(auth_client, db):
    """Otherwise the account is left with nobody who can administer it, and
    recovery requires database access."""
    admin_mem = (await db.execute(
        select(Membership).where(Membership.role == "admin")
    )).scalar_one()
    r = await auth_client.patch(f"/team/members/{admin_mem.id}", json={"role": "member"})
    assert r.status_code == 400, r.text


async def test_last_admin_cannot_be_removed(auth_client, db):
    admin_mem = (await db.execute(
        select(Membership).where(Membership.role == "admin")
    )).scalar_one()
    r = await auth_client.delete(f"/team/members/{admin_mem.id}")
    assert r.status_code == 400, r.text


async def test_admin_cannot_touch_another_accounts_membership(auth_client, client, db):
    """Cross-account isolation on the team endpoints themselves. 404, not 403 --
    the caller must not learn the membership exists."""
    await client.post("/auth/register", json={
        "email": "outsider@test.com", "name": "Out", "password": "Test1234!",
    })
    outsider = (await db.execute(
        select(User).where(User.email == "outsider@test.com")
    )).scalar_one()
    foreign_mem = (await db.execute(
        select(Membership).where(Membership.user_id == outsider.id)
    )).scalar_one()

    assert (await auth_client.patch(
        f"/team/members/{foreign_mem.id}", json={"role": "member"}
    )).status_code == 404
    assert (await auth_client.delete(f"/team/members/{foreign_mem.id}")).status_code == 404
