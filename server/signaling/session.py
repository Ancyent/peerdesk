import uuid
import json
from dataclasses import dataclass, field
from typing import Dict, Optional
from fastapi import WebSocket
import redis.asyncio as aioredis
import bcrypt


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


async def register_agent(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
    password_hash: str,
    ws: WebSocket,
) -> None:
    state.agent_connections[peer_id] = ws
    await redis.hset(f"agent:{peer_id}", mapping={"password_hash": password_hash})
    await redis.expire(f"agent:{peer_id}", 3600)


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
    await redis.delete(f"agent:{peer_id}")


async def handle_join(
    state: ConnectionState,
    redis: aioredis.Redis,
    peer_id: str,
    password: str,
    viewer_ws: WebSocket,
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

    viewer_id = str(uuid.uuid4())
    # Don't register yet — wait for agent approval
    await request_approval(state, peer_id, viewer_id, viewer_ws, "unknown")
    return viewer_id


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
        await agent_ws.send_text(json.dumps({
            "type": "viewer_pending",
            "viewer_id": viewer_id,
            "remote_ip": remote_ip,
        }))
    else:
        # Agent disconnected — deny immediately
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
        state.viewer_connections[viewer_id] = viewer_ws
        state.viewer_to_agent[viewer_id] = peer_id
        state.agent_to_viewer[peer_id] = viewer_id
        await viewer_ws.send_text(json.dumps({
            "type": "joined",
            "viewer_id": viewer_id,
        }))
    else:
        await viewer_ws.send_text(json.dumps({
            "type": "denied",
            "reason": "Host denied the connection",
        }))


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
