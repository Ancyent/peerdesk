import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from database import Base
from deps import get_db
from main import app
import models  # noqa

TEST_DB = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db():
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def client(db):
    async def override():
        yield db
    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def auth_client(client):
    """An AsyncClient authenticated as an admin -- its OWN client, distinct
    from the `client` fixture. `client` and `auth_client` share the same
    dependency-overridden `app` (registration/login go through `client`
    itself), but each gets its own httpx AsyncClient/header set, the same
    pattern `member_client` below already uses. Previously this mutated and
    returned the shared `client` object, so a test requesting both fixtures
    got one client: the admin's Authorization header leaked into calls the
    test believed were anonymous, papered over in test_team.py with a
    `del client.headers["Authorization"]` after every auth_client use. See
    Finding 3 in task-4-report.md.
    """
    await client.post("/auth/register", json={
        "email": "user@test.com", "name": "Test User", "password": "Test1234!"
    })
    r = await client.post("/auth/login", json={
        "email": "user@test.com", "password": "Test1234!"
    })
    assert r.status_code == 200, f"Login failed: {r.text}"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        yield c


@pytest.fixture
async def member_client(auth_client, db):
    """A second AsyncClient authenticated as a plain member of the same account
    the auth_client admin owns. Yields (client, membership_id).

    Built by direct DB insert rather than through an invitation endpoint so the
    fixture stays usable by the tasks that run before invitations exist.
    """
    from httpx import AsyncClient, ASGITransport
    from sqlalchemy import select as _select
    from models import Membership as _Membership, User as _User
    from main import app as _app
    from deps import get_db as _get_db

    admin_user = (await db.execute(
        _select(_User).where(_User.email == "user@test.com")
    )).scalar_one()
    admin_mem = (await db.execute(
        _select(_Membership).where(_Membership.user_id == admin_user.id)
    )).scalar_one()

    async def override():
        yield db
    _app.dependency_overrides[_get_db] = override

    c = AsyncClient(transport=ASGITransport(app=_app), base_url="http://test")
    await c.post("/auth/register", json={
        "email": "member@test.com", "name": "Member", "password": "Test1234!"
    })
    member_user = (await db.execute(
        _select(_User).where(_User.email == "member@test.com")
    )).scalar_one()

    mem = _Membership(user_id=member_user.id, account_id=admin_mem.account_id, role="member")
    db.add(mem)
    await db.commit()

    r = await c.post("/auth/login", json={"email": "member@test.com", "password": "Test1234!"})
    assert r.status_code == 200, r.text
    r2 = await c.post(
        "/auth/switch-account",
        json={"account_id": admin_mem.account_id},
        headers={"Authorization": f"Bearer {r.json()['access_token']}"},
    )
    assert r2.status_code == 200, r2.text
    c.headers["Authorization"] = f"Bearer {r2.json()['access_token']}"

    yield c, mem.id
    await c.aclose()
