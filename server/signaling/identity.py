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

# httpx applies a bare float to connect/read/write/pool independently rather
# than as a total request budget, so a plain `timeout=3.0` can block a join for
# connect(3) + read(3) = 6 seconds worst case. Splitting the budget keeps the
# worst case (a slow connect followed by a slow read) at 3 seconds total: far
# above a healthy same-network response, far below a delay a user would read as
# a broken connection.
RESOLVE_TIMEOUT_SECONDS = httpx.Timeout(2.0, connect=1.0)


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
        async with httpx.AsyncClient(timeout=RESOLVE_TIMEOUT_SECONDS) as client:
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
