# Linux compatibility checklist — v0.4.28

`[ ]` untested · `[x]` pass · `[!]` fail · `[-]` blocked/skipped. Record errors under **Notes**.

## Common setup

```bash
BASE=https://github.com/Ancyent/peerdesk/releases/download/v0.4.28

# Agent — full (GUI + terminal auto-detect; needs pipewire >= 1.0)
curl -L "$BASE/peerdesk-agent-linux-x86_64-v0.4.28" -o peerdesk-agent && chmod +x peerdesk-agent

# Agent — HEADLESS (terminal mode only; links NO pipewire/X11/ALSA — for
# minimal/headless servers like CentOS/RHEL, old Debian/Ubuntu). Ships from v0.4.29:
curl -L "https://github.com/Ancyent/peerdesk/releases/download/v0.4.29/peerdesk-agent-linux-x86_64-headless-v0.4.29" \
  -o peerdesk-agent-headless && chmod +x peerdesk-agent-headless
# Verify it needs no GUI libs:  ldd ./peerdesk-agent-headless | grep -Ei "pipewire|x11|xcb|asound" || echo "clean"

# Viewer — pick one:
curl -L "$BASE/peerdesk-viewer-linux-v0.4.28.AppImage" -o peerdesk-viewer.AppImage && chmod +x peerdesk-viewer.AppImage
# or the .deb: curl -L "$BASE/peerdesk-viewer-linux-v0.4.28-amd64.deb" -o peerdesk-viewer.deb
```

Run the agent against the live server (replace token from the Downloads page):

```bash
./peerdesk-agent --server http://192.168.200.223 --api-key <TOKEN-OR-pd_KEY>
# check the log line: "session mode: Gui|Terminal (display_present=…, monitors=…)"
```

### Runtime dependency check (before blaming the app)

```bash
ldd ./peerdesk-agent | grep -Ei "not found"          # missing = won't start
pkg-config --modversion libpipewire-0.3 2>/dev/null  # need >= 1.0 for GUI mode
```

Agent GUI runtime libs (install the runtime, not -dev): `libpipewire-0.3-0 libspa-0.2-modules
libgbm1 libegl1 libwayland-client0 libxcb1 libxkbcommon0 libasound2`.
Viewer runtime libs: `libwebkit2gtk-4.1-0 libgtk-3-0`.

---

## Scenarios per distro

For each, run: **G** = agent GUI/video, **T** = agent terminal (headless, no `DISPLAY`),
**V** = viewer connects + host approves + surface renders.

### Ubuntu 24.04 LTS — baseline (matches CI build)
- [ ] **G · X11 session** — video streams, mouse/keyboard land, monitor picker correct
- [ ] **G · Wayland session** — same (xcap via pipewire); watch for capture init errors
- [ ] **T** — `unset DISPLAY WAYLAND_DISPLAY && ./peerdesk-agent …` → mode=Terminal, shell over xterm.js, keystrokes + resize work
- [ ] **V** — AppImage + .deb both launch, connect, approve, render
- Notes:

### Ubuntu 22.04 LTS
- [ ] **V** — expected PASS (webkit 4.1 available) → confirms viewer floor
- [!] **G** — expected FAIL (pipewire < 1.0). Goal: **clean error**, not ugly crash — record the exact message
- [ ] **T** (headless binary) — `./peerdesk-agent-headless --server … --api-key …`; expect mode=Terminal, shell over xterm.js. Confirm it STARTS (the full binary won't on this distro)
- Notes:

### Ubuntu 20.04 LTS
- [!] **V** — expected FAIL (only webkit 4.0). Record error
- [!] **G** — expected FAIL (pipewire 0.3). Record error
- [ ] **T** (headless binary) — `./peerdesk-agent-headless --server … --api-key …`; expect mode=Terminal, shell over xterm.js. Confirm it STARTS (the full binary won't on this distro)
- Notes:

### Debian 13 (trixie)
- [ ] **G** — expected PASS (pipewire 1.x), non-Ubuntu sanity
- [ ] **T**
- [ ] **V**
- Notes:

### Debian 12 (bookworm)
- [ ] **V** — expected PASS (webkit 4.1)
- [!] **G** — expected FAIL (pipewire 0.3.65). Record error
- [ ] **T** (headless binary) — `./peerdesk-agent-headless --server … --api-key …`; expect mode=Terminal, shell over xterm.js. Confirm it STARTS (the full binary won't on this distro)
- Notes:

### Fedora 40+
- [ ] **G** — expected PASS, different packaging, current pipewire
- [ ] **T**
- [ ] **V (.rpm)** — native package via the Downloads page → Fedora chip → `sudo dnf install ./peerdesk-viewer-linux-v0.4.30-x86_64.rpm`; launches, connects, approves, renders
- [ ] **V (.AppImage)** — fallback, most portable across RPM distros
- Notes:

### openSUSE (Leap 15.6 / Tumbleweed)
- [ ] **V (.rpm)** — same package, install via `sudo zypper install ./peerdesk-viewer-linux-v0.4.30-x86_64.rpm` (Downloads page → openSUSE chip shows the zypper hint); launches + connects
- [ ] **G** — expected PASS on Tumbleweed (pipewire 1.x); Leap 15.6 ships older pipewire → may FAIL, record
- Notes:

### CentOS Stream 9 / RHEL 9
- [!] **G** — expected FAIL (pipewire 0.3.x). Record error
- [ ] **T** (headless binary) — `./peerdesk-agent-headless --server … --api-key …`; expect mode=Terminal, shell over xterm.js. Confirm it STARTS (the full binary won't on this distro) (this is the main reason to build it — RHEL servers are headless)
- [ ] **V (.rpm)** — `sudo dnf install ./peerdesk-viewer-linux-v0.4.30-x86_64.rpm` installs, but the app needs **WebKitGTK 4.1** which RHEL 9 may lack → expect launch FAIL; record whether the rpm at least installs cleanly vs a missing-dependency error
- Notes:

### Headless server (no monitor, no DISPLAY)
- [ ] **T** — pure terminal-mode proof: `unset DISPLAY WAYLAND_DISPLAY` → shell serves over data channel
- Notes:

### Headless server + Xvfb (GUI-detect on a box with no physical monitor)
- [ ] **G** — `Xvfb :99 & export DISPLAY=:99` → agent detects Gui, captures the virtual desktop, streams video
- Notes:
