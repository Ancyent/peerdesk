import pytest


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_register_and_login(client):
    r = await client.post("/auth/register", json={"email": "a@b.com", "name": "Alice", "password": "pass1234"})
    assert r.status_code == 201
    data = r.json()
    assert "access_token" in data
    assert "refresh_token" in data

    r2 = await client.post("/auth/login", json={"email": "a@b.com", "password": "pass1234"})
    assert r2.status_code == 200


async def test_duplicate_register(client):
    body = {"email": "dup@b.com", "name": "Dup", "password": "pass1234"}
    await client.post("/auth/register", json=body)
    r = await client.post("/auth/register", json=body)
    assert r.status_code == 409


async def test_wrong_password(client):
    await client.post("/auth/register", json={"email": "e@b.com", "name": "E", "password": "pass1234"})
    r = await client.post("/auth/login", json={"email": "e@b.com", "password": "wrong"})
    assert r.status_code == 401


async def test_token_refresh(client):
    r = await client.post("/auth/register", json={"email": "ref@b.com", "name": "Ref", "password": "pass1234"})
    refresh = r.json()["refresh_token"]
    r2 = await client.post("/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 200
    assert "access_token" in r2.json()


async def test_register_and_list_machines(client):
    r = await client.post("/auth/register", json={"email": "b@b.com", "name": "Bob", "password": "pass1234"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r2 = await client.post("/machines", json={"peer_id": "123456789", "name": "My PC"}, headers=headers)
    assert r2.status_code == 201
    assert r2.json()["peer_id"] == "123456789"

    r3 = await client.get("/machines", headers=headers)
    assert r3.status_code == 200
    assert len(r3.json()) == 1


async def test_get_me(client):
    r = await client.post("/auth/register", json={"email": "me@b.com", "name": "Me", "password": "pass1234"})
    token = r.json()["access_token"]
    r2 = await client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == "me@b.com"


async def test_machines_isolated_between_users(client):
    r1 = await client.post("/auth/register", json={"email": "u1@b.com", "name": "U1", "password": "pass1234"})
    t1 = r1.json()["access_token"]
    r2 = await client.post("/auth/register", json={"email": "u2@b.com", "name": "U2", "password": "pass1234"})
    t2 = r2.json()["access_token"]

    await client.post("/machines", json={"peer_id": "111111111"}, headers={"Authorization": f"Bearer {t1}"})
    r3 = await client.get("/machines", headers={"Authorization": f"Bearer {t2}"})
    assert r3.json() == []


async def test_get_turn_credentials(client):
    r = await client.post("/auth/register", json={"email": "turn@b.com", "name": "Turn", "password": "pass1234"})
    token = r.json()["access_token"]
    r2 = await client.get("/turn/credentials", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    data = r2.json()
    assert "urls" in data
    assert len(data["urls"]) >= 1
    assert "username" in data
    assert "credential" in data
    assert ":" in data["username"]  # format: "<timestamp>:<user_id>"
    assert data["ttl"] == 3600


async def test_start_and_end_session(client):
    # Start a session
    r = await client.post("/sessions", json={
        "host_peer_id": "123456789",
        "connection_type": "p2p"
    })
    assert r.status_code == 201
    data = r.json()
    assert data["host_peer_id"] == "123456789"
    assert data["ended_at"] is None
    session_id = data["id"]

    # End the session
    r2 = await client.patch(f"/sessions/{session_id}/end")
    assert r2.status_code == 204


async def test_end_nonexistent_session(client):
    r = await client.patch("/sessions/nonexistent-id/end")
    assert r.status_code == 404


async def test_2fa_enable_and_confirm(client):
    # Register user
    r = await client.post("/auth/register", json={"email": "totp@b.com", "name": "TOTP", "password": "pass1234"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Enable 2FA
    r2 = await client.post("/auth/2fa/enable", headers=headers)
    assert r2.status_code == 200
    data = r2.json()
    assert "secret" in data
    assert "qr_uri" in data
    secret = data["secret"]

    # Confirm with valid TOTP code
    import pyotp
    code = pyotp.TOTP(secret).now()
    r3 = await client.post("/auth/2fa/confirm", json={"code": code}, headers=headers)
    assert r3.status_code == 200


async def test_2fa_login_flow(client):
    import pyotp

    # Register and enable 2FA
    r = await client.post("/auth/register", json={"email": "totp2@b.com", "name": "TOTP2", "password": "pass1234"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r2 = await client.post("/auth/2fa/enable", headers=headers)
    secret = r2.json()["secret"]
    code = pyotp.TOTP(secret).now()
    await client.post("/auth/2fa/confirm", json={"code": code}, headers=headers)

    # Login should now require 2FA
    r3 = await client.post("/auth/login", json={"email": "totp2@b.com", "password": "pass1234"})
    assert r3.status_code == 200
    data = r3.json()
    assert data["requires_2fa"] is True
    assert data["temp_token"] is not None

    # The temp_token must NOT be usable as a real access token (no 2FA bypass).
    bad = await client.get("/users/me", headers={"Authorization": f"Bearer {data['temp_token']}"})
    assert bad.status_code == 401

    # Complete login with TOTP code
    code2 = pyotp.TOTP(secret).now()
    r4 = await client.post("/auth/login/2fa", json={"temp_token": data["temp_token"], "code": code2})
    assert r4.status_code == 200
    assert "access_token" in r4.json()
    assert r4.json()["access_token"] != ""


async def test_get_branding_public(client):
    """GET /branding works without auth."""
    r = await client.get("/branding")
    assert r.status_code == 200
    data = r.json()
    assert data["brand_name"] == "PeerDesk"
    assert data["accent_color"] == "#2563eb"
    assert "logo_data_url" in data


async def test_update_branding_requires_auth(client):
    """POST /branding without token returns 403."""
    r = await client.post("/branding", json={"brand_name": "TestBrand"})
    assert r.status_code == 403


async def test_update_branding_authenticated(client):
    """Authenticated user can update brand_name and accent_color."""
    r = await client.post("/auth/register", json={
        "email": "brandtest@b.com", "name": "Brand", "password": "pass1234"
    })
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r2 = await client.post("/branding",
        json={"brand_name": "MyDesk", "accent_color": "#e63946"},
        headers=headers,
    )
    assert r2.status_code == 200
    assert r2.json()["brand_name"] == "MyDesk"
    assert r2.json()["accent_color"] == "#e63946"


async def test_branding_invalid_color_rejected(client):
    """Invalid hex color returns 400."""
    r = await client.post("/auth/register", json={
        "email": "brandtest2@b.com", "name": "B2", "password": "pass1234"
    })
    token = r.json()["access_token"]
    r2 = await client.post("/branding",
        json={"accent_color": "not-a-color"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 400


async def test_branding_row_gets_a_real_account_id(client, db):
    """account_id on branding is NOT NULL as of Task 7. Creating the singleton
    row through an authenticated call must stamp it with the caller's own
    account rather than leaving it unset or crashing the insert."""
    from sqlalchemy import select
    from models import Branding

    r = await client.post("/auth/register", json={
        "email": "brandtest3@b.com", "name": "B3", "password": "pass1234"
    })
    token = r.json()["access_token"]
    r2 = await client.post("/branding",
        json={"brand_name": "Acme"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200

    row = (await db.execute(select(Branding).where(Branding.id == 1))).scalar_one()
    assert row.account_id is not None


async def test_branding_is_per_account_not_cross_tenant(client, db):
    """Two different accounts must get two independent branding rows. Writing
    one account's branding must not affect another account's row — otherwise
    POST /branding is a cross-tenant write (the bug: every admin after the
    first ended up reading and mutating the first account's row)."""
    from sqlalchemy import select
    from models import Branding, Membership, User

    r_a = await client.post("/auth/register", json={
        "email": "tenant-a@b.com", "name": "Tenant A", "password": "pass1234"
    })
    token_a = r_a.json()["access_token"]
    r_b = await client.post("/auth/register", json={
        "email": "tenant-b@b.com", "name": "Tenant B", "password": "pass1234"
    })
    token_b = r_b.json()["access_token"]

    r2 = await client.post("/branding",
        json={"brand_name": "Acme A", "accent_color": "#111111"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert r2.status_code == 200

    r3 = await client.post("/branding",
        json={"brand_name": "Acme B", "accent_color": "#222222"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert r3.status_code == 200

    async def account_id_for(email: str) -> str:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        membership = (await db.execute(
            select(Membership).where(Membership.user_id == user.id)
        )).scalar_one()
        return membership.account_id

    account_a = await account_id_for("tenant-a@b.com")
    account_b = await account_id_for("tenant-b@b.com")
    assert account_a != account_b

    row_a = (await db.execute(
        select(Branding).where(Branding.account_id == account_a)
    )).scalar_one()
    row_b = (await db.execute(
        select(Branding).where(Branding.account_id == account_b)
    )).scalar_one()

    assert row_a.id != row_b.id
    assert row_a.brand_name == "Acme A"
    assert row_a.accent_color == "#111111"
    assert row_b.brand_name == "Acme B"
    assert row_b.accent_color == "#222222"
