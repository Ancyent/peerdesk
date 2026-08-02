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

Most of this does not go through the FastAPI app or routers/team.py -- it
operates directly on the access_grants/memberships tables (via raw asyncpg,
or via SQLAlchemy statements shaped like set_grants' own) so the two
transactions can be choreographed with asyncio.Event handshakes at the exact
points the finding describes. That is a deliberate departure from "test
through the API" for most of this file: the property under test is a
database interleaving, not application logic, and the interleaving can't be
forced through an HTTP client without a race that may or may not reproduce.

That departure has a cost: none of those tests import or execute
routers/team.py, so they cannot tell the difference between "the lock is in
set_grants" and "the lock was deleted from set_grants" -- both leave these
tests equally green. test_set_grants_route_prevents_merge_under_real_concurrency
at the bottom of this file closes that gap: it calls the actual
routers.team.set_grants coroutine (bypassing FastAPI's dependency injection,
not the function) so a change to that function's locking is what the test
depends on, not a hand-modeled copy of it. It gets its determinism from a
thin session wrapper that delays one side's COMMIT rather than from
choreographing individual SQL statements, since the statement sequence
inside set_grants is otherwise opaque from the outside.

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
SQLALCHEMY_ASYNC_DSN = f"postgresql+asyncpg://{PG_USER}:{PG_PASSWORD}@localhost:{HOST_PORT}/{PG_DB}"

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
    # Save/restore rather than just set: this env var is process-global, so
    # leaving it pointed at this fixture's throwaway container after the test
    # ends means the *next* thing to read DATABASE_URL in the same process
    # (e.g. a later `-m migration` test, or test_migrations.py's own fixture
    # running after this one) gets a DSN for a container that's already been
    # torn down.
    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = SQLALCHEMY_ASYNC_DSN
    try:
        alembic_upgrade(_alembic_config(), "head")
        yield
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url


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


async def _wait_until_blocked_on_memberships_lock(poll_conn, timeout: float = 5.0) -> None:
    """Polls pg_locks until some backend is shown blocked waiting to acquire
    a row lock another transaction holds, instead of sleeping a fixed guess.
    `poll_conn` must be a connection dedicated to polling: it can't be one of
    the two racing connections, since those are themselves in-flight on a
    blocking query and can't service another query concurrently.

    Row-level lock contention (`SELECT ... FOR UPDATE` blocking on a row
    another still-open transaction already locked) does NOT show up in
    pg_locks as an ungranted `tuple` lock on the target table -- Postgres
    implements it by having the waiter request a share lock on the holder's
    *transaction id*, which only resolves (releasing the waiter) once the
    holder commits or rolls back. That ungranted `transactionid` lock is
    what this polls for; two concurrent connections in this test file is
    always exactly one transaction blocked on exactly one other, so it's
    unambiguous here without also matching on which table's row is involved.

    Deterministic where `asyncio.sleep(0.2)` was not: on a loaded machine, a
    quarter-second guess can elapse before the second transaction's
    `FOR UPDATE` has even reached Postgres, and the assertion that follows
    (about which side blocked on which) fails spuriously -- not because the
    lock didn't work, but because the test didn't wait long enough to find
    out.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = await poll_conn.fetchrow(
            "SELECT 1 FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted"
        )
        if row is not None:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(
        "timed out waiting for a backend to block on another transaction's lock -- "
        "either the lock isn't being taken, or this poll is looking in the wrong place"
    )


# --- Without the fix: the race is real ---------------------------------

def test_concurrent_puts_without_lock_merge_instead_of_replace(pg):
    """Reproduces Finding 1 exactly: admin A replaces the member's one grant
    (Company A) with Company B (PUT {"grants": [{"company_id": B}]});
    concurrently, admin B saves an unrelated edit that (from B's point of
    view) keeps the member's existing grant on Company A unchanged (PUT
    {"grants": [{"company_id": A}]}). If B's SELECT of the "existing" rows
    happens before A's DELETE commits, B's own DELETE (by the same captured
    primary key A is deleting) matches zero rows once it resumes -- A's row
    is already gone -- and B's INSERT still lands, alongside A's own INSERT
    of Company B. Final state: the member holds BOTH companies -- the union
    of what the two admins each intended, when the whole point of a
    whole-set PUT is that the last write wins cleanly. This is the
    set_grants statement sequence with no membership row lock in front of
    it -- i.e. the code as it stood before this fix.

    Deliberately the same scenario (same pre-race state, same two desired
    states: tx1 -> Company B, tx2 -> Company A) as
    test_concurrent_puts_with_membership_lock_do_not_merge below, so the
    only variable between the two tests is the lock, not the scenario --
    see task-5-report.md's Gap 2 discussion for why that pairing matters.
    """
    async def run():
        setup = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            membership_id, co_a, co_b = await _seed(setup)
            # The pre-race state: the member already holds a grant on Company A.
            await _insert_grant(setup, membership_id, company_id=co_a)
        finally:
            await setup.close()

        conn1 = await asyncpg.connect(dsn=ASYNCPG_DSN)  # admin A: A -> B
        conn2 = await asyncpg.connect(dsn=ASYNCPG_DSN)  # admin B: unrelated re-save of A

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
                # admin A's desired state: Company B only.
                await _insert_grant(conn1, membership_id, company_id=co_b)
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
                # B's UI last knew, unaware A just moved the member off it).
                await _insert_grant(conn2, membership_id, company_id=co_a)

        await asyncio.gather(tx1(), tx2())
        await conn1.close()
        await conn2.close()

        check = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            final = await _final_company_ids(check, membership_id)
        finally:
            await check.close()

        return final, co_a, co_b, tx2_delete_matched, tx2_delete_returned_after_tx1_committed

    (final_company_ids, co_a, co_b, tx2_delete_matched,
     blocked_until_tx1_committed) = asyncio.run(run())

    # tx2's DELETE targeted the exact row tx1 also deleted; by the time it
    # ran, tx1 had already committed and removed it -- 0 rows matched.
    assert tx2_delete_matched == 0, (
        "expected tx2's DELETE to match zero rows (tx1 already removed them); "
        f"got {tx2_delete_matched}"
    )
    assert blocked_until_tx1_committed, (
        "tx2's DELETE returned before tx1 committed -- the row lock that should "
        "serialize these two didn't apply, so this run didn't exercise the race"
    )
    # The bug: the member ends up with BOTH companies -- the union of admin
    # A's and admin B's independent, non-overlapping intents -- instead of
    # cleanly reflecting whichever admin's write landed last. Neither test
    # in this file that only varies a single grant's presence/absence can
    # distinguish "union" from "last-writer-wins" when both happen to name
    # the same company; this scenario can't collapse that way, since A and B
    # are different companies and a correct last-writer-wins result is
    # always a strict subset of {A, B}, never both.
    assert final_company_ids == {co_a, co_b}, (
        f"expected the union {{A, B}} -- this IS the bug Finding 1 describes, "
        f"reproduced against real Postgres; got {final_company_ids} instead"
    )


# --- With the fix: the row lock serializes the two PUTs -----------------

def test_membership_lock_statement_matches_set_grants(pg):
    """Pins the exact SQLAlchemy statement routers/team.py:253-255 issues to
    lock the target membership row, and the exact SQL Postgres receives for
    it. This is a static, cheap check (needs Postgres only to import
    `models`, not to run against it) that catches a change to *what* gets
    locked -- wrong table, wrong column, or a dropped `.with_for_update()`
    -- independently of the timing-sensitive tests below. It does not by
    itself prove team.py still takes this lock at runtime; see
    test_set_grants_route_prevents_merge_under_real_concurrency for that.
    """
    from sqlalchemy import select as sa_select
    from sqlalchemy.dialects import postgresql
    from models import Membership

    stmt = sa_select(Membership.id).where(Membership.id == "x").with_for_update()
    compiled = str(stmt.compile(dialect=postgresql.dialect()))
    assert compiled == (
        "SELECT memberships.id \n"
        "FROM memberships \n"
        "WHERE memberships.id = %(id_1)s FOR UPDATE"
    ), compiled


def test_concurrent_puts_with_membership_lock_do_not_merge(pg):
    """Same scenario as test_concurrent_puts_without_lock_merge_instead_of_replace
    above (tx1 -> Company B, tx2 -> Company A, over a pre-existing grant on
    Company A) -- the only thing that differs between the two tests is that
    each transaction here takes
    `select(Membership.id).where(Membership.id == membership_id).with_for_update()`
    (issued through SQLAlchemy against an AsyncSession, the same statement
    shape set_grants in routers/team.py uses, rather than a hand-written
    `SELECT ... FOR UPDATE` string) before reading the existing grants. tx2
    cannot even perform its SELECT of existing grants until tx1's lock is
    released by COMMIT, so tx2's read is no longer stale: it sees tx1's
    post-commit state (Company B) and correctly replaces that with its own
    desired state (Company A), rather than merging with it.
    """
    async def run():
        setup = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            membership_id, co_a, co_b = await _seed(setup)
            await _insert_grant(setup, membership_id, company_id=co_a)
        finally:
            await setup.close()

        from sqlalchemy import select as sa_select
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
        from models import AccessGrant, Membership

        engine = create_async_engine(SQLALCHEMY_ASYNC_DSN)
        session1 = AsyncSession(engine)
        session2 = AsyncSession(engine)
        poll_conn = await asyncpg.connect(dsn=ASYNCPG_DSN)  # dedicated: sessions 1/2 are themselves in-flight

        lock_stmt = sa_select(Membership.id).where(Membership.id == membership_id).with_for_update()

        tx1_locked = asyncio.Event()
        tx1_committed = asyncio.Event()
        tx2_lock_wait_started = asyncio.Event()

        async def tx1():
            async with session1.begin():
                await session1.execute(lock_stmt)
                tx1_locked.set()
                await tx2_lock_wait_started.wait()
                # Wait until tx2 is actually blocked on this lock in Postgres
                # (not just "has probably had time to get there") before
                # doing tx1's own work and releasing it.
                await _wait_until_blocked_on_memberships_lock(poll_conn)
                existing = (await session1.execute(
                    sa_select(AccessGrant).where(AccessGrant.membership_id == membership_id)
                )).scalars().all()
                for row in existing:
                    await session1.delete(row)
                # admin A's desired state: Company B only.
                session1.add(AccessGrant(membership_id=membership_id, company_id=co_b))
            tx1_committed.set()

        tx2_locked_after_tx1_committed = False
        tx2_saw_company_b = None

        async def tx2():
            nonlocal tx2_locked_after_tx1_committed, tx2_saw_company_b
            await tx1_locked.wait()
            async with session2.begin():
                lock_fut = asyncio.ensure_future(session2.execute(lock_stmt))
                tx2_lock_wait_started.set()
                await lock_fut
                tx2_locked_after_tx1_committed = tx1_committed.is_set()

                existing = (await session2.execute(
                    sa_select(AccessGrant).where(AccessGrant.membership_id == membership_id)
                )).scalars().all()
                tx2_saw_company_b = {row.company_id for row in existing} == {co_b}
                for row in existing:
                    await session2.delete(row)
                # admin B's desired state: keep Company A.
                session2.add(AccessGrant(membership_id=membership_id, company_id=co_a))

        await asyncio.gather(tx1(), tx2())
        await session1.close()
        await session2.close()
        await poll_conn.close()
        await engine.dispose()

        check = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            final = await _final_company_ids(check, membership_id)
        finally:
            await check.close()

        return final, tx2_locked_after_tx1_committed, tx2_saw_company_b, co_a, co_b

    (final_company_ids, locked_after_commit, saw_company_b,
     co_a, co_b) = asyncio.run(run())

    assert locked_after_commit, (
        "tx2 acquired the membership row lock before tx1 committed -- the fix "
        "isn't serializing the two transactions"
    )
    assert saw_company_b, (
        "tx2's read of existing grants did not reflect tx1's post-commit state "
        "(Company B) even though it only ran after acquiring the lock tx1 held "
        "until commit -- tx2's read was stale"
    )
    # admin A's edit landed and was then cleanly superseded by admin B's own
    # desired state (Company A) -- last-committer-wins, not a merge of both.
    assert final_company_ids == {co_a}, (
        f"expected only admin B's own grant (Company A) to survive; got {final_company_ids}"
    )


# --- Regression guard: this must fail if the lock is deleted from team.py ---

# How long tx2 waits for tx1 to hold the membership lock before giving up and
# running anyway. Generous on purpose: reaching it must mean "team.py issues no
# FOR UPDATE", never "the machine was briefly busy". The previous value was
# 0.1s, which an instrumented run showed expiring on *every* execution -- tx1
# needs ~0.10s just to reach its lock statement. The test passed anyway only
# because tx2 then took another ~0.08s to reach its own, so tx1 still won by
# luck rather than by coordination; when scheduling ate that margin, tx2 locked
# first, tx1 became the last writer, and the run failed with Company B alone.
TX1_LOCK_WAIT = 2.0

# How long tx1 holds its transaction open waiting for tx2 to contend. Must stay
# comfortably above TX1_LOCK_WAIT plus one full tx2 transaction: if the lock is
# ever deleted from team.py, tx2 gives up after TX1_LOCK_WAIT and must still
# finish inside this window for the merge to happen and the test to fail.
LOCK_ABSENT_WINDOW = 5.0

class _InstrumentedSession:
    """Wraps a real AsyncSession, delegating everything set_grants (routers/
    team.py) calls on `db`. Two knobs, both driven by inspecting statements
    rather than by a pause plumbed through set_grants itself -- the function
    is opaque from out here, unlike the hand-choreographed tests above:

    - `on_lock_acquired`, if given, is set the moment a statement whose text
      contains "FOR UPDATE" finishes executing -- i.e. the instant this
      session actually holds the membership row lock set_grants takes at
      team.py:253-255. If team.py never issues such a statement (the lock
      has been removed), this event is simply never set.
    - `delay_before_commit` sleeps before delegating commit(). By the time
      set_grants reaches its commit, it has already read the "existing"
      grants and queued its delete/insert in the ORM unit of work
      (unflushed); sleeping here holds that open long enough for the other
      concurrent call to genuinely overlap it.
    """
    def __init__(self, session, *, on_lock_acquired=None, before_commit=None,
                 trace=None, label: str = ""):
        self._session = session
        self._on_lock_acquired = on_lock_acquired
        # before_commit is an async callable awaited just before delegating
        # commit(), replacing what used to be a fixed `asyncio.sleep(0.6)`.
        # The sleep was a guess about how long the other call needs to reach
        # its own lock; this lets the caller wait on something observable
        # instead. See the test's docstring for why the guess was wrong.
        self._before_commit = before_commit
        # trace is an append-only list of (monotonic_seconds, label, event)
        # shared by both concurrent calls. It exists because this test failed
        # once in roughly five full-suite runs and never reproduced on demand,
        # so the assertion message has to carry enough of the interleaving to
        # diagnose a CI failure without reproducing it locally. Recording only
        # -- it changes no timing decision and no control flow.
        self._trace = trace
        self._label = label

    def _record(self, event: str) -> None:
        if self._trace is not None:
            self._trace.append((time.monotonic(), self._label, event))

    async def execute(self, statement, *args, **kwargs):
        is_lock = "FOR UPDATE" in str(statement)
        if is_lock:
            self._record("lock stmt issued")
        result = await self._session.execute(statement, *args, **kwargs)
        if is_lock:
            self._record("lock stmt returned (row now locked)")
            if self._on_lock_acquired is not None:
                self._on_lock_acquired.set()
        return result

    def add(self, obj):
        return self._session.add(obj)

    async def delete(self, obj):
        return await self._session.delete(obj)

    async def commit(self):
        if self._before_commit is not None:
            await self._before_commit(self._record)
        self._record("commit issued")
        result = await self._session.commit()
        self._record("commit returned")
        return result


def test_set_grants_route_prevents_merge_under_real_concurrency(pg):
    """The actual regression guard for the `.with_for_update()` at
    routers/team.py:253-255. Every other test in this file drives the
    access_grants/memberships tables directly and never imports team.py at
    all (see the module docstring) -- delete the lock from set_grants and
    they keep passing, which is exactly the gap this test closes. This one
    calls the real `routers.team.set_grants` coroutine -- the same function
    FastAPI invokes for `PUT /team/members/{id}/grants` -- twice,
    concurrently, each against its own real Postgres-backed AsyncSession.

    Same scenario as the two tests above (pre-existing grant on Company A;
    tx1 -> Company B, tx2 -> Company A) so a union {A, B} unambiguously means
    "these two concurrent calls merged instead of one replacing the other."

    tx2 doesn't start at all until tx1 has either acquired the membership
    lock (signaled via _InstrumentedSession.on_lock_acquired) or 100ms have
    passed with no such statement seen -- which happens if the lock has been
    deleted, and is short enough to still leave tx1's 0.6s delayed commit
    below as a wide-open overlap window. tx1's own commit is delayed 0.6s
    (via `delay_before_commit`) so it holds its critical section open long
    enough for tx2 to genuinely contend for the same lock:

    - Lock present: tx2's own lock statement blocks in Postgres until tx1's
      delayed commit finally runs, so tx2's read of "existing" reflects
      tx1's post-commit state (Company B) and correctly replaces it with
      Company A.
    - Lock absent: tx2 has nothing to block on. It runs to completion --
      reading the still-untouched original Company A row, deleting it, and
      committing its own Company A insert -- entirely within tx1's 0.6s
      sleep, before tx1 ever flushes. When tx1 wakes and its commit finally
      flushes, SQLAlchemy's unit of work inserts before it deletes for the
      same mapper, so tx1's Company B insert lands, and its delete of the
      original Company A row (by then already gone, deleted by tx2) matches
      zero rows -- no error, just a silent no-op. Final state: both
      companies.
    """
    async def run():
        setup = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            membership_id, co_a, co_b = await _seed(setup)
            await _insert_grant(setup, membership_id, company_id=co_a)
            account_id = await setup.fetchval(
                "SELECT account_id FROM memberships WHERE id = $1", membership_id,
            )
            admin_user_id = str(uuid.uuid4())
            admin_membership_id = str(uuid.uuid4())
            await setup.execute(
                "INSERT INTO users (id, email, name, password_hash, is_active, totp_enabled, created_at) "
                "VALUES ($1, $2, 'Admin', 'x', true, false, NOW())",
                admin_user_id, f"{admin_user_id}@test.com",
            )
            await setup.execute(
                "INSERT INTO memberships (id, user_id, account_id, role, created_at) "
                "VALUES ($1, $2, $3, 'admin', NOW())",
                admin_membership_id, admin_user_id, account_id,
            )
        finally:
            await setup.close()

        from sqlalchemy import select as sa_select
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
        from models import Membership, User
        from schemas import GrantIn, GrantsIn
        from routers.team import set_grants

        engine = create_async_engine(SQLALCHEMY_ASYNC_DSN)
        Session = async_sessionmaker(engine, expire_on_commit=False)

        tx1_lock_acquired = asyncio.Event()
        trace: list[tuple[float, str, str]] = []

        # Dedicated connection: the two racing sessions are themselves in-flight
        # on blocking queries and cannot service another statement concurrently.
        poll_conn = await asyncpg.connect(dsn=ASYNCPG_DSN)

        async def wait_until_someone_blocks(record) -> None:
            """tx1's hold-open, replacing a fixed sleep with an observation.

            Returns as soon as Postgres reports a backend blocked on another
            transaction's lock -- i.e. the moment tx2 genuinely contends -- or
            after LOCK_ABSENT_WINDOW if nobody ever blocks, which is what
            happens when the lock has been deleted from team.py. That window
            must stay comfortably longer than TX1_LOCK_WAIT plus one full tx2
            transaction, so the no-lock case still produces the merge this test
            exists to catch.
            """
            deadline = time.monotonic() + LOCK_ABSENT_WINDOW
            while time.monotonic() < deadline:
                row = await poll_conn.fetchrow(
                    "SELECT 1 FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted"
                )
                if row is not None:
                    record("observed the other call blocked on this lock")
                    return
                await asyncio.sleep(0.02)
            record(f"NOBODY BLOCKED within {LOCK_ABSENT_WINDOW}s -- no lock is being taken")

        async def call_set_grants(company_id, *, before_commit, label,
                                  signal_lock=False, wait_for_lock=False):
            trace.append((time.monotonic(), label, "call started"))
            if wait_for_lock:
                try:
                    await asyncio.wait_for(tx1_lock_acquired.wait(), timeout=TX1_LOCK_WAIT)
                    trace.append((time.monotonic(), label, "saw tx1 hold the lock"))
                except asyncio.TimeoutError:
                    # No lock statement seen at all -- proceed anyway, so the
                    # missing-lock regression still produces a merge. This is
                    # now a real signal rather than routine noise: with
                    # TX1_LOCK_WAIT set generously, reaching it means team.py
                    # issued no FOR UPDATE, not that the machine was busy.
                    trace.append((time.monotonic(), label, "TIMED OUT waiting for tx1's lock"))
            async with Session() as raw_session:
                admin_membership = (await raw_session.execute(
                    sa_select(Membership).where(Membership.id == admin_membership_id)
                )).scalar_one()
                admin_user = (await raw_session.execute(
                    sa_select(User).where(User.id == admin_user_id)
                )).scalar_one()
                wrapped = _InstrumentedSession(
                    raw_session,
                    on_lock_acquired=tx1_lock_acquired if signal_lock else None,
                    before_commit=before_commit,
                    trace=trace,
                    label=label,
                )
                await set_grants(
                    membership_id=membership_id,
                    body=GrantsIn(grants=[GrantIn(company_id=company_id)]),
                    db=wrapped,
                    user=admin_user,
                    membership=admin_membership,
                )
            trace.append((time.monotonic(), label, "call finished"))

        try:
            await asyncio.gather(
                call_set_grants(co_b, before_commit=wait_until_someone_blocks,
                                signal_lock=True, label="tx1 (-> B)"),
                call_set_grants(co_a, before_commit=None,
                                wait_for_lock=True, label="tx2 (-> A)"),
            )
        finally:
            await poll_conn.close()
        await engine.dispose()

        check = await asyncpg.connect(dsn=ASYNCPG_DSN)
        try:
            final = await _final_company_ids(check, membership_id)
        finally:
            await check.close()
        return final, co_a, co_b, trace

    final_company_ids, co_a, co_b, trace = asyncio.run(run())

    if final_company_ids == {co_a, co_b}:
        outcome = ("both companies -- the two concurrent set_grants calls MERGED instead of "
                   "one replacing the other, which is exactly what the membership row lock "
                   "in routers/team.py:set_grants exists to prevent")
    elif final_company_ids == {co_b}:
        outcome = ("Company B only -- tx1 won, so the two calls ran in the opposite order to "
                   "the one this test sets up. That is a broken test scenario, not a broken "
                   "lock: check the timeline below for 'TIMED OUT waiting for tx1's lock'")
    else:
        outcome = "neither the expected nor a recognised failure shape"

    origin = trace[0][0] if trace else 0.0
    timeline = "\n".join(f"    +{t - origin:6.3f}s  {label:12}  {event}" for t, label, event in trace)

    assert final_company_ids == {co_a}, (
        f"expected last-writer-wins (tx2's own desired state, Company A only); "
        f"got {final_company_ids} -- {outcome}.\n"
        f"  Company A = {co_a}\n  Company B = {co_b}\n"
        f"  interleaving actually observed:\n{timeline}"
    )
