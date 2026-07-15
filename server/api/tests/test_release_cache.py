import json
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
