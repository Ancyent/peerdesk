import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

# The builder is not importable as a package - it ships in the image, not in
# the API - so load it by path, the way the image will invoke it.
_SPEC = importlib.util.spec_from_file_location(
    "write_manifest",
    Path(__file__).resolve().parents[3] / "deploy" / "builder" / "write_manifest.py",
)
_MOD = importlib.util.module_from_spec(_SPEC)
sys.modules["write_manifest"] = _MOD
_SPEC.loader.exec_module(_MOD)
write_manifest = _MOD.write_manifest


def _artifacts(tmp_path: Path) -> Path:
    for name, size in [
        ("peerdesk-agent-linux-x86_64-v9.9.9", 1000),
        ("peerdesk-viewer-linux-v9.9.9.AppImage", 2000),
        ("peerdesk-viewer-linux-v9.9.9.AppImage.sig", 30),
        ("peerdesk-viewer-windows-v9.9.9-x64.msi", 3000),
    ]:
        (tmp_path / name).write_bytes(b"x" * size)
    return tmp_path


def test_writes_every_required_key(tmp_path):
    m = write_manifest(_artifacts(tmp_path), "v9.9.9")
    assert set(m) == {"tag_name", "html_url", "body", "published_at", "fetched_at", "assets"}
    assert m["tag_name"] == "v9.9.9"


def test_lists_every_artifact_with_its_real_size(tmp_path):
    m = write_manifest(_artifacts(tmp_path), "v9.9.9")
    by_name = {a["name"]: a["size"] for a in m["assets"]}
    assert by_name["peerdesk-agent-linux-x86_64-v9.9.9"] == 1000
    assert by_name["peerdesk-viewer-windows-v9.9.9-x64.msi"] == 3000
    # The signature is an asset too - the updater fetches it by name.
    assert by_name["peerdesk-viewer-linux-v9.9.9.AppImage.sig"] == 30


def test_does_not_list_the_manifest_itself(tmp_path):
    write_manifest(_artifacts(tmp_path), "v9.9.9")
    m = write_manifest(tmp_path, "v9.9.9")
    assert all(a["name"] != "manifest.json" for a in m["assets"])


def test_the_file_on_disk_matches_what_was_returned(tmp_path):
    m = write_manifest(_artifacts(tmp_path), "v9.9.9")
    assert json.loads((tmp_path / "manifest.json").read_text()) == m


def test_timestamps_are_iso_utc(tmp_path):
    m = write_manifest(_artifacts(tmp_path), "v9.9.9")
    for key in ("published_at", "fetched_at"):
        # Parses, and carries a zone - release_cache and the updater read these.
        assert datetime.fromisoformat(m[key].replace("Z", "+00:00")).tzinfo is not None


def test_release_cache_can_read_what_we_wrote(tmp_path, monkeypatch):
    """The point of the whole task: this manifest must be indistinguishable
    from a mirrored one to the code that serves it."""
    import release_cache

    write_manifest(_artifacts(tmp_path), "v9.9.9")
    monkeypatch.setattr(release_cache, "CACHE_DIR", tmp_path)
    read = release_cache.read_manifest()
    assert read["tag_name"] == "v9.9.9"
    assert release_cache.asset_path("peerdesk-viewer-windows-v9.9.9-x64.msi") is not None

    # And the updater consumes it: the producer's asset names have to line up
    # with the suffixes updater_platforms matches on, or a local build serves a
    # Downloads page that works and an update endpoint that offers nothing.
    platforms = release_cache.updater_platforms(
        read, lambda n: release_cache.asset_path(n).read_text() if release_cache.asset_path(n) else None
    )
    assert set(platforms) == {"linux-x86_64"}  # no .exe in this fixture
    assert platforms["linux-x86_64"]["url"].endswith("peerdesk-viewer-linux-v9.9.9.AppImage")


def test_refuses_a_directory_with_no_artifacts(tmp_path):
    with pytest.raises(ValueError, match="no artifacts"):
        write_manifest(tmp_path, "v9.9.9")
