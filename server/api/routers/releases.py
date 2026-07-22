from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

import release_cache

router = APIRouter(prefix="/releases", tags=["releases"])

# Public on purpose: install.sh fetches this before any session exists, and the
# binaries are public artefacts on GitHub anyway.


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
    actually arrived here -- honoring `X-Forwarded-Proto`/`X-Forwarded-Host`
    since this endpoint sits behind nginx -- rather than a hardcoded/config
    host, keeping self-host and white-label deployments correct.
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

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.base_url.netloc
    )
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
