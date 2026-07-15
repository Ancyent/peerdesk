from fastapi import APIRouter, HTTPException
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
                "GitHub. Check RELEASE_REPO and outbound network, or copy the "
                "release assets into RELEASE_CACHE_DIR manually."
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
