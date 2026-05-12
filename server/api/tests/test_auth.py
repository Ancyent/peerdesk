import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

def test_password_hash_and_verify():
    from auth import hash_password, verify_password
    hashed = hash_password("secret123")
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)

def test_access_token_round_trip():
    from auth import create_access_token, decode_token
    token = create_access_token("user-123")
    user_id = decode_token(token, "access")
    assert user_id == "user-123"

def test_refresh_token_round_trip():
    from auth import create_refresh_token, decode_token
    token = create_refresh_token("user-456")
    user_id = decode_token(token, "refresh")
    assert user_id == "user-456"

def test_token_wrong_type_rejected():
    from auth import create_refresh_token, decode_token
    refresh = create_refresh_token("user-123")
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
