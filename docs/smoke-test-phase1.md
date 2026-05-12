# Phase 1 Smoke Test

## Prerequisites

- [ ] Ubuntu 24.04 LXC cu Docker, Rust 1.95+, Node.js 20 instalat
- [ ] Portul 8001 (signaling) și 5173 (web) accesibile din rețea
- [ ] Dacă testezi de pe alt PC: înlocuiește `localhost` cu IP-ul serverului

---

## Pasul 1 — Pornește stack-ul Docker (signaling + Redis)

```bash
cd /root/peerdesk/deploy
docker compose -f docker-compose.dev.yml up -d
```

- [ ] Verifică că serviciile sunt healthy:
  ```bash
  docker compose -f docker-compose.dev.yml ps
  curl -s http://localhost:8001/health
  ```
  Rezultat așteptat: `{"status":"ok"}`

---

## Pasul 2 — Pornește display-ul virtual (Xvfb)

```bash
# Oprește orice instanță anterioară
pkill -f "Xvfb :99" 2>/dev/null; sleep 1
rm -f /tmp/.X99-lock

# Pornește Xvfb + window manager + terminal
Xvfb :99 -screen 0 1920x1080x24 &
sleep 2
apt-get install -y fluxbox 2>/dev/null | tail -1
DISPLAY=:99 fluxbox &
sleep 1
DISPLAY=:99 xterm &
```

- [ ] Xvfb pornit fără erori `Fatal server error`
- [ ] xterm deschis pe display-ul :99 (nu trebuie să fie vizibil local)

---

## Pasul 3 — Pornește agentul Rust

```bash
cd /root/peerdesk
source ~/.cargo/env

DISPLAY=:99 \
PEERDESK_PASSWORD=testpass123 \
SIGNALING_URL=ws://localhost:8001/ws \
  cargo run -p peerdesk-agent 2>&1 | tee /tmp/agent.log &

sleep 4
grep "peer_id=" /tmp/agent.log
```

- [ ] Log apare: `PeerDesk agent — peer_id=XXXXXXXXX`
- [ ] Log apare: `Registered with signaling server, peer_id=XXXXXXXXX`
- [ ] **Notează peer_id-ul** (9 cifre) — vei avea nevoie la pasul următor

---

## Pasul 4 — Pornește viewer-ul web

```bash
source ~/.nvm/nvm.sh && nvm use 20
cd /root/peerdesk/web
npm run dev -- --host 0.0.0.0
```

- [ ] Output conține: `Local: http://localhost:5173` sau `Network: http://<IP>:5173`

> **De pe alt PC:** folosește adresa `Network:` în browser

---

## Pasul 5 — Conectează-te din browser

Deschide `http://localhost:5173` (sau `http://<IP-SERVER>:5173` de pe alt PC).

- [ ] Pagina PeerDesk se încarcă cu formularul de conectare
- [ ] Introdu peer_id-ul de la Pasul 3 (9 cifre)
- [ ] Introdu parola: `testpass123`
- [ ] Apasă **Connect**
- [ ] Aplicația trece la starea „Connecting…"

---

## Pasul 6 — Verifică conexiunea WebRTC

În log-urile agentului (`/tmp/agent.log` sau terminalul unde rulează):

- [ ] `Viewer XXXXXXXX joined — waiting for WebRTC offer`
- [ ] `Got offer — creating answer`
- [ ] `ICE connection state changed: connected`
- [ ] `peer connection state changed: connected`

---

## Pasul 7 — Verifică video-ul

- [ ] Browser-ul afișează un ecran (nu mai e „Connecting…")
- [ ] Video-ul arată display-ul virtual (fundal negru cu xterm deschis)
- [ ] Rezoluția video e clară (nu pixelat sau înghețat)

---

## Pasul 8 — Verifică input-ul

Mișcă mouse-ul **deasupra** video-ului din browser:

- [ ] Cursorul devine invizibil pe overlay (cursor:none activ)
- [ ] Cursorul se mișcă pe display-ul remote (vizibil în xterm dacă e focusat)

Apasă o tastă (ex: `a`, `b`, `Enter`):

- [ ] Caracterele apar în xterm-ul de pe display-ul remote

Click stânga în xterm:

- [ ] xterm primește focusul

Click dreapta:

- [ ] Meniul contextual al xterm-ului apare pe display-ul remote (nu în browser)

Scroll cu rotița mouse-ului:

- [ ] Scroll funcționează în xterm

---

## Rezultate așteptate — rezumat

| Test | Rezultat așteptat |
|------|-------------------|
| Signaling health | `{"status":"ok"}` |
| Agent pornit | peer_id logat, connected to signaling |
| WebRTC handshake | ICE connected, peer connection connected |
| Video stream | Display virtual vizibil în browser |
| Mouse move | Cursor se mișcă pe remote |
| Keyboard input | Taste apar în xterm |
| Left click | xterm focusat |
| Right click | Meniu contextual pe remote |
| Scroll | Scroll funcționează |

---

## Troubleshooting

**Ecran negru în browser**
- Verifică că `fluxbox` și `xterm` rulează: `DISPLAY=:99 xterm &`
- Verifică că agentul a primit frame-uri: nu trebuie erori `H264Encoder init failed` în log

**„Machine not found" sau „Wrong ID or password"**
- Verifică că peer_id-ul e exact 9 cifre
- Verifică că parola e `testpass123` (același string cu `PEERDESK_PASSWORD`)
- Verifică că agentul e conectat la signaling: `Registered with signaling server`

**ICE nu se conectează (rămâne în „checking")**
- LXC/NAT poate bloca UDP; testează pe localhost unde nu există NAT
- STUN pe IPv6 poate eșua (warning normal în LXC) — IPv4 trebuie să funcționeze

**Input nu ajunge pe remote**
- Asigură-te că mouse-ul a intrat pe overlay (auto-focus la `mouseenter`)
- Verifică că xterm e deschis pe `:99`: `DISPLAY=:99 xterm &`
- Pe LXC fără desktop: enigo necesită `libxdo-dev` instalat (`apt-get install -y libxdo-dev`)
