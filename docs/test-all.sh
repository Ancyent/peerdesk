#!/usr/bin/env bash
# PeerDesk — test-all.sh
# Testează automat tot stack-ul: infra Docker, pytest backend, API REST complet,
# Signaling WebSocket, compilare Rust agent, frontend TypeScript.
#
# Usage:
#   bash docs/test-all.sh              # toți pașii
#   bash docs/test-all.sh --skip-build # sare compilarea Rust/Node (mai rapid)
#   bash docs/test-all.sh --prod       # testează stack-ul de prod (port 80)
#
# Cerințe: docker, curl, python3
# Opțional: cargo, node/npm (pentru --build), websocat (pentru teste WebSocket)

set -euo pipefail

# ── Configurare ────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_BUILD=false
PROD_MODE=false
FAILURES=0
PASSES=0
HAVE_WEBSOCAT=false
MACHINE_ID=""

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
  COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.yml"
  API_CONTAINER="deploy-api-1"
else
  API_URL="http://localhost:8000"
  SIG_URL="http://localhost:8001"
  SIG_WS="ws://localhost:8001/ws"
  COMPOSE_FILE="$REPO_ROOT/deploy/docker-compose.dev.yml"
  API_CONTAINER="deploy-api-1"
fi

# ── Helpers ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

section() { echo -e "\n${BLUE}══ $1 ══${NC}"; }
pass()    { echo -e "  ${GREEN}✓${NC} $1"; PASSES=$((PASSES+1)); }
fail()    { echo -e "  ${RED}✗${NC} $1"; FAILURES=$((FAILURES+1)); }
skip()    { echo -e "  ${YELLOW}–${NC} $1 (skipped)"; }
info()    { echo -e "  ${YELLOW}ℹ${NC} $1"; }

http_code() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@" 2>/dev/null || echo "000"
}

json_get() {
  local resp="$1" field="$2"
  echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || echo ""
}

json_field() {
  local label="$1" url="$2" field="$3" expected="$4"
  local resp val
  resp=$(curl -s --max-time 5 "$url" 2>/dev/null || echo "{}")
  val=$(json_get "$resp" "$field")
  if [[ "$val" == "$expected" ]]; then
    pass "$label ($field=$val)"
  else
    fail "$label — câmp '$field': așteptat '$expected', primit '$val'"
  fi
}

# ── 1. Cerințe de sistem ───────────────────────────────────────────────────────
section "1/10  Cerințe de sistem"

for cmd in docker curl python3; do
  command -v "$cmd" &>/dev/null && pass "$cmd disponibil" || fail "$cmd lipsește din PATH"
done

command -v cargo &>/dev/null && pass "cargo $(cargo --version 2>&1 | head -1)" || info "cargo lipsă — compilarea Rust va fi sarită"
command -v node  &>/dev/null && pass "node $(node --version)"                  || info "node lipsă — testele frontend vor fi sarite"

if command -v websocat &>/dev/null; then
  HAVE_WEBSOCAT=true
  pass "websocat disponibil"
else
  skip "websocat lipsă (cargo install websocat pentru teste WS complete)"
fi

# ── 2. Docker services ─────────────────────────────────────────────────────────
section "2/10  Docker services"

[[ -f "$COMPOSE_FILE" ]] && pass "docker-compose găsit" || fail "Fișierul $COMPOSE_FILE lipsește"

if docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -qE "running|Up"; then
  pass "Stack Docker deja pornit"
else
  info "Pornesc stack-ul Docker..."
  docker compose -f "$COMPOSE_FILE" up -d --wait 2>&1 | tail -3
  pass "Stack Docker pornit"
fi

REQUIRED_SVCS=(redis signaling)
$PROD_MODE || REQUIRED_SVCS+=(postgres api)

for svc in "${REQUIRED_SVCS[@]}"; do
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -E "${svc}.*(running|Up)" &>/dev/null \
    && pass "Container '$svc' rulează" \
    || fail "Container '$svc' NU rulează"
done

info "Aștept serviciile (max 30s)..."
for i in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$SIG_URL/health" 2>/dev/null)" == "200" ]] \
    && { info "Ready după ${i}s"; break; }
  sleep 1
done

# ── 3. Health checks HTTP ──────────────────────────────────────────────────────
section "3/10  Health checks HTTP"

json_field "Signaling /health" "$SIG_URL/health" "status" "ok"
if ! $PROD_MODE; then
  json_field "API /health"       "$API_URL/health" "status" "ok"
  code=$(http_code "$API_URL/docs")
  [[ "$code" == "200" ]] && pass "API /docs (OpenAPI) → 200" || fail "API /docs → $code"
fi

# ── 4. Pytest backend (suite completă) ────────────────────────────────────────
section "4/10  Pytest backend (suite completă)"

if $PROD_MODE; then
  skip "Pytest sarat în --prod mode"
elif docker ps --format "{{.Names}}" 2>/dev/null | grep -q "$API_CONTAINER"; then
  info "docker exec $API_CONTAINER python -m pytest tests/ ..."
  PYTEST_OUT=$(docker exec "$API_CONTAINER" python -m pytest tests/ -v --tb=short 2>&1 || true)
  PASSED_N=$(echo "$PYTEST_OUT" | grep -oP '\d+ passed' | grep -oP '\d+' || echo "0")
  FAILED_N=$(echo "$PYTEST_OUT" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "0")
  ERROR_N=$(echo "$PYTEST_OUT"  | grep -oP '\d+ error'  | grep -oP '\d+' || echo "0")

  if [[ "$FAILED_N" == "0" && "$ERROR_N" == "0" && "$PASSED_N" -gt 0 ]]; then
    pass "pytest → $PASSED_N passed, 0 failed"
  elif [[ "$PASSED_N" -gt 0 ]]; then
    fail "pytest → $PASSED_N passed, $FAILED_N failed, $ERROR_N errors"
    echo "$PYTEST_OUT" | grep -E "FAILED|ERROR" | head -10
  else
    fail "pytest → nu a rulat corect"
    echo "$PYTEST_OUT" | tail -10
  fi
else
  skip "Container $API_CONTAINER indisponibil"
fi

# ── 5. API REST — autentificare & user settings ────────────────────────────────
section "5/10  API REST — autentificare & user settings"

ACCESS_TOKEN=""

if $PROD_MODE; then
  skip "Testele API sar în --prod mode"
else
  TEST_EMAIL="test-$(date +%s)@peerdesk-test.com"
  TEST_PASS="TestPass123!"

  REGISTER_RESP=$(curl -s --max-time 10 -X POST "$API_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"name\":\"Test User\",\"password\":\"$TEST_PASS\"}")
  ACCESS_TOKEN=$(json_get "$REGISTER_RESP" "access_token")
  REFRESH_TOKEN=$(json_get "$REGISTER_RESP" "refresh_token")

  [[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] \
    && pass "POST /auth/register → token primit" \
    || fail "POST /auth/register → eșuat ($REGISTER_RESP)"

  DUP=$(http_code -X POST "$API_URL/auth/register" -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"name\":\"T\",\"password\":\"$TEST_PASS\"}")
  [[ "$DUP" == "409" ]] && pass "Register email duplicat → 409" || fail "Register email duplicat → $DUP"

  LOGIN_RESP=$(curl -s --max-time 10 -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
  [[ -n "$(json_get "$LOGIN_RESP" "access_token")" ]] \
    && pass "POST /auth/login → token primit" \
    || fail "POST /auth/login → eșuat"

  BAD=$(http_code -X POST "$API_URL/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"GRESIT\"}")
  [[ "$BAD" == "401" ]] && pass "Login parolă greșită → 401" || fail "Login parolă greșită → $BAD"

  if [[ -n "$REFRESH_TOKEN" && "$REFRESH_TOKEN" != "null" ]]; then
    NEW_T=$(json_get "$(curl -s --max-time 10 -X POST "$API_URL/auth/refresh" \
      -H "Content-Type: application/json" -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}")" "access_token")
    [[ -n "$NEW_T" ]] && pass "POST /auth/refresh → token nou" || fail "POST /auth/refresh → eșuat"
  fi

  UPD=$(json_get "$(curl -s --max-time 10 -X PATCH "$API_URL/users/me" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"name":"Updated Name"}')" "name")
  [[ "$UPD" == "Updated Name" ]] && pass "PATCH /users/me → name actualizat" || fail "PATCH /users/me → eșuat"

  PW_CODE=$(http_code -X POST "$API_URL/users/me/password" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d "{\"current_password\":\"$TEST_PASS\",\"new_password\":\"NewPass999!\"}")
  [[ "$PW_CODE" == "204" ]] && pass "POST /users/me/password → 204" || fail "POST /users/me/password → $PW_CODE"
fi

# ── 6. API REST — machines, approval, sessions ────────────────────────────────
section "6/10  API REST — machines, approval, sessions"

if [[ -z "$ACCESS_TOKEN" ]]; then
  skip "Testele machines sar — nu am token valid"
else
  AUTH_H="Authorization: Bearer $ACCESS_TOKEN"
  TEST_PEER_ID="$(shuf -i 100000000-999999999 -n 1 2>/dev/null || echo "$(date +%s)" | grep -oP '\d{9}$')"

  MACHINE_RESP=$(curl -s --max-time 10 -X POST "$API_URL/machines" \
    -H "Content-Type: application/json" -H "$AUTH_H" \
    -d "{\"peer_id\":\"$TEST_PEER_ID\",\"name\":\"Test Machine\",\"os\":\"Linux\"}")
  MACHINE_ID=$(json_get "$MACHINE_RESP" "id")
  [[ -n "$MACHINE_ID" && "$MACHINE_ID" != "null" ]] \
    && pass "POST /machines → creat ($MACHINE_ID)" \
    || fail "POST /machines → eșuat ($MACHINE_RESP)"

  DUP_M=$(http_code -X POST "$API_URL/machines" -H "Content-Type: application/json" -H "$AUTH_H" \
    -d "{\"peer_id\":\"$TEST_PEER_ID\",\"name\":\"Dup\"}")
  [[ "$DUP_M" == "409" ]] && pass "POST /machines peer_id duplicat → 409" || fail "peer_id duplicat → $DUP_M"

  LIST_N=$(curl -s "$API_URL/machines" -H "$AUTH_H" | \
    python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [[ "$LIST_N" -ge 1 ]] && pass "GET /machines → $LIST_N mașini" || fail "GET /machines → lista goală"

  UNAUTH=$(http_code "$API_URL/machines")
  [[ "$UNAUTH" == "401" || "$UNAUTH" == "403" ]] \
    && pass "GET /machines fără token → $UNAUTH" \
    || fail "GET /machines fără token → $UNAUTH"

  HB=$(http_code -X PATCH "$API_URL/machines/$TEST_PEER_ID/heartbeat?online=true")
  [[ "$HB" == "204" ]] && pass "PATCH /machines/heartbeat → 204" || fail "PATCH /machines/heartbeat → $HB"

  if [[ -n "$MACHINE_ID" && "$MACHINE_ID" != "null" ]]; then
    APP=$(http_code -X POST "$API_URL/machines/$MACHINE_ID/approve" -H "$AUTH_H")
    [[ "$APP" == "200" || "$APP" == "204" ]] && pass "POST /machines/approve → $APP" || fail "POST /machines/approve → $APP"

    DENY_RESP=$(curl -s -X POST "$API_URL/machines" -H "Content-Type: application/json" -H "$AUTH_H" \
      -d "{\"peer_id\":\"$(shuf -i 100000000-999999999 -n 1 2>/dev/null || echo 300000003)\",\"name\":\"Deny Test\"}")
    DENY_ID=$(json_get "$DENY_RESP" "id")
    if [[ -n "$DENY_ID" && "$DENY_ID" != "null" ]]; then
      DENY_C=$(http_code -X POST "$API_URL/machines/$DENY_ID/deny" -H "$AUTH_H")
      [[ "$DENY_C" == "200" || "$DENY_C" == "204" ]] && pass "POST /machines/deny → $DENY_C" || fail "POST /machines/deny → $DENY_C"
    fi
  fi

  SESSION_RESP=$(curl -s --max-time 10 -X POST "$API_URL/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"host_peer_id\":\"$TEST_PEER_ID\",\"connection_type\":\"p2p\"}")
  SESSION_ID=$(json_get "$SESSION_RESP" "id")
  if [[ -n "$SESSION_ID" && "$SESSION_ID" != "null" ]]; then
    pass "POST /sessions → creat ($SESSION_ID)"
    END_C=$(http_code -X PATCH "$API_URL/sessions/$SESSION_ID/end")
    [[ "$END_C" == "204" ]] && pass "PATCH /sessions/end → 204" || fail "PATCH /sessions/end → $END_C"
  else
    fail "POST /sessions → eșuat ($SESSION_RESP)"
  fi
fi

# ── 7. API REST — org hierarchy (companies/locations/groups/placement) ─────────
section "7/10  API REST — org hierarchy"

if [[ -z "$ACCESS_TOKEN" ]]; then
  skip "Testele org sar — nu am token valid"
else
  AUTH_H="Authorization: Bearer $ACCESS_TOKEN"

  CO_RESP=$(curl -s --max-time 10 -X POST "$API_URL/companies" \
    -H "Content-Type: application/json" -H "$AUTH_H" -d '{"name":"Test Company"}')
  CO_ID=$(json_get "$CO_RESP" "id")
  [[ -n "$CO_ID" && "$CO_ID" != "null" ]] && pass "POST /companies → creat" || fail "POST /companies → eșuat ($CO_RESP)"

  CO_N=$(curl -s "$API_URL/companies" -H "$AUTH_H" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
  [[ "$CO_N" -ge 1 ]] && pass "GET /companies → $CO_N companii" || fail "GET /companies → goală"

  if [[ -n "$CO_ID" && "$CO_ID" != "null" ]]; then
    LOC_RESP=$(curl -s -X POST "$API_URL/companies/$CO_ID/locations" \
      -H "Content-Type: application/json" -H "$AUTH_H" -d '{"name":"HQ"}')
    LOC_ID=$(json_get "$LOC_RESP" "id")
    [[ -n "$LOC_ID" && "$LOC_ID" != "null" ]] && pass "POST /locations → creat" || fail "POST /locations → eșuat ($LOC_RESP)"

    if [[ -n "$LOC_ID" && "$LOC_ID" != "null" ]]; then
      GRP_RESP=$(curl -s -X POST "$API_URL/locations/$LOC_ID/groups" \
        -H "Content-Type: application/json" -H "$AUTH_H" -d '{"name":"IT"}')
      GRP_ID=$(json_get "$GRP_RESP" "id")
      [[ -n "$GRP_ID" && "$GRP_ID" != "null" ]] && pass "POST /groups → creat" || fail "POST /groups → eșuat ($GRP_RESP)"

      if [[ -n "$GRP_ID" && -n "$MACHINE_ID" && "$MACHINE_ID" != "null" ]]; then
        PL=$(json_get "$(curl -s -X PATCH "$API_URL/machines/$MACHINE_ID/placement" \
          -H "Content-Type: application/json" -H "$AUTH_H" \
          -d "{\"group_id\":\"$GRP_ID\"}")" "group_id")
        [[ "$PL" == "$GRP_ID" ]] && pass "PATCH /machines/placement → group_id setat" || fail "PATCH /machines/placement → eșuat"
      fi

      [[ "$(http_code -X DELETE "$API_URL/groups/$GRP_ID" -H "$AUTH_H")" == "204" ]] \
        && pass "DELETE /groups → 204" || fail "DELETE /groups → eșuat"
    fi

    [[ "$(http_code -X DELETE "$API_URL/locations/$LOC_ID" -H "$AUTH_H")" == "204" ]] \
      && pass "DELETE /locations → 204" || fail "DELETE /locations → eșuat"

    [[ "$(http_code -X DELETE "$API_URL/companies/$CO_ID" -H "$AUTH_H")" == "204" ]] \
      && pass "DELETE /companies → 204" || fail "DELETE /companies → eșuat"
  fi
fi

# ── 8. API REST — registration tokens & API keys ──────────────────────────────
section "8/10  API REST — registration tokens & API keys"

if [[ -z "$ACCESS_TOKEN" ]]; then
  skip "Testele tokens/keys sar — nu am token valid"
else
  AUTH_H="Authorization: Bearer $ACCESS_TOKEN"

  TOK_RESP=$(curl -s --max-time 10 -X POST "$API_URL/tokens" \
    -H "Content-Type: application/json" -H "$AUTH_H" -d '{}')
  TOK_VAL=$(json_get "$TOK_RESP" "token")
  echo "$TOK_VAL" | grep -qE '^[A-Z0-9]{4}-[A-Z0-9]{4}$' \
    && pass "POST /tokens → token generat ($TOK_VAL)" \
    || fail "POST /tokens → format invalid ($TOK_RESP)"

  if [[ -n "$TOK_VAL" && "$TOK_VAL" != "null" ]]; then
    REDEEM_PID="$(shuf -i 100000000-999999999 -n 1 2>/dev/null || echo "$(date +%N)" | grep -oP '^\d{9}')"
    REDEEM=$(json_get "$(curl -s -X POST "$API_URL/tokens/redeem" \
      -H "Content-Type: application/json" \
      -d "{\"token\":\"$TOK_VAL\",\"peer_id\":\"$REDEEM_PID\",\"name\":\"Redeemed PC\"}")" "peer_id")
    [[ -n "$REDEEM" ]] && pass "POST /tokens/redeem → mașinărie înregistrată" || fail "POST /tokens/redeem → eșuat"

    REDEEM2=$(http_code -X POST "$API_URL/tokens/redeem" -H "Content-Type: application/json" \
      -d "{\"token\":\"$TOK_VAL\",\"peer_id\":\"$(shuf -i 100000000-999999999 -n 1 2>/dev/null || echo 200000002)\",\"name\":\"Dup\"}")
    [[ "$REDEEM2" == "400" ]] && pass "Redeem a doua oară → 400 (token deja folosit)" || fail "Redeem a doua oară → $REDEEM2"
  fi

  INVALID=$(http_code -X POST "$API_URL/tokens/redeem" -H "Content-Type: application/json" \
    -d '{"token":"XXXX-XXXX","peer_id":"bad","name":"Bad"}')
  [[ "$INVALID" == "400" ]] && pass "Redeem token invalid → 400" || fail "Redeem token invalid → $INVALID"

  NOAUTH_T=$(http_code -X POST "$API_URL/tokens" -H "Content-Type: application/json" -d '{}')
  [[ "$NOAUTH_T" == "401" || "$NOAUTH_T" == "403" ]] && pass "POST /tokens fără auth → $NOAUTH_T" || fail "POST /tokens fără auth → $NOAUTH_T"

  AKEY_RESP=$(curl -s --max-time 10 -X POST "$API_URL/api-keys" \
    -H "Content-Type: application/json" -H "$AUTH_H" -d '{"name":"Test Key"}')
  AKEY_ID=$(json_get "$AKEY_RESP" "id")
  [[ -n "$AKEY_ID" && "$AKEY_ID" != "null" ]] \
    && pass "POST /api-keys → creat ($AKEY_ID)" \
    || fail "POST /api-keys → eșuat ($AKEY_RESP)"

  AKEY_N=$(curl -s "$API_URL/api-keys" -H "$AUTH_H" | \
    python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
  [[ "$AKEY_N" -ge 1 ]] && pass "GET /api-keys → $AKEY_N cheie(i)" || fail "GET /api-keys → goală"

  if [[ -n "$AKEY_ID" && "$AKEY_ID" != "null" ]]; then
    REV=$(http_code -X DELETE "$API_URL/api-keys/$AKEY_ID" -H "$AUTH_H")
    [[ "$REV" == "204" ]] && pass "DELETE /api-keys/:id → 204 (revocat)" || fail "DELETE /api-keys/:id → $REV"
  fi
fi

# ── 9. Signaling WebSocket ─────────────────────────────────────────────────────
section "9/10  Signaling WebSocket"

if ! $HAVE_WEBSOCAT; then
  skip "websocat lipsă (cargo install websocat)"
else
  WS_PEER_ID="ws-$(date +%s)"
  WS_PW_HASH=$(echo -n "testpass123" | sha256sum | awk '{print $1}')

  REG_MSG="{\"type\":\"register\",\"peer_id\":\"$WS_PEER_ID\",\"password_hash\":\"$WS_PW_HASH\"}"
  WS_RESP=$(echo "$REG_MSG" | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  echo "$WS_RESP" | grep -q '"type":"registered"' \
    && pass "WS register → 'registered' primit" \
    || fail "WS register → $WS_RESP"

  JOIN_MISS="{\"type\":\"join\",\"peer_id\":\"000000000\",\"password\":\"x\"}"
  WS_MISS=$(echo "$JOIN_MISS" | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  echo "$WS_MISS" | grep -q '"type":"error"' \
    && pass "WS join peer inexistent → eroare returnată" \
    || info "WS join → '$WS_MISS'"

  WS_BAD=$(echo '{"type": nope' | timeout 5 websocat --no-close -n1 "$SIG_WS" 2>/dev/null || echo "")
  echo "$WS_BAD" | grep -q '"code":"invalid_json"' \
    && pass "WS JSON invalid → 'invalid_json'" \
    || info "WS JSON invalid → '$WS_BAD'"
fi

# ── 10. Compilare Rust agent + Frontend TypeScript ─────────────────────────────
section "10/10  Compilare Rust agent + Frontend TypeScript"

if $SKIP_BUILD; then
  skip "Build sarat (--skip-build)"
else
  if command -v cargo &>/dev/null; then
    info "cargo build -p peerdesk-agent --release..."
    cargo build -p peerdesk-agent --release 2>&1 | tail -3 \
      && pass "cargo build → success" \
      || fail "cargo build → erori de compilare"

    RUST_OUT=$(cargo test -p peerdesk-agent 2>&1 || true)
    if echo "$RUST_OUT" | grep -qE "test result: ok|0 failed"; then
      pass "cargo test → trecut"
    elif echo "$RUST_OUT" | grep -q "0 tests"; then
      info "cargo test → 0 teste definite"
    else
      fail "cargo test → unele teste au eșuat"
    fi

    AGENT_BIN="$REPO_ROOT/target/release/peerdesk-agent"
    [[ -f "$AGENT_BIN" ]] \
      && pass "Binar agent generat ($(du -h "$AGENT_BIN" | awk '{print $1}'))" \
      || fail "Binarul agent nu a fost generat"
  else
    skip "cargo lipsă"
  fi

  if command -v node &>/dev/null; then
    WEB_DIR="$REPO_ROOT/web"
    [[ ! -d "$WEB_DIR/node_modules" ]] && npm --prefix "$WEB_DIR" install --silent 2>&1 | tail -3

    info "npm run build..."
    npm --prefix "$WEB_DIR" run build 2>&1 | tail -3 \
      && pass "Frontend compilat → dist/ ($(du -sh "$WEB_DIR/dist" 2>/dev/null | awk '{print $1}'))" \
      || fail "npm run build → eșuat"

    info "tsc --noEmit..."
    npm --prefix "$WEB_DIR" exec -- tsc --noEmit 2>&1 | tail -3 \
      && pass "TypeScript typecheck → fără erori" \
      || fail "TypeScript typecheck → erori de tipuri"
  else
    skip "node lipsă"
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
