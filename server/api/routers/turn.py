import hashlib
import hmac
import base64
import os
import time
from fastapi import APIRouter, Depends
from deps import get_current_user
from models import User

router = APIRouter(prefix="/turn", tags=["turn"])

TURN_SECRET = os.getenv("TURN_SECRET", "dev-turn-secret")
TURN_HOST = os.getenv("TURN_HOST", "localhost")
TURN_PORT = int(os.getenv("TURN_PORT", "3478"))
TURN_TTL = 3600  # credentials valid 1 hour


@router.get("/credentials")
async def get_turn_credentials(current_user: User = Depends(get_current_user)):
    """
    RFC 5766 time-limited TURN credentials.
    username = "<expiry_timestamp>:<user_id>"
    password = base64(HMAC-SHA1(secret, username))
    """
    expiry = int(time.time()) + TURN_TTL
    username = f"{expiry}:{current_user.id}"

    h = hmac.new(
        TURN_SECRET.encode("utf-8"),
        username.encode("utf-8"),
        hashlib.sha1,
    )
    credential = base64.b64encode(h.digest()).decode("utf-8")

    return {
        "urls": [
            f"turn:{TURN_HOST}:{TURN_PORT}?transport=udp",
            f"turn:{TURN_HOST}:{TURN_PORT}?transport=tcp",
            f"stun:{TURN_HOST}:{TURN_PORT}",
        ],
        "username": username,
        "credential": credential,
        "ttl": TURN_TTL,
    }
