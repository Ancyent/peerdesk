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
    await client.post("/auth/register", json={
        "email": "user@test.com", "name": "Test User", "password": "Test1234!"
    })
    r = await client.post("/auth/login", json={
        "email": "user@test.com", "password": "Test1234!"
    })
    assert r.status_code == 200, f"Login failed: {r.text}"
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return client
