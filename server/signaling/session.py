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

    stored_hash = agent_data[b"password_hash"].decode()
    if not bcrypt.checkpw(password.encode(), stored_hash.encode()):
        await viewer_ws.send_text(json.dumps({"type": "error", "code": "unauthorized"}))
        return None

    viewer_id = str(uuid.uuid4())
    state.viewer_connections[viewer_id] = viewer_ws
    state.viewer_to_agent[viewer_id] = peer_id
    state.agent_to_viewer[peer_id] = viewer_id

    agent_ws = state.agent_connections.get(peer_id)
    if agent_ws:
        await agent_ws.send_text(json.dumps({"type": "viewer_joined", "viewer_id": viewer_id}))

    await viewer_ws.send_text(json.dumps({"type": "joined", "viewer_id": viewer_id}))
    return viewer_id


async def forward_to_peer(
    state: ConnectionState,
    sender_peer_id: Optional[str],
    sender_viewer_id: Optional[str],
    data: dict,
) -> None:
    """Forward SDP offer/answer/ICE between agent and viewer."""
    if sender_peer_id:
        viewer_id = state.agent_to_viewer.get(sender_peer_id)
        ws = state.viewer_connections.get(viewer_id) if viewer_id else None
    else:
        agent_peer_id = state.viewer_to_agent.get(sender_viewer_id)
        ws = state.agent_connections.get(agent_peer_id) if agent_peer_id else None

    if ws:
        await ws.send_text(json.dumps(data))
