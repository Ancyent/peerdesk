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

# The expected Alembic head. Bump this in the task that adds a migration.
HEAD_REVISION = "0018"


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
    assert version == HEAD_REVISION


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
    assert version == HEAD_REVISION


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
    assert version == HEAD_REVISION
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
    assert version == HEAD_REVISION

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


# --- Stage 2: saved connect passwords move to (membership, machine) ---------

def _seed_account_user_machine(account_id, user_id, machine_id, peer_id, saved_enc):
    """Creates account + user + membership + machine, with an optional saved
    password on the machine.

    saved_password_enc is set via a follow-up UPDATE, not in the INSERT
    itself, so this stays usable both at revision 0016 (column exists) and at
    head (0017 has dropped it) -- callers seeding at head always pass
    saved_enc=None, so the UPDATE simply never runs and the now-nonexistent
    column is never referenced. Returns nothing; callers assert."""
    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        account_id, "Acme",
    ))
    _run(_execute(
        "INSERT INTO users (id, email, name, password_hash, is_active, created_at) "
        "VALUES ($1, $2, $3, 'hash', TRUE, NOW())",
        user_id, f"{user_id}@example.com", "U",
    ))
    _run(_execute(
        "INSERT INTO memberships (id, user_id, account_id, role, created_at) "
        "VALUES ($1, $2, $3, 'admin', NOW())",
        f"mem-{user_id}", user_id, account_id,
    ))
    _run(_execute(
        "INSERT INTO machines (id, peer_id, name, account_id, created_by_id, "
        "is_online, approval_status, created_at) "
        "VALUES ($1, $2, 'M', $3, $4, FALSE, 'approved', NOW())",
        machine_id, peer_id, account_id, user_id,
    ))
    if saved_enc is not None:
        _run(_execute(
            "UPDATE machines SET saved_password_enc = $1 WHERE id = $2",
            saved_enc, machine_id,
        ))


def test_saved_password_moves_to_creators_membership(pg):
    """The ordinary case: the machine's created_by_id is still a member, so the
    stored password becomes that person's copy rather than being lost."""
    _upgrade("0016")
    _seed_account_user_machine("acct-1", "user-1", "mach-1", "AAA-1111", "enc-secret")

    _upgrade("0017")

    row = _run(_fetchval(
        "SELECT password_enc FROM saved_connect_passwords "
        "WHERE machine_id = $1 AND membership_id = $2",
        "mach-1", "mem-user-1",
    ))
    assert row == "enc-secret"
    assert _run(_fetchval("SELECT COUNT(*) FROM saved_connect_passwords")) == 1


def test_saved_password_dropped_when_creator_is_not_a_member(pg):
    """The rule that matters: a password whose enroller has left the account is
    deleted, not silently reassigned to an admin. Also covers created_by_id
    being NULL, which its ON DELETE SET NULL foreign key produces."""
    _upgrade("0016")
    _seed_account_user_machine("acct-2", "user-2", "mach-2", "BBB-2222", "orphan-enc")
    # user-2 leaves the account; the machine keeps created_by_id pointing at them
    _run(_execute("DELETE FROM memberships WHERE user_id = $1", "user-2"))

    _upgrade("0017")

    assert _run(_fetchval("SELECT COUNT(*) FROM saved_connect_passwords")) == 0


def test_saved_password_column_is_gone_at_head(pg):
    """0017 drops machines.saved_password_enc. If it survives, the app and the
    schema disagree about where the credential lives."""
    _upgrade("head")

    exists = _run(_fetchval(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_name = 'machines' AND column_name = 'saved_password_enc'"
    ))
    assert exists == 0


# --- 0018: backfill inconsistent machine placement columns -----------------

def _seed_bare_account_and_user(account_id, user_id):
    """Just an account + user + admin membership, no machine -- 0018's seed
    needs the tree (companies/locations/groups) inserted separately per test,
    so this stops short of _seed_account_user_machine's machine insert (which
    also still writes the now-dropped saved_password_enc column at 0017+)."""
    _run(_execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        account_id, "Acme",
    ))
    _run(_execute(
        "INSERT INTO users (id, email, name, password_hash, is_active, created_at) "
        "VALUES ($1, $2, $3, 'hash', TRUE, NOW())",
        user_id, f"{user_id}@example.com", "U",
    ))
    _run(_execute(
        "INSERT INTO memberships (id, user_id, account_id, role, created_at) "
        "VALUES ($1, $2, $3, 'admin', NOW())",
        f"mem-{user_id}", user_id, account_id,
    ))


def test_backfill_repairs_group_placement_missing_ancestors(pg):
    """Reproduces the shape a pre-existing test proved reachable: PATCH
    .../placement with only {"group_id": ...} used to return 200 and leave
    company_id/location_id NULL. A machine in that state is invisible to a
    member holding a company- or location-level grant even though it sits
    inside that company/location (access.visible_machines matches grants
    against these denormalized columns directly, with no recursive walk).
    Seeded at 0017 -- the revision before 0018 -- so this exercises exactly
    the backfill migration and nothing upstream of it."""
    _upgrade("0017")
    _seed_bare_account_and_user("acct-bf1", "user-bf1")
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-bf1', 'Co', 'acct-bf1', NOW())"
    ))
    _run(_execute(
        "INSERT INTO locations (id, name, company_id, created_at) "
        "VALUES ('loc-bf1', 'Loc', 'co-bf1', NOW())"
    ))
    _run(_execute(
        "INSERT INTO groups (id, name, location_id, created_at) "
        "VALUES ('grp-bf1', 'Grp', 'loc-bf1', NOW())"
    ))
    _run(_execute(
        "INSERT INTO machines (id, peer_id, name, account_id, created_by_id, "
        "is_online, approval_status, created_at, group_id) "
        "VALUES ('mach-bf1', 'GGG-7777', 'M', 'acct-bf1', 'user-bf1', FALSE, "
        "'approved', NOW(), 'grp-bf1')"
    ))
    company_before = _run(_fetchval("SELECT company_id FROM machines WHERE id = 'mach-bf1'"))
    location_before = _run(_fetchval("SELECT location_id FROM machines WHERE id = 'mach-bf1'"))
    assert (company_before, location_before) == (None, None)

    _upgrade("0018")

    row_company = _run(_fetchval("SELECT company_id FROM machines WHERE id = 'mach-bf1'"))
    row_location = _run(_fetchval("SELECT location_id FROM machines WHERE id = 'mach-bf1'"))
    assert row_company == "co-bf1"
    assert row_location == "loc-bf1"


def test_backfill_repairs_location_placement_wrong_company(pg):
    """Covers the other reachable inconsistency: location_id set with
    company_id NULL or pointing at the wrong company. Deterministic because
    locations.company_id is NOT NULL -- every location has exactly one
    company, so there is only one correct value to backfill."""
    _upgrade("0017")
    _seed_bare_account_and_user("acct-bf2", "user-bf2")
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-bf2-right', 'Right', 'acct-bf2', NOW())"
    ))
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-bf2-wrong', 'Wrong', 'acct-bf2', NOW())"
    ))
    _run(_execute(
        "INSERT INTO locations (id, name, company_id, created_at) "
        "VALUES ('loc-bf2', 'Loc', 'co-bf2-right', NOW())"
    ))
    _run(_execute(
        "INSERT INTO machines (id, peer_id, name, account_id, created_by_id, "
        "is_online, approval_status, created_at, location_id, company_id) "
        "VALUES ('mach-bf2', 'HHH-8888', 'M', 'acct-bf2', 'user-bf2', FALSE, "
        "'approved', NOW(), 'loc-bf2', 'co-bf2-wrong')"
    ))

    _upgrade("0018")

    row_company = _run(_fetchval("SELECT company_id FROM machines WHERE id = 'mach-bf2'"))
    assert row_company == "co-bf2-right"


def test_backfill_leaves_consistent_placement_untouched(pg):
    """A machine that was already consistent (company-only placement, no
    location/group) must survive the backfill unchanged -- the migration only
    repairs rows that are wrong, it doesn't touch valid partial placements."""
    _upgrade("0017")
    _seed_bare_account_and_user("acct-bf3", "user-bf3")
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-bf3', 'Co', 'acct-bf3', NOW())"
    ))
    _run(_execute(
        "INSERT INTO machines (id, peer_id, name, account_id, created_by_id, "
        "is_online, approval_status, created_at, company_id) "
        "VALUES ('mach-bf3', 'III-9999', 'M', 'acct-bf3', 'user-bf3', FALSE, "
        "'approved', NOW(), 'co-bf3')"
    ))

    _upgrade("0018")

    row_company = _run(_fetchval("SELECT company_id FROM machines WHERE id = 'mach-bf3'"))
    row_location = _run(_fetchval("SELECT location_id FROM machines WHERE id = 'mach-bf3'"))
    assert row_company == "co-bf3"
    assert row_location is None


def test_backfill_skips_cross_account_group_placement(pg):
    """The FKs on machines/groups/locations/companies never enforced that a
    machine's account matches its placement's account -- that guard is
    app-level (assert_placement_consistent) and postdates rows like this one.
    A machine in account A with group_id pointing into account B's tree must
    NOT get company_id/location_id backfilled from B's tree: that would leak
    account B's company id onto an account A machine. Left inconsistent
    (NULL) is the safe outcome here, not silently "repaired" cross-account."""
    _upgrade("0017")
    _seed_bare_account_and_user("acct-bf4a", "user-bf4a")
    _seed_bare_account_and_user("acct-bf4b", "user-bf4b")
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-bf4b', 'Co B', 'acct-bf4b', NOW())"
    ))
    _run(_execute(
        "INSERT INTO locations (id, name, company_id, created_at) "
        "VALUES ('loc-bf4b', 'Loc B', 'co-bf4b', NOW())"
    ))
    _run(_execute(
        "INSERT INTO groups (id, name, location_id, created_at) "
        "VALUES ('grp-bf4b', 'Grp B', 'loc-bf4b', NOW())"
    ))
    # Machine belongs to account A but its group_id points into account B's tree.
    _run(_execute(
        "INSERT INTO machines (id, peer_id, name, account_id, created_by_id, "
        "is_online, approval_status, created_at, group_id) "
        "VALUES ('mach-bf4', 'JJJ-0000', 'M', 'acct-bf4a', 'user-bf4a', FALSE, "
        "'approved', NOW(), 'grp-bf4b')"
    ))

    _upgrade("0018")

    row_company = _run(_fetchval("SELECT company_id FROM machines WHERE id = 'mach-bf4'"))
    row_location = _run(_fetchval("SELECT location_id FROM machines WHERE id = 'mach-bf4'"))
    assert row_company is None
    assert row_location is None


# --- Stage 2: access_grants exactly-one-target CHECK -----------------------

def test_access_grant_rejects_two_targets(pg):
    """The CHECK is the whole reason a grant cannot mean two things at once.
    A test that only inserts valid rows would pass with no constraint at all."""
    _upgrade("head")
    _seed_account_user_machine("acct-3", "user-3", "mach-3", "CCC-3333", None)
    _run(_execute(
        "INSERT INTO companies (id, name, account_id, created_at) "
        "VALUES ('co-3', 'Co', 'acct-3', NOW())"
    ))

    import asyncpg as _asyncpg
    with pytest.raises(_asyncpg.exceptions.CheckViolationError):
        _run(_execute(
            "INSERT INTO access_grants (id, membership_id, created_by_id, created_at, "
            "company_id, machine_id) VALUES ('g-bad', 'mem-user-3', 'user-3', NOW(), "
            "'co-3', 'mach-3')"
        ))


def test_access_grant_rejects_zero_targets(pg):
    """A grant with no target grants nothing and would sit in the table forever
    looking like access somebody has."""
    _upgrade("head")
    _seed_account_user_machine("acct-4", "user-4", "mach-4", "DDD-4444", None)

    import asyncpg as _asyncpg
    with pytest.raises(_asyncpg.exceptions.CheckViolationError):
        _run(_execute(
            "INSERT INTO access_grants (id, membership_id, created_by_id, created_at) "
            "VALUES ('g-empty', 'mem-user-4', 'user-4', NOW())"
        ))


def test_access_grant_created_at_is_not_nullable(pg):
    """models.py declares created_at: Mapped[datetime] (NOT NULL under
    create_all). The migration must match, or a fresh install (create_all)
    and a migrated install (alembic) end up with different schemas for the
    same table."""
    _upgrade("head")

    is_nullable = _run(_fetchval(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = 'access_grants' AND column_name = 'created_at'"
    ))
    assert is_nullable == "NO"
