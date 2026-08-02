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

## 6. Desktop auto-update (signing)

The desktop viewer verifies every update against a Tauri signing key. The public
key is committed in `desktop/src-tauri/tauri.conf.json`; the private key is a CI
secret and is NEVER committed.

**Update endpoint.** `plugins.updater.endpoints` in that same file points at
`https://app.peerdesk.eu/api/releases/update/...` and is compiled into every
client, so it cannot be changed after a build. **If you self-host or fork, edit
that URL to your own server before cutting a tag** — otherwise your users'
clients ask this project's server for updates. It previously read
`updates.invalid`, a reserved never-resolving TLD, so auto-update silently
failed in every build up to and including v0.5.3.

**One-time maintainer setup (required before the next tagged release):**
Add two GitHub Actions secrets (Settings → Secrets and variables → Actions):
- `TAURI_SIGNING_PRIVATE_KEY` — the full contents of the generated private key
  file (`peerdesk-updater.key`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen when generating it.

Without these, the viewer builds produce no `.sig` files and the
**Require signed viewer bundles** step fails, so the `release-viewers` job
publishes no desktop viewers. That is deliberate: an unsigned viewer looks green
but silently breaks auto-update for every existing desktop client, so refusing to
publish it is the cheaper failure. Fix the cause, then re-run the same tag.

**Release cache refresh.** The server mirrors the GitHub release locally and
re-checks every `RELEASE_REFRESH_SECONDS` (default 3600), so without a nudge a
new tag can take up to an hour to reach clients. CI nudges it: the
`refresh-release-cache` job POSTs to `/api/releases/refresh` after publishing.

Set two GitHub Actions secrets to enable it, plus the matching server-side one:
- `RELEASE_REFRESH_URL` — e.g. `https://app.peerdesk.eu/api/releases/refresh`
- `RELEASE_REFRESH_TOKEN` — must equal `RELEASE_REFRESH_TOKEN` in `deploy/.env`

Unset on the server, the endpoint 404s and effectively does not exist; unset in
CI, the job skips with a notice. Either way the timer still picks the release
up, and the job never fails the run — a release must not be marked broken
because a notification did not land.

Releasing is split across three jobs so one slow or failing platform never holds
up the others:
- `release-agents` — agents only. Needs just the two agent builds, so agents
  publish as soon as they are ready. Creates the release for the tag.
- `release-android` — the APK. Ungated (Android uses notify+link, not the
  updater), so it ships even when viewer signing fails.
- `release-viewers` — desktop viewers only, hard-gated on signatures.

All three use `!cancelled()`, so none blocks another. The latter two only add
assets and share a concurrency group, so their uploads serialise rather than
racing each other.

Store the private key in a password manager; losing it means no future client can
verify updates and every user must reinstall manually.

**First updater-enabled release caveat:** clients built BEFORE auto-update
shipped have no updater and cannot auto-install this first signed release. Users
on older builds need ONE manual update (download from the releases page) to the
first updater-enabled version; every release after that is seamless.

**Not self-updatable:** `.deb`/`.rpm` installs and Android get a notify+link
(open the releases page), not in-app install — same as before.

**Optional hardening — `PUBLIC_BASE_URL`:** the update manifest's download links are
built from the incoming request (`X-Forwarded-Proto` + `Host`), which is correct for a
normal single-domain deploy behind nginx. To pin them explicitly and ignore request
Host headers entirely (defense against Host-header spoofing), set `PUBLIC_BASE_URL` in
the api service env (e.g. `PUBLIC_BASE_URL=https://peerdesk.example.com`) — see
`deploy/docker-compose.yml`. When set it is authoritative; leave empty to auto-derive.
(The forgeable `X-Forwarded-Host` header is never trusted regardless.)

## 7. Building your own clients (self-hosted release cache)

Instead of pointing users at this project's GitHub releases, a deployment can
build Linux and Windows clients itself, in a container, and serve them from
its own release cache. This section covers running that build; the signing
concepts (updater key, `.sig` files, why signing is not optional) are the same
ones section 6 already covers in depth — this reuses that key rather than
introducing a second one.

**1. Generate an updater key pair**, if you don't already have one from
section 6:

```bash
cargo tauri signer generate -w ./peerdesk-updater.key
```

This writes `peerdesk-updater.key` (private) and `peerdesk-updater.key.pub`
(public). Store the private key **outside the repo**, backed up (a password
manager, same as section 6 recommends). Losing it means no existing install —
official or self-built — can ever be updated again; every user has to
reinstall manually.

**2. Point the client at your own key and your own server.** Both of these are
compiled into the client at build time, so both have to be set *before* you
build — set them, then commit, then run step 3.

- Set `plugins.updater.pubkey` in `desktop/src-tauri/tauri.conf.json` to the
  contents of the generated `.pub` file.
- Set `plugins.updater.endpoints` (same `tauri.conf.json`, same `updater`
  block) to your own update URL. Section 6 already covers why this field is
  load-bearing and what happens if you skip it: the endpoint is baked into
  every client and cannot be changed after the fact, so a self-hoster who
  builds without editing it ships a client that still asks *this project's*
  server for updates. `RELEASE_SOURCE=local` in step 4 has no effect on that —
  the client never asks your server at all, so it looks correctly configured
  and silently never updates.

Skipping either of these produces a build that runs clean and looks fine; the
failure only shows up later, as an update nobody gets.

**3. Run a build:**

```bash
cd deploy
VERSION=v1.2.3 \
UPDATER_KEY_PATH=/srv/keys/peerdesk-updater.key \
UPDATER_KEY_PASSWORD=… \
  docker compose --profile build run --rm builder
```

`VERSION` **must be a plain `vX.Y.Z` tag** — no `-rc1`, no `+build` suffix. The
build refuses anything else and says why: an RPM `Version` field cannot
contain a hyphen and an MSI `ProductVersion` is three numeric fields and
nothing else, so a pre-release tag can't be expressed in two of the four
packages it produces. This isn't a validation nicety to work around — tag the
release `x.y.z` and re-run.

A cold build (no cached `cargo`/`npm` state, no base images pulled) needs
roughly **40 GB of free disk** — an estimate, not a measured figure (nothing
in `build.sh`, the builder `Dockerfile`, or CI enforces or reports it). It's
still the constraint most operators hit first — check headroom before the
first run, and revise upward if you see it get close.

Know before you run it:
- The build **mutates the checkout it runs against** for its duration: it
  stamps the release version into `desktop/src-tauri/tauri.conf.json`, runs
  `npm ci`, and writes into both `target/` build trees. The version stamp is
  restored on exit, including on Ctrl-C.
- If the container is killed hard (`docker rm -f`) instead of being allowed to
  stop, that restore never runs and `tauri.conf.json` is left with the stamped
  version. Run `git checkout -- desktop/src-tauri/tauri.conf.json` (or a plain
  `git status`/`git diff` to check first) before doing anything else with the
  checkout.
- It produces **ten** artifacts: two Linux agents (full and headless), one
  Windows agent, a `.deb`, `.rpm`, `.AppImage` + its `.sig`, and an `.msi` and
  Windows `-setup.exe` + its `.sig`. The project's GitHub releases carry
  twelve — the **Android APK and the portable Windows `.exe` are not built**
  by this path. Switching to a self-hosted release cache removes those two
  from the Downloads page.

**4. Switch the server to serve it.** Set `RELEASE_SOURCE=local` in
`deploy/.env` and restart the `api` service. `RELEASE_SOURCE` accepts only
`github` (the default) or `local` — any other value makes the API refuse to
start at import time. There is deliberately no `both`: artifacts from the two
sources are signed with different keys, and offering a mix would mean some
clients silently can't verify the update they were just told about.

**5. Back up the `release_cache` volume.** It now holds artifacts that exist
nowhere else — not in git, not on GitHub. Alongside `postgres_data`, it is one
of only two named volumes `deploy/docker-compose.yml` declares, and the first
piece of user-facing state that lives outside Postgres — add it to whatever
backup procedure already covers `postgres_data`.

A self-built client and an official client are separate trust domains. Each
verifies updates against the public key baked into it at build time, so a
self-built client cannot be updated to an official release, and an official
client cannot be updated from a self-hosted server. This is the point of
self-hosting, not a limitation — but moving a fleet from one to the other
means reinstalling, not updating.
