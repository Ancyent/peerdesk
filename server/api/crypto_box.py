"""Reversible encryption for secrets stored at rest (e.g. saved connect passwords).

Uses Fernet (AES-128-CBC + HMAC). The key is derived from `SAVED_PW_KEY` if set,
otherwise from `JWT_SECRET` — both live in the gitignored deploy `.env`, so the key
is stable across container rebuilds (no extra deploy config required). Rotating
either secret makes previously stored ciphertext undecryptable (decrypt returns
None), which the callers treat as "no saved password".
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    secret = os.getenv("SAVED_PW_KEY") or os.getenv(
        "JWT_SECRET", "dev-secret-change-in-production"
    )
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext secret to a urlsafe token string."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str | None:
    """Decrypt a token back to plaintext, or None if it can't be decrypted
    (tampered, or the key changed since it was written)."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None
