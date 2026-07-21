import pytest
from models import Account, Membership
from auth import decode_access_claims


@pytest.mark.asyncio
async def test_switching_to_an_account_you_do_not_belong_to_is_refused(auth_client, db):
    stranger = Account(name="Someone Else")
    db.add(stranger)
    await db.commit()

    r = await auth_client.post("/auth/switch-account", json={"account_id": stranger.id})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_listing_accounts_returns_the_users_memberships(auth_client):
    r = await auth_client.get("/auth/accounts")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["role"] == "admin"


@pytest.mark.asyncio
async def test_switching_to_an_account_you_belong_to_returns_a_token_for_it(auth_client, db):
    from sqlalchemy import select
    from models import User

    result = await db.execute(select(User).where(User.email == "user@test.com"))
    user = result.scalar_one()

    second_account = Account(name="Second Account")
    db.add(second_account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=second_account.id, role="member"))
    await db.commit()

    r = await auth_client.post("/auth/switch-account", json={"account_id": second_account.id})
    assert r.status_code == 200
    token = r.json()["access_token"]

    claims = decode_access_claims(token)
    assert claims == (user.id, second_account.id)


@pytest.mark.asyncio
async def test_refresh_after_switch_account_keeps_the_switched_to_account(client, db):
    """A refresh within the session lifetime must not silently throw the user
    back to their oldest membership -- the switched-to account has to survive
    the next /auth/refresh, not just the token that was live at switch time."""
    from sqlalchemy import select
    from models import User
    from auth import decode_access_claims

    await client.post("/auth/register", json={
        "email": "switcher@test.com", "name": "Switcher", "password": "Test1234!",
    })
    login = await client.post("/auth/login", json={
        "email": "switcher@test.com", "password": "Test1234!",
    })
    assert login.status_code == 200
    tokens = login.json()

    result = await db.execute(select(User).where(User.email == "switcher@test.com"))
    user = result.scalar_one()

    second_account = Account(name="Second Account")
    db.add(second_account)
    await db.flush()
    db.add(Membership(user_id=user.id, account_id=second_account.id, role="member"))
    await db.commit()

    client.headers["Authorization"] = f"Bearer {tokens['access_token']}"
    switch = await client.post("/auth/switch-account", json={"account_id": second_account.id})
    assert switch.status_code == 200

    refresh = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 200

    claims = decode_access_claims(refresh.json()["access_token"])
    assert claims == (user.id, second_account.id)
