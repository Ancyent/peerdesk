# Map the two shipped updater bundles (Windows NSIS .exe, Linux .AppImage) + their .sig.
# Bundle name patterns confirmed against .github/workflows/build-clients.yml:
#   peerdesk-viewer-windows-{VERSION}-x64-setup.exe  (NSIS installer)
#   peerdesk-viewer-windows-{VERSION}-x64.msi        (MSI installer)
#   peerdesk-viewer-linux-{VERSION}.AppImage
# (.deb / .rpm are also produced but are not Tauri updater targets.)
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
