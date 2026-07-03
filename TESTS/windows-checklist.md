# Windows compatibility checklist — v0.4.28

`[ ]` untested · `[x]` pass · `[!]` fail · `[-]` blocked/skipped. Record errors under **Notes**.

## Assets

```
BASE = https://github.com/Ancyent/peerdesk/releases/download/v0.4.28
- peerdesk-agent-windows-x86_64-v0.4.28.exe      (standalone agent)
- peerdesk-viewer-windows-v0.4.28-x64-setup.exe  (installer, bundles agent)
- peerdesk-viewer-windows-v0.4.28-x64.msi        (MSI installer)
- peerdesk-viewer-windows-v0.4.28-portable.exe   (no install; needs WebView2)
```

The **desktop viewer** embeds the agent, so installing it also lets the box act as a host.
The standalone agent `.exe` is the headless/host-only path.

## Key facts

- **No terminal mode on Windows** — the agent is always GUI capture. "Headless Windows" = Windows Server.
- Viewer needs the **WebView2 runtime** (present on Win10 2020+ / Win11; may need install on older/Server).
- Capture uses **Windows Graphics Capture** (WGC), requires Win10 **1903+**; older → DXGI fallback.
- Log file: `%LOCALAPPDATA%\peerdesk\agent.log` (look for `xcap enumerated N monitor(s)`).

---

## Scenarios

Run: **G** = agent as host (video/input) · **V** = viewer connects/approves/renders ·
**Inst** = each installer variant launches.

### Windows 11
- [ ] **G** — multi-monitor detection + picker + switch, mouse buttons (L/M/R), keyboard shortcuts (Ctrl+C etc.)
- [ ] **V** — connect to a host, approve, video renders
- [ ] **Inst** — setup.exe, .msi, portable.exe all launch (portable = no install)
- [ ] **Token onboarding** — deploy with a generated token → machine appears ONLINE → survives restart *(the v0.4.28 headline fix)*
- Notes:

### Windows 10 21H2+ (WGC-capable)
- [ ] **G** — capture via WGC, no DXGI fallback in log
- [ ] **V**
- [ ] **Inst**
- Notes:

### Windows 10 older (< 1903)
- [ ] **G** — expected DXGI fallback path; confirm it still captures (log shows fallback, not crash)
- [ ] **V** — WebView2 may need manual install; record if prompted
- Notes:

### Windows Server 2022 + Desktop Experience ("headless with GUI")
- [ ] **G** — agent captures the server desktop, streams to a viewer
- Notes:

### Windows Server Core (no GUI)
- [-] **NOT SUPPORTED today** — no desktop to capture, no terminal mode. Confirm it fails cleanly (clear log), don't expect success.
- Notes:
