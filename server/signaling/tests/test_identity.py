"""Resolving a viewer's access token to a user.

Every failure resolves to None rather than raising: an unidentified viewer is a
supported state, and a connection must never fail because identity could not be
established.
"""
import sys, os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import httpx
import identity


def _client_yielding(response=None, error=None):
    """Stands in for httpx.AsyncClient, which is used as an async context manager."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=response, side_effect=error)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx, client


def _response(status_code, body=None):
    r = MagicMock()
    r.status_code = status_code
    r.json = MagicMock(return_value=body if body is not None else {})
    return r


@pytest.mark.asyncio
async def test_a_valid_token_resolves_to_the_user():
    ctx, client = _client_yielding(
        _response(200, {"id": "u-1", "name": "Maria Ionescu", "email": "m@example.com"})
    )

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("tok-abc")

    assert result == {"id": "u-1", "name": "Maria Ionescu"}
    client.get.assert_awaited_once()
    _, kwargs = client.get.await_args
    assert kwargs["headers"]["Authorization"] == "Bearer tok-abc"


@pytest.mark.asyncio
async def test_no_token_resolves_to_none_without_calling_the_api():
    ctx, client = _client_yielding(_response(200, {"id": "u-1", "name": "Nobody"}))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer(None)

    assert result is None
    client.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_empty_token_resolves_to_none():
    ctx, client = _client_yielding(_response(200, {"id": "u-1", "name": "Nobody"}))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("")

    assert result is None
    client.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_rejected_token_resolves_to_none():
    ctx, _ = _client_yielding(_response(401))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("stale-token")

    assert result is None


@pytest.mark.asyncio
async def test_a_timeout_resolves_to_none():
    ctx, _ = _client_yielding(error=httpx.TimeoutException("slow"))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("tok-abc")

    assert result is None


@pytest.mark.asyncio
async def test_an_unreachable_api_resolves_to_none():
    ctx, _ = _client_yielding(error=httpx.ConnectError("no route"))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("tok-abc")

    assert result is None


@pytest.mark.asyncio
async def test_a_malformed_body_resolves_to_none():
    # A 200 without the fields we need is as useless as a 500.
    ctx, _ = _client_yielding(_response(200, {"unexpected": True}))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx):
        result = await identity.resolve_viewer("tok-abc")

    assert result is None


@pytest.mark.asyncio
async def test_the_call_is_bounded_by_the_agreed_timeout():
    # Pins the spec's number: a hanging API must not stall a join by more than
    # 3 seconds total. httpx times connect/read/write/pool as four SEPARATE,
    # sequential phases rather than one total budget, so EVERY phase counts
    # toward the worst case — checking only connect+read (as an earlier,
    # buggy version of this test did) leaves write and pool unbounded and
    # would let a regression like that slip through green. A None phase means
    # "no timeout" for that phase, which would silently unbound it too.
    ctx, _ = _client_yielding(_response(200, {"id": "u-1", "name": "Maria"}))

    with patch.object(identity.httpx, "AsyncClient", return_value=ctx) as ctor:
        await identity.resolve_viewer("tok-abc")

    timeout = ctor.call_args.kwargs["timeout"]
    assert isinstance(timeout, httpx.Timeout)
    phases = {
        "connect": timeout.connect,
        "read": timeout.read,
        "write": timeout.write,
        "pool": timeout.pool,
    }
    for name, value in phases.items():
        assert value is not None, (
            f"{name} timeout is None (unbounded) — httpx times each phase "
            "separately, so every phase must have an explicit budget"
        )
    total = sum(phases.values())
    assert total <= 3.0, (
        f"phases sum to {total}s, exceeding the 3s bound "
        f"({phases}) — httpx times connect/read/write/pool separately, so "
        "the SUM of all four is the real worst-case delay, not just any two"
    )
