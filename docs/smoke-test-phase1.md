# Phase 1 Smoke Test

## Prerequisites

- Ubuntu 24.04 with Docker, Rust 1.78+, Node.js 20 installed
- Dev stack running: `cd deploy && docker compose -f docker-compose.dev.yml up -d`
- Signaling server healthy: `curl http://localhost:8001/health` → `{"status":"ok"}`

## Steps

1. **Start virtual display**
   ```bash
   Xvfb :99 -screen 0 1920x1080x24 &
   DISPLAY=:99 xterm &
   ```

2. **Start agent** — note the 9-digit peer_id in logs
   ```bash
   DISPLAY=:99 PEERDESK_PASSWORD=testpass123 SIGNALING_URL=ws://localhost:8001/ws \
     cargo run -p peerdesk-agent 2>&1 | tee /tmp/agent.log &
   sleep 3 && grep "peer_id=" /tmp/agent.log
   ```

3. **Start browser viewer**
   ```bash
   cd web && npm run dev
   ```

4. **Connect in browser**
   - Open `http://localhost:5173`
   - Enter the 9-digit peer_id from step 2
   - Enter password: `testpass123`
   - Click **Connect**

## Expected Results

- App transitions from "Connecting…" to full-screen video
- Video shows the Xvfb virtual display (xterm window visible)
- Moving mouse over video moves cursor on the remote display
- Typing into video sends keystrokes to the remote display
- Right-click works (right mouse button forwarded)
- Scroll wheel works
