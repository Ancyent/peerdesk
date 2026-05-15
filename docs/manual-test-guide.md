# PeerDesk — Ghid de Test Manual

**Scop:** Verificarea completă a platformei de la instalare până la control remote, din perspectiva unui utilizator nou care nu a mai folosit PeerDesk.

**Cine rulează:** QA / developer / utilizator final  
**Durată estimată:** 60–90 minute (cu 2 monitoare disponibile)  
**Cerințe minime:** Un server Linux + o mașină Windows sau Linux de controlat + un dispozitiv pentru viewer (browser / Android)

---

## Convenții

- ✅ = rezultat așteptat — bifează după verificare
- ❌ = problemă — notează comportamentul observat
- `[SERVER_IP]` = IP-ul sau domeniul serverului tău PeerDesk
- `[PEER_ID]` = ID-ul de 9 cifre al agentului

---

## Secțiunea 1 — Instalare server

### 1.1 Instalare fresh pe Linux

```bash
git clone https://github.com/Ancyent/peerdesk.git
cd peerdesk/deploy
docker compose up -d

curl http://[SERVER_IP]/api/health
curl http://[SERVER_IP]/ws/health
```

- ✅ Toate containerele în stare `Up` sau `healthy`
- ✅ `/api/health` returnează `{"status":"ok"}`
- ✅ `/ws/health` returnează `{"status":"ok"}`
- ✅ `http://[SERVER_IP]` deschide pagina de login în browser

---

## Secțiunea 2 — Cont și autentificare

### 2.1 Înregistrare cont nou

1. Deschide `http://[SERVER_IP]` în browser
2. Click **Register**
3. Completează: Email, Nume, Parolă (min 8 caractere, o cifră, o majusculă)
4. Click **Register**

- ✅ Ești redirecționat automat în dashboard
- ✅ Icon bar întunecat apare pe stânga cu iconuri: 💻 🏢 ⬇️ 🔑 📦 🎨 ⚙️
- ✅ Avatar cu inițiala numelui tău apare jos în icon bar

### 2.2 Logout și Login

1. Click avatar (jos în icon bar) → dropdown cu numele și email-ul
2. Click **Logout** → ✅ pagina de login
3. Introdu credențialele → ✅ dashboard-ul se redeschide

### 2.3 Parolă greșită

1. La login, introdu parola greșită
2. ✅ Eroare vizibilă — nu ești autentificat

---

## Secțiunea 3 — Download clienți

### 3.1 Pagina Downloads

1. Click 📦 (Download) în icon bar
2. ✅ Carduri pentru: Agent, Viewer Desktop, Android, Viewer Web
3. ✅ Link „Toate versiunile pe GitHub →" funcționează

### 3.2 Descarcă binarele

Du-te la `https://github.com/Ancyent/peerdesk/releases/latest` și descarcă:

| Platformă | Fișier |
|---|---|
| Agent Linux | `peerdesk-agent-linux-x86_64-vX.Y.Z` |
| Agent Windows | `peerdesk-agent-windows-x86_64-vX.Y.Z.exe` |
| Viewer Android | `peerdesk-android-vX.Y.Z.apk` |
| Viewer Linux | `peerdesk-viewer-linux-vX.Y.Z-amd64.deb` sau `.AppImage` |
| Viewer Windows | `peerdesk-viewer-windows-vX.Y.Z-x64-setup.exe` sau `.msi` |

---

## Secțiunea 4 — Instalare și înregistrare agent

### 4.1 Token de înregistrare (metoda recomandată)

1. Click ⬇️ (Instalare Agent) în dashboard
2. Selectează opțional o companie/locație
3. Click **Generează token de înregistrare**
4. ✅ Token de forma `XXXX-XXXX` apare cu countdown 24h
5. Copiază comanda din tab-ul platformei dorite

### 4.2 Agent pe Linux

```bash
chmod +x peerdesk-agent-linux-x86_64-vX.Y.Z

# Cu token:
PEERDESK_TOKEN=XXXX-XXXX \
PEERDESK_SERVER=ws://[SERVER_IP]/ws \
./peerdesk-agent-linux-x86_64-vX.Y.Z

# Sau standalone (fără server central):
PEERDESK_PASSWORD=parolamea \
SIGNALING_URL=ws://[SERVER_IP]/ws \
./peerdesk-agent-linux-x86_64-vX.Y.Z
```

- ✅ Log: `PeerDesk agent — peer_id=XXXXXXXXX` — **notează ID-ul!**
- ✅ Log: `Registered with signaling server`
- ✅ Mașina apare în dashboard

### 4.3 Agent pe Windows

```powershell
$env:PEERDESK_TOKEN="XXXX-XXXX"
$env:PEERDESK_SERVER="ws://[SERVER_IP]/ws"
.\peerdesk-agent-windows-x86_64-vX.Y.Z.exe
```

- ✅ Consola afișează peer_id-ul
- ✅ Mașina apare în dashboard

### 4.4 Aprobare mașinărie (dacă e Pending)

1. Click 💻 (Mașini) → tab **Pending**
2. Click **Approve** pe mașinăria nou înregistrată
3. ✅ Mașinăria trece la status Online (indicator verde 🟢)

---

## Secțiunea 5 — Conectare și control remote

### 5.1 Conectare din browser

1. Click **Connect** pe mașinăria online din dashboard
2. ✅ Formular cu peer_id pre-completat
3. Introdu parola agentului
4. Click **Connect**
5. ✅ Ecranul remote apare în câteva secunde
6. ✅ Video clar, nu pixelat sau înghețat

### 5.2 Cod de securitate DTLS

- ✅ Cod de 6 cifre afișat în viewer sau în log-ul agentului
- ✅ Codul se schimbă la fiecare sesiune nouă

### 5.3 Control mouse

Cu cursorul deasupra video-ului:

- Mișcă mouse-ul → ✅ cursorul se mișcă pe remote (cursorul local dispare)
- Click stânga → ✅ click înregistrat pe remote
- Click dreapta → ✅ meniu contextual apare pe remote (nu în browser)
- Scroll rotița → ✅ scroll funcționează pe remote

### 5.4 Control tastatură

Click o dată pe video pentru focus, apoi:

- Tastează litere/cifre → ✅ apar pe remote
- `Ctrl+C` / `Ctrl+V` → ✅ funcționează pe remote
- `Enter`, `Backspace`, `Tab` → ✅ funcționează
- `Alt+F4` (Windows remote) → ✅ închide fereastra activă pe remote

---

## Secțiunea 6 — Clipboard (Copy-Paste bidirecțional)

### 6.1 Local → Remote

1. Copiază un text pe mașina ta locală (`Ctrl+C`)
2. Click în viewer (focus pe remote)
3. `Ctrl+V` într-un câmp de text pe remote
4. ✅ Textul apare pe ecranul remote

### 6.2 Remote → Local

1. Pe ecranul remote, selectează și copiază text (`Ctrl+C`)
2. Pe mașina ta, `Ctrl+V` într-un câmp de text
3. ✅ Textul de pe remote apare local

---

## Secțiunea 7 — Transfer fișiere

### 7.1 Trimitere fișier mic (<5 MB)

1. În viewer activ, click **File Transfer** (bara de jos)
2. Selectează un fișier de pe mașina locală
3. ✅ Progress bar apare
4. ✅ Fișierul apare în folderul Downloads al mașinii remote
5. ✅ Mesaj de confirmare la final

### 7.2 Fișier mare (>20 MB)

1. Trimite un fișier de 20–50 MB
2. ✅ Transfer se finalizează fără erori
3. ✅ Dimensiunea fișierului primit = dimensiunea originalului

---

## Secțiunea 8 — Multi-monitor

> Mașina remotă trebuie să aibă 2+ monitoare conectate

### 8.1 Selectare display

1. Conectează-te la mașina cu multiple monitoare
2. ✅ Dropdown apare în colțul stânga-sus: `Monitor 1 (1920×1080) ★ ▼`
3. Selectează **Monitor 2**
4. ✅ Viewer-ul trece la al doilea monitor în 1-2 secunde
5. Selectează înapoi Monitor 1
6. ✅ Revine la monitorul principal

### 8.2 Verificare rezoluție și control

- ✅ Rezoluțiile din dropdown corespund realității
- ✅ Monitorul primar are marcajul ★
- ✅ Mouse funcționează corect după switch

---

## Secțiunea 9 — Viewer Desktop (Tauri)

### 9.1 Linux

```bash
# .deb:
sudo dpkg -i peerdesk-viewer-linux-vX.Y.Z-amd64.deb

# .AppImage:
chmod +x peerdesk-viewer-linux-vX.Y.Z.AppImage && ./peerdesk-viewer-linux-vX.Y.Z.AppImage
```

- ✅ Aplicația pornește cu icon în system tray
- ✅ Dashboard identic cu versiunea browser
- ✅ Conectare la agent funcționează
- ✅ Click dreapta tray → Show / Quit

### 9.2 Windows

1. Rulează `peerdesk-viewer-windows-vX.Y.Z-x64-setup.exe`
2. Urmează wizard-ul de instalare
3. ✅ PeerDesk apare în Start Menu și system tray
4. ✅ Funcționalitate identică cu browser-ul

---

## Secțiunea 10 — Viewer Android

### 10.1 Instalare

1. Activează **Surse necunoscute** (Settings → Security)
2. Instalează `peerdesk-android-vX.Y.Z.apk`
3. ✅ Aplicația apare în launcher

### 10.2 Conectare de pe Android

1. Autentifică-te cu contul tău
2. ✅ Dashboard cu lista de mașini
3. Click **Connect** pe o mașinărie online
4. ✅ Ecranul remote apare pe telefon
5. Atinge ecranul → ✅ mouse se mișcă pe remote
6. Touch and hold → ✅ click dreapta pe remote
7. Pinch → ✅ zoom în/out pe viewer
8. Tastatură virtuală → ✅ input ajunge pe remote

---

## Secțiunea 11 — Organizare (Companies / Locations / Groups)

### 11.1 Creare structură

1. Click 🏢 (Organizare)
2. Click **+** → introdu `Firma Mea` → Enter
3. ✅ Compania apare în arbore stânga
4. Expand companie → **+** → adaugă locație `Sediu Central`
5. Expand locație → **+** → adaugă grup `IT Department`
6. ✅ Arbore: Firma Mea → Sediu Central → IT Department

### 11.2 Plasare mașinărie

1. Click 💻 (Mașini) → pe o mașinărie click **···**
2. Selectează grupul IT Department
3. Click 🏢 → selectează IT Department
4. ✅ Mașinăria apare filtrată în grupul selectat

---

## Secțiunea 12 — API Keys

### 12.1 Creare și test

1. Click 🔑 → **Create Key** → introdu `Test Key`
2. ✅ Key-ul generat apare o singură dată — **copiază-l!**
3. Testează:
   ```bash
   curl -H "X-API-Key: [KEY]" http://[SERVER_IP]/api/machines
   ```
4. ✅ Lista de mașini returnată în JSON

### 12.2 Revocare

1. Click **Revoke** pe key
2. ✅ Key-ul dispare din listă
3. Testează din nou → ✅ `401 Unauthorized`

---

## Secțiunea 13 — Setări cont

### 13.1 Actualizare profil

1. Click ⚙️ → schimbă numele → **Salvează**
2. ✅ Numele nou apare în avatar dropdown imediat

### 13.2 Schimbare parolă

1. Setări → **Schimbă parola** → introdu parola curentă + nouă
2. ✅ Confirmare verde
3. Logout + login cu parola nouă → ✅ funcționează

---

## Secțiunea 14 — Branding

1. Click 🎨 → schimbă **Brand Name** (ex: `MyDesk`)
2. Schimbă **Accent Color** (ex: `#e11d48`)
3. Uploadează logo PNG/SVG
4. **Salvează**
5. ✅ Titlul, culoarea și logo-ul se schimbă imediat în toată interfața

---

## Secțiunea 15 — Scenarii de eroare

### 15.1 Agent offline

1. Oprește agentul (`Ctrl+C`)
2. ✅ Mașina trece la Offline în ~30 secunde
3. Încearcă Connect → ✅ Eroare clară „Machine not found"

### 15.2 Parolă greșită la conectare

1. Connect pe mașina online → parolă greșită
2. ✅ Eroare „Wrong ID or password"

### 15.3 Deconectare în timpul sesiunii

1. Ești conectat → oprești agentul remote
2. ✅ Viewer afișează „Remote machine disconnected"
3. ✅ Ești întors în dashboard

### 15.4 Reconectare rapidă

1. Repornești agentul
2. ✅ Mașina revine Online în ~5 secunde
3. ✅ Poți reconecta imediat

---

## Raport final

| Secțiune | Status | Observații |
|---|---|---|
| 1. Instalare server | ☐ | |
| 2. Autentificare | ☐ | |
| 3. Downloads | ☐ | |
| 4. Agent Linux | ☐ | |
| 4. Agent Windows | ☐ | |
| 5. Control remote (browser) | ☐ | |
| 6. Clipboard bidirecțional | ☐ | |
| 7. File transfer | ☐ | |
| 8. Multi-monitor | ☐ | |
| 9. Viewer Desktop Linux | ☐ | |
| 9. Viewer Desktop Windows | ☐ | |
| 10. Viewer Android | ☐ | |
| 11. Org hierarchy | ☐ | |
| 12. API Keys | ☐ | |
| 13. Setări cont | ☐ | |
| 14. Branding | ☐ | |
| 15. Scenarii eroare | ☐ | |

**Testat de:** _______________  
**Data:** _______________  
**Versiunea:** _______________  
**Probleme găsite:** _______________
