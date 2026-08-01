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
