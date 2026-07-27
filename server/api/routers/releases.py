import asyncio
import os
import secrets

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

import release_cache

router = APIRouter(prefix="/releases", tags=["releases"])

# Shared secret for POST /releases/refresh. Unset -> the endpoint does not
# exist. Left open, it would let anyone make this server hammer GitHub's API
# and re-download every release asset on demand.
REFRESH_TOKEN = os.getenv("RELEASE_REFRESH_TOKEN", "")

# One refresh at a time; a burst of calls must not multiply the outbound work.
_refresh_lock = asyncio.Lock()

# Public on purpose: install.sh fetches this before any session exists, and the
# binaries are public artefacts on GitHub anyway.

# Authoritative, non-spoofable override for the update manifest's base URL.
# Set this for self-host/white-label deployments (or anywhere the request's
# own Host header isn't the public one) to pin the URL fully.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")


@router.post("/refresh", status_code=202)
async def trigger_refresh(request: Request):
    """Pull the newest release now, instead of waiting for the hourly loop.

    CI calls this after publishing a tag so clients see the release in seconds
    rather than up to an hour later. The periodic loop stays as the fallback:
    this endpoint failing must never mean a release goes unnoticed.
    """
    if not REFRESH_TOKEN:
        # Not configured — behave as if the route were never registered rather
        # than advertising a disabled endpoint.
        raise HTTPException(status_code=404, detail="Not Found")

    supplied = request.headers.get("X-Refresh-Token", "")
    if not secrets.compare_digest(supplied, REFRESH_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid refresh token")

    if _refresh_lock.locked():
        return {"status": "already-running", "changed": False}

    async with _refresh_lock:
        changed = await release_cache.refresh()
    return {"status": "ok", "changed": changed}


@router.get("/latest")
async def latest():
    """The cached release, with every asset URL pointed back at this server."""
    m = release_cache.read_manifest()
    if not m:
        raise HTTPException(
            status_code=503,
            detail=(
                "No release cached yet — the server has not been able to reach "
                "GitHub. Check RELEASE_REPO and outbound network, or populate "
                "RELEASE_CACHE_DIR by hand with the assets AND a manifest.json "
                "(see RELEASE_REFRESH_SECONDS in .env.example for its shape)."
            ),
        )
    return {
        **m,
        "assets": [
            {**a, "browser_download_url": f"/api/releases/download/{a['name']}"}
            for a in m.get("assets", [])
        ],
    }


@router.get("/download/{name}")
async def download(name: str):
    p = release_cache.asset_path(name)
    if p is None:
        raise HTTPException(status_code=404, detail="Unknown release asset")
    return FileResponse(p, media_type="application/octet-stream", filename=name)


@router.get("/update/{target}/{arch}/{current_version}")
async def update_manifest(target: str, arch: str, current_version: str, request: Request):
    """Tauri updater manifest, built from the cached release.

    `{target}`/`{arch}`/`{current_version}` are accepted for Tauri's URL
    template but not filtered on: this static-manifest form always returns
    every assemblable platform and lets the client itself decide whether
    `current_version` is behind. 204 (not 404/503) whenever there is nothing
    safe to serve -- no manifest cached yet, or no platform has both its
    bundle and its `.sig` -- so an updater client sees "no update" rather
    than an error.

    tauri-plugin-updater deserializes each platform's `url` as a `url::Url`,
    which requires an ABSOLUTE url (a bare path fails with
    `RelativeUrlWithoutBase`), so it must be rebuilt from the request that
    actually arrived here. If `PUBLIC_BASE_URL` is set that wins outright
    (the authoritative override for self-host/white-label deployments).
    Otherwise the base is `X-Forwarded-Proto` (set by our nginx, trusted) +
    `Host` (what the client used to reach us). `X-Forwarded-Host` is
    intentionally NOT trusted here -- our nginx doesn't set it, so a client
    could forge it to point the manifest's download URL anywhere.
    """
    m = release_cache.read_manifest()
    if not m:
        return Response(status_code=204)

    def sig_reader(name: str):
        p = release_cache.asset_path(name)
        if p is None:
            return None
        try:
            return p.read_text(encoding="utf-8").strip()
        except OSError:
            return None

    if PUBLIC_BASE_URL:
        base = PUBLIC_BASE_URL
    else:
        # X-Forwarded-Proto is set by our nginx (trusted). Host is what the client used
        # to reach this server. X-Forwarded-Host is NOT set by our nginx, so a client
        # could forge it -- do not trust it. Set PUBLIC_BASE_URL to pin the URL fully.
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("host") or request.base_url.netloc
        base = f"{proto}://{host}".rstrip("/")

    platforms = release_cache.updater_platforms(m, sig_reader, base_url=base)
    if not platforms:
        return Response(status_code=204)

    version = (m.get("version") or m.get("tag_name") or "").lstrip("v")
    return {
        "version": version,
        "notes": m.get("body") or m.get("notes") or "",
        "pub_date": m.get("published_at") or m.get("pub_date") or m.get("fetched_at") or "",
        "platforms": platforms,
    }
