# PeerDesk — Compatibility Test Suite

Manual OS-compatibility testing for PeerDesk. **Only the latest release is tested** — each
release supersedes the previous one, so we never re-test old versions.

- **Version under test:** `v0.4.28`
- **Release assets:** https://github.com/Ancyent/peerdesk/releases/tag/v0.4.28
- **Download base URL:** `https://github.com/Ancyent/peerdesk/releases/download/v0.4.28/`

## The three Linux artifacts (different dependency floors)

Linux is not one client — it is three binaries with very different runtime dependencies.
Test each independently; a distro can pass one and fail another.

| Artifact | Asset | Hard runtime dependency | Realistic floor |
|----------|-------|-------------------------|-----------------|
| **Agent — GUI (video)** | `peerdesk-agent-linux-x86_64-v0.4.28` | `xcap`/`libspa` → **pipewire ≥ 1.0** | Ubuntu 24.04+, Fedora 39+, Debian 13 |
| **Agent — terminal (full binary)** | `peerdesk-agent-linux-x86_64-*` | still links capture libs → **pipewire ≥ 1.0** | same as GUI |
| **Agent — terminal (headless binary)** | `peerdesk-agent-linux-x86_64-headless-*` | **none** — links no pipewire/X11/ALSA | any glibc Linux (CentOS/RHEL, old Debian/Ubuntu) |
| **Viewer** | `.AppImage` / `.deb` | Tauri 2 → **WebKitGTK 4.1** | Ubuntu 22.04+, Debian 12+ |

> **Terminal-mode note:** the **full** agent binary links the capture stack
> unconditionally, so its terminal mode still needs pipewire ≥1.0. From **v0.4.29**
> a dedicated **headless agent binary** (built `--no-default-features`) drops
> xcap/openh264/enigo/arboard/cpal and links no GUI libs, so terminal mode runs on
> old/headless distros (CentOS/RHEL, Debian 12, Ubuntu 20.04). Use the `-headless`
> asset for those rows.

## Windows

- The agent has **no terminal/headless mode** — on Windows it is always GUI capture.
  "Headless Windows" therefore means **Windows Server** (Desktop Experience vs Core).
- Viewer installers: `-x64-setup.exe`, `-x64.msi`, `-portable.exe` (needs WebView2, present on Win10 2020+/11).
- Agent capture uses Windows Graphics Capture (WGC), needs Win10 **1903+**; older falls back to DXGI.

## How to record a result

Fill in each checkbox row: `[x]` pass · `[!]` fail · `[-]` blocked/skipped. Add the
observed behavior + any error under **Notes**. Keep `agent.log` output for failures.

- Linux: [`linux-checklist.md`](./linux-checklist.md)
- Windows: [`windows-checklist.md`](./windows-checklist.md)
