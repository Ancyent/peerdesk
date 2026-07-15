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
