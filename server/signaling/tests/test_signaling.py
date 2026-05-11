import pytest
from unittest.mock import AsyncMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from session import ConnectionState, register_agent, unregister_agent


@pytest.mark.asyncio
async def test_register_agent_stores_connection():
    state = ConnectionState()
    mock_ws = AsyncMock()
    mock_redis = AsyncMock()
    mock_redis.hset = AsyncMock()
    mock_redis.expire = AsyncMock()

    await register_agent(state, mock_redis, "123456789", "hashed_pw", mock_ws)

    assert state.agent_connections["123456789"] == mock_ws
    mock_redis.hset.assert_called_once()


@pytest.mark.asyncio
async def test_unregister_agent_removes_connection():
    state = ConnectionState()
    mock_ws = AsyncMock()
    state.agent_connections["123456789"] = mock_ws
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock()

    await unregister_agent(state, mock_redis, "123456789")

    assert "123456789" not in state.agent_connections
