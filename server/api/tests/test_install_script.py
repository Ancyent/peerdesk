"""The installer must pick its binary from OUR manifest, not the GitHub API."""
import json
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = [REPO / "web/public/install.sh", REPO / "scripts/deploy/install.sh"]

MANIFEST = json.dumps({
    "tag_name": "v0.4.32",
    "assets": [
        {"name": "peerdesk-agent-linux-x86_64-v0.4.32"},
        {"name": "peerdesk-agent-linux-x86_64-headless-v0.4.32"},
    ],
})

# A decoy asset name that merely *contains* the substring "headless" but is
# not the headless agent binary — e.g. a viewer/CLI package. Listed BEFORE
# the real headless agent asset, so an unanchored `grep -o '*headless*'`
# glob would pick it first.
DECOY_MANIFEST = json.dumps({
    "tag_name": "v0.4.32",
    "assets": [
        {"name": "peerdesk-viewer-linux-headless-cli-v0.4.32"},
        {"name": "peerdesk-agent-linux-x86_64-headless-v0.4.32"},
        {"name": "peerdesk-agent-linux-x86_64-v0.4.32"},
    ],
})


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.parent.name)
def test_script_never_calls_the_github_api(script):
    assert "api.github.com" not in script.read_text(), (
        "install.sh must resolve assets from the PeerDesk server: the GitHub API "
        "allows 60 req/hour per IP and is unreachable from isolated machines"
    )


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.parent.name)
@pytest.mark.parametrize("headless,expected", [
    (1, "peerdesk-agent-linux-x86_64-headless-v0.4.32"),
    (0, "peerdesk-agent-linux-x86_64-v0.4.32"),
])
def test_picks_the_right_asset_for_the_mode(script, headless, expected, tmp_path):
    """Run the script's resolver with a stubbed curl and check its choice."""
    stub = tmp_path / "curl"
    stub.write_text(f"#!/bin/sh\ncat <<'JSON'\n{MANIFEST}\nJSON\n")
    stub.chmod(0o755)

    body = script.read_text()
    start = body.index("resolve_download_url()")
    end = body.index("\n}\n", start) + 3
    resolver = body[start:end]

    prog = f"""
PATH="{tmp_path}:$PATH"
SERVER="http://server.test"
HEADLESS={headless}
{resolver}
resolve_download_url
echo "$DOWNLOAD_URL"
"""
    out = subprocess.run(["bash", "-c", prog], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == f"http://server.test/api/releases/download/{expected}"


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.parent.name)
def test_headless_glob_ignores_decoy_asset(script, tmp_path):
    """The headless resolver must be anchored to the agent's name shape, just
    like the GUI resolver already is. An unanchored `*headless*` substring
    match would happily select a non-agent asset (e.g. a viewer package)
    that happens to contain "headless" in its name and is listed first."""
    stub = tmp_path / "curl"
    stub.write_text(f"#!/bin/sh\ncat <<'JSON'\n{DECOY_MANIFEST}\nJSON\n")
    stub.chmod(0o755)

    body = script.read_text()
    start = body.index("resolve_download_url()")
    end = body.index("\n}\n", start) + 3
    resolver = body[start:end]

    prog = f"""
PATH="{tmp_path}:$PATH"
SERVER="http://server.test"
HEADLESS=1
{resolver}
resolve_download_url
echo "$DOWNLOAD_URL"
"""
    out = subprocess.run(["bash", "-c", prog], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == (
        "http://server.test/api/releases/download/"
        "peerdesk-agent-linux-x86_64-headless-v0.4.32"
    ), out.stdout


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda p: p.parent.name)
def test_fails_fast_when_server_is_empty(script, tmp_path):
    """The download URL is now built from SERVER, so a missing --server must be
    a clear, immediate error — not a curl failure against 'http:///...'."""
    body = script.read_text()
    start = body.index("resolve_download_url()")
    end = body.index("\n}\n", start) + 3
    resolver = body[start:end]

    prog = f"""
SERVER=""
HEADLESS=0
{resolver}
resolve_download_url
echo "$DOWNLOAD_URL"
"""
    out = subprocess.run(["bash", "-c", prog], capture_output=True, text=True)
    assert out.returncode != 0
    assert "--server" in out.stderr
    assert out.stdout.strip() == "", "must exit before ever calling curl"
