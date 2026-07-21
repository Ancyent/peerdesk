import pytest
from fastapi import HTTPException
from models import Account, Machine, Membership
import access


@pytest.mark.asyncio
async def test_visible_machines_excludes_other_accounts(db):
    a, b = Account(name="A"), Account(name="B")
    db.add_all([a, b])
    await db.flush()
    db.add_all([
        Machine(peer_id="111111111", name="mine", owner_id="u1", account_id=a.id),
        Machine(peer_id="222222222", name="theirs", owner_id="u1", account_id=b.id),
    ])
    await db.flush()

    admin = Membership(user_id="u1", account_id=a.id, role="admin")
    rows = (await db.execute(access.visible_machines(admin))).scalars().all()

    assert [m.name for m in rows] == ["mine"]


def test_assert_admin_rejects_a_member():
    member = Membership(user_id="u1", account_id="a1", role="member")
    with pytest.raises(HTTPException) as exc:
        access.assert_admin(member)
    assert exc.value.status_code == 403


def test_assert_admin_allows_an_admin():
    access.assert_admin(Membership(user_id="u1", account_id="a1", role="admin"))
