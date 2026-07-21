"""Real two-connection Postgres proof for Finding 1 of the Task 5 grants-API
review: concurrent PUTs to the same member's grants can merge instead of
replace, silently undoing a revocation.

Why this file exists rather than relying on tests/test_grants.py or
tests/test_team.py: those run against SQLite (see tests/conftest.py), and
``.with_for_update()`` -- the fix -- is a documented no-op on SQLite. A
unit test cannot prove a row lock does anything there. This file, modeled on
tests/test_migrations.py's throwaway-Postgres harness, drives two real
asyncpg connections against a real postgres:16-alpine container and issues
the exact statement sequence routers/team.py's set_grants runs (SELECT
existing ids, DELETE those ids, INSERT the new rows, COMMIT), with and
without the row lock, to show the race is real and the fix serializes it.

This does not go through the FastAPI app or SQLAlchemy ORM -- it operates
directly on the access_grants/memberships tables so the two transactions can
be choreographed with asyncio.Event handshakes at the exact points the
finding describes. That is a deliberate departure from "test through the
API" for this one file: the property under test is a database interleaving,
not application logic, and the interleaving can't be forced through an HTTP
client without a race that may or may not reproduce.

Slow, and needs Docker -- part of the `migration` marker group, same as
test_migrations.py. Select just these with `-m migration`.
"""
import asyncio
import os
import shutil
import subprocess
import time
import uuid

import asyncpg
import pytest

pytestmark = pytest.mark.migration

CONTAINER_NAME = "peerdesk-grants-race-tests-pg"
HOST_PORT = 55492  # distinct from both the live deploy stack and test_migrations.py's container
PG_USER = "peerdesk"
PG_PASSWORD = "peerdesk"
PG_DB = "peerdesk"
ASYNCPG_DSN = f"postgresql://{PG_USER}:{PG_PASSWORD}@localhost:{HOST_PORT}/{PG_DB}"

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS_DIR = os.path.join(API_DIR, "migrations")
ALEMBIC_INI = os.path.join(API_DIR, "alembic.ini")


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=5, check=True)
    except Exception:
        return False
    return True


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


@pytest.fixture(scope="module")
def postgres_container():
    """Own container, own name/port -- never touches the live `deploy` stack
    or test_migrations.py's container, and can run in the same session as
    that file without port collisions."""
    if not _docker_available():
        pytest.skip("docker is not available/running; skipping real-Postgres grants race tests")

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
        check=True, capture_output=True, text=True,
    )
    try:
        asyncio.run(_wait_for_postgres())
        yield
    finally:
        subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True)


def _alembic_config():
    from alembic.config import Config
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("script_location", MIGRATIONS_DIR)
    return cfg


@pytest.fixture
def pg(postgres_container):
    """A fresh schema, migrated to head via the real Alembic scripts (not
    create_all) -- same reasoning as test_migrations.py: this is the schema
    that actually ships, CHECK constraints and FKs included."""
    async def _reset():
        conn = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        finally:
            await conn.close()

    asyncio.run(_reset())
    from alembic.command import upgrade as alembic_upgrade
    async_db_url = f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@localhost:{HOST_PORT}/{PG_DB}"
    os.environ["DATABASE_URL"] = async_db_url
    alembic_upgrade(_alembic_config(), "head")


async def _seed(conn) -> tuple[str, str, str]:
    """One account, one member, two companies (A, B). Returns
    (membership_id, company_a_id, company_b_id)."""
    account_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    membership_id = str(uuid.uuid4())
    co_a = str(uuid.uuid4())
    co_b = str(uuid.uuid4())

    await conn.execute(
        "INSERT INTO accounts (id, name, created_at) VALUES ($1, $2, NOW())",
        account_id, "Acme",
    )
    await conn.execute(
        "INSERT INTO users (id, email, name, password_hash, is_active, totp_enabled, created_at) "
        "VALUES ($1, $2, 'Member', 'x', true, false, NOW())",
        user_id, f"{user_id}@test.com",
    )
    await conn.execute(
        "INSERT INTO memberships (id, user_id, account_id, role, created_at) "
        "VALUES ($1, $2, $3, 'member', NOW())",
        membership_id, user_id, account_id,
    )
    await conn.execute(
        "INSERT INTO companies (id, name, account_id, created_at) VALUES ($1, 'A', $2, NOW())",
        co_a, account_id,
    )
    await conn.execute(
        "INSERT INTO companies (id, name, account_id, created_at) VALUES ($1, 'B', $2, NOW())",
        co_b, account_id,
    )
    return membership_id, co_a, co_b


async def _existing_ids(conn, membership_id: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT id FROM access_grants WHERE membership_id = $1 ORDER BY id", membership_id,
    )
    return [r["id"] for r in rows]


async def _insert_grant(conn, membership_id: str, *, company_id: str | None = None) -> None:
    await conn.execute(
        "INSERT INTO access_grants (id, membership_id, created_at, company_id) "
        "VALUES ($1, $2, NOW(), $3)",
        str(uuid.uuid4()), membership_id, company_id,
    )


async def _final_company_ids(conn, membership_id: str) -> set[str]:
    rows = await conn.fetch(
        "SELECT company_id FROM access_grants WHERE membership_id = $1", membership_id,
    )
    return {r["company_id"] for r in rows}


# --- Without the fix: the race is real ---------------------------------

def test_concurrent_puts_without_lock_merge_instead_of_replace(pg):
    """Reproduces Finding 1 exactly: admin A revokes the member down to
    nothing (PUT {"grants": []}); concurrently, admin B saves an unrelated
    edit that (from B's point of view) keeps the member's existing grant on
    Company A and adds nothing else new. If B's SELECT of the "existing"
    rows happens before A's DELETE commits, B's own DELETE (by the same
    captured primary keys A is deleting) matches zero rows once it resumes
    -- A's rows are already gone -- and B's INSERT still lands. Final state:
    the member keeps access to Company A, even though admin A's revoke
    reported success. This is the set_grants statement sequence with no
    membership row lock in front of it -- i.e. the code as it stood before
    this fix.
    """
    async def run():
        setup = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            membership_id, co_a, _co_b = await _seed(setup)
            # The pre-race state: the member already holds a grant on Company A.
            await _insert_grant(setup, membership_id, company_id=co_a)
        finally:
            await setup.close()

        conn1 = await asyncpg.connect(dsn=ASYNCPG_DSN)  # admin A: revoke everything
        conn2 = await asyncpg.connect(dsn=ASYNCPG_DSN)  # admin B: unrelated re-save

        tx1_read_done = asyncio.Event()
        tx2_read_done = asyncio.Event()
        tx1_delete_done = asyncio.Event()  # tx1's DELETE has been sent and has acquired its locks
        tx1_committed = asyncio.Event()

        async def tx1():
            async with conn1.transaction():
                ids = await _existing_ids(conn1, membership_id)
                tx1_read_done.set()
                await tx2_read_done.wait()  # force true overlap: both read the same stale set
                if ids:
                    await conn1.execute(
                        "DELETE FROM access_grants WHERE id = ANY($1::text[])", ids,
                    )
                # admin A's desired state is empty -- no inserts.
                tx1_delete_done.set()
            tx1_committed.set()

        tx2_delete_returned_after_tx1_committed = False
        tx2_delete_matched = None

        async def tx2():
            nonlocal tx2_delete_returned_after_tx1_committed, tx2_delete_matched
            await tx1_read_done.wait()
            async with conn2.transaction():
                ids = await _existing_ids(conn2, membership_id)
                tx2_read_done.set()
                # Don't attempt the DELETE until tx1's own DELETE has already
                # been issued (and thus already holds the row locks) --
                # otherwise which of the two DELETEs reaches Postgres first
                # is a race and the test would be non-deterministic about
                # which side blocks.
                await tx1_delete_done.wait()
                if ids:
                    tag = await conn2.execute(
                        "DELETE FROM access_grants WHERE id = ANY($1::text[])", ids,
                    )
                    tx2_delete_matched = int(tag.split()[-1])
                tx2_delete_returned_after_tx1_committed = tx1_committed.is_set()
                # admin B's desired state: keep Company A (echoing back what
                # B's UI last knew, unaware A just revoked it).
                await _insert_grant(conn2, membership_id, company_id=co_a)

        await asyncio.gather(tx1(), tx2())
        await conn1.close()
        await conn2.close()

        check = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            final = await _final_company_ids(check, membership_id)
        finally:
            await check.close()

        return final, tx2_delete_matched, tx2_delete_returned_after_tx1_committed

    final_company_ids, tx2_delete_matched, blocked_until_tx1_committed = asyncio.run(run())

    # tx2's DELETE targeted the exact rows tx1 also deleted; by the time it
    # ran, tx1 had already committed and removed them -- 0 rows matched.
    assert tx2_delete_matched == 0, (
        "expected tx2's DELETE to match zero rows (tx1 already removed them); "
        f"got {tx2_delete_matched}"
    )
    assert blocked_until_tx1_committed, (
        "tx2's DELETE returned before tx1 committed -- the row lock that should "
        "serialize these two didn't apply, so this run didn't exercise the race"
    )
    # The bug: admin A's revoke-to-nothing was silently undone. The member
    # still has access to Company A because B's insert was never touched by
    # either transaction's DELETE.
    assert final_company_ids != set(), (
        "admin A's revoke to an empty grant set should have left the member with "
        "zero grants; instead the member kept access -- this IS the bug Finding 1 "
        "describes, reproduced against real Postgres"
    )


# --- With the fix: the row lock serializes the two PUTs -----------------

def test_concurrent_puts_with_membership_lock_do_not_merge(pg):
    """Same choreography as above, except each transaction takes
    `SELECT id FROM memberships WHERE id = $1 FOR UPDATE` before reading the
    existing grants -- the fix applied to set_grants in routers/team.py.
    tx2 cannot even perform its SELECT of existing grants until tx1's lock
    is released by COMMIT, so tx2's read is no longer stale: it sees tx1's
    post-commit state (nothing) and correctly reflects admin B's own desired
    state on top of that, rather than resurrecting rows admin A just
    removed.
    """
    async def run():
        setup = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            membership_id, co_a, co_b = await _seed(setup)
            await _insert_grant(setup, membership_id, company_id=co_a)
        finally:
            await setup.close()

        conn1 = await asyncpg.connect(dsn=ASYNCPG_DSN)
        conn2 = await asyncpg.connect(dsn=ASYNCPG_DSN)

        tx1_locked = asyncio.Event()
        tx1_committed = asyncio.Event()
        tx2_lock_wait_started = asyncio.Event()

        async def tx1():
            async with conn1.transaction():
                await conn1.fetchval(
                    "SELECT id FROM memberships WHERE id = $1 FOR UPDATE", membership_id,
                )
                tx1_locked.set()
                await tx2_lock_wait_started.wait()
                # Give tx2's FOR UPDATE a moment to actually reach Postgres
                # and start waiting on tx1's lock before tx1 releases it.
                await asyncio.sleep(0.2)
                ids = await _existing_ids(conn1, membership_id)
                if ids:
                    await conn1.execute(
                        "DELETE FROM access_grants WHERE id = ANY($1::text[])", ids,
                    )
                # admin A's desired state is empty -- no inserts.
            tx1_committed.set()

        tx2_locked_after_tx1_committed = False
        tx2_saw_empty_existing = None

        async def tx2():
            nonlocal tx2_locked_after_tx1_committed, tx2_saw_empty_existing
            await tx1_locked.wait()
            async with conn2.transaction():
                lock_fut = asyncio.ensure_future(
                    conn2.fetchval("SELECT id FROM memberships WHERE id = $1 FOR UPDATE", membership_id)
                )
                tx2_lock_wait_started.set()
                await lock_fut
                tx2_locked_after_tx1_committed = tx1_committed.is_set()

                ids = await _existing_ids(conn2, membership_id)
                tx2_saw_empty_existing = (ids == [])
                if ids:
                    await conn2.execute(
                        "DELETE FROM access_grants WHERE id = ANY($1::text[])", ids,
                    )
                # admin B's desired state: an unrelated grant on Company B.
                await _insert_grant(conn2, membership_id, company_id=co_b)

        await asyncio.gather(tx1(), tx2())
        await conn1.close()
        await conn2.close()

        check = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            final = await _final_company_ids(check, membership_id)
        finally:
            await check.close()

        return final, tx2_locked_after_tx1_committed, tx2_saw_empty_existing, co_b

    final_company_ids, locked_after_commit, saw_empty, co_b = asyncio.run(run())

    assert locked_after_commit, (
        "tx2 acquired the membership row lock before tx1 committed -- the fix "
        "isn't serializing the two transactions"
    )
    assert saw_empty, (
        "tx2's read of existing grants was stale (saw tx1's pre-revoke rows) even "
        "though it only ran after acquiring the lock tx1 held until commit"
    )
    # admin A's revoke landed cleanly (nothing left over from it: no Company A),
    # and admin B's own unrelated grant (Company B) is the only thing present --
    # last-committer-wins on B's actual desired state, not a merge of both.
    assert final_company_ids == {co_b}, (
        f"expected only admin B's own grant (Company B) to survive; got {final_company_ids}"
    )
