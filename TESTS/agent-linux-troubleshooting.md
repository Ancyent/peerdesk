# Linux agent — connection troubleshooting

## Where the logs actually are

`--silent` (how the systemd service runs) sends logs to a **file**, not journald
— see `agent/src/logging.rs`. `journalctl -u peerdesk-agent` therefore shows only
systemd start/stop lines and **never** any agent activity. That is expected and
is *not* a symptom. Read the file instead:

- `/var/log/peerdesk-agent.log` (preferred — used when `/var/log` is writable)
- `~/.local/share/peerdesk/agent.log` (fallback)

---

## SOLVED 2026-07-15 — "wrong password" on a Linux agent that shows online

**Do not chase configs, HOME, or reinstalls for this symptom.** The old
"two configs / wrong HOME" theory (v0.4.31) was *not* the cause. The bug was on
the **server**, and it is now fixed.

### Root cause

`server/signaling/main.py` cleaned up a disconnecting agent inside
`except WebSocketDisconnect:`. But starlette's `iter_text()` catches
WebSocketDisconnect itself (`websockets.py:143-148`), so the `async for` loop
ends *normally* and that `except` block was **unreachable dead code**.
`unregister_agent()` therefore never ran for **any** disconnect.

Every agent disconnect leaked:
- a **zombie socket** in `state.agent_connections[peer_id]` — held the peer_id
  until the process restarted (the container had been up since 2026-06-24)
- a **stale `agent:<peer_id>` record in Redis** with the *old* password hash

The failure chain that produced "wrong password":

1. Agent registers → Redis stores hash **A**. Socket later dies → nothing is
   cleaned up.
2. Password is changed (`--reset-password` / reinstall) → agent config now has
   hash **B**.
3. Agent reconnects announcing **B**. `register_agent()` sees the zombie socket
   *and* stored hash **A** → no match → rejects with `peer_id_in_use`.
4. The agent logged a warning and **kept running as if registered** — so it sat
   there permanently unreachable while looking healthy.
5. The viewer's password was checked against the **stale hash A** → `auth_failed`
   → *"Wrong ID or password"*. The real agent was never consulted.

### Fixes shipped

- **`server/signaling/main.py`** — cleanup moved to a `finally:` block, so it
  runs on normal disconnects *and* abrupt resets. Regression tests:
  `test_agent_disconnect_unregisters`, `test_agent_can_reregister_after_password_change`.
- **`agent/src/signaling/mod.rs`** —
  - `peer_id_in_use` now drops the socket and retries with backoff instead of
    idling forever pretending to be registered.
  - "Registered with signaling server" is logged only on the server's
    `registered` ack, not immediately after `send`. The old log claimed success
    on a registration the server had rejected — it is what sent this
    investigation to the wrong place for two sessions.

### Verified

- Live: registered a throwaway peer against `ws://192.168.200.223/ws`, dropped
  the socket, confirmed `EXISTS agent:999000111` → `0`. Before the fix the key
  survived 24h (TTL) and the socket forever.
- The real agent (`933146422`) re-registered on its own after the signaling
  restart; Redis now holds the **same** hash as the agent's config.

---

## Still open — token reuse bricks the agent's API key

Visible in the agent log and **not yet fixed**:

```
Token redeem failed (non-fatal): 409 Conflict: {"detail":"peer_id already registered"}
API registration failed (non-fatal): 401 Unauthorized: {"detail":"Invalid or inactive API key"}
TURN credentials unavailable, using STUN only: 401 Unauthorized
```

Re-running `install.sh` with an **already-redeemed** registration token
(`--api-key=UFDW-RA9Q`) makes `Config::load_or_create` overwrite the durable
`pd_…` api-key in `config.json` with the spent token. The agent then 401s on
register/heartbeat/TURN and runs **STUN-only** — fine on one LAN, but no relay
for cross-network viewers.

Workaround: generate a **fresh** token per install. Real fix: don't let a token
clobber a durable api-key that already redeemed successfully.

---

## If a Linux agent misbehaves again — the order that works

```bash
# 1. the agent's real log (NOT journalctl)
tail -n 60 /var/log/peerdesk-agent.log 2>/dev/null || tail -n 60 ~/.local/share/peerdesk/agent.log

# 2. is its websocket actually up?
ss -tnp | grep -i peerdesk    # expect ESTAB to <server>:80
```

Then on the **server** (`192.168.200.223`):

```bash
cd /root/peerdesk/deploy
docker compose exec redis redis-cli --scan --pattern 'agent:*'
docker compose exec redis redis-cli HGETALL agent:<PEER_ID>
docker compose logs --tail=40 signaling      # look for "outcome": "auth_failed"
```

Read it like this:

| Evidence | Meaning |
|---|---|
| Redis hash ≠ the hash in the agent's `config.json` | The server holds a stale record — the viewer is being checked against the wrong password. |
| `peer_id_in_use` in the agent log | The server refused the registration; the agent is a ghost. Should now self-heal via retry. |
| `"outcome": "auth_failed"` in signaling logs | The request *did* reach the server — so this is auth, not connectivity. |
| No `agent:*` key at all | The agent never registered — check its websocket first. |
