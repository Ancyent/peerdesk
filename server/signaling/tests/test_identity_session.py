"""The resolved identity travels with the viewer session and is cleaned up.

A dict that only some teardown paths clear is a leak, so every path that ends a
viewer session is covered here.
"""
import sys, os
import pytest
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from session import (
    ConnectionState,
    handle_viewer_authenticated,
    handle_approval,
    unregister_agent,
    request_approval,
)

IDENTITY = {"id": "u-1", "name": "Maria Ionescu"}


@pytest.mark.asyncio
async def test_an_identified_viewer_is_remembered():
    state = ConnectionState()
    state.agent_connections["123456789"] = AsyncMock()

    viewer_id = await handle_viewer_authenticated(
        state, AsyncMock(), "123456789", AsyncMock(), "1.2.3.4", identity=IDENTITY
    )

    assert state.viewer_identity[viewer_id] == IDENTITY


@pytest.mark.asyncio
async def test_an_unidentified_viewer_stores_nothing():
    state = ConnectionState()
    state.agent_connections["123456789"] = AsyncMock()

    viewer_id = await handle_viewer_authenticated(
        state, AsyncMock(), "123456789", AsyncMock(), "1.2.3.4", identity=None
    )

    assert viewer_id not in state.viewer_identity, (
        "absence means unidentified; storing a placeholder would make callers "
        "guard against two different empty values"
    )


@pytest.mark.asyncio
async def test_a_denied_viewer_leaves_no_identity_behind():
    state = ConnectionState()
    state.viewer_pending["v-1"] = AsyncMock()
    state.viewer_identity["v-1"] = IDENTITY

    await handle_approval(state, "123456789", "v-1", False)

    assert "v-1" not in state.viewer_identity


@pytest.mark.asyncio
async def test_identity_is_dropped_when_the_agent_disconnects():
    state = ConnectionState()
    state.viewer_connections["v-1"] = AsyncMock()
    state.viewer_to_agent["v-1"] = "123456789"
    state.agent_to_viewer["123456789"] = "v-1"
    state.viewer_identity["v-1"] = IDENTITY
    redis = AsyncMock()
    redis.delete = AsyncMock()

    await unregister_agent(state, redis, "123456789")

    assert "v-1" not in state.viewer_identity


@pytest.mark.asyncio
async def test_the_immediate_self_deny_leaves_no_identity_behind():
    """`request_approval`'s own denial path (no agent connected, or a stale
    agent socket) is symmetric with `handle_approval`'s denial branch — both
    must drop the identity they never got to use.
    """
    state = ConnectionState()
    state.viewer_pending["v-1"] = AsyncMock()
    state.viewer_identity["v-1"] = IDENTITY
    viewer_ws = AsyncMock()

    # No agent registered for "123456789" — request_approval falls straight
    # through to the immediate self-deny branch.
    await request_approval(state, "123456789", "v-1", viewer_ws, "1.2.3.4")

    assert "v-1" not in state.viewer_identity


@pytest.mark.asyncio
async def test_a_displaced_viewer_leaves_no_identity_behind():
    state = ConnectionState()
    old_ws, new_ws = AsyncMock(), AsyncMock()
    state.viewer_connections["old"] = old_ws
    state.viewer_to_agent["old"] = "123456789"
    state.agent_to_viewer["123456789"] = "old"
    state.viewer_identity["old"] = IDENTITY
    state.viewer_pending["new"] = new_ws

    await handle_approval(state, "123456789", "new", True)

    assert "old" not in state.viewer_identity
