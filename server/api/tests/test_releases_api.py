import json
import pytest
import release_cache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(release_cache, "CACHE_DIR", tmp_path)
    return tmp_path


def _seed(cache, name="agent-linux", body=b"BINARY"):
    (cache / name).write_bytes(body)
    (cache / "manifest.json").write_text(json.dumps({
        "tag_name": "v0.4.32",
        "html_url": "https://github.com/OWNER/REPO/releases/tag/v0.4.32",
        "fetched_at": "2026-07-15T08:00:00Z",
        "assets": [{"name": name, "size": len(body)}],
    }))


async def test_latest_503_when_cache_empty(client, cache):
    r = await client.get("/releases/latest")
    assert r.status_code == 503
    assert "GitHub" in r.json()["detail"]


async def test_latest_503_in_local_mode_does_not_blame_github(client, cache, monkeypatch):
    """With RELEASE_SOURCE=local nothing is ever fetched, so telling the
    operator to check RELEASE_REPO and their outbound network sends them to
    debug a component that is switched off. The cache is just empty."""
    monkeypatch.setattr(release_cache, "RELEASE_SOURCE", "local")
    r = await client.get("/releases/latest")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "GitHub" not in detail
    assert "RELEASE_REPO" not in detail
    assert "RELEASE_SOURCE=local" in detail


async def test_latest_returns_manifest_with_server_relative_urls(client, cache):
    _seed(cache)
    r = await client.get("/releases/latest")
    assert r.status_code == 200
    body = r.json()
    assert body["tag_name"] == "v0.4.32"
    asset = body["assets"][0]
    assert asset["name"] == "agent-linux"
    assert asset["size"] == 6
    # Clients must be pointed at this server, never at GitHub.
    assert asset["browser_download_url"] == "/api/releases/download/agent-linux"


async def test_latest_needs_no_auth(client, cache):
    # install.sh fetches this before any session exists.
    _seed(cache)
    assert (await client.get("/releases/latest")).status_code == 200


async def test_download_streams_the_cached_file(client, cache):
    _seed(cache)
    r = await client.get("/releases/download/agent-linux")
    assert r.status_code == 200
    assert r.content == b"BINARY"


async def test_download_404_for_unknown_asset(client, cache):
    _seed(cache)
    assert (await client.get("/releases/download/nope")).status_code == 404


async def test_download_rejects_traversal(client, cache):
    # Honesty note (see task-3-report.md): this specific attempt never reaches
    # release_cache.asset_path() at all. FastAPI's default `{name}` path
    # converter matches `[^/]+`, so a decoded segment containing "/" fails
    # Starlette's own route matching and returns its generic 404 before our
    # endpoint runs -- verified by disabling asset_path()'s containment check
    # and confirming this test still passed. The real containment guard inside
    # asset_path() (a name that resolves outside CACHE_DIR without a literal
    # slash) is exercised directly, bypassing HTTP routing, by
    # test_release_cache.py::test_asset_path_rejects_traversal. This test is
    # kept because it documents a real, load-bearing defense layer (routing
    # itself refuses to deliver a slash-containing name to any endpoint) --
    # it just isn't the layer its name might suggest.
    _seed(cache)
    r = await client.get("/releases/download/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code == 404
