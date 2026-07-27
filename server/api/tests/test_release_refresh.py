"""POST /releases/refresh — the hook CI calls after publishing a tag.

The endpoint exists so a new release reaches clients in seconds instead of
waiting up to an hour for the periodic loop. It is guarded by a shared secret:
left open, it would let anyone make this server hammer GitHub's API and
re-download every asset on demand.
"""
import asyncio

import pytest
import release_cache
from routers import releases


@pytest.fixture
def no_real_refresh(monkeypatch):
    """Never touch GitHub or the cache directory from a test."""
    calls = []

    async def fake_refresh():
        calls.append(1)
        return True

    monkeypatch.setattr(release_cache, "refresh", fake_refresh)
    return calls


async def test_refresh_is_404_when_no_token_is_configured(client, monkeypatch, no_real_refresh):
    # An unconfigured deployment should not even advertise the route.
    monkeypatch.setattr(releases, "REFRESH_TOKEN", "")

    r = await client.post("/releases/refresh")

    assert r.status_code == 404
    assert no_real_refresh == [], "refresh ran despite the endpoint being disabled"


async def test_refresh_rejects_a_missing_token(client, monkeypatch, no_real_refresh):
    monkeypatch.setattr(releases, "REFRESH_TOKEN", "s3cret")

    r = await client.post("/releases/refresh")

    assert r.status_code == 403
    assert no_real_refresh == []


async def test_refresh_rejects_a_wrong_token(client, monkeypatch, no_real_refresh):
    monkeypatch.setattr(releases, "REFRESH_TOKEN", "s3cret")

    r = await client.post("/releases/refresh", headers={"X-Refresh-Token": "guess"})

    assert r.status_code == 403
    assert no_real_refresh == []


async def test_refresh_runs_with_the_right_token(client, monkeypatch, no_real_refresh):
    monkeypatch.setattr(releases, "REFRESH_TOKEN", "s3cret")

    r = await client.post("/releases/refresh", headers={"X-Refresh-Token": "s3cret"})

    assert r.status_code == 202
    assert r.json() == {"status": "ok", "changed": True}
    assert no_real_refresh == [1], "refresh should have run exactly once"


async def test_a_second_call_does_not_stack_refreshes(client, monkeypatch):
    """A burst of CI calls must not multiply the outbound work."""
    monkeypatch.setattr(releases, "REFRESH_TOKEN", "s3cret")

    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def slow_refresh():
        calls.append(1)
        started.set()
        await release.wait()
        return True

    monkeypatch.setattr(release_cache, "refresh", slow_refresh)

    first = asyncio.create_task(
        client.post("/releases/refresh", headers={"X-Refresh-Token": "s3cret"})
    )
    await asyncio.wait_for(started.wait(), timeout=5)

    # While the first is still in flight, a second call is turned away.
    second = await client.post("/releases/refresh", headers={"X-Refresh-Token": "s3cret"})
    assert second.status_code == 202
    assert second.json() == {"status": "already-running", "changed": False}

    release.set()
    r1 = await asyncio.wait_for(first, timeout=5)
    assert r1.status_code == 202
    assert calls == [1], "the second call started a duplicate refresh"
