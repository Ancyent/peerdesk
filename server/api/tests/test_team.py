"""Team membership and invitations."""
import hashlib
from datetime import datetime, timedelta, timezone

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


# --- Fix pass: accept-invite must not be a second, 2FA-less login path -----

async def test_totp_enabled_users_password_cannot_accept_invite(auth_client, client, db):
    """Finding 1 (critical): the old endpoint verified the password of an
    existing-email match and minted a full session, without ever checking
    user.totp_enabled the way /auth/login does. An attacker holding Bob's
    password but unable to pass Bob's 2FA must not get a session for Bob
    through this endpoint. The fix removes password auth for existing users
    entirely, so this is really a 409-not-a-session assertion, grounded in
    the TOTP scenario that motivated the finding."""
    import pyotp

    bob_password = "Test1234!"
    r = await client.post("/auth/register", json={
        "email": "bob@test.com", "name": "Bob", "password": bob_password,
    })
    bob_token = r.json()["access_token"]
    r2 = await client.post("/auth/2fa/enable", headers={"Authorization": f"Bearer {bob_token}"})
    secret = r2.json()["secret"]
    code = pyotp.TOTP(secret).now()
    confirm = await client.post(
        "/auth/2fa/confirm", json={"code": code}, headers={"Authorization": f"Bearer {bob_token}"}
    )
    assert confirm.status_code == 200, confirm.text

    token = (await auth_client.post("/team/invitations", json={"role": "member"})).json()["token"]

    r3 = await client.post("/auth/accept-invite", json={
        "token": token, "email": "bob@test.com", "password": bob_password,
    })
    assert r3.status_code == 409, r3.text
    assert "access_token" not in r3.json()

    # The invitation must still be unconsumed -- 409 happens before any write.
    inv = (await db.execute(select(Invitation))).scalar_one()
    assert inv.accepted_at is None


async def test_authenticated_user_accepting_invite_joins_account(auth_client, client, db):
    """The design's 'already signed in: a single accept button' branch. The
    caller is trusted via their bearer token; any email in the body (even a
    wrong one) must be ignored, not authenticated against.

    Carol registers her own account first (as its admin -- /auth/register
    always makes the registrant an admin of a fresh account), so the
    account she joins by invitation must be looked up by the *inviting*
    admin's account_id specifically, not just "the admin membership" --
    there are two of those once Carol has her own account too.
    """
    admin_mem = (await db.execute(select(Membership))).scalars().first()

    r = await client.post("/auth/register", json={
        "email": "carol@test.com", "name": "Carol", "password": "Test1234!",
    })
    carol_token = r.json()["access_token"]

    token = (await auth_client.post("/team/invitations", json={"role": "member"})).json()["token"]

    r2 = await client.post(
        "/auth/accept-invite",
        json={"token": token, "email": "not-carols-email@test.com"},
        headers={"Authorization": f"Bearer {carol_token}"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["access_token"]

    carol = (await db.execute(select(User).where(User.email == "carol@test.com"))).scalar_one()
    joined_mem = (await db.execute(
        select(Membership).where(
            Membership.user_id == carol.id, Membership.account_id == admin_mem.account_id,
        )
    )).scalar_one()
    assert joined_mem.role == "member"


async def test_unauthenticated_accept_with_registered_email_returns_409_not_session(
    auth_client, client, db
):
    """Finding 1 / Finding 5: an unauthenticated accept for an email that
    already belongs to a registered user must behave like /auth/register's
    duplicate-email case (409), never authenticate them, and never consume
    the invitation."""
    await client.post("/auth/register", json={
        "email": "dave@test.com", "name": "Dave", "password": "Test1234!",
    })
    token = (await auth_client.post("/team/invitations", json={"role": "member"})).json()["token"]

    r = await client.post("/auth/accept-invite", json={
        "token": token, "email": "dave@test.com", "password": "whatever-guess",
    })
    assert r.status_code == 409, r.text
    assert "access_token" not in r.json()

    inv = (await db.execute(select(Invitation))).scalar_one()
    assert inv.accepted_at is None


# --- Fix pass: the invitation's email, when set, is enforced ---------------

async def test_invitation_email_is_enforced_when_set(auth_client, client, db):
    """Finding 3: an admin invites alice@corp.com; whoever holds the link
    must not be able to join as a different email."""
    token = (await auth_client.post(
        "/team/invitations", json={"email": "alice@corp.com", "role": "member"}
    )).json()["token"]

    wrong = await client.post("/auth/accept-invite", json={
        "token": token, "email": "mallory@evil.com", "name": "Mallory", "password": "Test1234!",
    })
    assert wrong.status_code == 400, wrong.text
    assert wrong.json()["detail"] == "Invalid or expired invitation"

    right = await client.post("/auth/accept-invite", json={
        "token": token, "email": "alice@corp.com", "name": "Alice", "password": "Test1234!",
    })
    assert right.status_code == 200, right.text


async def test_invitation_email_match_is_case_insensitive(auth_client, client):
    token = (await auth_client.post(
        "/team/invitations", json={"email": "Alice@Corp.com", "role": "member"}
    )).json()["token"]

    r = await client.post("/auth/accept-invite", json={
        "token": token, "email": "alice@corp.com", "name": "Alice", "password": "Test1234!",
    })
    assert r.status_code == 200, r.text


async def test_case_variant_of_existing_user_email_cannot_join_as_a_new_identity(
    auth_client, client, db
):
    """Finding 1: _emails_match folds case, so an invitation scoped to
    alice@corp.com is (rightly) also redeemable with ALICE@corp.com. But the
    existing-user lookup that follows must fold case too, or an attacker who
    already knows a real user's address can present a case-swapped variant,
    sail past the email check, and get a brand-new User row created for
    what reads as Alice's address instead of hitting the 409 that
    /auth/register's own case-sensitive-lookup twin would give for an exact
    match. That would defeat the entire purpose of email-scoped invitations
    -- the link holder joining as a different identity -- via nothing more
    than a case change."""
    await client.post("/auth/register", json={
        "email": "alice@corp.com", "name": "Alice", "password": "Test1234!",
    })
    token = (await auth_client.post(
        "/team/invitations", json={"email": "alice@corp.com", "role": "member"}
    )).json()["token"]

    r = await client.post("/auth/accept-invite", json={
        "token": token, "email": "ALICE@corp.com", "name": "Mallory", "password": "Test1234!",
    })
    assert r.status_code == 409, r.text
    assert "access_token" not in r.json()

    # No shadow account was created for the case-variant address, and the
    # invitation was not consumed by the rejected attempt.
    users = (await db.execute(select(User).where(User.name == "Mallory"))).scalars().all()
    assert users == []
    inv = (await db.execute(select(Invitation))).scalar_one()
    assert inv.accepted_at is None


async def test_authenticated_users_own_email_must_match_invitation_email(auth_client, client, db):
    """The email check applies to the authenticated branch too -- otherwise
    it is sidestepped by signing in first with any account and putting the
    invited address in the body, which the authenticated branch ignores."""
    r = await client.post("/auth/register", json={
        "email": "eve@test.com", "name": "Eve", "password": "Test1234!",
    })
    eve_token = r.json()["access_token"]

    token = (await auth_client.post(
        "/team/invitations", json={"email": "alice@corp.com", "role": "member"}
    )).json()["token"]

    r2 = await client.post(
        "/auth/accept-invite",
        json={"token": token, "email": "alice@corp.com"},
        headers={"Authorization": f"Bearer {eve_token}"},
    )
    assert r2.status_code == 400, r2.text
    assert r2.json()["detail"] == "Invalid or expired invitation"


# --- Task 5: the grants API -------------------------------------------------

async def test_admin_sets_and_reads_a_members_grants(auth_client, member_client):
    _, membership_id = member_client
    co = (await auth_client.post("/companies", json={"name": "Co"})).json()

    r = await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"company_id": co["id"]}]},
    )
    assert r.status_code == 200, r.text
    assert [g["company_id"] for g in r.json()] == [co["id"]]

    listed = (await auth_client.get(f"/team/members/{membership_id}/grants")).json()
    assert [g["company_id"] for g in listed] == [co["id"]]


async def test_put_grants_replaces_the_whole_set(auth_client, member_client):
    _, membership_id = member_client
    co_a = (await auth_client.post("/companies", json={"name": "A"})).json()
    co_b = (await auth_client.post("/companies", json={"name": "B"})).json()

    await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"company_id": co_a["id"]}]},
    )
    r = await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"company_id": co_b["id"]}]},
    )
    assert [g["company_id"] for g in r.json()] == [co_b["id"]]


async def test_grant_with_two_targets_is_refused(auth_client, member_client):
    """Rejected at the API boundary with a 422 rather than reaching the CHECK
    constraint and surfacing as a 500."""
    _, membership_id = member_client
    r = await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"company_id": "co-1", "machine_id": "mach-1"}]},
    )
    assert r.status_code == 422, r.text


async def test_cannot_grant_a_node_from_another_account(auth_client, member_client, client):
    """Grants are anchored to membership_id so they cannot cross accounts, but
    the target id is caller-supplied -- without this check an admin could point a
    grant at another tenant's company id."""
    await client.post("/auth/register", json={
        "email": "other@test.com", "name": "Other", "password": "Test1234!",
    })
    r = await client.post("/auth/login", json={"email": "other@test.com", "password": "Test1234!"})
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    foreign_co = (await client.post("/companies", json={"name": "Foreign"})).json()

    _, membership_id = member_client
    r = await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"company_id": foreign_co["id"]}]},
    )
    assert r.status_code == 404, r.text


async def test_member_cannot_edit_grants(member_client):
    client, membership_id = member_client
    r = await client.put(f"/team/members/{membership_id}/grants", json={"grants": []})
    assert r.status_code == 403


async def test_removing_a_grant_syncs_saved_passwords(auth_client, member_client, db):
    """The endpoint must call sync_saved_passwords, not merely delete rows from
    access_grants. Without it, revocation leaves the credential behind."""
    from models import SavedConnectPassword
    client, membership_id = member_client
    m = (await auth_client.post("/machines", json={"peer_id": "GGG-7777", "name": "M"})).json()

    await auth_client.put(
        f"/team/members/{membership_id}/grants",
        json={"grants": [{"machine_id": m["id"]}]},
    )
    await client.put(f"/machines/{m['id']}/saved-password", json={"password": "pw"})

    await auth_client.put(f"/team/members/{membership_id}/grants", json={"grants": []})

    rows = (await db.execute(
        select(SavedConnectPassword).where(SavedConnectPassword.membership_id == membership_id)
    )).scalars().all()
    assert rows == []
