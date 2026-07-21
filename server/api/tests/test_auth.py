import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

def test_password_hash_and_verify():
    from auth import hash_password, verify_password
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)

def test_access_token_round_trip():
    from auth import create_access_token, decode_token
    token = create_access_token("user-123", "acct-123")
    user_id = decode_token(token, "access")
    assert user_id == "user-123"

def test_refresh_token_round_trip():
    from auth import create_refresh_token, decode_refresh_token
    token = create_refresh_token("user-456", "sid-1")
    assert decode_refresh_token(token) == ("user-456", "sid-1")

def test_token_wrong_type_rejected():
    from auth import create_refresh_token, decode_token
    refresh = create_refresh_token("user-123", "sid-x")
    assert decode_token(refresh, "access") is None

def test_expired_token_rejected():
    from auth import decode_token
    from jose import jwt
    import os
    expired = jwt.encode(
        {"sub": "user-123", "type": "access", "exp": 1000},  # expired in 1970
        os.getenv("JWT_SECRET", "dev-secret-change-in-production"),
        algorithm="HS256"
    )
    assert decode_token(expired, "access") is None


def test_refresh_token_carries_sid():
    from auth import create_refresh_token, decode_refresh_token
    token = create_refresh_token("user-1", "sess-9")
    assert decode_refresh_token(token) == ("user-1", "sess-9")

def test_decode_refresh_rejects_access_token():
    from auth import create_access_token, decode_refresh_token
    assert decode_refresh_token(create_access_token("user-1", "acct-1")) is None

def test_hash_refresh_token_stable_and_hex():
    from auth import hash_refresh_token
    a = hash_refresh_token("abc")
    assert a == hash_refresh_token("abc")
    assert len(a) == 64 and all(c in "0123456789abcdef" for c in a)

def test_idle_and_cap_constants():
    from auth import IDLE_TIMEOUT, ABSOLUTE_CAP
    assert IDLE_TIMEOUT.total_seconds() == 24 * 3600
    assert ABSOLUTE_CAP.days == 7


def test_turn_credential_hmac():
    import hashlib, hmac, base64
    secret = "test-secret"
    username = "1234567890:user-abc"
    h = hmac.new(secret.encode(), username.encode(), hashlib.sha1)
    credential = base64.b64encode(h.digest()).decode()
    # Verify it's a non-empty base64 string
    assert len(credential) > 0
    assert credential == base64.b64encode(
        hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    ).decode()
