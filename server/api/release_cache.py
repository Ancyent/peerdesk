"""Local mirror of the project's GitHub releases.

Clients (the Downloads page, install.sh) must never call api.github.com
themselves: it is capped at 60 requests/hour per source IP, so every client
behind one NAT shares that budget, and a machine with no route to GitHub could
never install an agent at all. The API fetches each release once and serves the
files from this cache.
"""
import json
import logging
import os
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

CACHE_DIR = Path(os.getenv("RELEASE_CACHE_DIR", "/var/lib/peerdesk/releases"))
RELEASE_REPO = os.getenv("RELEASE_REPO", "Ancyent/peerdesk")
REFRESH_SECONDS = int(os.getenv("RELEASE_REFRESH_SECONDS", "3600"))
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

MANIFEST_NAME = "manifest.json"


def manifest_path() -> Path:
    return CACHE_DIR / MANIFEST_NAME


def read_manifest() -> Optional[dict]:
    """The cached manifest, or None when nothing is cached or it is unreadable."""
    try:
        return json.loads(manifest_path().read_text())
    except (FileNotFoundError, NotADirectoryError, json.JSONDecodeError):
        return None


def asset_path(name: str) -> Optional[Path]:
    """Resolve a cached asset by name, or None if it is not available.

    The name is matched against the manifest and the resolved path is confirmed
    to sit directly in CACHE_DIR, so a crafted name cannot escape the cache.
    """
    m = read_manifest()
    if not m:
        return None
    if name not in {a["name"] for a in m.get("assets", [])}:
        return None
    p = (CACHE_DIR / name).resolve()
    if p.parent != CACHE_DIR.resolve():
        return None
    return p if p.is_file() else None
