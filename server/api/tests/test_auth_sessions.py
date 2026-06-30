import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import datetime, timezone
from models import AuthSession
from sqlalchemy import select


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
