import pytest
from sqlalchemy import select
from models import Account, Membership, User


@pytest.mark.asyncio
async def test_a_user_can_hold_memberships_in_two_accounts(db):
    user = User(email="tech@test.com", name="Tech", password_hash="x")
    own = Account(name="My Company")
    client_acct = Account(name="Client Co")
    db.add_all([user, own, client_acct])
    await db.flush()

    db.add_all([
        Membership(user_id=user.id, account_id=own.id, role="admin"),
        Membership(user_id=user.id, account_id=client_acct.id, role="member"),
    ])
    await db.flush()

    rows = (await db.execute(
        select(Membership).where(Membership.user_id == user.id)
    )).scalars().all()

    assert {m.account_id: m.role for m in rows} == {own.id: "admin", client_acct.id: "member"}


@pytest.mark.asyncio
async def test_machine_carries_account_and_creator_separately(db):
    from models import Machine

    user = User(email="owner@test.com", name="Owner", password_hash="x")
    acct = Account(name="Acct")
    db.add_all([user, acct])
    await db.flush()

    # owner_id is still NOT NULL (expand/contract keeps it until Task 7), so it
    # must be supplied here alongside the new columns.
    m = Machine(peer_id="123456789", name="Server", owner_id=user.id, account_id=acct.id, created_by_id=user.id)
    db.add(m)
    await db.flush()

    assert m.account_id == acct.id
    assert m.created_by_id == user.id
    # owner_id deliberately still exists here: the routers read it until Task 7
    # moves them onto account_id. Task 7 drops it and asserts it is gone.


def test_account_id_is_nullable_until_routers_set_it():
    from models import ApiKey, Branding, Company, Machine, Membership, RegistrationToken

    for model in (Machine, Company, ApiKey, RegistrationToken, Branding):
        assert model.__table__.c.account_id.nullable is True, f"{model.__name__} must stay nullable until Task 7"
    assert Membership.__table__.c.account_id.nullable is False, "a membership without an account is meaningless"
