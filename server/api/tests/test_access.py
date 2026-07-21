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
        Machine(peer_id="111111111", name="mine", account_id=a.id),
        Machine(peer_id="222222222", name="theirs", account_id=b.id),
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


def test_no_router_builds_its_own_account_filter():
    """Authorization lives in access.py. A router that writes its own
    account_id/created_by condition is how one forgotten endpoint becomes a
    leak six months later.

    The old version of this test grepped for the literal `owner_id` only --
    a column that no longer exists -- so it passed while api_keys.py was
    filtering on created_by by hand.
    """
    import pathlib
    import re

    routers_dir = pathlib.Path(__file__).parent.parent / "routers"
    # Creation sites legitimately assign these; they do not filter on them.
    ALLOWED = {"account_id=", "created_by=", "created_by_id="}
    pattern = re.compile(r"(account_id|created_by|created_by_id)\s*==")

    offenders = []
    for path in sorted(routers_dir.glob("*.py")):
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if pattern.search(line) and not any(a in line for a in ALLOWED):
                offenders.append(f"{path.name}:{lineno}: {line.strip()}")

    assert not offenders, (
        "these routers build their own authorization filter instead of using "
        "access.py:\n" + "\n".join(offenders)
    )
