import asyncio
import json

import httpx
import pytest
import release_cache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(release_cache, "CACHE_DIR", tmp_path)
    return tmp_path


def _write_manifest(cache, assets):
    (cache / "manifest.json").write_text(json.dumps({
        "tag_name": "v0.4.32",
        "html_url": "https://github.com/OWNER/REPO/releases/tag/v0.4.32",
        "fetched_at": "2026-07-15T08:00:00Z",
        "assets": assets,
    }))


def test_read_manifest_returns_none_when_empty(cache):
    assert release_cache.read_manifest() is None


def test_read_manifest_returns_none_when_corrupt(cache):
    (cache / "manifest.json").write_text("{not json")
    assert release_cache.read_manifest() is None


def test_read_manifest_roundtrips(cache):
    _write_manifest(cache, [{"name": "agent-linux", "size": 12}])
    m = release_cache.read_manifest()
    assert m["tag_name"] == "v0.4.32"
    assert m["assets"][0]["name"] == "agent-linux"


def test_asset_path_resolves_listed_file(cache):
    _write_manifest(cache, [{"name": "agent-linux", "size": 3}])
    (cache / "agent-linux").write_bytes(b"bin")
    assert release_cache.asset_path("agent-linux") == cache / "agent-linux"


def test_asset_path_rejects_name_not_in_manifest(cache):
    _write_manifest(cache, [{"name": "agent-linux", "size": 3}])
    (cache / "secret").write_bytes(b"x")
    assert release_cache.asset_path("secret") is None


def test_asset_path_rejects_traversal(tmp_path, monkeypatch):
    # pytest's tmp_path already sits several levels under /tmp, so a name like
    # "../../etc/passwd" resolves to a path that doesn't exist -- a naive
    # implementation would return None simply because the file is missing, not
    # because traversal was blocked, making the test pass even without a guard.
    #
    # To make this test actually exercise the guard, we put the cache in its
    # own subdirectory (so there is a real directory directly above it) and
    # write a real file there that "../secret.txt" would genuinely reach if
    # the containment check in asset_path() were removed. The manifest must
    # list that traversal name too, since asset_path() checks manifest
    # membership before the guard runs.
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    monkeypatch.setattr(release_cache, "CACHE_DIR", cache_dir)
    (tmp_path / "secret.txt").write_bytes(b"SECRET")

    _write_manifest(cache_dir, [{"name": "../secret.txt", "size": 6}])
    assert release_cache.asset_path("../secret.txt") is None


def test_asset_path_returns_none_when_file_missing(cache):
    _write_manifest(cache, [{"name": "agent-linux", "size": 3}])
    assert release_cache.asset_path("agent-linux") is None


def _github_release(tag="v0.4.32", assets=(("agent-linux", b"BINARY"),)):
    return {
        "tag_name": tag,
        "html_url": f"https://github.com/OWNER/REPO/releases/tag/{tag}",
        "assets": [
            {"name": n, "size": len(b), "browser_download_url": f"https://dl.test/{n}"}
            for n, b in assets
        ],
    }


@pytest.fixture
def fake_github(monkeypatch):
    """Route release_cache's httpx client through a MockTransport."""
    # Captured once, outside install(), so a second install() call in the same
    # test (see test_refresh_prunes_assets_from_older_releases) wraps the real
    # httpx.AsyncClient rather than the previous call's already-patched factory.
    real = httpx.AsyncClient

    def install(release, bodies, fail_download=False):
        def handler(request: httpx.Request) -> httpx.Response:
            if "api.github.com" in request.url.host:
                return httpx.Response(200, json=release)
            if fail_download:
                return httpx.Response(500)
            return httpx.Response(200, content=bodies[request.url.path.lstrip("/")])

        transport = httpx.MockTransport(handler)

        def factory(*a, **kw):
            kw["transport"] = transport
            return real(*a, **kw)

        monkeypatch.setattr(release_cache.httpx, "AsyncClient", factory)
    return install


async def test_refresh_downloads_assets_and_writes_manifest(cache, fake_github):
    fake_github(_github_release(), {"agent-linux": b"BINARY"})
    assert await release_cache.refresh() is True
    assert (cache / "agent-linux").read_bytes() == b"BINARY"
    m = release_cache.read_manifest()
    assert m["tag_name"] == "v0.4.32"
    assert m["assets"] == [{"name": "agent-linux", "size": 6}]
    assert m["fetched_at"].endswith("Z")


async def test_refresh_is_noop_when_tag_unchanged(cache, fake_github):
    fake_github(_github_release(), {"agent-linux": b"BINARY"})
    await release_cache.refresh()
    assert await release_cache.refresh() is False


async def test_refresh_keeps_serving_old_release_when_github_fails(cache, fake_github, monkeypatch):
    fake_github(_github_release(), {"agent-linux": b"BINARY"})
    await release_cache.refresh()

    def boom(*a, **kw):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(release_cache.httpx, "AsyncClient", boom)
    assert await release_cache.refresh() is False

    # The whole point: the cached release survives a failed refresh.
    assert release_cache.read_manifest()["tag_name"] == "v0.4.32"
    assert (cache / "agent-linux").read_bytes() == b"BINARY"


async def test_failed_download_leaves_no_partial_file_and_no_manifest(cache, fake_github):
    fake_github(_github_release(), {}, fail_download=True)
    assert await release_cache.refresh() is False
    assert release_cache.read_manifest() is None
    assert not (cache / "agent-linux").exists()
    assert list(cache.glob("*.tmp")) == []


async def test_refresh_prunes_assets_from_older_releases(cache, fake_github):
    fake_github(_github_release("v0.4.32", (("old-asset", b"OLD"),)), {"old-asset": b"OLD"})
    await release_cache.refresh()
    fake_github(_github_release("v0.4.33", (("new-asset", b"NEW"),)), {"new-asset": b"NEW"})
    await release_cache.refresh()
    assert (cache / "new-asset").exists()
    assert not (cache / "old-asset").exists()


async def test_refresh_loop_disabled_makes_no_network_call(cache, monkeypatch):
    called = False

    async def tripwire():
        nonlocal called
        called = True
        return False

    monkeypatch.setattr(release_cache, "refresh", tripwire)
    await release_cache.refresh_loop(0)
    assert called is False, "RELEASE_REFRESH_SECONDS=0 must not touch the network"
