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
                    peer_id = data["peer_id"]
                    await register_agent(state, redis_client, peer_id, data["password_hash"], ws)
                    await ws.send_text(json.dumps({"type": "registered", "peer_id": peer_id}))

                elif msg_type == "join":
                    viewer_id = await handle_join(
                        state, redis_client, data["peer_id"], data["password"], ws
                    )

                elif msg_type in ("offer", "answer", "ice_candidate"):
                    await forward_to_peer(state, peer_id, viewer_id, data)

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
