# Map the two shipped updater bundles (Windows NSIS .exe, Linux .AppImage) + their .sig.
# Bundle name patterns confirmed against .github/workflows/build-clients.yml:
#   peerdesk-viewer-windows-{VERSION}-x64-setup.exe  (NSIS installer)
#   peerdesk-viewer-windows-{VERSION}-x64.msi        (MSI installer)
#   peerdesk-viewer-linux-{VERSION}.AppImage
# (.deb / .rpm are also produced but are not Tauri updater targets.)
import json

import pytest
import release_cache
from release_cache import updater_platforms


def test_updater_platforms_pairs_bundles_with_signatures():
    manifest = {
        "version": "0.5.0",
        "assets": [
            {"name": "peerdesk-viewer-windows-0.5.0-x64-setup.exe"},
            {"name": "peerdesk-viewer-windows-0.5.0-x64-setup.exe.sig"},
            {"name": "peerdesk-viewer-linux-0.5.0.AppImage"},
            {"name": "peerdesk-viewer-linux-0.5.0.AppImage.sig"},
            {"name": "peerdesk-viewer-linux-0.5.0-amd64.deb"},  # not an updater target — ignored
        ],
    }
    sigs = {
        "peerdesk-viewer-windows-0.5.0-x64-setup.exe.sig": "SIG_WIN",
        "peerdesk-viewer-linux-0.5.0.AppImage.sig": "SIG_LINUX",
    }
    plats = updater_platforms(manifest, lambda n: sigs.get(n))
    assert plats["windows-x86_64"] == {
        "signature": "SIG_WIN",
        "url": "/api/releases/download/peerdesk-viewer-windows-0.5.0-x64-setup.exe",
    }
    assert plats["linux-x86_64"] == {
        "signature": "SIG_LINUX",
        "url": "/api/releases/download/peerdesk-viewer-linux-0.5.0.AppImage",
    }
    assert "darwin-x86_64" not in plats  # no macOS bundle


def test_updater_platforms_omits_platform_missing_its_sig():
    manifest = {
        "version": "0.5.0",
        "assets": [{"name": "peerdesk-viewer-windows-0.5.0-x64-setup.exe"}],
    }
    plats = updater_platforms(manifest, lambda n: None)  # no .sig
    assert plats == {}


def test_windows_prefers_nsis_setup_exe_over_msi_regardless_of_order():
    # Every real release ships both bundles for windows-x86_64. Tauri's
    # updater consumes the NSIS -setup.exe, so it must win deterministically
    # no matter which order the assets happen to appear in.
    base = [
        {"name": "peerdesk-viewer-windows-0.5.0-x64-setup.exe"},
        {"name": "peerdesk-viewer-windows-0.5.0-x64-setup.exe.sig"},
        {"name": "peerdesk-viewer-windows-0.5.0-x64.msi"},
        {"name": "peerdesk-viewer-windows-0.5.0-x64.msi.sig"},
    ]
    sigs = {
        "peerdesk-viewer-windows-0.5.0-x64-setup.exe.sig": "SIG_EXE",
        "peerdesk-viewer-windows-0.5.0-x64.msi.sig": "SIG_MSI",
    }
    for assets in (base, list(reversed(base))):
        plats = updater_platforms({"version": "0.5.0", "assets": assets}, lambda n: sigs.get(n))
        assert plats["windows-x86_64"]["url"] == "/api/releases/download/peerdesk-viewer-windows-0.5.0-x64-setup.exe"
        assert plats["windows-x86_64"]["signature"] == "SIG_EXE"


# --- GET /releases/update/{target}/{arch}/{current_version} ---------------
# Reuses test_release_cache.py's cache-seeding pattern: monkeypatch
# release_cache.CACHE_DIR to a tmp_path and write manifest.json + assets by
# hand (no real GitHub call involved).

WIN_NAME = "peerdesk-viewer-windows-0.5.0-x64-setup.exe"
LINUX_NAME = "peerdesk-viewer-linux-0.5.0.AppImage"


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(release_cache, "CACHE_DIR", tmp_path)
    return tmp_path


def _write_manifest(cache, assets, body=None, published_at=None):
    manifest = {
        "tag_name": "v0.5.0",
        "html_url": "https://github.com/OWNER/REPO/releases/tag/v0.5.0",
        "fetched_at": "2026-07-15T08:00:00Z",
        "assets": assets,
    }
    if body is not None:
        manifest["body"] = body
    if published_at is not None:
        manifest["published_at"] = published_at
    (cache / "manifest.json").write_text(json.dumps(manifest))


def _seed_full_release(cache, body=None, published_at=None):
    """A manifest with both updater bundles and their .sig on disk."""
    (cache / WIN_NAME).write_bytes(b"WINBIN")
    (cache / f"{WIN_NAME}.sig").write_text("SIG_WIN\n")
    (cache / LINUX_NAME).write_bytes(b"LINUXBIN")
    (cache / f"{LINUX_NAME}.sig").write_text("SIG_LINUX\n")
    _write_manifest(cache, [
        {"name": WIN_NAME, "size": 6},
        {"name": f"{WIN_NAME}.sig", "size": 8},
        {"name": LINUX_NAME, "size": 8},
        {"name": f"{LINUX_NAME}.sig", "size": 10},
    ], body=body, published_at=published_at)


async def test_update_endpoint_returns_tauri_manifest(client, cache):
    # No body/published_at cached (e.g. an old manifest written before that
    # was persisted) -- notes falls back to "" and pub_date falls back to
    # fetched_at.
    _seed_full_release(cache)
    r = await client.get("/releases/update/windows/x86_64/0.4.0")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "0.5.0"  # no leading "v"
    assert body["notes"] == ""
    assert body["pub_date"] == "2026-07-15T08:00:00Z"  # fetched_at fallback

    # Tauri's updater deserializes each platform `url` into a `url::Url`,
    # which requires an ABSOLUTE url (Url::parse fails on a bare path with
    # RelativeUrlWithoutBase) -- so the endpoint must prefix it with the
    # scheme+host the request actually arrived on. httpx's ASGITransport
    # test client talks to base_url="http://test", so that's what a
    # request with no forwarding headers resolves to.
    win = body["platforms"]["windows-x86_64"]
    assert win["url"] == f"http://test/api/releases/download/{WIN_NAME}"
    assert win["signature"] == "SIG_WIN"  # stripped of trailing whitespace

    linux = body["platforms"]["linux-x86_64"]
    assert linux["url"] == f"http://test/api/releases/download/{LINUX_NAME}"
    assert linux["signature"] == "SIG_LINUX"


async def test_update_endpoint_url_is_absolute_and_honors_forwarded_headers(client, cache):
    # Our nginx sets X-Forwarded-Proto (trusted) but not X-Forwarded-Host, so
    # the manifest must be built from Host + X-Forwarded-Proto, and a forged
    # X-Forwarded-Host must be ignored entirely.
    _seed_full_release(cache)
    r = await client.get(
        "/releases/update/windows/x86_64/0.4.0",
        headers={
            "Host": "real.example.com",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "evil.example.com",
        },
    )
    assert r.status_code == 200
    body = r.json()
    win = body["platforms"]["windows-x86_64"]
    assert win["url"] == f"https://real.example.com/api/releases/download/{WIN_NAME}"
    assert win["url"].startswith(("http://", "https://"))
    assert "evil.example.com" not in win["url"]


async def test_update_endpoint_url_uses_public_base_url_override(client, cache, monkeypatch):
    # PUBLIC_BASE_URL is the authoritative, non-spoofable override for
    # self-host/white-label deployments -- it must win outright and ignore
    # request headers entirely (even a forged Host/X-Forwarded-Host).
    monkeypatch.setattr("routers.releases.PUBLIC_BASE_URL", "https://pinned.example.com")
    _seed_full_release(cache)
    r = await client.get(
        "/releases/update/windows/x86_64/0.4.0",
        headers={
            "Host": "real.example.com",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "evil.example.com",
        },
    )
    assert r.status_code == 200
    body = r.json()
    win = body["platforms"]["windows-x86_64"]
    assert win["url"] == f"https://pinned.example.com/api/releases/download/{WIN_NAME}"


async def test_update_endpoint_returns_notes_and_pub_date_from_release_body(client, cache):
    # When the cache carries the GitHub release's body/published_at, the
    # endpoint must surface those verbatim instead of falling back.
    _seed_full_release(
        cache,
        body="## What's new\n- stuff",
        published_at="2026-07-01T00:00:00Z",
    )
    r = await client.get("/releases/update/windows/x86_64/0.4.0")
    assert r.status_code == 200
    body = r.json()
    assert body["notes"] == "## What's new\n- stuff"
    assert body["pub_date"] == "2026-07-01T00:00:00Z"


async def test_update_endpoint_204_when_no_release_cached(client, cache):
    r = await client.get("/releases/update/linux/x86_64/0.4.0")
    assert r.status_code == 204
    assert r.content == b""


async def test_update_endpoint_204_when_no_platform_assemblable(client, cache):
    # Manifest present and the bundle is on disk, but its .sig never got
    # cached -- updater_platforms() can't assemble a platform without one, so
    # there is nothing safe to serve.
    (cache / LINUX_NAME).write_bytes(b"LINUXBIN")
    _write_manifest(cache, [{"name": LINUX_NAME, "size": 8}])
    r = await client.get("/releases/update/linux/x86_64/0.4.0")
    assert r.status_code == 204
