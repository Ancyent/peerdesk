import hashlib
import hmac as hmac_lib
import secrets
import uuid
import json
from dataclasses import dataclass, field
from typing import Dict, Optional
from fastapi import WebSocket
import redis.asyncio as aioredis
import bcrypt

from identity import resolve_viewer


def compute_hmac_key(password: str) -> str:
    return hmac_lib.new(b"peerdesk-v1", password.encode(), hashlib.sha256).hexdigest()


def generate_nonce() -> str:
    return secrets.token_hex(16)


def verify_challenge_response(nonce: str, response: str, stored_hmac_key: str) -> bool:
    expected = hmac_lib.new(
        stored_hmac_key.encode(), nonce.encode(), hashlib.sha256
    ).hexdigest()
    return hmac_lib.compare_digest(expected, response)


@dataclass
class ConnectionState:
    # peer_id → WebSocket for registered agents
    agent_connections: Dict[str, WebSocket] = field(default_factory=dict)
    # viewer_session_id → WebSocket for active viewers
    viewer_connections: Dict[str, WebSocket] = field(default_factory=dict)
    # viewer_session_id → peer_id
    viewer_to_agent: Dict[str, str] = field(default_factory=dict)
    # peer_id → viewer_session_id
    agent_to_viewer: Dict[str, str] = field(default_factory=dict)
    # viewer_session_id → WebSocket for viewers awaiting approval
    viewer_pending: Dict[str, WebSocket] = field(default_factory=dict)
    # viewer_session_id → {"id": ..., "name": ...}; absent when unidentified
    viewer_identity: Dict[str, dict] = field(default_factory=dict)


async def register_agent(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
    password_hash: str,
    ws: WebSocket,
    hmac_key: str = "",
) -> bool:
    """Register an agent for peer_id.

    Returns True on success. If a live agent connection already exists for this
    peer_id, the new registration is only accepted when its credentials match the
    stored ones (i.e. the same legitimate agent reconnecting); otherwise the
    registration is rejected (returns False) and existing state is left untouched.
    """
    existing_ws = state.agent_connections.get(peer_id)
    if existing_ws is not None and existing_ws is not ws:
        stored = await redis.hgetall(f"agent:{peer_id}")

        def _field(name: str) -> str:
            raw = stored.get(name.encode()) or stored.get(name)
            if raw is None:
                return ""
            return raw.decode() if isinstance(raw, bytes) else raw

        stored_hmac = _field("hmac_key")
        stored_pw = _field("password_hash")
        # Allow the same legitimate agent to reconnect (matching persistent
        # credentials). Prefer the hmac_key; fall back to password_hash.
        matches = (
            (bool(hmac_key) and hmac_lib.compare_digest(hmac_key, stored_hmac))
            or (bool(password_hash) and hmac_lib.compare_digest(password_hash, stored_pw))
        )
        # If the stored record is gone (Redis key expired) we can't verify
        # ownership; a lingering dead in-memory socket must not block the real
        # agent forever, so allow the replacement in that case.
        no_stored = not stored_hmac and not stored_pw
        if not matches and not no_stored:
            return False
        # Same agent reconnecting (or replacing a stale socket) — close the old.
        try:
            await existing_ws.close(code=1012, reason="reconnected")
        except Exception:
            pass

    state.agent_connections[peer_id] = ws
    await redis.hset(f"agent:{peer_id}", mapping={
        "password_hash": password_hash,
        "hmac_key": hmac_key,
    })
    # Long TTL refreshed on every (re)register; the record is deleted on
    # disconnect. A short TTL used to expire mid-session and break viewer auth.
    await redis.expire(f"agent:{peer_id}", 86400)
    return True


async def unregister_agent(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
) -> None:
    state.agent_connections.pop(peer_id, None)
    viewer_id = state.agent_to_viewer.pop(peer_id, None)
    if viewer_id:
        viewer_ws = state.viewer_connections.get(viewer_id)
        if viewer_ws:
            try:
                await viewer_ws.send_text(json.dumps({"type": "agent_disconnected"}))
            except Exception:
                pass
        state.viewer_to_agent.pop(viewer_id, None)
        state.viewer_connections.pop(viewer_id, None)
        state.viewer_identity.pop(viewer_id, None)
    await redis.delete(f"agent:{peer_id}")


async def handle_viewer_authenticated(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
    viewer_ws: WebSocket,
    remote_ip: str = "unknown",
    identity: Optional[dict] = None,
) -> str:
    """Create viewer session and queue for agent approval. Returns viewer_session_id."""
    viewer_id = str(uuid.uuid4())
    if identity:
        state.viewer_identity[viewer_id] = identity
    # Don't register yet — wait for agent approval
    await request_approval(state, peer_id, viewer_id, viewer_ws, remote_ip)
    return viewer_id


async def handle_join(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
    password: str,
    viewer_ws: WebSocket,
    remote_ip: str = "unknown",
    token: Optional[str] = None,
) -> Optional[str]:
    """Returns viewer_session_id on success, None on failure."""
    agent_data = await redis.hgetall(f"agent:{peer_id}")
    if not agent_data:
        await viewer_ws.send_text(json.dumps({"type": "error", "code": "not_found"}))
        return None

    raw = agent_data.get(b"password_hash") or agent_data.get("password_hash")
    if not raw:
        await viewer_ws.send_text(json.dumps({"type": "error", "code": "not_found"}))
        return None
    stored_hash = raw.decode() if isinstance(raw, bytes) else raw
    if not bcrypt.checkpw(password.encode(), stored_hash.encode()):
        await viewer_ws.send_text(json.dumps({"type": "error", "code": "unauthorized"}))
        return None

    identity = await resolve_viewer(token)
    return await handle_viewer_authenticated(
        state, redis, peer_id, viewer_ws, remote_ip, identity=identity
    )


async def request_approval(
    state: ConnectionState,
    peer_id: str,
    viewer_id: str,
    viewer_ws: WebSocket,
    remote_ip: str,
) -> None:
    """Store pending viewer and notify agent to approve/deny."""
    state.viewer_pending[viewer_id] = viewer_ws
    agent_ws = state.agent_connections.get(peer_id)
    if agent_ws:
        try:
            await agent_ws.send_text(json.dumps({
                "type": "viewer_pending",
                "viewer_id": viewer_id,
                "remote_ip": remote_ip,
            }))
            return
        except Exception:
            # The stored agent socket is dead — e.g. the agent dropped or
            # restarted (a client upgrade) and its disconnect wasn't processed
            # yet. Sending used to raise an unhandled RuntimeError that killed
            # the viewer's handler, so the approval never reached the host and
            # the viewer hung at "connecting". Drop the stale socket so a
            # reconnect can re-register cleanly, then fall through to deny.
            if state.agent_connections.get(peer_id) is agent_ws:
                state.agent_connections.pop(peer_id, None)
    # Agent disconnected (or its socket was dead) — deny immediately
    await viewer_ws.send_text(json.dumps({
        "type": "denied",
        "reason": "Host not connected",
    }))
    state.viewer_pending.pop(viewer_id, None)


async def handle_approval(
    state: ConnectionState,
    peer_id: str,
    viewer_id: str,
    approved: bool,
) -> None:
    """Complete or reject the pending connection."""
    viewer_ws = state.viewer_pending.pop(viewer_id, None)
    if not viewer_ws:
        return
    if approved:
        # The agent closes its previous PeerConnection on every offer
        # (agent/src/lib.rs), so admitting a second viewer ends the first one's
        # session. Say so: otherwise the old window shows the generic
        # "remote disconnected" error and reads like a fault.
        displaced_id = state.agent_to_viewer.get(peer_id)
        if displaced_id and displaced_id != viewer_id:
            displaced_ws = state.viewer_connections.pop(displaced_id, None)
            state.viewer_to_agent.pop(displaced_id, None)
            state.viewer_identity.pop(displaced_id, None)
            if displaced_ws:
                try:
                    await displaced_ws.send_text(json.dumps({"type": "session_taken_over"}))
                except Exception:
                    # A displaced socket that is already dead must not stop the
                    # new viewer from joining.
                    pass
        state.viewer_connections[viewer_id] = viewer_ws
        state.viewer_to_agent[viewer_id] = peer_id
        state.agent_to_viewer[peer_id] = viewer_id
        # The viewer may have disconnected while awaiting approval; a failed send
        # must not propagate and kill the agent's connection coroutine.
        try:
            await viewer_ws.send_text(json.dumps({
                "type": "joined",
                "viewer_id": viewer_id,
            }))
        except Exception:
            pass
        # Tell the agent the viewer joined so it publishes its monitor list
        # (the agent only sends `display_list` in response to `viewer_joined`).
        agent_ws = state.agent_connections.get(peer_id)
        if agent_ws:
            try:
                await agent_ws.send_text(json.dumps({
                    "type": "viewer_joined",
                    "viewer_id": viewer_id,
                }))
            except Exception:
                pass
    else:
        try:
            await viewer_ws.send_text(json.dumps({
                "type": "denied",
                "reason": "Host denied the connection",
            }))
        except Exception:
            pass
        state.viewer_identity.pop(viewer_id, None)


async def forward_to_peer(
    state: ConnectionState,
    sender_peer_id: Optional[str],
    sender_viewer_id: Optional[str],
    data: dict,
) -> None:
    """Forward SDP offer/answer/ICE between agent and viewer."""
    if sender_peer_id is not None:
        viewer_id = state.agent_to_viewer.get(sender_peer_id)
        ws = state.viewer_connections.get(viewer_id) if viewer_id else None
    else:
        agent_peer_id = state.viewer_to_agent.get(sender_viewer_id)
        ws = state.agent_connections.get(agent_peer_id) if agent_peer_id else None

    if ws:
        await ws.send_text(json.dumps(data))
