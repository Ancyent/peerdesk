from datetime import datetime, timedelta, timezone
from jose import jwt
from auth import ALGORITHM, SECRET_KEY, create_access_token, decode_access_claims


def test_access_token_carries_the_active_account():
    token = create_access_token("user-1", "acct-1")
    assert decode_access_claims(token) == ("user-1", "acct-1")


def test_a_token_minted_before_accounts_decodes_with_no_account():
    legacy = jwt.encode(
        {"sub": "user-1", "type": "access",
         "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
        SECRET_KEY, algorithm=ALGORITHM,
    )
    assert decode_access_claims(legacy) == ("user-1", None)
