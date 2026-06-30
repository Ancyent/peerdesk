import sys, os, asyncio
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import datetime, timezone, timedelta
from models import AuthSession
from sqlalchemy import select
from auth import decode_refresh_token


def test_auth_session_defaults():
    s = AuthSession(user_id="u1", token_hash="abc", remember_me=True)
    assert s.id and isinstance(s.id, str)
    assert s.revoked is False
    assert s.created_at.tzinfo is not None
    assert s.last_used_at.tzinfo is not None
    # created_at and last_used_at start equal
    assert abs((s.created_at - s.last_used_at).total_seconds()) < 1


async def test_login_creates_auth_session(client, db):
    await client.post("/auth/register", json={"email": "a@b.com", "name": "A", "password": "Pw1234!!"})
    r = await client.post("/auth/login", json={"email": "a@b.com", "password": "Pw1234!!", "remember_me": True})
    assert r.status_code == 200
    rows = (await db.execute(select(AuthSession))).scalars().all()
    assert len(rows) >= 1
    assert any(row.remember_me for row in rows)


async def _login(client, remember=True):
    await client.post("/auth/register", json={"email": "r@b.com", "name": "R", "password": "Pw1234!!"})
    r = await client.post("/auth/login", json={"email": "r@b.com", "password": "Pw1234!!", "remember_me": remember})
    return r.json()


async def _session_for(db, refresh_token):
    """Return the AuthSession row that belongs to the given refresh token."""
    decoded = decode_refresh_token(refresh_token)
    assert decoded is not None
    _, sid = decoded
    return (await db.execute(select(AuthSession).where(AuthSession.id == sid))).scalars().first()


async def test_refresh_slides_and_returns_same_refresh(client, db):
    tokens = await _login(client)
    before = (await _session_for(db, tokens["refresh_token"])).last_used_at
    await asyncio.sleep(1)  # ensure new access token has a different exp (JWT is second-precision)
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["refresh_token"] == tokens["refresh_token"]
    assert r.json()["access_token"] != tokens["access_token"]
    after = (await _session_for(db, tokens["refresh_token"])).last_used_at
    assert after > before


async def test_refresh_rejects_idle_expired(client, db):
    tokens = await _login(client)
    row = await _session_for(db, tokens["refresh_token"])
    row.last_used_at = datetime.now(timezone.utc) - timedelta(hours=25)
    await db.commit()
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_refresh_rejects_absolute_cap(client, db):
    tokens = await _login(client)
    row = await _session_for(db, tokens["refresh_token"])
    row.created_at = datetime.now(timezone.utc) - timedelta(days=8)
    await db.commit()
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_logout_revokes_then_refresh_fails(client):
    tokens = await _login(client)
    r = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 204
    r2 = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r2.status_code == 401


async def test_logout_idempotent(client):
    tokens = await _login(client)
    await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    r = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 204
    r2 = await client.post("/auth/logout", json={"refresh_token": "garbage"})
    assert r2.status_code == 204
