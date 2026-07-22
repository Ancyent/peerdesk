# PeerDesk — Manual Test Guide

**Purpose:** Full verification of the platform, from installation to remote control, from the perspective of a new user who has never used PeerDesk before.

**Who runs it:** QA / developer / end user  
**Estimated duration:** 60–90 minutes (with 2 monitors available)  
**Minimum requirements:** A Linux server + a Windows or Linux machine to control + a device for the viewer (browser / Android)

---

## Conventions

- ✅ = expected result — check off after verifying
- ❌ = problem — note the observed behavior
- `[SERVER_IP]` = the IP or domain of your PeerDesk server
- `[PEER_ID]` = the agent's 9-digit ID

---

## Section 1 — Server installation

### 1.1 Fresh install on Linux

```bash
git clone https://github.com/Ancyent/peerdesk.git
cd peerdesk/deploy
docker compose up -d

curl http://[SERVER_IP]/api/health
curl http://[SERVER_IP]/ws/health
```

- ✅ All containers in `Up` or `healthy` state
- ✅ `/api/health` returns `{"status":"ok"}`
- ✅ `/ws/health` returns `{"status":"ok"}`
- ✅ `http://[SERVER_IP]` opens the login page in the browser

---

## Section 2 — Account and authentication

### 2.1 Register a new account

1. Open `http://[SERVER_IP]` in a browser
2. Click **Register**
3. Fill in: Email, Name, Password (min 8 characters, one digit, one uppercase letter)
4. Click **Register**

- ✅ You are redirected to the dashboard automatically
- ✅ A dark icon bar appears on the left with icons: 💻 🏢 ⬇️ 🔑 📦 🎨 ⚙️
- ✅ An avatar with your name's initial appears at the bottom of the icon bar

### 2.2 Logout and Login

1. Click the avatar (bottom of the icon bar) → dropdown with your name and email
2. Click **Logout** → ✅ login page
3. Enter your credentials → ✅ the dashboard reopens

### 2.3 Wrong password

1. At login, enter the wrong password
2. ✅ Visible error — you are not authenticated

---

## Section 3 — Downloading clients

### 3.1 Downloads page

1. Click 📦 (Download) in the icon bar
2. ✅ Cards for: Agent, Viewer Desktop, Android, Viewer Web
3. ✅ The "All versions on GitHub →" link works

### 3.2 Download the binaries

Go to `https://github.com/Ancyent/peerdesk/releases/latest` and download:

| Platform | File |
|---|---|
| Agent Linux | `peerdesk-agent-linux-x86_64-vX.Y.Z` |
| Agent Windows | `peerdesk-agent-windows-x86_64-vX.Y.Z.exe` |
| Viewer Android | `peerdesk-android-vX.Y.Z.apk` |
| Viewer Linux | `peerdesk-viewer-linux-vX.Y.Z-amd64.deb` or `.AppImage` |
| Viewer Windows | `peerdesk-viewer-windows-vX.Y.Z-x64-setup.exe` or `.msi` |

---

## Section 4 — Agent installation and registration

### 4.1 Registration token (recommended method)

1. Click ⬇️ (Install Agent) in the dashboard
2. Optionally select a company/location
3. Click **Generate registration token**
4. ✅ A token of the form `XXXX-XXXX` appears with a 24h countdown
5. Copy the command from the tab for the desired platform

### 4.2 Agent on Linux

```bash
chmod +x peerdesk-agent-linux-x86_64-vX.Y.Z

# With a token:
PEERDESK_TOKEN=XXXX-XXXX \
PEERDESK_SERVER=ws://[SERVER_IP]/ws \
./peerdesk-agent-linux-x86_64-vX.Y.Z

# Or standalone (without a central server):
PEERDESK_PASSWORD=mypassword \
SIGNALING_URL=ws://[SERVER_IP]/ws \
./peerdesk-agent-linux-x86_64-vX.Y.Z
```

- ✅ Log: `PeerDesk agent — peer_id=XXXXXXXXX` — **note the ID!**
- ✅ Log: `Registered with signaling server`
- ✅ The machine appears in the dashboard

### 4.3 Agent on Windows

```powershell
$env:PEERDESK_TOKEN="XXXX-XXXX"
$env:PEERDESK_SERVER="ws://[SERVER_IP]/ws"
.\peerdesk-agent-windows-x86_64-vX.Y.Z.exe
```

- ✅ The console shows the peer_id
- ✅ The machine appears in the dashboard

### 4.4 Approving a machine (if Pending)

1. Click 💻 (Machines) → **Pending** tab
2. Click **Approve** on the newly registered machine
3. ✅ The machine moves to Online status (green indicator 🟢)

---

## Section 5 — Connecting and remote control

### 5.1 Connect from the browser

1. Click **Connect** on the online machine in the dashboard
2. ✅ Form with peer_id pre-filled
3. Enter the agent's password
4. Click **Connect**
5. ✅ The remote screen appears within a few seconds
6. ✅ Video is clear, not pixelated or frozen

### 5.2 DTLS security code

- ✅ 6-digit code shown in the viewer or in the agent's log
- ✅ The code changes on every new session

### 5.3 Mouse control

With the cursor over the video:

- Move the mouse → ✅ the cursor moves on the remote (the local cursor disappears)
- Left click → ✅ click registered on the remote
- Right click → ✅ context menu appears on the remote (not in the browser)
- Scroll wheel → ✅ scroll works on the remote

### 5.4 Keyboard control

Click once on the video for focus, then:

- Type letters/digits → ✅ they appear on the remote
- `Ctrl+C` / `Ctrl+V` → ✅ works on the remote
- `Enter`, `Backspace`, `Tab` → ✅ works
- `Alt+F4` (Windows remote) → ✅ closes the active window on the remote

---

## Section 6 — Clipboard (Bidirectional Copy-Paste)

### 6.1 Local → Remote

1. Copy some text on your local machine (`Ctrl+C`)
2. Click in the viewer (focus on the remote)
3. `Ctrl+V` into a text field on the remote
4. ✅ The text appears on the remote screen

### 6.2 Remote → Local

1. On the remote screen, select and copy text (`Ctrl+C`)
2. On your machine, `Ctrl+V` into a text field
3. ✅ The text from the remote appears locally

---

## Section 7 — File transfer

### 7.1 Sending a small file (<5 MB)

1. In the active viewer, click **File Transfer** (bottom bar)
2. Select a file from the local machine
3. ✅ Progress bar appears
4. ✅ The file appears in the remote machine's Downloads folder
5. ✅ Confirmation message at the end

### 7.2 Large file (>20 MB)

1. Send a 20–50 MB file
2. ✅ Transfer completes without errors
3. ✅ The received file's size matches the original

---

## Section 8 — Multi-monitor

> The remote machine must have 2+ monitors connected

### 8.1 Selecting a display

1. Connect to the machine with multiple monitors
2. ✅ Dropdown appears in the top-left corner: `Monitor 1 (1920×1080) ★ ▼`
3. Select **Monitor 2**
4. ✅ The viewer switches to the second monitor within 1-2 seconds
5. Select Monitor 1 again
6. ✅ Returns to the primary monitor

### 8.2 Checking resolution and control

- ✅ The resolutions in the dropdown match reality
- ✅ The primary monitor has the ★ marker
- ✅ The mouse works correctly after switching

---

## Section 9 — Desktop Viewer (Tauri)

### 9.1 Linux

```bash
# .deb:
sudo dpkg -i peerdesk-viewer-linux-vX.Y.Z-amd64.deb

# .AppImage:
chmod +x peerdesk-viewer-linux-vX.Y.Z.AppImage && ./peerdesk-viewer-linux-vX.Y.Z.AppImage
```

- ✅ The app starts with an icon in the system tray
- ✅ Dashboard identical to the browser version
- ✅ Connecting to the agent works
- ✅ Right-click tray → Show / Quit

### 9.2 Windows

1. Run `peerdesk-viewer-windows-vX.Y.Z-x64-setup.exe`
2. Follow the installation wizard
3. ✅ PeerDesk appears in the Start Menu and system tray
4. ✅ Functionality identical to the browser

---

## Section 10 — Android Viewer

### 10.1 Installation

1. Enable **Unknown Sources** (Settings → Security)
2. Install `peerdesk-android-vX.Y.Z.apk`
3. ✅ The app appears in the launcher

### 10.2 Connecting from Android

1. Log in with your account
2. ✅ Dashboard with the list of machines
3. Click **Connect** on an online machine
4. ✅ The remote screen appears on the phone
5. Touch the screen → ✅ the mouse moves on the remote
6. Touch and hold → ✅ right click on the remote
7. Pinch → ✅ zoom in/out on the viewer
8. Virtual keyboard → ✅ input reaches the remote

---

## Section 11 — Organization (Companies / Locations / Groups)

### 11.1 Creating a structure

1. Click 🏢 (Organization)
2. Click **+** → enter `My Company` → Enter
3. ✅ The company appears in the tree on the left
4. Expand the company → **+** → add location `Head Office`
5. Expand the location → **+** → add group `IT Department`
6. ✅ Tree: My Company → Head Office → IT Department

### 11.2 Placing a machine

1. Click 💻 (Machines) → on a machine click **···**
2. Select the IT Department group
3. Click 🏢 → select IT Department
4. ✅ The machine appears filtered in the selected group

---

## Section 12 — API Keys

### 12.1 Create and test

1. Click 🔑 → **Create Key** → enter `Test Key`
2. ✅ The generated key appears only once — **copy it!**
3. Test it:
   ```bash
   curl -H "X-API-Key: [KEY]" http://[SERVER_IP]/api/machines
   ```
4. ✅ The list of machines is returned as JSON

### 12.2 Revocation

1. Click **Revoke** on the key
2. ✅ The key disappears from the list
3. Test again → ✅ `401 Unauthorized`

---

## Section 13 — Account settings

### 13.1 Updating the profile

1. Click ⚙️ → change the name → **Save**
2. ✅ The new name appears in the avatar dropdown immediately

### 13.2 Changing the password

1. Settings → **Change password** → enter the current password + new one
2. ✅ Green confirmation
3. Logout + login with the new password → ✅ works

---

## Section 14 — Branding

1. Click 🎨 → change **Brand Name** (e.g. `MyDesk`)
2. Change **Accent Color** (e.g. `#e11d48`)
3. Upload a PNG/SVG logo
4. **Save**
5. ✅ The title, color, and logo change immediately across the whole interface

---

## Section 15 — Error scenarios

### 15.1 Agent offline

1. Stop the agent (`Ctrl+C`)
2. ✅ The machine goes Offline within ~30 seconds
3. Try Connect → ✅ Clear error "Machine not found"

### 15.2 Wrong password on connect

1. Connect on the online machine → wrong password
2. ✅ Error "Wrong ID or password"

### 15.3 Disconnection during a session

1. You are connected → stop the remote agent
2. ✅ The viewer shows "Remote machine disconnected"
3. ✅ You are returned to the dashboard

### 15.4 Quick reconnect

1. Restart the agent
2. ✅ The machine comes back Online within ~5 seconds
3. ✅ You can reconnect immediately

---

## Final report

| Section | Status | Notes |
|---|---|---|
| 1. Server installation | ☐ | |
| 2. Authentication | ☐ | |
| 3. Downloads | ☐ | |
| 4. Agent Linux | ☐ | |
| 4. Agent Windows | ☐ | |
| 5. Remote control (browser) | ☐ | |
| 6. Bidirectional clipboard | ☐ | |
| 7. File transfer | ☐ | |
| 8. Multi-monitor | ☐ | |
| 9. Desktop Viewer Linux | ☐ | |
| 9. Desktop Viewer Windows | ☐ | |
| 10. Android Viewer | ☐ | |
| 11. Org hierarchy | ☐ | |
| 12. API Keys | ☐ | |
| 13. Account settings | ☐ | |
| 14. Branding | ☐ | |
| 15. Error scenarios | ☐ | |

**Tested by:** _______________  
**Date:** _______________  
**Version:** _______________  
**Issues found:** _______________
