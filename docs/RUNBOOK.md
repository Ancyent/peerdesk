# PeerDesk — Operations Runbook

Practical guide to what runs where, how to bring it up, and how to connect a machine.

## 1. Architecture — what runs where

```
                         ┌──────────────── Server host (Docker) ───────────────┐
  Browser / Desktop  ──► │  nginx :80/:443                                       │
  client                 │    ├─ /        → web   (React dashboard SPA)          │
                         │    ├─ /api/    → api   (FastAPI REST, :8000)          │
                         │    ├─ /ws       → signaling (WebSocket broker, :8001)  │
                         │    └─ /config.json → runtime web config               │
                         │  postgres :5432   redis :6379   coturn (TURN relay)   │
                         └──────────────────────────────────────────────────────┘

  Agent (host side)  ── screen capture → H.264 → WebRTC ──►  Viewer (browser or desktop)
       registers with /api, brokers the handshake over /ws, then streams P2P.
```

Key routing rule: the REST API is reachable **only under `/api/`**, signaling **only under `/ws`**.
The agent derives both from a single server URL: `https://host` → API `https://host/api`, signaling `wss://host/ws`.

## 2. Components

| Component | Path | Tech | Notes |
|---|---|---|---|
| Signaling | `server/signaling/` | FastAPI + WebSocket + Redis | brokers WebRTC offer/answer/ICE, approval flow |
| API | `server/api/` | FastAPI + SQLAlchemy + PostgreSQL + JWT | accounts, machines, org tree, API keys, 2FA |
| Web dashboard | `web/` | React 19 + Vite | login, machine list, browser viewer, downloads |
| Desktop client | `desktop/` | Tauri v2 + React | **host (agent) AND viewer in one app** |
| Agent | `agent/` | Rust | capture/encode/input/webrtc; also embedded in the desktop client |

> The "Viewer" installer **is** the full desktop client — it runs the agent (host mode, shows this
> PC's peer ID) and can also connect out as a viewer. One install does both.

## 3. Bring the server up (self-host)

```bash
cd deploy
cp .env.example .env            # then edit: POSTGRES_PASSWORD, JWT_SECRET, VITE_* URLs, TURN_SECRET
docker compose up -d --build
docker compose exec -T api alembic upgrade head    # run DB migrations
curl -s http://<host>/api/health                   # → {"status":"ok"}
```

`.env` essentials:
- `VITE_API_URL` / `VITE_SIGNALING_URL` are **baked into the web build** — set them to your real
  host (e.g. `http://192.168.200.223/api`, `ws://192.168.200.223/ws`), then rebuild the `web` service.
- Changing the web/version display needs only a `web` rebuild: `docker compose up -d --build web`.

Current dev instance: **http://192.168.200.223** (user: andrei@prajina.eu).

## 4. Connect a machine (the host registration flow)

1. **Dashboard → API Keys** → create a key (`pd_…`). Toggle **auto-approve** on if you want machines
   to come online without a manual approval step.
2. **Install the desktop client** on the machine and open **Settings → Network**.
3. Enter **Server URL** = `http://<host>` (just the host — the client adds `/api` and `/ws` itself)
   and paste the **API key**. Click **Apply & Reconnect**.
4. The agent registers via `POST /api/machines/register` (header `X-API-Key`). It appears in the
   dashboard:
   - key has **auto-approve** → status **approved**, shows in *My Machines*.
   - otherwise → status **pending** → approve it under **Machines → pending**.
5. Connect to it from the dashboard or another client using its 9-digit peer ID.

Troubleshooting "machine doesn't appear":
- `docker compose exec -T postgres psql -U peerdesk -c "SELECT peer_id,approval_status FROM machines;"`
- `docker logs deploy-nginx-1 | grep /machines/register` — a `405` means the client sent the request
  to the SPA, not the API (server URL / `/api` routing mismatch).
- A registered-but-pending machine lives in the approvals view, not *My Machines*.

## 5. Releases & versioning

- Git tags drive releases. CI (`.github/workflows/build-clients.yml`) builds on any `v*` tag push and
  publishes a GitHub Release with Linux/Windows (+ Android) artifacts.
- Cut a release: `git tag -aN vX.Y.Z -m "…" && git push origin vX.Y.Z` (after pushing `main`).
- The dashboard **Downloads** page reads the **latest** GitHub release dynamically (tag + asset links),
  so it never goes stale — no code change needed per release.
- After changing the **agent** (`agent/`) or **desktop** (`desktop/`), users need a **new client build**
  (new tag). After changing **web/server**, redeploy with `docker compose up -d --build`.
