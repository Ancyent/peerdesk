"""Regression coverage for deps.get_current_membership.

This dependency resolves an access token's account claim to a Membership,
with a backward-compatibility fallback for tokens minted before accounts
existed (no `account_id` claim). That fallback is the one thing that most
needs a guard: this project once logged its whole web userbase out with a
token change, and deleting the fallback branch entirely still leaves every
*other* test in the suite green. Each test below exercises exactly one
branch of get_current_membership and would fail if that branch vanished.
"""
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from auth import ALGORITHM, SECRET_KEY, create_access_token
from models import Account, Membership, User
import deps


def _legacy_token(user_id: str) -> str:
    """A token minted before accounts existed: no account_id claim at all."""
    return jwt.encode(
        {"sub": user_id, "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def _make_user(db, is_active: bool = True) -> User:
    user = User(email=f"{__name__}-{id(object())}@test.com", name="Test", password_hash="x", is_active=is_active)
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_legacy_token_with_one_membership_resolves_to_it(db):
    user = await _make_user(db)
    account = Account(name="Solo Account")
    db.add(account)
    await db.flush()
    membership = Membership(user_id=user.id, account_id=account.id, role="admin")
    db.add(membership)
    await db.commit()

    result = await deps.get_current_membership(credentials=_creds(_legacy_token(user.id)), db=db)

    assert result.id == membership.id
    assert result.account_id == account.id


@pytest.mark.asyncio
async def test_legacy_token_with_two_memberships_is_401_ambiguous(db):
    user = await _make_user(db)
    a, b = Account(name="A"), Account(name="B")
    db.add_all([a, b])
    await db.flush()
    db.add_all([
        Membership(user_id=user.id, account_id=a.id, role="admin"),
        Membership(user_id=user.id, account_id=b.id, role="member"),
    ])
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await deps.get_current_membership(credentials=_creds(_legacy_token(user.id)), db=db)

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_token_naming_an_account_the_user_does_not_belong_to_is_403(db):
    user = await _make_user(db)
    own_account, other_account = Account(name="Mine"), Account(name="Not mine")
    db.add_all([own_account, other_account])
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=own_account.id, role="admin"))
    await db.commit()

    token = create_access_token(user.id, other_account.id)

    with pytest.raises(HTTPException) as exc:
        await deps.get_current_membership(credentials=_creds(token), db=db)

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_deactivated_user_is_rejected_even_with_a_valid_membership(db):
    user = await _make_user(db, is_active=False)
    account = Account(name="Deactivated User Account")
    db.add(account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=account.id, role="admin"))
    await db.commit()

    token = create_access_token(user.id, account.id)

    with pytest.raises(HTTPException) as exc:
        await deps.get_current_membership(credentials=_creds(token), db=db)

    assert exc.value.status_code == 401
    assert exc.value.detail == "User not found"
