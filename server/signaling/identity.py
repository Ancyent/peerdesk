"""Resolving a viewer's access token to the user behind it.

The signaling server deliberately does NOT hold the JWT signing secret. It asks
the API instead, so compromising this service cannot forge tokens for any
account. `httpx` is already a dependency, and a join is rare enough that one
HTTP call costs nothing — this is not on the media path.
"""
import os
from typing import Optional, TypedDict

import httpx

API_URL = os.environ.get("API_URL", "http://api:8000")

# httpx times connect, write, read, and pool as four SEPARATE, sequential
# phases rather than one total budget — a bare float (or leaving any phase at
# its default) multiplies instead of capping, since each phase gets the full
# allowance on its own. To actually deliver the spec's 3-second bound, every
# phase must be budgeted explicitly and the four numbers must SUM to at most
# 3.0: connect 1.0 + read 1.0 + write 0.5 + pool 0.5 = 3.0. `GET /users/me` on
# the internal Docker network answers in well under 100ms, so 1s of read is
# generous; the request body is empty, so 0.5s of write is ample; and pool
# acquisition is effectively free (a fresh AsyncClient per call, no
# contention) but is still budgeted so the arithmetic stays complete rather
# than relying on that staying true.
RESOLVE_TIMEOUT = httpx.Timeout(connect=1.0, read=1.0, write=0.5, pool=0.5)


class ViewerIdentity(TypedDict):
    id: str
    name: str


async def resolve_viewer(token: Optional[str]) -> Optional[ViewerIdentity]:
    """The user behind an access token, or None when it cannot be established.

    None is never an error. A client predating this feature sends no token; a
    stale token is not an attack; an API blip must not stop a connection. The
    machine password remains the gate, so callers treat None as "unidentified"
    and carry on.
    """
    if not token:
        return None

    try:
        async with httpx.AsyncClient(timeout=RESOLVE_TIMEOUT) as client:
            response = await client.get(
                f"{API_URL}/users/me",
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code != 200:
            return None
        body = response.json()
        return {"id": body["id"], "name": body["name"]}
    except Exception:
        # Network error, timeout, malformed body — all mean the same thing here.
        return None
