import pytest
import json
from unittest.mock import AsyncMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from session import ConnectionState, register_agent, unregister_agent, handle_approval


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
    from main import _connection_attempts, _RATE_LIMIT_MAX
    _connection_attempts.clear()
    from main import _check_rate_limit
    for _ in range(_RATE_LIMIT_MAX):
        assert _check_rate_limit("10.0.0.1") is True  # up to the limit — allowed


def test_rate_limiter_blocks_over_limit():
    from main import _check_rate_limit, _connection_attempts, _RATE_LIMIT_MAX
    _connection_attempts.clear()
    ip = "10.0.0.2"
    for _ in range(_RATE_LIMIT_MAX):
        _check_rate_limit(ip)
    # the next attempt should be blocked
    assert _check_rate_limit(ip) is False


def test_rate_limiter_different_ips_independent():
    from main import _check_rate_limit, _connection_attempts, _RATE_LIMIT_MAX
    _connection_attempts.clear()
    # Fill up one IP
    for _ in range(_RATE_LIMIT_MAX):
        _check_rate_limit("10.0.0.3")
    _check_rate_limit("10.0.0.3")  # blocked
    # Different IP should still be allowed
    assert _check_rate_limit("10.0.0.4") is True


def _fake_redis():
    from unittest.mock import AsyncMock
    r = AsyncMock()
    r.hset = AsyncMock()
    r.expire = AsyncMock()
    r.delete = AsyncMock()
    r.hgetall = AsyncMock(return_value={})
    return r


def _ws_test_client(monkeypatch):
    """TestClient wired to a fake Redis and a fresh ConnectionState.

    The endpoint reads `redis_client`/`state` as module globals at call time, so
    patching the module attributes is enough; lifespan (which would dial a real
    Redis) never runs because we don't enter TestClient as a context manager.
    """
    import main
    from fastapi.testclient import TestClient
    from session import ConnectionState

    fake = _fake_redis()
    monkeypatch.setattr(main, "redis_client", fake)
    monkeypatch.setattr(main, "state", ConnectionState())
    main._connection_attempts.clear()
    return main, fake, TestClient(main.app)


def test_agent_disconnect_unregisters(monkeypatch):
    """A disconnecting agent must be evicted from state and Redis.

    Regression: starlette's `iter_text()` catches WebSocketDisconnect itself, so
    the endpoint's `except WebSocketDisconnect` block was unreachable and
    `unregister_agent` never ran. Every disconnect leaked a zombie socket that
    held the peer_id forever (blocking the real agent's re-register with
    peer_id_in_use) and left a stale password hash in Redis, so viewers were
    authenticated against the *old* password and saw "wrong password".
    """
    main, fake, client = _ws_test_client(monkeypatch)

    with client.websocket_connect("/ws") as ws:
        ws.send_json({
            "type": "register",
            "peer_id": "123456789",
            "password_hash": "hash-v1",
            "hmac_key": "key-v1",
        })
        assert ws.receive_json()["type"] == "registered"
        assert "123456789" in main.state.agent_connections

    assert "123456789" not in main.state.agent_connections, (
        "agent socket leaked after disconnect — it will hold the peer_id forever"
    )
    fake.delete.assert_awaited_with("agent:123456789")


def test_agent_can_reregister_after_password_change(monkeypatch):
    """The end-to-end scenario from the field.

    An agent registers, its password is reset (new hash), and it reconnects.
    With the disconnect leak, the stale socket + old hash made the server reject
    the reconnect as peer_id_in_use and keep authenticating viewers against the
    old password. After cleanup runs, the new hash must win.
    """
    main, fake, client = _ws_test_client(monkeypatch)

    with client.websocket_connect("/ws") as ws:
        ws.send_json({
            "type": "register",
            "peer_id": "933146422",
            "password_hash": "hash-old",
            "hmac_key": "key-old",
        })
        assert ws.receive_json()["type"] == "registered"

    # Agent restarts after `--reset-password` and announces fresh credentials.
    with client.websocket_connect("/ws") as ws:
        ws.send_json({
            "type": "register",
            "peer_id": "933146422",
            "password_hash": "hash-new",
            "hmac_key": "key-new",
        })
        reply = ws.receive_json()

    assert reply["type"] == "registered", f"re-register rejected: {reply}"
    stored = fake.hset.await_args.kwargs["mapping"]
    assert stored["password_hash"] == "hash-new"
    assert stored["hmac_key"] == "key-new"


def test_viewer_identity_is_dropped_when_the_viewer_socket_closes(monkeypatch):
    """End-to-end join -> approve -> close, exercising main.py's own cleanup.

    The unit tests in test_identity_session.py call handle_viewer_authenticated
    / handle_approval / unregister_agent directly and never touch main.py's
    websocket endpoint, so they cannot catch a missing
    `state.viewer_identity.pop(viewer_id, None)` in the `finally` block at the
    bottom of websocket_endpoint. This test goes through the real endpoint —
    an agent registers, a viewer joins with a token, the agent approves, and
    only then does the viewer socket close — to prove that line actually runs.
    """
    import bcrypt
    import session as session_module

    main, fake, client = _ws_test_client(monkeypatch)

    password = "s3cr3t-pw"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    fake.hgetall = AsyncMock(return_value={"password_hash": pw_hash})

    identity = {"id": "u-1", "name": "Maria Ionescu"}
    monkeypatch.setattr(session_module, "resolve_viewer", AsyncMock(return_value=identity))

    with client.websocket_connect("/ws") as agent_ws:
        agent_ws.send_json({
            "type": "register",
            "peer_id": "123456789",
            "password_hash": pw_hash,
            "hmac_key": "key-v1",
        })
        assert agent_ws.receive_json()["type"] == "registered"

        with client.websocket_connect("/ws") as viewer_ws:
            viewer_ws.send_json({
                "type": "join",
                "peer_id": "123456789",
                "password": password,
                "token": "tok-1",
            })
            pending = agent_ws.receive_json()
            assert pending["type"] == "viewer_pending"
            viewer_id = pending["viewer_id"]
            assert main.state.viewer_identity[viewer_id] == identity

            agent_ws.send_json({"type": "approve", "viewer_id": viewer_id})
            assert viewer_ws.receive_json()["type"] == "joined"

        # viewer_ws is now closed — main.py's `finally` block has run.
        assert viewer_id not in main.state.viewer_identity, (
            "the viewer socket closed but its identity entry survived — "
            "this is the leak the whole feature must not create"
        )


@pytest.mark.asyncio
async def test_a_second_viewer_displaces_the_first_with_a_reason():
    state = ConnectionState()
    old_ws, new_ws = AsyncMock(), AsyncMock()
    state.viewer_connections["old"] = old_ws
    state.viewer_to_agent["old"] = "123456789"
    state.agent_to_viewer["123456789"] = "old"
    state.viewer_pending["new"] = new_ws

    await handle_approval(state, "123456789", "new", True)

    sent = [json.loads(c.args[0])["type"] for c in old_ws.send_text.call_args_list]
    assert "session_taken_over" in sent, "the old viewer must be told, not left to guess"
    assert state.agent_to_viewer["123456789"] == "new"
    assert "old" not in state.viewer_connections
    assert "old" not in state.viewer_to_agent


@pytest.mark.asyncio
async def test_nobody_is_notified_when_no_one_is_displaced():
    state = ConnectionState()
    viewer_ws = AsyncMock()
    state.viewer_pending["only"] = viewer_ws

    await handle_approval(state, "123456789", "only", True)

    sent = [json.loads(c.args[0])["type"] for c in viewer_ws.send_text.call_args_list]
    assert "session_taken_over" not in sent
    assert sent == ["joined"]


@pytest.mark.asyncio
async def test_a_dead_displaced_socket_does_not_block_the_new_viewer():
    state = ConnectionState()
    old_ws, new_ws = AsyncMock(), AsyncMock()
    old_ws.send_text.side_effect = RuntimeError("socket closed")
    state.viewer_connections["old"] = old_ws
    state.viewer_to_agent["old"] = "123456789"
    state.agent_to_viewer["123456789"] = "old"
    state.viewer_pending["new"] = new_ws

    await handle_approval(state, "123456789", "new", True)

    assert old_ws.send_text.await_count == 1, "the dead socket must actually be notified, not skipped"
    assert state.agent_to_viewer["123456789"] == "new"
    sent = [json.loads(c.args[0])["type"] for c in new_ws.send_text.call_args_list]
    assert "joined" in sent


@pytest.mark.asyncio
async def test_reapproving_the_same_viewer_does_not_displace_it():
    state = ConnectionState()
    viewer_ws = AsyncMock()
    state.viewer_connections["same"] = viewer_ws
    state.viewer_to_agent["same"] = "123456789"
    state.agent_to_viewer["123456789"] = "same"
    state.viewer_pending["same"] = viewer_ws

    await handle_approval(state, "123456789", "same", True)

    sent = [json.loads(c.args[0])["type"] for c in viewer_ws.send_text.call_args_list]
    assert "session_taken_over" not in sent
    assert state.agent_to_viewer["123456789"] == "same"
