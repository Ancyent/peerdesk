"""Local mirror of the project's GitHub releases.

Clients (the Downloads page, install.sh) must never call api.github.com
themselves: it is capped at 60 requests/hour per source IP, so every client
behind one NAT shares that budget, and a machine with no route to GitHub could
never install an agent at all. The API fetches each release once and serves the
files from this cache.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

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


async def _download(client: httpx.AsyncClient, url: str, dest: Path) -> None:
    """Stream `url` to `dest` atomically: a partial transfer is never visible."""
    tmp = dest.with_name(dest.name + ".tmp")
    try:
        with tmp.open("wb") as fh:
            async with client.stream("GET", url, follow_redirects=True) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes():
                    fh.write(chunk)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def _prune(keep: set) -> None:
    for p in CACHE_DIR.iterdir():
        if p.name != MANIFEST_NAME and p.name not in keep:
            p.unlink(missing_ok=True)


def _prune_safely(keep: set) -> None:
    """Best-effort cleanup of stale assets. Never lets a refresh be reported
    as failed just because a straggler file could not be removed — by the
    time this runs, the new manifest is already durably committed."""
    try:
        _prune(keep)
    except Exception as e:
        log.warning("release cache prune failed (stale assets may remain): %s", e)


async def refresh() -> bool:
    """Pull the latest release into the cache. True when the cache changed.

    Never raises. A failure must leave the previous cache intact and serving —
    a stale agent binary is vastly better than a Downloads page that 503s
    because GitHub happened to be unreachable.
    """
    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    try:
        async with httpx.AsyncClient(timeout=60.0, headers=headers) as client:
            r = await client.get(
                f"https://api.github.com/repos/{RELEASE_REPO}/releases/latest"
            )
            r.raise_for_status()
            rel = r.json()

            current = read_manifest()
            if current and current.get("tag_name") == rel["tag_name"]:
                return False

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            assets = []
            for a in rel.get("assets", []):
                dest = CACHE_DIR / a["name"]
                # Skip re-downloading a file that is already on disk, so a retry of
                # the same tag after a partial failure resumes instead of redoing
                # completed work. This is only safe because every asset filename
                # embeds the release tag (CI names them e.g.
                # peerdesk-agent-linux-x86_64-${{ github.ref_name }}), so no two
                # releases can ever collide on a filename. An unversioned asset
                # name would let this skip serve stale bytes under a new tag.
                if not dest.is_file():
                    await _download(client, a["browser_download_url"], dest)
                assets.append({"name": a["name"], "size": a["size"]})

        # Manifest last: it must never advertise a file that is not on disk.
        manifest = {
            "tag_name": rel["tag_name"],
            "html_url": rel.get("html_url", ""),
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "assets": assets,
        }
        tmp = manifest_path().with_name(MANIFEST_NAME + ".tmp")
        try:
            tmp.write_text(json.dumps(manifest, indent=2))
            os.replace(tmp, manifest_path())
        finally:
            tmp.unlink(missing_ok=True)

        # The manifest is now durably committed -- the refresh has succeeded
        # regardless of what happens next. Pruning stale assets is cleanup,
        # not part of the commit, so its failure must not be reported as a
        # failed refresh (see _prune_safely).
        _prune_safely(keep={a["name"] for a in assets})
        log.info("release cache updated to %s (%d assets)", rel["tag_name"], len(assets))
        return True
    except Exception as e:
        log.warning("release refresh failed, serving cached copy: %s", e)
        return False


async def refresh_loop(interval: int = REFRESH_SECONDS) -> None:
    """Refresh now, then every `interval` seconds.

    `interval <= 0` disables fetching entirely (air-gap mode): the cache is
    served exactly as an operator populated it.
    """
    if interval <= 0:
        log.info("release refresh disabled — serving the cache as-is")
        return
    while True:
        await refresh()
        await asyncio.sleep(interval)
