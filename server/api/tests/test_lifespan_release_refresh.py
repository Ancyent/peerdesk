"""The single line the self-hosted release cache rests on.

`main.lifespan` starts the GitHub mirror loop only when RELEASE_SOURCE is
`github`. If it ever started in `local` mode, the loop would wake up on its
timer, see the locally built tag differ from GitHub's, download GitHub's assets
and prune the operator's own artifacts away -- silently swapping a deployment's
trust domain for the project's. Nothing else in the suite covers the wiring
itself, only the pieces either side of it.
"""
import asyncio

import main
import release_cache


def _refresh_task():
    for task in asyncio.all_tasks():
        if task.get_name() == "release-refresh":
            return task
    return None


async def _never_returns():
    await asyncio.sleep(3600)


async def test_the_refresh_loop_runs_when_mirroring_github(monkeypatch):
    started = []

    async def fake_loop(*args, **kwargs):
        started.append(True)
        await _never_returns()

    monkeypatch.setattr(release_cache, "RELEASE_SOURCE", "github")
    monkeypatch.setattr(release_cache, "refresh_loop", fake_loop)

    async with main.lifespan(main.app):
        # Hand the loop one turn so the freshly created task actually enters
        # fake_loop -- otherwise this would assert only that a task object was
        # constructed, which is not the property that matters.
        await asyncio.sleep(0)
        task = _refresh_task()
        assert task is not None
        assert started == [True]

    # Shutdown must stop it, or the task outlives the app it belongs to.
    assert task.done()
    assert _refresh_task() is None


async def test_no_refresh_loop_when_the_cache_is_locally_built(monkeypatch):
    started = []

    async def fake_loop(*args, **kwargs):
        started.append(True)
        await _never_returns()

    monkeypatch.setattr(release_cache, "RELEASE_SOURCE", "local")
    monkeypatch.setattr(release_cache, "refresh_loop", fake_loop)

    async with main.lifespan(main.app):
        await asyncio.sleep(0)
        assert _refresh_task() is None
        assert started == []
