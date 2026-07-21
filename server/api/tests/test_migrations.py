"""Migration tests that run the *real* Alembic migrations against a *real*
PostgreSQL, started in a throwaway Docker container.

Why this file exists: the rest of the suite (tests/conftest.py) builds its
schema with ``Base.metadata.create_all`` on in-memory SQLite. That is fast,
but it means no test has ever executed a single Alembic script, and a green
suite says nothing about whether the migrations themselves work. Two real
production defects slipped through exactly that gap:

  1. Migration 0013 used to abort mid-run on any install that had a
     ``branding`` row but zero accounts (``ALTER ... SET NOT NULL`` on a NULL
     column) -- reachable because ``GET /branding`` is public and the login
     page calls it before anyone has registered.
  2. ``branding_id_seq`` was never advanced, because the old app code always
     inserted branding with an explicit ``id=1``. The first ``POST
     /branding`` from a second tenant collided on the primary key.

Both were only ever caught by implementers spinning up throwaway Postgres
containers by hand. This file automates exactly that.

Design notes:
  - No new dependency. We shell out to ``docker run`` for postgres:16-alpine
    instead of pulling in testcontainers / pytest-postgresql.
  - Docker availability is checked once, in the session-scoped
    ``postgres_container`` fixture; if it's unavailable, every test in this
    module skips cleanly via ``pytest.skip``.
  - The container uses a distinctive name and a non-default host port so it
    can never collide with (or be mistaken for) the live `deploy` stack's
    postgres container, which this file never touches.
  - The container is torn down in a ``finally`` so it goes away even when a
    test fails or errors.
  - Tests are plain ``def test_...`` (not ``async def``). Alembic's
    env.py (migrations/env.py) drives its own event loop internally via
    ``asyncio.run(...)``; calling that from inside a coroutine already
    running under pytest-asyncio's loop would raise "asyncio.run() cannot be
    called from a running event loop". Keeping these tests synchronous and
    doing our own ad hoc async DB calls via ``asyncio.run`` sidesteps that.

Slow, and needs Docker. Select just these with ``-m migration``, or exclude
them from a fast run with ``-m "not migration"``.
"""
import asyncio
import os
import shutil
import subprocess
import time

import asyncpg
import pytest
from alembic.command import downgrade as alembic_downgrade
from alembic.command import upgrade as alembic_upgrade
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

pytestmark = pytest.mark.migration

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS_DIR = os.path.join(API_DIR, "migrations")
ALEMBIC_INI = os.path.join(API_DIR, "alembic.ini")

CONTAINER_NAME = "peerdesk-migration-tests-pg"
HOST_PORT = 55491  # distinct from the live deploy stack's postgres (no host port at all)
PG_USER = "peerdesk"
PG_PASSWORD = "peerdesk"
PG_DB = "peerdesk"

ASYNC_DB_URL = f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@localhost:{HOST_PORT}/{PG_DB}"
ASYNCPG_DSN = f"postgresql://{PG_USER}:{PG_PASSWORD}@localhost:{HOST_PORT}/{PG_DB}"

# Kept in sync with 0013_drop_owner_id.py's SCOPED list -- the tables that
# are account-scoped and must have a NOT NULL account_id at head.
SCOPED_TABLES = ["machines", "companies", "api_keys", "registration_tokens", "branding"]


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=5, check=True)
    except Exception:
        return False
    return True


def _run(coro):
    return asyncio.run(coro)


async def _wait_for_postgres(timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            conn = await asyncpg.connect(dsn=ASYNCPG_DSN, timeout=2)
            await conn.close()
            return
        except Exception as e:  # noqa: BLE001 - retry loop, any error means "not ready yet"
            last_err = e
            await asyncio.sleep(0.5)
    raise RuntimeError(f"postgres in container {CONTAINER_NAME!r} never became ready: {last_err}")


@pytest.fixture(scope="session")
def postgres_container():
    """Starts postgres:16-alpine in a dedicated, disposable container for the
    whole test session. Skips the module if Docker isn't available. Never
    touches the running `deploy` containers or the live database."""
    if not _docker_available():
        pytest.skip("docker is not available/running; skipping real-Postgres migration tests")

    subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True)
    subprocess.run(
        [
            "docker", "run", "-d",
            "--name", CONTAINER_NAME,
            "-e", f"POSTGRES_USER={PG_USER}",
            "-e", f"POSTGRES_PASSWORD={PG_PASSWORD}",
            "-e", f"POSTGRES_DB={PG_DB}",
            "-p", f"{HOST_PORT}:5432",
            "postgres:16-alpine",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        _run(_wait_for_postgres())
        yield
    finally:
        subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True)


async def _reset_schema() -> None:
    conn = await asyncpg.connect(dsn=ASYNCPG_DSN)
    try:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


@pytest.fixture
def pg(postgres_container):
    """A blank database inside the shared container. Function-scoped so every
    test starts from an empty schema and tests can't see each other's data,
    even though the container itself is started once per session."""
    _run(_reset_schema())
    return ASYNC_DB_URL


def _alembic_config() -> Config:
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("script_location", MIGRATIONS_DIR)
    return cfg


def _upgrade(revision: str = "head") -> None:
    os.environ["DATABASE_URL"] = ASYNC_DB_URL
    alembic_upgrade(_alembic_config(), revision)


def _downgrade(revision: str = "base") -> None:
    os.environ["DATABASE_URL"] = ASYNC_DB_URL
    alembic_downgrade(_alembic_config(), revision)


async def _execute(sql: str, *args) -> None:
    conn = await asyncpg.connect(dsn=ASYNCPG_DSN)
    try:
        await conn.execute(sql, *args)
    finally:
        await conn.close()


async def _fetchval(sql: str, *args):
    conn = await asyncpg.connect(dsn=ASYNCPG_DSN)
    try:
        return await conn.fetchval(sql, *args)
    finally:
        await conn.close()


async def _reflect():
    """Returns (all_table_names, {table: {col_name: column_info}}) for every
    SCOPED_TABLES table, reflected off the live database via SQLAlchemy's
    Inspector (run through the async engine since only asyncpg is installed)."""
    engine = create_async_engine(ASYNC_DB_URL)
    try:
        async with engine.connect() as conn:
            def _do(sync_conn):
                insp = inspect(sync_conn)
                tables = set(insp.get_table_names())
                cols = {
                    t: {c["name"]: c for c in insp.get_columns(t)}
                    for t in SCOPED_TABLES
                    if t in tables
                }
                return tables, cols

            return await conn.run_sync(_do)
    finally:
        await engine.dispose()


# --- 1. upgrade head from empty -------------------------------------------

def test_upgrade_head_from_empty_succeeds(pg):
    """The base case: a fresh install must be able to reach head in one shot.
    This is the case the suite has effectively been "testing" all along via
    create_all -- except create_all can't fail the way a real migration can."""
    _upgrade("head")
    version = _run(_fetchval("SELECT version_num FROM alembic_version"))
    assert version == "0015"


# --- 2. round trip: head -> base -> head -----------------------------------

def test_upgrade_downgrade_upgrade_roundtrip(pg):
    """Round-tripping catches asymmetric downgrades -- a downgrade that
    doesn't fully undo its upgrade, or that raises outright. One such bug
    (0013's downgrade recreating owner_id without its NOT NULL/FK) was found
    this week precisely because someone did this by hand."""
    _upgrade("head")

    _downgrade("base")
    tables, _ = _run(_reflect())
    # every app table must be gone; only alembic's own bookkeeping table may remain
    assert tables - {"alembic_version"} == set(), f"downgrade base left tables behind: {tables}"
    remaining_version = _run(_fetchval("SELECT version_num FROM alembic_version"))
    assert remaining_version is None

    _upgrade("head")
    tables, _ = _run(_reflect())
    assert {"users", "accounts", "machines", "branding"} <= tables
    version = _run(_fetchval("SELECT version_num FROM alembic_version"))
    assert version == "0015"


# --- 3. zero-accounts branding: the Critical defect ------------------------

def test_zero_accounts_branding_survives_upgrade_head(pg):
    """Reproduces the exact shape of the Critical defect: a branding row
    exists (GET /branding is public and the login page calls it) but no one
    has registered yet, so there are zero accounts and zero users. Migrating
    to head must not abort. Before the fix, `ALTER TABLE branding ALTER
    COLUMN account_id SET NOT NULL` raised on the NULL row and took the
    whole migration down with it."""
    _upgrade("0012")

    _run(_execute("INSERT INTO branding (brand_name) VALUES ('Zero Accounts')"))
    assert _run(_fetchval("SELECT COUNT(*) FROM accounts")) == 0
    assert _run(_fetchval("SELECT COUNT(*) FROM users")) == 0
    assert _run(_fetchval("SELECT account_id FROM branding")) is None

    _upgrade("head")  # must not raise

    version = _run(_fetchval("SELECT version_num FROM alembic_version"))
    assert version == "0015"
    # 0013 deletes orphaned (NULL account_id) branding rows rather than leave
    # an un-tightenable column -- the row is regenerable, the migration is not.
    assert _run(_fetchval("SELECT COUNT(*) FROM branding")) == 0


# --- 4. the sequence defect --------------------------------------------------

def test_branding_sequence_resynced_after_upgrade(pg):
    """Reproduces the second defect: old app code always inserted branding
    with an explicit id=1, so branding_id_seq's nextval() was never called on
    any real deployment. After head, a second tenant's POST /branding (which
    inserts without an explicit id) must get a fresh id, not collide with the
    surviving id=1 row."""
    _upgrade("head")

    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        "acct-1", "Acme",
    ))
    _run(_execute(
        "INSERT INTO branding (id, account_id, brand_name) VALUES (1, $1, 'Acme')",
        "acct-1",
    ))

    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        "acct-2", "Beta",
    ))
    new_id = _run(_fetchval(
        "INSERT INTO branding (account_id, brand_name) VALUES ($1, 'Beta') RETURNING id",
        "acct-2",
    ))

    assert new_id is not None
    assert new_id != 1
    assert _run(_fetchval("SELECT COUNT(*) FROM branding")) == 2


# --- 4b. 0015: duplicate branding.account_id rows survive dedup ------------

def test_duplicate_branding_account_id_deduped_on_upgrade_head(pg):
    """Reproduces the Critical defect from the branding review: branding has
    no UNIQUE constraint on account_id, and _get_or_create's
    scalar_one_or_none() read-then-insert is racy, so two concurrent
    first-time POST /branding calls from the same account can each insert a
    row. Once that happens, every GET /branding -- public, called by the
    unauthenticated login page -- raises MultipleResultsFound and returns
    500 forever. Migration 0015 must deduplicate existing rows (keeping the
    lowest id per account_id) before creating the UNIQUE constraint, the
    same way 0013 had to survive unexpected data rather than abort mid-run."""
    _upgrade("0014")

    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        "acct-dup", "Acme",
    ))
    lower_id = _run(_fetchval(
        "INSERT INTO branding (account_id, brand_name) VALUES ($1, 'First') RETURNING id",
        "acct-dup",
    ))
    higher_id = _run(_fetchval(
        "INSERT INTO branding (account_id, brand_name) VALUES ($1, 'Second') RETURNING id",
        "acct-dup",
    ))
    assert _run(_fetchval(
        "SELECT COUNT(*) FROM branding WHERE account_id = $1", "acct-dup"
    )) == 2

    _upgrade("head")  # must not raise

    version = _run(_fetchval("SELECT version_num FROM alembic_version"))
    assert version == "0015"

    remaining = _run(_fetchval(
        "SELECT COUNT(*) FROM branding WHERE account_id = $1", "acct-dup"
    ))
    assert remaining == 1
    surviving_id = _run(_fetchval(
        "SELECT id FROM branding WHERE account_id = $1", "acct-dup"
    ))
    assert surviving_id == lower_id
    assert surviving_id != higher_id


# --- 5. schema parity between Alembic head and Base.metadata ---------------

def test_migrated_schema_matches_declared_models(pg):
    """A drift here means models.py and the migrations have diverged -- which
    is how a column ends up existing in only one of them. This checks table
    names, and for the five account-scoped tables, that account_id exists
    and is NOT NULL, matching 0013's SCOPED list and models.py."""
    _upgrade("head")

    from database import Base
    import models  # noqa: F401 -- registers all tables on Base.metadata

    tables, cols = _run(_reflect())
    expected_tables = set(Base.metadata.tables.keys())
    assert tables - {"alembic_version"} == expected_tables

    for table in SCOPED_TABLES:
        assert "account_id" in cols[table], f"{table} is missing account_id"
        assert cols[table]["account_id"]["nullable"] is False, (
            f"{table}.account_id should be NOT NULL at head"
        )


# --- 6. 0014: auth_sessions.account_id -------------------------------------

def test_auth_sessions_account_id_is_nullable_and_clears_on_account_delete(pg):
    """0014 adds account_id to auth_sessions so /auth/refresh can persist the
    active account across a refresh. Unlike SCOPED_TABLES, this column stays
    nullable forever -- sessions created before the migration have no value
    and routers/auth.py treats that as "fall back to the oldest membership",
    so there is nothing to backfill. The FK must be ON DELETE SET NULL (not
    CASCADE): deleting an account must not destroy the caller's login
    session, only detach it from that account."""
    _upgrade("head")

    is_nullable = _run(_fetchval(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = 'auth_sessions' AND column_name = 'account_id'"
    ))
    assert is_nullable == "YES"

    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        "acct-x", "Acme",
    ))
    _run(_execute(
        "INSERT INTO users (id, email, name, password_hash, is_active, created_at) "
        "VALUES ($1, $2, $3, $4, TRUE, NOW())",
        "user-x", "x@example.com", "X", "hash",
    ))
    _run(_execute(
        "INSERT INTO auth_sessions (id, user_id, token_hash, account_id, created_at, last_used_at) "
        "VALUES ($1, $2, $3, $4, NOW(), NOW())",
        "sess-x", "user-x", "hash", "acct-x",
    ))

    _run(_execute("DELETE FROM accounts WHERE id = $1", "acct-x"))

    remaining = _run(_fetchval("SELECT account_id FROM auth_sessions WHERE id = $1", "sess-x"))
    assert remaining is None
