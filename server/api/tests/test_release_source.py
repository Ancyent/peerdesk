import asyncio
import importlib
import os

import pytest

import release_cache


def _reload(monkeypatch, value):
    """Re-import the module so the module-level constant is re-read.

    RELEASE_SOURCE is read at import time like every other setting in this
    file, so a test that only patched the environment would assert nothing.
    """
    if value is None:
        monkeypatch.delenv("RELEASE_SOURCE", raising=False)
    else:
        monkeypatch.setenv("RELEASE_SOURCE", value)
    return importlib.reload(release_cache)


def test_defaults_to_github_so_existing_deployments_are_unchanged(monkeypatch):
    mod = _reload(monkeypatch, None)
    assert mod.RELEASE_SOURCE == "github"
    assert mod.mirrors_github() is True


def test_local_stops_mirroring(monkeypatch):
    mod = _reload(monkeypatch, "local")
    assert mod.RELEASE_SOURCE == "local"
    assert mod.mirrors_github() is False


def test_the_value_is_case_insensitive(monkeypatch):
    # An operator writing LOCAL in a .env file means local. Getting this wrong
    # would silently keep mirroring and overwrite their own build.
    assert _reload(monkeypatch, "LOCAL").mirrors_github() is False
    assert _reload(monkeypatch, "Local").mirrors_github() is False


def test_an_empty_value_means_github_rather_than_crashing_the_api(monkeypatch):
    # docker-compose passes ${RELEASE_SOURCE:-github}, so an empty .env line
    # arrives as "github" there. Set directly in the environment (an exported
    # but empty shell variable), the empty string reaches this module -- and
    # raising on it restart-loops the api instead of doing the obvious thing.
    assert _reload(monkeypatch, "").RELEASE_SOURCE == "github"
    assert _reload(monkeypatch, "   ").mirrors_github() is True


def test_an_unknown_value_is_rejected_at_import(monkeypatch):
    # Failing loudly at startup beats silently mirroring over a local build.
    with pytest.raises(ValueError, match="RELEASE_SOURCE"):
        _reload(monkeypatch, "both")


def test_refresh_refuses_to_run_when_the_source_is_local(monkeypatch):
    mod = _reload(monkeypatch, "local")
    assert asyncio.run(mod.refresh()) is False


def teardown_module():
    # Leave the module as the rest of the suite expects to find it.
    os.environ.pop("RELEASE_SOURCE", None)
    importlib.reload(release_cache)


def test_a_locally_built_release_is_served_with_its_own_signature(tmp_path):
    """A client verifies an update against the key baked into it. This asserts
    the signature the server hands out is the one the local build produced, so
    a deployment serving its own artifacts serves its own trust domain too."""
    import release_cache

    (tmp_path / "peerdesk-viewer-linux-v9.9.9.AppImage").write_bytes(b"payload")
    (tmp_path / "peerdesk-viewer-linux-v9.9.9.AppImage.sig").write_text("LOCALLY-SIGNED")

    manifest = {
        "tag_name": "v9.9.9",
        "assets": [
            {"name": "peerdesk-viewer-linux-v9.9.9.AppImage", "size": 7},
            {"name": "peerdesk-viewer-linux-v9.9.9.AppImage.sig", "size": 14},
        ],
    }

    def sig_reader(name):
        p = tmp_path / name
        return p.read_text() if p.exists() else None

    platforms = release_cache.updater_platforms(
        manifest, sig_reader, base_url="https://example.invalid"
    )
    entry = next(iter(platforms.values()))
    assert entry["signature"] == "LOCALLY-SIGNED"
    assert "peerdesk-viewer-linux-v9.9.9.AppImage" in entry["url"]


def test_an_asset_with_no_signature_is_not_offered_as_an_update():
    """Offering an unsigned artifact would make every client reject the update
    at install time, after downloading it. Better not to offer it at all."""
    import release_cache

    manifest = {
        "tag_name": "v9.9.9",
        "assets": [{"name": "peerdesk-viewer-linux-v9.9.9.AppImage", "size": 7}],
    }
    platforms = release_cache.updater_platforms(
        manifest, lambda name: None, base_url="https://example.invalid"
    )
    assert platforms == {}
