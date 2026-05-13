import hashlib, hmac as hmac_lib, secrets


def compute_hmac_key(password: str) -> str:
    return hmac_lib.new(b"peerdesk-v1", password.encode(), hashlib.sha256).hexdigest()


def compute_challenge_response(nonce: str, hmac_key: str) -> str:
    return hmac_lib.new(hmac_key.encode(), nonce.encode(), hashlib.sha256).hexdigest()


def verify_challenge_response(nonce: str, response: str, stored_hmac_key: str) -> bool:
    expected = hmac_lib.new(
        stored_hmac_key.encode(), nonce.encode(), hashlib.sha256
    ).hexdigest()
    return hmac_lib.compare_digest(expected, response)


def test_valid_response():
    password, nonce = "MySecret123", secrets.token_hex(16)
    key = compute_hmac_key(password)
    resp = compute_challenge_response(nonce, key)
    assert verify_challenge_response(nonce, resp, key)


def test_wrong_password_fails():
    nonce = "abc123"
    key = compute_hmac_key("correct")
    resp = compute_challenge_response(nonce, compute_hmac_key("wrong"))
    assert not verify_challenge_response(nonce, resp, key)


def test_nonce_reuse_fails():
    key = compute_hmac_key("pw")
    resp = compute_challenge_response("nonce_a", key)
    assert not verify_challenge_response("nonce_b", resp, key)


def test_hmac_key_never_equals_password():
    pw = "MyPassword"
    assert compute_hmac_key(pw) != pw
    assert len(compute_hmac_key(pw)) == 64  # 32 bytes hex
