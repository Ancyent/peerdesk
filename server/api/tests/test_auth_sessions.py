import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import datetime, timezone
from models import AuthSession


def test_auth_session_defaults():
    s = AuthSession(user_id="u1", token_hash="abc", remember_me=True)
    assert s.id and isinstance(s.id, str)
    assert s.revoked is False
    assert s.created_at.tzinfo is not None
    assert s.last_used_at.tzinfo is not None
    # created_at and last_used_at start equal
    assert abs((s.created_at - s.last_used_at).total_seconds()) < 1
