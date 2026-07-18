#!/bin/sh
# Tests for scripts/ts-bridge-failover.sh.
#
# Two modes are exercised:
#   unit        — source the script with FAILOVER_TEST_SOURCE_ONLY=1 and call
#                 functions directly against a mock `tailscale` that records
#                 its argv.
#   integration — run the whole script with a mock containerboot that dies at
#                 once, asserting the consecutive-boot-failure counter and the
#                 state-wipe self-heal (the 2026-07-17 crash-loop incident:
#                 persisted prefs made `tailscale up` fail on every restart
#                 and the bridge stayed dead for 9 hours).
#
# Run:  sh tests/ts-bridge/failover.test.sh
set -u

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/ts-bridge-failover.sh"
FAILS=0
PASS=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); say "  ok: $1"; }
fail() { FAILS=$((FAILS + 1)); say "  FAIL: $1"; }

assert_contains() { # file needle label
  if grep -q -- "$2" "$1" 2>/dev/null; then ok "$3"; else
    fail "$3 (wanted '$2' in $1: $(cat "$1" 2>/dev/null | tail -3 | tr '\n' ';'))"
  fi
}
assert_not_contains() {
  if grep -q -- "$2" "$1" 2>/dev/null; then
    fail "$3 (must NOT contain '$2')"
  else ok "$3"; fi
}

# --- shared mock environment -------------------------------------------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
MOCKBIN="$TMP/bin"
mkdir -p "$MOCKBIN"

# mock tailscale: records every invocation; `status --json` prints the JSON in
# $TS_STATUS_FILE (default: NoState).
cat > "$MOCKBIN/tailscale" <<'EOF'
#!/bin/sh
echo "$@" >> "${TS_ARGS_LOG:?}"
for a in "$@"; do
  case "$a" in
    status) cat "${TS_STATUS_FILE:-/dev/null}" 2>/dev/null || echo '{"BackendState":"NoState"}'; exit 0 ;;
  esac
done
exit 0
EOF
# mock psql / curl: record and succeed (DB/network never touched in tests)
cat > "$MOCKBIN/psql" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$MOCKBIN/curl" <<'EOF'
#!/bin/sh
echo "$@" >> "${CURL_ARGS_LOG:-/dev/null}"
# session list GET → emit the JSON fixture; everything else → succeed silently
case "$*" in
  *"/api/sessions/"*) exit 0 ;;
  *"/api/sessions"*) cat "${CURL_SESSIONS_FILE:-/dev/null}"; exit 0 ;;
esac
exit 0
EOF
chmod +x "$MOCKBIN/tailscale" "$MOCKBIN/psql" "$MOCKBIN/curl"
export PATH="$MOCKBIN:$PATH"

# --- unit-mode helper --------------------------------------------------------
# run_unit <shell snippet> — sources the script (functions only), then evals
# the snippet. Output captured to $TMP/out.
run_unit() {
  TS_ARGS_LOG="$TMP/ts_args" CURL_ARGS_LOG="$TMP/curl_args" sh -c "
    export FAILOVER_TEST_SOURCE_ONLY=1
    export PHONE_TS_IP='100.93.73.73' PHONE_TS_IP_2=''
    export DB_URL='' WAHA_API_KEY='k'
    . '$SCRIPT'
    STARTUP_GRACE_UNTIL=0
    $1
  " > "$TMP/out" 2>&1
}

say "== unit: script is sourceable with FAILOVER_TEST_SOURCE_ONLY=1 =="
: > "$TMP/ts_args"
if run_unit 'echo SOURCED_OK'; then :; fi
assert_contains "$TMP/out" "SOURCED_OK" "script sources cleanly without running bootstrap"

say "== unit: apply_tier 2 (direct) clears exit-node-allow-lan-access =="
: > "$TMP/ts_args"
run_unit 'apply_tier 2'
assert_contains "$TMP/ts_args" "--exit-node-allow-lan-access=false" \
  "direct tier resets allow-lan-access (the pref that poisoned tailscale up on 2026-07-17)"
assert_contains "$TMP/ts_args" "--exit-node= " \
  "direct tier clears the exit node"

say "== unit: apply_tier 0 (phone1) sets exit node + allow-lan-access =="
: > "$TMP/ts_args"
run_unit 'apply_tier 0'
assert_contains "$TMP/ts_args" "--exit-node=100.93.73.73" "phone tier sets exit node"
assert_contains "$TMP/ts_args" "--exit-node-allow-lan-access=true" "phone tier sets allow-lan-access"

say "== unit: restart_sessions inside startup grace DEFERS (not drops) =="
: > "$TMP/curl_args"
run_unit '
  STARTUP_GRACE_UNTIL=$(( $(date +%s) + 1000 ))
  PENDING_RESTART=0
  restart_sessions "test"
  echo "PENDING=$PENDING_RESTART"
'
assert_contains "$TMP/out" "PENDING=1" "grace-skipped restart sets PENDING_RESTART=1 for retry after grace"

say "== unit: restart_sessions after grace clears PENDING_RESTART and calls API =="
: > "$TMP/curl_args"
cat > "$TMP/sessions.json" <<'EOF'
[{"name":"amolendait","status":"FAILED","config":{"proxy":{"server":"ts-bridge:8080"}}}]
EOF
CURL_SESSIONS_FILE="$TMP/sessions.json" run_unit '
  PENDING_RESTART=1
  restart_sessions "test"
  echo "PENDING=$PENDING_RESTART"
'
assert_contains "$TMP/out" "PENDING=0" "actual restart attempt clears PENDING_RESTART"
assert_contains "$TMP/curl_args" "/api/sessions/amolendait/restart" "restart endpoint called for proxied session"

# --- integration: consecutive-boot-failure self-heal -------------------------
# mock containerboot that dies immediately (like tailscale up failing on
# poisoned persisted prefs)
cat > "$MOCKBIN/containerboot-dead" <<'EOF'
#!/bin/sh
echo "boot: failed to auth tailscale: tailscale up failed: exit status 1"
exit 1
EOF
chmod +x "$MOCKBIN/containerboot-dead"

STATE="$TMP/state"
mkdir -p "$STATE"
echo "poisoned-prefs" > "$STATE/tailscaled.state"
echo '{"BackendState":"NoState"}' > "$TMP/nostate.json"

# run_boot <n> — one full script run == one container start
run_boot() {
  TS_ARGS_LOG="$TMP/ts_args" TS_STATUS_FILE="$TMP/nostate.json" \
  TS_STATE_DIR="$STATE" DB_URL='' WAHA_API_KEY='k' \
  PHONE_TS_IP='100.93.73.73' PHONE_TS_IP_2='' \
  FAILOVER_CONTAINERBOOT="$MOCKBIN/containerboot-dead" \
  FAILOVER_BOOT_FAIL_WIPE_THRESHOLD=3 \
  sh "$SCRIPT" > "$TMP/boot_out_$1" 2>&1
  echo "exit=$? " >> "$TMP/boot_out_$1"
}

say "== integration: containerboot startup death exits 1 and counts the failure =="
run_boot 1
assert_contains "$TMP/boot_out_1" "exit=1" "watchdog exits 1 so docker restarts the container"
assert_contains "$TMP/boot_out_1" "containerboot died during startup" "death is logged"
if [ "$(cat "$STATE/.watchdog-consecutive-boot-failures" 2>/dev/null)" = "1" ]; then
  ok "failure counter persisted in state dir = 1"
else
  fail "failure counter after 1st death: got '$(cat "$STATE/.watchdog-consecutive-boot-failures" 2>/dev/null)', want 1"
fi
if [ -f "$STATE/tailscaled.state" ]; then
  ok "state NOT wiped below threshold"
else
  fail "state wiped too early (after 1 failure)"
fi

say "== integration: 3rd consecutive death wipes tailscaled state (self-heal) =="
run_boot 2
run_boot 3
assert_contains "$TMP/boot_out_3" "wiping tailscaled state" "wipe is announced loudly"
if [ -f "$STATE/tailscaled.state" ]; then
  fail "tailscaled.state still present after threshold — poisoned state would crash-loop forever"
else
  ok "tailscaled.state wiped at threshold → next boot re-registers via TS_AUTHKEY"
fi
if [ "$(cat "$STATE/.watchdog-consecutive-boot-failures" 2>/dev/null)" = "0" ]; then
  ok "counter reset after wipe"
else
  fail "counter not reset after wipe: '$(cat "$STATE/.watchdog-consecutive-boot-failures" 2>/dev/null)'"
fi

say "== integration: successful backend start resets the failure counter =="
echo "2" > "$STATE/.watchdog-consecutive-boot-failures"
echo "keep-me" > "$STATE/tailscaled.state"
cat > "$MOCKBIN/containerboot-alive" <<EOF
#!/bin/sh
sleep 60
EOF
chmod +x "$MOCKBIN/containerboot-alive"
echo '{"BackendState":"Running","Peer":{},"ExitNodeStatus":null}' > "$TMP/running.json"
TS_ARGS_LOG="$TMP/ts_args" TS_STATUS_FILE="$TMP/running.json" \
TS_STATE_DIR="$STATE" DB_URL='' WAHA_API_KEY='k' \
PHONE_TS_IP='100.93.73.73' PHONE_TS_IP_2='' \
FAILOVER_CONTAINERBOOT="$MOCKBIN/containerboot-alive" \
FAILOVER_VERIFY_TRIES=1 FAILOVER_VERIFY_SLEEP=0 FAILOVER_CHECK_INTERVAL=1 \
FAILOVER_TEST_EXIT_AFTER_STARTUP=1 \
sh "$SCRIPT" > "$TMP/boot_out_ok" 2>&1
if [ "$(cat "$STATE/.watchdog-consecutive-boot-failures" 2>/dev/null || echo 0)" = "0" ] \
   || [ ! -f "$STATE/.watchdog-consecutive-boot-failures" ]; then
  ok "counter cleared once tailscaled backend reached Running"
else
  fail "counter not cleared on healthy start: '$(cat "$STATE/.watchdog-consecutive-boot-failures")'"
fi
if [ -f "$STATE/tailscaled.state" ]; then
  ok "healthy start never touches tailscaled.state"
else
  fail "healthy start wiped state"
fi

say ""
say "passed=$PASS failed=$FAILS"
[ "$FAILS" -eq 0 ]
