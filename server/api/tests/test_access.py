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

    A later version matched `\\s*==` but exempted any line containing the
    substring "account_id=" (etc) -- meant to whitelist constructor kwargs
    like `Machine(account_id=...)`. Because `\\s*` allows zero whitespace,
    `account_id==x` (no space around the operator) itself CONTAINS the
    substring "account_id=", so the exemption swallowed the very comparison
    it was supposed to catch. `account_id == x` (with a space) was the only
    spelling that still tripped it. This version distinguishes assignment
    from comparison by matching the operator tokens directly (`==`, `!=`,
    `.in_(`, `.not_in(`, `.is_(`, `.is_not(`, `.isnot(`, or a `filter_by(...)`
    kwarg) instead of by excluding a substring -- a bare `=` can never match a
    `==`/`!=` token regex, so no exemption list is needed at all.

    `.is_not(` and `.not_in(` are SQLAlchemy 2.0's spellings (this codebase is
    2.0 throughout); `.isnot(` and `.in_(` are the older ones some code and
    docs still use. All four are covered so a future author reaching for
    either era's spelling still trips the guard.
    """
    import pathlib
    import re

    routers_dir = pathlib.Path(__file__).parent.parent / "routers"
    columns = r"(?:account_id|created_by_id|created_by)"
    # A hand-built comparison against one of the authorization columns, in any
    # of SQLAlchemy's spellings: ==, !=, .in_(...), .not_in(...), .is_(...),
    # .is_not(...), .isnot(...), or the `filter_by(col=...)` kwarg form
    # (filter_by's `=` is a comparison, not an assignment, despite looking
    # like one).
    patterns = [
        re.compile(rf"\b{columns}\s*(==|!=)"),
        re.compile(rf"\b{columns}\.(in_|not_in|is_not|is_|isnot)\("),
        re.compile(rf"filter_by\([^)]*\b{columns}\s*=(?!=)"),
    ]

    offenders = []
    for path in sorted(routers_dir.rglob("*.py")):
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if any(p.search(line) for p in patterns):
                offenders.append(f"{path.name}:{lineno}: {line.strip()}")

    assert not offenders, (
        "these routers build their own authorization filter instead of using "
        "access.py:\n" + "\n".join(offenders)
    )
