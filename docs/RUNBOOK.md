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
build — set them, then commit, then work through steps 3 and 4.

- Set `plugins.updater.pubkey` in `desktop/src-tauri/tauri.conf.json` to the
  contents of the generated `.pub` file.
- Set `plugins.updater.endpoints` (same `tauri.conf.json`, same `updater`
  block) to your own update URL. Section 6 already covers why this field is
  load-bearing and what happens if you skip it: the endpoint is baked into
  every client and cannot be changed after the fact, so a self-hoster who
  builds without editing it ships a client that still asks *this project's*
  server for updates. `RELEASE_SOURCE=local` in step 3 has no effect on that —
  the client never asks your server at all, so it looks correctly configured
  and silently never updates.

Skipping either of these produces a build that runs clean and looks fine; the
failure only shows up later, as an update nobody gets.

**3. Switch the server to serve its own cache — do this *before* the first
build.** Set `RELEASE_SOURCE=local` in `deploy/.env`, then recreate the `api`
service so it picks the value up:

```bash
cd deploy
docker compose up -d api
```

The order matters and it is not a style preference. While `RELEASE_SOURCE` is
still `github`, the api keeps running `refresh_loop()` on its timer (every
`RELEASE_REFRESH_SECONDS`, default 3600). The build in step 4 swaps its
artifacts into the cache and writes a manifest carrying your new tag; the next
tick compares that tag against the latest tag on GitHub, sees they differ,
downloads GitHub's assets — and then prunes every file the new manifest does
not list, which is all ten artifacts the build just spent half an hour
producing.

Losing the build is the smaller half of it. Nothing reports an error, so an
operator who then flips to `local` and restarts is left serving **GitHub's
project-signed artifacts while believing the deployment serves its own** — and
clients built with their key cannot verify them. That mixed-provenance state is
precisely what `RELEASE_SOURCE` exists to prevent, and it is invisible from the
outside.

`RELEASE_SOURCE` accepts only `github` (the default) or `local` — any other
value makes the API refuse to start at import time. There is deliberately no
`both`: artifacts from the two sources are signed with different keys, and
offering a mix would mean some clients silently can't verify the update they
were just told about.

Between this step and the end of step 4 the cache is whatever it already was,
and once the first local build replaces it there is no going back to the
mirrored set without flipping `RELEASE_SOURCE` back. On a deployment that has
never mirrored anything, `/api/releases/latest` returns 503 and the Downloads
page has nothing to offer until step 4 finishes. That is expected.

**4. Run a build:**

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
- The build **mutates the checkout it runs against** for its duration: it runs
  `npm ci` and writes into both `target/` build trees. The release version (and,
  for a branded build, the product name, identifier, binary name, window title
  and update endpoint) is stamped through an environment channel
  (`TAURI_CONFIG` / `cargo tauri build --config`), not written into any tracked
  file, so an unbranded build **modifies no tracked file** — even if the
  container is killed hard (`docker rm -f`) mid-build, there is nothing to
  restore with `git checkout`. It is not quite "exactly as it found it",
  though: the Windows cross-build generates
  `desktop/src-tauri/gen/schemas/windows-schema.json`, which is untracked, is
  not cleaned up, and will show as a new file in `git status` afterwards. It is
  a generated schema and harmless to delete or to leave.
- A **branded** build is the one exception: see section 8 for what it leaves
  behind in `desktop/src-tauri/icons/` and how to clean it up.
- It produces **ten** artifacts: two Linux agents (full and headless), one
  Windows agent, a `.deb`, `.rpm`, `.AppImage` + its `.sig`, and an `.msi` and
  Windows `-setup.exe` + its `.sig`. The project's GitHub releases carry
  twelve — the **Android APK and the portable Windows `.exe` are not built**
  by this path. Switching to a self-hosted release cache removes those two
  from the Downloads page.
- The Windows installers it produces (`.msi` and `-setup.exe`) install the
  Edge WebView2 runtime automatically when it's missing, the same way the
  official CI-built installers always have: on install, each checks three
  registry locations for an already-installed runtime and, if none is found,
  downloads Microsoft's Evergreen bootstrapper
  (`https://go.microsoft.com/fwlink/p/?LinkId=2124703`) and runs it silently
  before finishing. That download needs a route out to Microsoft's endpoint.
  On a machine that already has the runtime (most current Windows installs
  do, since it now ships in-box), nothing is downloaded and install proceeds
  exactly as before.

  **When the runtime is missing and the endpoint is unreachable, the install
  fails — but what the machine is left with depends on whether it was a
  fresh install or an upgrade, and the two differ between the formats:**

  | | fresh install | upgrade over an existing install |
  |---|---|---|
  | `.msi` | fails and rolls back; nothing installed | fails and rolls back; **the previous version is restored** |
  | `-setup.exe` (NSIS) | fails and aborts; nothing written | fails and aborts; **the previous version is already gone and is not restored** |

  The MSI schedules the removal of the old version inside the install
  transaction, so a failure at the WebView2 step rolls the removal back with
  everything else. The NSIS setup runs the old uninstaller before the install
  section is entered, and NSIS has no transactional rollback, so there is
  nothing to restore — that machine is left with **neither** version and
  needs the previous installer re-run by hand.

  The realistic way to hit the NSIS case: a machine that installed an
  earlier self-hosted build (which carried no WebView2 machinery, so the app
  installed but never started) and then takes an upgrade that now checks for
  the runtime and cannot reach Microsoft. If you are upgrading a fleet that
  may include such machines, confirm the route to Microsoft's endpoint
  first, or prefer the `.msi`.
- **The portable `.exe` is different.** It carries no installer at all, so it
  never runs the check above — it will not launch on a machine without the
  runtime already present. That is a pre-existing, deliberate limitation of
  the portable build, not something this changed. (It is also not one of the
  ten artifacts this path produces — see above.)
- Every build now runs `deploy/builder/webview2_check.py` against the staged
  `.msi` before publishing, comparing its registry searches, its download
  action, and where that action is scheduled against what the official
  Tauri-built installer carries — and **fails the build** if any of it is
  missing. It does **not** inspect the `Property` table, where the download
  action's own executable path is resolved; a defect there has passed this
  check before. Treat a green build as evidence the machinery is present, not
  as proof the installer runs to completion on Windows.
- **These installers have never been executed on a Windows machine.** The work
  that produced them proved the definitions are structurally valid —
  `wixl` and `makensis` accept them and emit installers of the expected
  shape, and the build now checks the MSI's WebView2 machinery against the
  official installer's — not that they install, upgrade, or launch anything.
  Treat the Windows half of this path as unverified until you have run it
  yourself.

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

## 8. White-label (branded) client builds

The build in section 7 also accepts a brand profile, which replaces the
PeerDesk name, identifier, icon and update endpoint in the desktop viewer it
produces — everywhere but the one place named under "What a brand does not
reach" below. This section covers what a brand actually changes, how to supply
one, and what a branded build leaves behind.

**What a brand changes, and what it doesn't.** Display name, logo and accent
colour are already runtime settings — they come from `GET /branding` (see the
web UI's branding settings) and need no build at all; changing them takes
effect immediately for every existing install, desktop included. What *does*
require a build is anything compiled into the binary: the product name shown
by the OS (title bar, Start menu, `.deb`/`.rpm` package name), the app
identifier, the installer/bundle name, and the auto-update endpoint. That
split exists on purpose — duplicating the runtime fields into the build would
create two places for a brand to be defined, with no guarantee they agree.

**What a brand does not reach.** One string stays literal in a branded build:
the `peerdesk://setup?…` config-link format the viewer accepts on its setup
screen. A link generated by the server for one of your users still starts with
`peerdesk://`, whatever the client is called. This is cosmetic, not a
conflict: no deep-link plugin is registered, so nothing claims that scheme at
the OS level and no other application competes for it — it is a string the
viewer parses out of a paste box, not a URL the operating system routes.
Everything else that is visible — window title, tray menu item, Start-menu and
package names, installer name, icon, update endpoint — follows the brand.

**The profile.** A brand is a directory containing a `brand.json` and the
icon it references. Four fields are required:

- `product_name` — shown in title bars, the tray menu, the Start menu, and used
  to derive the Linux package name. It also becomes a Windows install
  directory, so it must not contain any of `/ \ : * ? " < > |`.
- `identifier` — the app identifier, reverse-DNS, e.g. `com.acme.remotedesk`
  (at least two dot-separated segments).
- `server_url` — an absolute `https://` URL; see below.
- `icon` — a filename, relative to the brand directory, of **one square PNG or
  SVG**. A non-square PNG is rejected before the build starts; an SVG is
  accepted without a shape check since it scales.

One field is optional:

- `updater_endpoint` — overrides the update URL the client is built to check.
  Leave it unset and it's derived from `server_url` (see below); set it only
  if updates need to be served from somewhere other than the main server.

A minimal `brand.json`:

```json
{
  "product_name": "Acme Remote",
  "identifier": "com.acme.remotedesk",
  "server_url": "https://remote.acme.example.com",
  "icon": "icon.png"
}
```

Validation runs before the first compile and fails in under a second on a bad
field — deliberately, since the same mistake caught here would otherwise
surface twenty minutes in, inside the Windows bundler or `cargo tauri icon`,
with an error naming neither the field nor the file.

**`server_url` drives the update endpoint.** Unless `updater_endpoint` is set
explicitly, the client's update URL is built from `server_url` (as
`{server_url}/api/releases/update/{{target}}/{{arch}}/{{current_version}}`).
That value gets compiled into the client and, same as section 6's update
endpoint, cannot be changed after the build — so `server_url` must be the
address this brand's users will actually reach, not an internal or
build-time-only hostname.

It must also be an absolute `https://` URL, and the build refuses anything
else (an `http://` URL, a bare `desk.acme.example`, a hostname with no
scheme). The updater rejects every non-`https` endpoint outright, so a client
built from such a value installs and runs perfectly and then never sees an
update again — a failure that only surfaces on machines you no longer control.
`updater_endpoint`, when set explicitly, is held to the same rule.

**Running a branded build.** Same invocation as section 7 step 4, with
`BRAND_DIR` pointed at the profile directory:

```bash
cd deploy
BRAND_DIR=/srv/brands/acme \
VERSION=v1.2.3 \
UPDATER_KEY_PATH=/srv/keys/peerdesk-updater.key \
UPDATER_KEY_PASSWORD=… \
  docker compose --profile build run --rm builder
```

Leave `BRAND_DIR` unset for a plain PeerDesk build — the `builder` service
only mounts and forwards it when the host actually sets it, so an operator who
sets nothing gets the unbranded build, not one pointed at an empty mount.

**A branded build leaves the checkout dirty.** `cargo tauri icon` writes its
generated set into the tracked `desktop/src-tauri/icons/` — `tauri.conf.json`
names those files by path, and there's nowhere else to put them. Unlike the
version stamp (section 7), this one **is** a tracked-file write, and it
persists after the build exits, including after a hard kill. Restore it
before building a different brand, or before an unbranded build:

```bash
git checkout desktop/src-tauri/icons && git clean -fd desktop/src-tauri/icons
```

This isn't a step you have to remember to run: an **unbranded** build now
refuses to start if `desktop/src-tauri/icons` is dirty, rather than silently
compiling whatever a previous brand left there into a release that looks like
PeerDesk. If you see that refusal, it's telling you exactly what's above —
run the two commands and re-run the build.

**The agent is never branded.** `BRAND_DIR` affects only the desktop viewer;
the Linux and Windows agent binaries keep the literal `peerdesk-agent` name
regardless. Every existing agent install runs under a `peerdesk-agent`
systemd unit and was set up by `install.sh`, which locates the agent
artifacts in the release manifest by that literal name — a renamed agent
would publish a binary nothing could find or manage.

**Trust domains are defined by the signing key, not the brand.** A branded
build still needs `UPDATER_KEY_PATH`/`UPDATER_KEY_PASSWORD` and is signed and
verified the same way — see the trust-domain paragraph at the end of section
7. Building several brands with the same key keeps them in the same trust
domain; it's the key, not `product_name` or `identifier`, that decides which
clients a release can update.
