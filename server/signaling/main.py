import json
import os
from contextlib import asynccontextmanager
from typing import Optional

import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from session import (
    ConnectionState,
    forward_to_peer,
    handle_join,
    register_agent,
    unregister_agent,
)

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
    await ws.accept()
    peer_id: Optional[str] = None
    viewer_id: Optional[str] = None

    try:
        async for raw in ws.iter_text():
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "register":
                peer_id = data["peer_id"]
                await register_agent(state, redis_client, peer_id, data["password_hash"], ws)
                await ws.send_text(json.dumps({"type": "registered", "peer_id": peer_id}))

            elif msg_type == "join":
                viewer_id = await handle_join(
                    state, redis_client, data["peer_id"], data["password"], ws
                )

            elif msg_type in ("offer", "answer", "ice_candidate"):
                await forward_to_peer(state, peer_id, viewer_id, data)

    except WebSocketDisconnect:
        if peer_id:
            await unregister_agent(state, redis_client, peer_id)
        if viewer_id:
            state.viewer_connections.pop(viewer_id, None)
            state.viewer_to_agent.pop(viewer_id, None)
            agent_pid = next(
                (k for k, v in state.agent_to_viewer.items() if v == viewer_id), None
            )
            if agent_pid:
                state.agent_to_viewer.pop(agent_pid, None)
