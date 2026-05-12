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
    mock_redis.delete.assert_called_once_with("agent:123456789")


@pytest.mark.asyncio
async def test_unregister_agent_cleans_up_viewer():
    from unittest.mock import AsyncMock
    state = ConnectionState()
    state.agent_connections["123456789"] = AsyncMock()
    state.agent_to_viewer["123456789"] = "viewer-abc"
    state.viewer_to_agent["viewer-abc"] = "123456789"
    state.viewer_connections["viewer-abc"] = AsyncMock()
    mock_redis = AsyncMock()

    await unregister_agent(state, mock_redis, "123456789")

    assert "viewer-abc" not in state.viewer_connections
    assert "viewer-abc" not in state.viewer_to_agent
    assert "123456789" not in state.agent_to_viewer


def test_health_endpoint():
    from main import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_rate_limiter_allows_under_limit():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    # Reset state for clean test
    from main import _connection_attempts
    _connection_attempts.clear()
    from main import _check_rate_limit
    for _ in range(9):
        assert _check_rate_limit("10.0.0.1") is True
    # 9 attempts allowed
    assert _check_rate_limit("10.0.0.1") is True  # 10th — still allowed


def test_rate_limiter_blocks_over_limit():
    from main import _check_rate_limit, _connection_attempts
    _connection_attempts.clear()
    ip = "10.0.0.2"
    for _ in range(10):
        _check_rate_limit(ip)
    # 11th attempt should be blocked
    assert _check_rate_limit(ip) is False


def test_rate_limiter_different_ips_independent():
    from main import _check_rate_limit, _connection_attempts
    _connection_attempts.clear()
    # Fill up one IP
    for _ in range(10):
        _check_rate_limit("10.0.0.3")
    _check_rate_limit("10.0.0.3")  # blocked
    # Different IP should still be allowed
    assert _check_rate_limit("10.0.0.4") is True
