import datetime
import json
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Optional

import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from session import (
    ConnectionState,
    forward_to_peer,
    generate_nonce,
    handle_approval,
    handle_join,
    handle_viewer_authenticated,
    register_agent,
    unregister_agent,
    verify_challenge_response,
)

def audit_log(event: str, peer_id: str, viewer_ip: str, outcome: str, **extra):
    print(json.dumps({
        "event": event,
        "peer_id": peer_id,
        "viewer_ip": viewer_ip,
        "outcome": outcome,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        **extra,
    }), flush=True)


# Per-IP rate limiter: track WebSocket connection timestamps
_connection_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60.0   # seconds
_RATE_LIMIT_MAX = 10        # max new connections per window per IP


def _check_rate_limit(client_ip: str) -> bool:
    """Returns True if the connection is allowed, False if rate limited."""
    now = time.time()
    # Prune old entries outside window
    _connection_attempts[client_ip] = [
        t for t in _connection_attempts[client_ip]
        if now - t < _RATE_LIMIT_WINDOW
    ]
    if len(_connection_attempts[client_ip]) >= _RATE_LIMIT_MAX:
        return False
    _connection_attempts[client_ip].append(now)
    return True

state = ConnectionState()
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
    yield
    await redis_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    client_ip = ws.client.host if ws.client else "unknown"
    if not _check_rate_limit(client_ip):
        await ws.accept()
        await ws.close(code=1008, reason="rate limited")
        return
    await ws.accept()
    if redis_client is None:
        await ws.close(1011)
        return
    peer_id: Optional[str] = None
    viewer_id: Optional[str] = None

    try:
        async for raw in ws.iter_text():
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "code": "invalid_json"}))
                continue

            msg_type = data.get("type")

            try:
                if msg_type == "register":
                    req_peer_id = data["peer_id"]
                    ok = await register_agent(state, redis_client, req_peer_id, data["password_hash"], ws, data.get("hmac_key", ""))
                    if not ok:
                        await ws.send_text(json.dumps({"type": "error", "code": "peer_id_in_use"}))
                        continue
                    peer_id = req_peer_id
                    await ws.send_text(json.dumps({"type": "registered", "peer_id": peer_id}))

                elif msg_type == "request_challenge":
                    peer_id_req = data.get("peer_id", "")
                    agent_data = await redis_client.hgetall(f"agent:{peer_id_req}")
                    if not agent_data:
                        await ws.send_json({"type": "error", "code": "agent_not_found"})
                        continue
                    nonce = generate_nonce()
                    # One-time nonce, expires in 60s
                    await redis_client.setex(f"nonce:{peer_id_req}:{id(ws)}", 60, nonce)
                    await ws.send_json({"type": "challenge", "nonce": nonce})

                elif msg_type == "auth_response":
                    peer_id_req = data.get("peer_id", "")
                    response = data.get("response", "")
                    nonce_key = f"nonce:{peer_id_req}:{id(ws)}"
                    nonce = await redis_client.get(nonce_key)
                    if not nonce:
                        await ws.send_json({"type": "error", "code": "nonce_expired_or_not_issued"})
                        continue
                    await redis_client.delete(nonce_key)  # delete immediately — one-time use
                    nonce_str = nonce.decode() if isinstance(nonce, bytes) else nonce
                    agent_data = await redis_client.hgetall(f"agent:{peer_id_req}")
                    raw_key = agent_data.get(b"hmac_key") or agent_data.get("hmac_key", b"")
                    stored_key = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
                    viewer_ip = ws.client.host if ws.client else "unknown"
                    if not stored_key:
                        audit_log("connection_attempt", peer_id_req, viewer_ip, "hmac_not_configured", method="hmac")
                        await ws.send_json({"type": "error", "code": "hmac_not_configured"})
                    elif verify_challenge_response(nonce_str, response, stored_key):
                        audit_log("connection_attempt", peer_id_req, viewer_ip, "approved", method="hmac")
                        viewer_id = await handle_viewer_authenticated(state, redis_client, peer_id_req, ws, viewer_ip)
                    else:
                        audit_log("connection_attempt", peer_id_req, viewer_ip, "auth_failed", method="hmac")
                        await ws.send_json({"type": "error", "code": "auth_failed"})

                elif msg_type == "join":
                    viewer_ip = ws.client.host if ws.client else "unknown"
                    viewer_id = await handle_join(
                        state, redis_client, data["peer_id"], data["password"], ws, viewer_ip
                    )
                    if viewer_id:
                        audit_log("connection_attempt", data["peer_id"], viewer_ip, "approved")
                    else:
                        audit_log("connection_attempt", data.get("peer_id", ""), viewer_ip, "auth_failed")

                elif msg_type in ("offer", "answer", "ice_candidate"):
                    await forward_to_peer(state, peer_id, viewer_id, data)

                elif msg_type == "approve":
                    viewer_id_to_approve = data.get("viewer_id")
                    if peer_id and viewer_id_to_approve:
                        await handle_approval(state, peer_id, viewer_id_to_approve, True)

                elif msg_type == "deny":
                    viewer_id_to_deny = data.get("viewer_id")
                    if peer_id and viewer_id_to_deny:
                        await handle_approval(state, peer_id, viewer_id_to_deny, False)

            except KeyError as e:
                await ws.send_text(json.dumps({"type": "error", "code": f"missing_field:{e}"}))

    except WebSocketDisconnect:
        if peer_id:
            await unregister_agent(state, redis_client, peer_id)
        if viewer_id:
            agent_pid = state.viewer_to_agent.pop(viewer_id, None)
            if agent_pid:
                state.agent_to_viewer.pop(agent_pid, None)
            state.viewer_connections.pop(viewer_id, None)
            state.viewer_pending.pop(viewer_id, None)
