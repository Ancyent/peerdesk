"""Write the manifest that makes a local build indistinguishable from a mirror.

server/api/release_cache.py serves whatever is in the cache directory, and the
Downloads page, install.sh and the desktop updater all read through it. So the
contract a local build has to satisfy is this file's shape - six required keys
plus an entry per artifact, and optionally a linux_package key when the build
recorded one. Get it right and nothing downstream changes at all.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MANIFEST_NAME = "manifest.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_manifest(cache_dir: Path, version: str, notes: str = "",
                    linux_package: str | None = None) -> dict:
    cache_dir = Path(cache_dir)

    assets = sorted(
        (
            {"name": p.name, "size": p.stat().st_size}
            for p in cache_dir.iterdir()
            if p.is_file() and p.name != MANIFEST_NAME
        ),
        key=lambda a: a["name"],
    )
    if not assets:
        raise ValueError(f"no artifacts found in {cache_dir}")

    stamp = _now()
    manifest = {
        "tag_name": version,
        # Locally built releases have no release page to link to. The key stays
        # because the six-key shape is the contract release_cache and the
        # Downloads page read; the page treats an empty value as absent and
        # falls back to its configured releases URL.
        "html_url": "",
        "body": notes,
        "published_at": stamp,
        "fetched_at": stamp,
        "assets": assets,
    }

    if linux_package:
        # Read out of the built .deb rather than derived here: Tauri's
        # sanitisation rule is its own, and a reimplementation would drift.
        manifest["linux_package"] = linux_package

    (cache_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: write_manifest.py <cache_dir> <version> [notes] [linux_package]")
    written = write_manifest(
        Path(sys.argv[1]),
        sys.argv[2],
        sys.argv[3] if len(sys.argv) > 3 else "",
        sys.argv[4] if len(sys.argv) > 4 else None,
    )
    print(f"wrote {len(written['assets'])} assets for {written['tag_name']}")
