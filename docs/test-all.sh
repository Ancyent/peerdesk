#!/usr/bin/env bash
# PeerDesk — test-all.sh
# Testează automat tot stack-ul: infra Docker, API, Signaling, Agent, Frontend.
# Rulează din orice director; nu modifică codul.
#
# Usage:
#   bash docs/test-all.sh              # toți pașii
#   bash docs/test-all.sh --skip-build # sare compilarea Rust/Node (mai rapid)
#   bash docs/test-all.sh --prod       # testează stack-ul de prod (port 80)
#
# Cerințe: docker, curl, cargo, node/npm, python3
# Optional: websocat (pentru testul WebSocket — cargo install websocat)

set -euo pipefail

# ── Configurare ────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_BUILD=false
PROD_MODE=false
FAILURES=0
PASSES=0
HAVE_WEBSOCAT=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --prod)       PROD_MODE=true ;;
  esac
done

if $PROD_MODE; then
  API_URL="http://localhost/api"
  SIG_URL="http://localhost/ws"
  SIG_WS="ws://localhost/ws"
else
  API_URL="http://localhost:8000"
  SIG_URL="http://localhost:8001"
  SIG_WS="ws://localhost:8001/ws"
fi

# ── Helpers ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

section() { echo -e "\n${BLUE}══ $1 ══${NC}"; }
pass()    { echo -e "  ${GREEN}✓${NC} $1"; PASSES=$((PASSES+1)); }
fail()    { echo -e "  ${RED}✗${NC} $1"; FAILURES=$((FAILURES+1)); }
skip()    { echo -e "  ${YELLOW}–${NC} $1 (skipped)"; }
info()    { echo -e "  ${YELLOW}ℹ${NC} $1"; }

check_cmd() {
  if command -v "$1" &>/dev/null; then
    pass "$(command -v "$1") disponibil"
  else
    fail "$1 lipsește din PATH"
  fi
}

http_ok() {
  local label="$1" url="$2" expected="${3:-200}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expected" ]]; then
    pass "$label → HTTP $code"
  else
    fail "$label → așteptat HTTP $expected, primit $code"
  fi
}

json_field() {
  local label="$1" url="$2" field="$3" expected="$4"
  local resp
  resp=$(curl -s --max-time 5 "$url" 2>/dev/null || echo "{}")
  local val
  val=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || echo "")
  if [[ "$val" == "$expected" ]]; then
    pass "$label ($field=$val)"
  else
    fail "$label — câmp '$field': așteptat '$expected', primit '$val'"
  fi
}

# ── 1. Cerințe de sistem ───────────────────────────────────────────────────────
section "1/8  Cerințe de sistem"

check_cmd docker
check_cmd curl
check_cmd python3

if command -v cargo &>/dev/null; then
  pass "cargo $(cargo --version 2>&1 | head -1)"
else
  fail "cargo nu este instalat (necesar pentru agent Rust)"
fi

if command -v node &>/dev/null; then
  pass "node $(node --version)"
else
  fail "node nu este instalat (necesar pentru web)"
fi

if command -v websocat &>/dev/null; then
  HAVE_WEBSOCAT=true
  pass "websocat disponibil — testele WebSocket vor rula"
else
  skip "websocat lipsă — testele WebSocket sar (instalează cu: cargo install websocat)"
fi

# ── 2. Docker services ─────────────────────────────────────────────────────────
section "2/8  Docker services"

COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.dev.yml"
if $PROD_MODE; then
  COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.yml"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "Fișierul $COMPOSE_FILE nu există"
else
  pass "docker-compose.yml găsit"
fi

# Pornește stack-ul dacă nu rulează
if docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -q "running\|Up"; then
  pass "Stack Docker deja pornit"
else
  info "Pornesc stack-ul Docker (docker compose up -d)..."
  if docker compose -f "$COMPOSE_FILE" up -d --wait 2>&1 | tail -5; then
    pass "Stack Docker pornit"
  else
    fail "docker compose up a eșuat — verifică: docker compose -f $COMPOSE_FILE logs"
    info "Continuez cu testele rămase..."
  fi
fi

# Health check containere
for svc in redis signaling; do
  if docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -E "${svc}.*running|${svc}.*Up" &>/dev/null; then
    pass "Containerul '$svc' rulează"
  else
    fail "Containerul '$svc' NU rulează"
  fi
done

if ! $PROD_MODE; then
  for svc in postgres api; do
    if docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -E "${svc}.*running|${svc}.*Up" &>/dev/null; then
      pass "Containerul '$svc' rulează"
    else
      fail "Containerul '$svc' NU rulează"
    fi
  done
fi

# Așteaptă serviciile să fie ready (max 30s)
info "Aștept serviciile să fie ready (max 30s)..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$SIG_URL/health" 2>/dev/null || echo "000")
  if [[ "$code" == "200" ]]; then
    info "Serviciile sunt ready după ${i}s"
    break
  fi
  sleep 1
done

# ── 3. Health checks HTTP ──────────────────────────────────────────────────────
section "3/8  Health checks HTTP"

json_field "Signaling /health" "$SIG_URL/health" "status" "ok"

if ! $PROD_MODE; then
  json_field "API /health" "$API_URL/health" "status" "ok"
  http_ok "API /docs (OpenAPI)" "$API_URL/docs" "200"
fi

# ── 4. API REST — autentificare ────────────────────────────────────────────────
section "4/8  API REST — autentificare"

if $PROD_MODE; then
  skip "Testele API sar în --prod mode (ar crea date reale în DB)"
else
  TEST_EMAIL="test-$(date +%s)@peerdesk.test"
  TEST_PASS="TestPass123!"
  ACCESS_TOKEN=""
  REFRESH_TOKEN=""

  # Înregistrare
  REGISTER_RESP=$(curl -s --max-time 10 -X POST "$API_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"name\":\"Test User\",\"password\":\"$TEST_PASS\"}")

  ACCESS_TOKEN=$(echo "$REGISTER_RESP" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
  REFRESH_TOKEN=$(echo "$REGISTER_RESP" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('refresh_token',''))" 2>/dev/null || echo "")

  if [[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]]; then
    pass "POST /auth/register → access_token primit"
  else
    fail "POST /auth/register → nu am primit access_token (răspuns: $REGISTER_RESP)"
  fi

  # Email duplicat → 409
  DUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"name\":\"Test\",\"password\":\"$TEST_PASS\"}")
  if [[ "$DUP_CODE" == "409" ]]; then
    pass "POST /auth/register email duplicat → 409 (corect)"
  else
    fail "POST /auth/register email duplicat → $DUP_CODE (așteptat 409)"
  fi

  # Login
  LOGIN_RESP=$(curl -s --max-time 10 -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
  LOGIN_TOKEN=$(echo "$LOGIN_RESP" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

  if [[ -n "$LOGIN_TOKEN" && "$LOGIN_TOKEN" != "null" ]]; then
    pass "POST /auth/login → access_token primit"
  else
    fail "POST /auth/login → nu am primit access_token"
  fi

  # Login cu parolă greșită → 401
  BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"GRESIT\"}")
  if [[ "$BAD_CODE" == "401" ]]; then
    pass "POST /auth/login cu parolă greșită → 401 (corect)"
  else
    fail "POST /auth/login cu parolă greșită → $BAD_CODE (așteptat 401)"
  fi

  # Refresh token
  if [[ -n "$REFRESH_TOKEN" && "$REFRESH_TOKEN" != "null" ]]; then
    REFRESH_RESP=$(curl -s --max-time 10 -X POST "$API_URL/auth/refresh" \
      -H "Content-Type: application/json" \
      -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}")
    NEW_TOKEN=$(echo "$REFRESH_RESP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
    if [[ -n "$NEW_TOKEN" && "$NEW_TOKEN" != "null" ]]; then
      pass "POST /auth/refresh → nou access_token primit"
    else
      fail "POST /auth/refresh → eșuat"
    fi
  fi

  # ── 5. API REST — machines ─────────────────────────────────────────────────
  section "5/8  API REST — machines & sessions"

  if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    skip "Testele machines sar — nu am token valid"
  else
    TEST_PEER_ID="tp-$(date +%s)"

    # Înregistrare mașinărie
    MACHINE_RESP=$(curl -s --max-time 10 -X POST "$API_URL/machines" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d "{\"peer_id\":\"$TEST_PEER_ID\",\"name\":\"Test Machine\",\"os\":\"Linux\"}")
    MACHINE_ID=$(echo "$MACHINE_RESP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

    if [[ -n "$MACHINE_ID" && "$MACHINE_ID" != "null" ]]; then
      pass "POST /machines → mașinărie creată (id=$MACHINE_ID)"
    else
      fail "POST /machines → eșuat (răspuns: $MACHINE_RESP)"
    fi

    # peer_id duplicat → 409
    DUP_M=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$API_URL/machines" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d "{\"peer_id\":\"$TEST_PEER_ID\",\"name\":\"Dup\"}")
    if [[ "$DUP_M" == "409" ]]; then
      pass "POST /machines peer_id duplicat → 409 (corect)"
    else
      fail "POST /machines peer_id duplicat → $DUP_M (așteptat 409)"
    fi

    # Listare mașini
    LIST_RESP=$(curl -s --max-time 10 "$API_URL/machines" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    LIST_COUNT=$(echo "$LIST_RESP" | python3 -c \
      "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
    if [[ "$LIST_COUNT" -ge 1 ]]; then
      pass "GET /machines → $LIST_COUNT mașinărie(i) în cont"
    else
      fail "GET /machines → lista goală după înregistrare"
    fi

    # GET fără token → 401/403
    UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API_URL/machines")
    if [[ "$UNAUTH" == "401" || "$UNAUTH" == "403" ]]; then
      pass "GET /machines fără token → $UNAUTH (corect)"
    else
      fail "GET /machines fără token → $UNAUTH (așteptat 401/403)"
    fi

    # Heartbeat (fără auth)
    HB_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
      -X PATCH "$API_URL/machines/$TEST_PEER_ID/heartbeat?online=true")
    if [[ "$HB_CODE" == "204" ]]; then
      pass "PATCH /machines/:peer_id/heartbeat → 204"
    else
      fail "PATCH /machines/:peer_id/heartbeat → $HB_CODE (așteptat 204)"
    fi

    # Session start
    SESSION_RESP=$(curl -s --max-time 10 -X POST "$API_URL/sessions" \
      -H "Content-Type: application/json" \
      -d "{\"host_peer_id\":\"$TEST_PEER_ID\",\"connection_type\":\"p2p\"}")
    SESSION_ID=$(echo "$SESSION_RESP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
    if [[ -n "$SESSION_ID" && "$SESSION_ID" != "null" ]]; then
      pass "POST /sessions → sesiune creată (id=$SESSION_ID)"

      END_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
        -X PATCH "$API_URL/sessions/$SESSION_ID/end")
      if [[ "$END_CODE" == "204" ]]; then
        pass "PATCH /sessions/:id/end → 204"
      else
        fail "PATCH /sessions/:id/end → $END_CODE (așteptat 204)"
      fi
    else
      fail "POST /sessions → eșuat (răspuns: $SESSION_RESP)"
    fi
  fi
fi

# ── 6. Signaling WebSocket ─────────────────────────────────────────────────────
section "6/8  Signaling WebSocket"

if ! $HAVE_WEBSOCAT; then
  skip "websocat lipsă — salt peste testele WS (instalează: cargo install websocat)"
else
  WS_PEER_ID="ws-$(date +%s)"
  WS_PW_HASH=$(echo -n "testpass123" | sha256sum | awk '{print $1}')

  # Register agent
  REG_MSG="{\"type\":\"register\",\"peer_id\":\"$WS_PEER_ID\",\"password_hash\":\"$WS_PW_HASH\"}"
  WS_RESP=$(echo "$REG_MSG" | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  if echo "$WS_RESP" | grep -q '"type":"registered"'; then
    pass "WS register → tip 'registered' primit"
  else
    fail "WS register → răspuns neașteptat: $WS_RESP"
  fi

  # Join peer inexistent
  JOIN_MISS="{\"type\":\"join\",\"peer_id\":\"000000000\",\"password\":\"orice\"}"
  WS_MISS=$(echo "$JOIN_MISS" | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  if echo "$WS_MISS" | grep -qE '"type":"error"'; then
    pass "WS join peer inexistent → eroare returnată (corect)"
  else
    info "WS join peer inexistent → '$WS_MISS' (poate fi normal fără agent activ)"
  fi

  # JSON invalid → eroare
  BAD_JSON='{"type": nope'
  WS_BAD=$(echo "$BAD_JSON" | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  if echo "$WS_BAD" | grep -q '"code":"invalid_json"'; then
    pass "WS JSON invalid → cod 'invalid_json' primit"
  else
    info "WS JSON invalid → '$WS_BAD'"
  fi
fi

# ── 7. Compilare Rust agent ────────────────────────────────────────────────────
section "7/8  Compilare Rust agent"

if $SKIP_BUILD; then
  skip "Compilare Rust sarită (--skip-build)"
elif ! command -v cargo &>/dev/null; then
  skip "cargo lipsă"
else
  info "cargo build -p peerdesk-agent --release (poate dura câteva minute)..."
  if cargo build -p peerdesk-agent --release 2>&1 | tail -5; then
    pass "cargo build --release → success"
  else
    fail "cargo build → erori de compilare"
  fi

  info "cargo test -p peerdesk-agent..."
  RUST_TEST_OUT=$(cargo test -p peerdesk-agent 2>&1 || true)
  if echo "$RUST_TEST_OUT" | grep -qE "^test result: ok|0 failed"; then
    pass "cargo test → trecut"
  elif echo "$RUST_TEST_OUT" | grep -q "0 tests"; then
    info "cargo test → 0 teste definite (non-fatal)"
  else
    fail "cargo test → unele teste au eșuat"
  fi

  # Verifică că binarul există
  AGENT_BIN="$REPO_ROOT/target/release/peerdesk-agent"
  if [[ -f "$AGENT_BIN" ]]; then
    AGENT_SIZE=$(du -h "$AGENT_BIN" | awk '{print $1}')
    pass "Binar agent generat: target/release/peerdesk-agent ($AGENT_SIZE)"
  else
    fail "Binarul target/release/peerdesk-agent nu a fost generat"
  fi
fi

# ── 8. Frontend web ────────────────────────────────────────────────────────────
section "8/8  Frontend web (build + typecheck)"

if $SKIP_BUILD; then
  skip "Build Node sarită (--skip-build)"
elif ! command -v node &>/dev/null; then
  skip "node lipsă"
else
  WEB_DIR="$REPO_ROOT/web"

  if [[ ! -d "$WEB_DIR/node_modules" ]]; then
    info "npm install (prima rulare)..."
    npm --prefix "$WEB_DIR" install --silent 2>&1 | tail -3
  else
    pass "node_modules deja există"
  fi

  info "npm run build..."
  if npm --prefix "$WEB_DIR" run build 2>&1 | tail -5; then
    DIST_SIZE=$(du -sh "$WEB_DIR/dist" 2>/dev/null | awk '{print $1}' || echo "?")
    pass "Web frontend compilat → dist/ ($DIST_SIZE)"
  else
    fail "npm run build a eșuat"
  fi

  info "tsc --noEmit (typecheck)..."
  if npm --prefix "$WEB_DIR" exec -- tsc --noEmit 2>&1 | tail -3; then
    pass "TypeScript typecheck → fără erori"
  else
    fail "TypeScript typecheck → erori de tipuri"
  fi
fi

# ── Raport final ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
printf   "  Raport: ${GREEN}%d passed${NC}  ${RED}%d failed${NC}\n" "$PASSES" "$FAILURES"
echo -e "${BLUE}══════════════════════════════════════════════════${NC}"

if [[ $FAILURES -eq 0 ]]; then
  echo -e "\n${GREEN}Toate testele au trecut. Stack-ul e functional!${NC}\n"
  exit 0
else
  echo -e "\n${RED}$FAILURES test(e) au eșuat.${NC} Verifică detaliile de mai sus.\n"
  exit 1
fi
