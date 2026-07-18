#!/bin/sh
# ts-bridge failover watchdog.
#
# Runs as the ts-bridge container entrypoint: starts containerboot in the
# background (so the HTTP proxy at :8080 is ALWAYS up, even with every phone
# offline) and manages the Tailscale exit node at runtime with a fallback chain:
#
#   tier 0 = phone 1 (PHONE_TS_IP)      India 4G, preferred
#   tier 1 = phone 2 (PHONE_TS_IP_2)    India 4G, optional backup
#   tier 2 = direct  (no exit node)     Hetzner egress, last resort
#
# Demotion is fast (~60-75s of proxy failures); promotion back to a phone is
# dampened (5 min continuous online + 30 min dwell since last switch) because
# every egress-IP change is connection churn WhatsApp can see.
# After every verified switch the WAHA sessions using this proxy are restarted
# via the WAHA API so Baileys reconnects over the new path.
#
# Every decision is logged to Postgres table ts_bridge_failover (DB_URL) —
# the only remotely readable channel on this Coolify deployment. Logging is
# strictly best-effort and never blocks or delays a failover.
#
# Spec: docs/superpowers/specs/2026-07-13-tailscale-exit-node-failover.md

set -u

TSC="tailscale --socket=/tmp/tailscaled.sock"
export PGCONNECT_TIMEOUT=5

CHECK_INTERVAL="${FAILOVER_CHECK_INTERVAL:-20}"
FAIL_THRESHOLD="${FAILOVER_FAIL_THRESHOLD:-3}"
RECOVERY_CHECKS="${FAILOVER_RECOVERY_CHECKS:-15}"
MIN_DWELL="${FAILOVER_MIN_DWELL:-1800}"
QUARANTINE="${FAILOVER_QUARANTINE:-3600}"
WAHA_URL="${WAHA_URL:-http://waha:3000}"
# Prefer the plain key when both are set — WAHA_API_KEY may be a sha512: hash,
# which cannot authenticate API calls. (Resolved here in shell instead of a
# nested compose default, which Coolify's env parser cannot read.)
WAHA_API_KEY="${WAHA_API_KEY_PLAIN:-${WAHA_API_KEY:-}}"
DB_URL="${DB_URL:-}"
PHONE_TS_IP="${PHONE_TS_IP:-}"
PHONE_TS_IP_2="${PHONE_TS_IP_2:-}"
# Space-separated list of egress-IP probe URLs. The active path is judged dead
# only when ALL of them fail — one probe service being down must never trigger
# a failover (that would invalidate healthy WhatsApp sockets).
CHECK_URLS="${FAILOVER_CHECK_URLS:-https://api.ipify.org https://checkip.amazonaws.com https://ifconfig.me/ip}"
# Test hooks: the harness swaps these for a mock proxy/egress.
PROXY_ADDR="${FAILOVER_PROXY_ADDR:-http://127.0.0.1:8080}"
CONTAINERBOOT="${FAILOVER_CONTAINERBOOT:-/usr/local/bin/containerboot}"
VERIFY_TRIES="${FAILOVER_VERIFY_TRIES:-6}"
VERIFY_SLEEP="${FAILOVER_VERIFY_SLEEP:-10}"
STARTUP_GRACE="${FAILOVER_STARTUP_GRACE:-90}"
RESCUE_INTERVAL="${FAILOVER_RESCUE_INTERVAL:-900}"
# Self-heal: tailscaled's persisted state (TS_STATE_DIR volume) can get into a
# shape that deterministically kills containerboot at every boot — seen twice:
# 2026-07-14 (state written by an older tailscale died pre-login on v1.98.8)
# and 2026-07-17 (a runtime `tailscale set --exit-node-allow-lan-access` pref
# persisted, and containerboot's `tailscale up` then refused to run without
# mentioning it → 9h crash-loop, all sessions lost). After this many
# CONSECUTIVE startup deaths the watchdog wipes the state dir so the next boot
# re-registers cleanly via TS_AUTHKEY. 0 disables the wipe.
STATE_DIR="${TS_STATE_DIR:-/var/lib/tailscale}"
BOOT_FAIL_WIPE_THRESHOLD="${FAILOVER_BOOT_FAIL_WIPE_THRESHOLD:-3}"
BOOT_FAIL_FILE="$STATE_DIR/.watchdog-consecutive-boot-failures"

# --- state ---
CURRENT_TIER=2            # containerboot starts with no exit node = direct
LAST_SWITCH_TS=0
FAIL_COUNT=0
PROMO_TARGET=""
PROMO_COUNT=0
QUARANTINE_UNTIL_0=0
QUARANTINE_UNTIL_1=0
LAST_PROXY_IP=""
P1_ONLINE=false
P2_ONLINE=false
STATUS_JSON='{}'
LOOP_N=0
# Set when sockets were invalidated (exit node flipped) but no working path was
# found to restart sessions over; the restart runs as soon as a path answers.
PENDING_RESTART=0
LAST_RESCUE_TS=0

now() { date +%s; }

tier_ip() {
  case "$1" in
    0) printf %s "$PHONE_TS_IP" ;;
    1) printf %s "$PHONE_TS_IP_2" ;;
    *) printf %s "" ;;
  esac
}

tier_name() {
  case "$1" in
    0) printf %s "phone1" ;;
    1) printf %s "phone2" ;;
    *) printf %s "direct" ;;
  esac
}

tier_available() {
  [ "$1" -eq 2 ] && return 0
  [ -n "$(tier_ip "$1")" ]
}

quarantined() {
  case "$1" in
    0) [ "$(now)" -lt "$QUARANTINE_UNTIL_0" ] ;;
    1) [ "$(now)" -lt "$QUARANTINE_UNTIL_1" ] ;;
    *) return 1 ;;
  esac
}

set_quarantine() {
  case "$1" in
    0) QUARANTINE_UNTIL_0=$(($(now) + QUARANTINE)) ;;
    1) QUARANTINE_UNTIL_1=$(($(now) + QUARANTINE)) ;;
  esac
}

sql_quote() { printf %s "$1" | sed "s/'/''/g"; }

ensure_table() {
  [ -n "$DB_URL" ] || return 0
  psql "$DB_URL" -c "CREATE TABLE IF NOT EXISTS ts_bridge_failover(
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    event text NOT NULL,
    from_node text,
    to_node text,
    reason text,
    phone1_online boolean,
    phone2_online boolean,
    proxy_ip text,
    detail text
  );" >/dev/null 2>&1 || true
  psql "$DB_URL" -c "DELETE FROM ts_bridge_failover WHERE at < now() - interval '30 days';" >/dev/null 2>&1 || true
}

# log_event <event> <from> <to> <reason> <detail>
# Best-effort only — must never block failover, hence || true everywhere and
# it is always called AFTER the state change it describes.
log_event() {
  echo "[failover] event=$1 from=$2 to=$3 reason=$4 detail=$5"
  [ -n "$DB_URL" ] || return 0
  psql "$DB_URL" -c "INSERT INTO ts_bridge_failover(event, from_node, to_node, reason, phone1_online, phone2_online, proxy_ip, detail)
    VALUES ('$(sql_quote "$1")', '$(sql_quote "$2")', '$(sql_quote "$3")', '$(sql_quote "$4")',
            $P1_ONLINE, $P2_ONLINE, '$(sql_quote "$LAST_PROXY_IP")', '$(sql_quote "$5")');" >/dev/null 2>&1 || true
}

refresh_status() {
  STATUS_JSON=$($TSC status --json 2>/dev/null) || STATUS_JSON='{}'
  P1_ONLINE=$(peer_online 0 && echo true || echo false)
  P2_ONLINE=$(peer_online 1 && echo true || echo false)
}

# peer_online <tier> — phone is in the tailnet, online, and advertises exit node
peer_online() {
  po_ip=$(tier_ip "$1")
  [ -n "$po_ip" ] || return 1
  printf %s "$STATUS_JSON" | jq -e --arg ip "$po_ip" \
    '[.Peer[]? | select((.TailscaleIPs // []) | index($ip)) | select(.Online == true and .ExitNodeOption == true)] | length > 0' \
    >/dev/null 2>&1
}

# proxy_check — end-to-end test of the ACTIVE egress path through the proxy.
# Tries every probe URL; the path is dead only if ALL fail. Prints the egress
# IP on success.
proxy_check() {
  for pc_u in $CHECK_URLS; do
    if pc_r=$(curl -sf -m 10 -x "$PROXY_ADDR" "$pc_u" 2>/dev/null) && [ -n "$pc_r" ]; then
      printf %s "$pc_r"
      return 0
    fi
  done
  return 1
}

# apply_tier <tier> — returns tailscale's exit status; a failed `tailscale set`
# must never be treated as a completed switch.
# The direct tier must reset EVERY pref a phone tier sets: any pref left
# non-default persists in TS_STATE_DIR, and containerboot's next `tailscale up`
# refuses to start unless it mentions all non-default prefs (crash-looped the
# bridge for 9h on 2026-07-17). TS_EXTRA_ARGS=--reset in compose is the
# backstop; this keeps the state clean in the first place.
apply_tier() {
  if [ "$1" -eq 2 ]; then
    $TSC set --exit-node= --exit-node-allow-lan-access=false >/dev/null 2>&1
  else
    $TSC set --exit-node="$(tier_ip "$1")" --exit-node-allow-lan-access=true >/dev/null 2>&1
  fi
}

# boot-failure bookkeeping — the counter lives in the persisted state dir so it
# survives container restarts (each crash-loop iteration is a fresh process).
note_boot_success() { rm -f "$BOOT_FAIL_FILE" 2>/dev/null || true; }

note_boot_failure_and_maybe_wipe() {
  nb_n=$(cat "$BOOT_FAIL_FILE" 2>/dev/null || echo 0)
  case "$nb_n" in '' | *[!0-9]*) nb_n=0 ;; esac
  nb_n=$((nb_n + 1))
  echo "$nb_n" > "$BOOT_FAIL_FILE" 2>/dev/null || true
  [ "$BOOT_FAIL_WIPE_THRESHOLD" -gt 0 ] || return 0
  if [ "$nb_n" -ge "$BOOT_FAIL_WIPE_THRESHOLD" ]; then
    log_event error "" "" "wiping tailscaled state" \
      "containerboot died during startup ${nb_n}x consecutively; deleting persisted state in $STATE_DIR so the next boot re-registers via TS_AUTHKEY"
    find "$STATE_DIR" -mindepth 1 -maxdepth 1 ! -name "$(basename "$BOOT_FAIL_FILE")" \
      -exec rm -rf {} + 2>/dev/null || true
    echo 0 > "$BOOT_FAIL_FILE" 2>/dev/null || true
  fi
}

# exit_node_matches <tier> — tailscaled's actual exit node (per STATUS_JSON,
# refresh first) is the one this tier wants. Guards against `tailscale set`
# silently not taking effect: the proxy answering is not enough, the probe
# could be riding the OLD path.
exit_node_matches() {
  if [ "$1" -eq 2 ]; then
    printf %s "$STATUS_JSON" | jq -e '[.ExitNodeStatus.TailscaleIPs[]?] | length == 0' >/dev/null 2>&1
  else
    printf %s "$STATUS_JSON" | jq -e --arg ip "$(tier_ip "$1")" \
      '[.ExitNodeStatus.TailscaleIPs[]? | split("/")[0]] | index($ip) != null' >/dev/null 2>&1
  fi
}

# derive_tier — recover the real current tier from tailscaled state (used when
# a rollback fails and our bookkeeping can no longer be trusted).
derive_tier() {
  dt_ip=$(printf %s "$STATUS_JSON" | jq -r '(.ExitNodeStatus.TailscaleIPs[0] // "") | split("/")[0]' 2>/dev/null)
  if [ -z "$dt_ip" ]; then
    echo 2
  elif [ "$dt_ip" = "$PHONE_TS_IP" ]; then
    echo 0
  elif [ -n "$PHONE_TS_IP_2" ] && [ "$dt_ip" = "$PHONE_TS_IP_2" ]; then
    echo 1
  else
    echo 2
  fi
}

# restart_sessions [reason] — reason defaults to "egress switched"
restart_sessions() {
  rs_reason="${1:-egress switched}"
  if [ "$(now)" -lt "$STARTUP_GRACE_UNTIL" ]; then
    # DEFER, don't drop: ts-bridge restarting alone (waha container untouched)
    # still leaves the sessions' sockets dead — the main loop retries once the
    # grace passes and a path answers.
    PENDING_RESTART=1
    log_event sessions_restart "" "" "deferred" "within ${STARTUP_GRACE}s startup grace; will retry after grace"
    return 0
  fi
  PENDING_RESTART=0
  if [ -z "$WAHA_API_KEY" ]; then
    log_event error "" "" "no WAHA_API_KEY" "cannot restart sessions after egress switch"
    return 1
  fi
  case "$WAHA_API_KEY" in
    sha512:*)
      log_event error "" "" "WAHA_API_KEY is a sha512 hash" \
        "watchdog needs the PLAIN key to authenticate (set WAHA_API_KEY_PLAIN); cannot restart sessions"
      return 1
      ;;
  esac
  # fetch the session list with retries — a listing failure must NOT be
  # mistaken for "no sessions to restart"
  list_json=""
  la=1
  while [ "$la" -le 3 ]; do
    if list_json=$(curl -sf -m 10 -H "X-Api-Key: $WAHA_API_KEY" "$WAHA_URL/api/sessions" 2>/dev/null) \
       && [ -n "$list_json" ]; then
      break
    fi
    list_json=""
    la=$((la + 1))
    sleep 5
  done
  if [ -z "$list_json" ]; then
    log_event error "" "" "session list failed" \
      "GET /api/sessions failed 3x after '$rs_reason'; sessions must reconnect on their own"
    return 1
  fi
  # @uri-encode names: this fork allows arbitrary session names, and raw
  # whitespace//?/# would corrupt both the word-split and the restart URL
  if ! names=$(printf %s "$list_json" | jq -r \
      '.[] | select(.config.proxy.server == "ts-bridge:8080") | select(.status != "STOPPED") | .name | @uri' 2>/dev/null); then
    log_event error "" "" "session list unparseable" \
      "GET /api/sessions returned non-JSON after '$rs_reason'; sessions must reconnect on their own"
    return 1
  fi
  if [ -z "$names" ]; then
    log_event sessions_restart "" "" "nothing to restart" "no non-stopped sessions with proxy ts-bridge:8080"
    return 0
  fi
  results=""
  for n in $names; do
    ok=0
    i=1
    while [ "$i" -le 3 ]; do
      if curl -sf -m 20 -X POST -H "X-Api-Key: $WAHA_API_KEY" \
           "$WAHA_URL/api/sessions/$n/restart" >/dev/null 2>&1; then
        ok=1
        break
      fi
      i=$((i + 1))
      sleep 5
    done
    [ "$ok" -eq 1 ] && results="$results $n:ok" || results="$results $n:FAILED"
  done
  log_event sessions_restart "" "" "$rs_reason" "restarted:$results"
}

# rescue_failed_sessions — sessions can die (FAILED) without any egress switch
# happening: a blip during boot, WhatsApp closing sockets, etc. Nothing else
# restarts them (restart-on-switch only fires on tier CHANGE — learned the hard
# way when sessions sat FAILED for 3 days behind a perfectly healthy proxy).
# Runs on a healthy path, at most once per RESCUE_INTERVAL:
#   - FAILED with paired creds (me != null): restart — reconnects from stored auth.
#   - FAILED without creds (me == null): restart would only churn QR codes nobody
#     scans (and QR registration attempts are Meta-visible churn) — log loudly
#     for a human instead; only a QR re-scan can fix these.
rescue_failed_sessions() {
  [ "$(now)" -ge "$STARTUP_GRACE_UNTIL" ] || return 0
  [ $(($(now) - LAST_RESCUE_TS)) -ge "$RESCUE_INTERVAL" ] || return 0
  [ -n "$WAHA_API_KEY" ] || return 0
  case "$WAHA_API_KEY" in sha512:*) return 0 ;; esac
  rf_list=$(curl -sf -m 10 -H "X-Api-Key: $WAHA_API_KEY" "$WAHA_URL/api/sessions" 2>/dev/null) || return 0
  [ -n "$rf_list" ] || return 0
  LAST_RESCUE_TS=$(now)
  rf_dead=$(printf %s "$rf_list" | jq -r \
    '[.[] | select(.config.proxy.server == "ts-bridge:8080") | select(.status == "FAILED") | select(.me == null) | .name] | join(" ")' 2>/dev/null)
  if [ -n "$rf_dead" ]; then
    log_event error "" "" "sessions need QR re-scan" \
      "FAILED with no paired creds (me=null); restart cannot recover them, scan QR: $rf_dead"
  fi
  rf_names=$(printf %s "$rf_list" | jq -r \
    '.[] | select(.config.proxy.server == "ts-bridge:8080") | select(.status == "FAILED") | select(.me != null) | .name | @uri' 2>/dev/null)
  [ -n "$rf_names" ] || return 0
  rf_results=""
  for rf_n in $rf_names; do
    if curl -sf -m 20 -X POST -H "X-Api-Key: $WAHA_API_KEY" \
         "$WAHA_URL/api/sessions/$rf_n/restart" >/dev/null 2>&1; then
      rf_results="$rf_results $rf_n:ok"
    else
      rf_results="$rf_results $rf_n:FAILED"
    fi
  done
  log_event sessions_rescue "" "" "FAILED sessions on healthy path" "restarted:$rf_results"
}

# try_switch <new_tier> <reason> — the ONLY place the exit node changes.
# Applies the tier, verifies end-to-end through the proxy, and only then
# commits state + logs + restarts sessions. On a failed PROMOTION the old
# tier is restored and the candidate quarantined; on a failed DEMOTION the
# caller cascades to the next-worse tier (no revert — the old path is dead).
try_switch() {
  new=$1
  reason=$2
  old=$CURRENT_TIER
  applied=1
  apply_tier "$new" || applied=0
  verified=0
  if [ "$applied" -eq 1 ]; then
    i=0
    while [ "$i" -lt "$VERIFY_TRIES" ]; do
      sleep "$VERIFY_SLEEP"
      refresh_status
      # BOTH must hold: tailscaled really runs on the requested exit node AND
      # the path answers end-to-end. Proxy-answering alone can be the OLD path
      # still working after a `tailscale set` that didn't take effect.
      if exit_node_matches "$new" && ip=$(proxy_check); then
        verified=1
        LAST_PROXY_IP=$ip
        break
      fi
      i=$((i + 1))
    done
  fi
  refresh_status
  if [ "$verified" -eq 1 ]; then
    CURRENT_TIER=$new
    LAST_SWITCH_TS=$(now)
    FAIL_COUNT=0
    PROMO_TARGET=""
    PROMO_COUNT=0
    log_event switch "$(tier_name "$old")" "$(tier_name "$new")" "$reason" "verified egress=$LAST_PROXY_IP"
    if [ "$new" != "$old" ]; then
      restart_sessions
    fi
    return 0
  fi
  # switch failed (tailscale set refused, or the new path never answered)
  fail_how="verify failed"
  [ "$applied" -eq 0 ] && fail_how="tailscale set failed"
  [ "$new" -ne 2 ] && set_quarantine "$new"
  if [ "$new" -lt "$old" ]; then
    # failed promotion: roll back to the tier that was working
    rollback_ok=1
    apply_tier "$old" || rollback_ok=0
    refresh_status
    if [ "$rollback_ok" -eq 0 ] || ! exit_node_matches "$old"; then
      # rollback did not take — resync bookkeeping with tailscaled's reality
      CURRENT_TIER=$(derive_tier)
      log_event error "$(tier_name "$old")" "$(tier_name "$new")" "$reason" \
        "ROLLBACK FAILED after promotion attempt; actual state=$(tier_name "$CURRENT_TIER")"
    else
      CURRENT_TIER=$old
    fi
    LAST_SWITCH_TS=$(now)
    PROMO_TARGET=""
    PROMO_COUNT=0
    log_event switch_failed "$(tier_name "$old")" "$(tier_name "$new")" "$reason" \
      "promotion $fail_how; on $(tier_name "$CURRENT_TIER"), quarantined $(tier_name "$new") for ${QUARANTINE}s"
    if [ "$applied" -eq 1 ]; then
      # the exit node actually flapped — existing sockets are dead
      restart_sessions "recovering sockets after failed promotion"
    fi
  else
    log_event switch_failed "$(tier_name "$old")" "$(tier_name "$new")" "$reason" \
      "demotion $fail_how; cascading to next tier"
  fi
  return 1
}

# demote <reason> — walk down the chain until something verifies.
demote() {
  t=$((CURRENT_TIER + 1))
  while [ "$t" -le 2 ]; do
    if tier_available "$t" && { [ "$t" -eq 2 ] || peer_online "$t"; }; then
      if try_switch "$t" "$1"; then
        return 0
      fi
      # resync with whatever exit node tailscaled is actually on, keep cascading
      CURRENT_TIER=$(derive_tier)
    fi
    t=$((t + 1))
  done
  FAIL_COUNT=0 # retry demotion only after another full failure window
  # the cascade flipped the exit node without finding a working path: existing
  # sockets are dead, but restarting sessions now would just churn them into
  # FAILED — defer the restart until the next successful proxy_check.
  PENDING_RESTART=1
  log_event error "$(tier_name "$CURRENT_TIER")" "" "$1" \
    "no lower tier verified (direct egress also failing?); staying put, session restart deferred until a path answers"
  return 1
}

# Test hook: unit tests source this file for its functions only.
if [ "${FAILOVER_TEST_SOURCE_ONLY:-0}" = "1" ]; then
  STARTUP_GRACE_UNTIL=0
  return 0 2>/dev/null || exit 0
fi

# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------
# containerboot starts FIRST: the proxy at :8080 must come up even if package
# mirrors/DNS are unreachable — the watchdog can wait, the proxy cannot.
# Its output goes to /tmp/boot.log so a death can be diagnosed via Postgres
# (container stdout is not remotely readable on Coolify).
echo "[failover] starting containerboot"
"$CONTAINERBOOT" >/tmp/boot.log 2>&1 &
BOOT_PID=$!

boot_tail() { tail -n 15 /tmp/boot.log 2>/dev/null | tr -d '\r'; }

# curl/jq/psql are baked into the image (Dockerfile.tsbridge); this loop is a
# safety net for running on a stock tailscale image, guarded so a dead network
# at boot cannot spin it when the tools are already present.
if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 \
   || ! command -v psql >/dev/null 2>&1; then
  echo "[failover] installing curl/jq/psql"
  until apk add --no-cache curl jq postgresql16-client >/dev/null 2>&1 \
     || apk add --no-cache curl jq postgresql-client >/dev/null 2>&1; do
    echo "[failover] apk install failed; retrying in 10s"
    sleep 10
  done
fi

STARTUP_GRACE_UNTIL=$(($(now) + STARTUP_GRACE))
ensure_table

# wait for tailscaled backend
waits=0
while :; do
  st=$($TSC status --json 2>/dev/null | jq -r '.BackendState // "unknown"' 2>/dev/null)
  if [ "$st" = "Running" ]; then
    note_boot_success
    break
  fi
  if ! kill -0 "$BOOT_PID" 2>/dev/null; then
    log_event error "" "" "containerboot died during startup" \
      "backend state was: $st; boot log tail: $(boot_tail)"
    note_boot_failure_and_maybe_wipe
    exit 1
  fi
  waits=$((waits + 1))
  if [ $((waits % 30)) -eq 0 ]; then
    log_event error "" "" "still waiting for tailscale backend" "state=$st after $((waits * 2))s (bad TS_AUTHKEY?)"
  fi
  sleep 2
done

# give the tailnet a moment to report peers, then elect the best tier
sleep 10
refresh_status
log_event startup "" "" "watchdog started" \
  "phone1=$PHONE_TS_IP phone2=${PHONE_TS_IP_2:-none} interval=${CHECK_INTERVAL}s fail_threshold=$FAIL_THRESHOLD recovery_checks=$RECOVERY_CHECKS min_dwell=${MIN_DWELL}s quarantine=${QUARANTINE}s"

t=0
while [ "$t" -le 2 ]; do
  if tier_available "$t" && ! quarantined "$t" && { [ "$t" -eq 2 ] || peer_online "$t"; }; then
    if try_switch "$t" "startup election"; then
      break
    fi
  fi
  t=$((t + 1))
done

# Test hook: integration tests stop here instead of entering the infinite loop.
[ "${FAILOVER_TEST_EXIT_AFTER_STARTUP:-0}" = "1" ] && exit 0

# ---------------------------------------------------------------------------
# main loop
# ---------------------------------------------------------------------------
while :; do
  sleep "$CHECK_INTERVAL"
  LOOP_N=$((LOOP_N + 1))

  if ! kill -0 "$BOOT_PID" 2>/dev/null; then
    log_event error "$(tier_name "$CURRENT_TIER")" "" "containerboot died" \
      "exiting so docker restarts the container; boot log tail: $(boot_tail)"
    exit 1
  fi

  refresh_status

  # --- self-heal: tailscaled must be on the tier we think it is ---
  if ! exit_node_matches "$CURRENT_TIER"; then
    DRIFT_COUNT=$((${DRIFT_COUNT:-0} + 1))
    if [ "$DRIFT_COUNT" -eq 1 ] || [ $((DRIFT_COUNT % 15)) -eq 0 ]; then
      log_event error "" "$(tier_name "$CURRENT_TIER")" "exit-node drift detected" \
        "tailscaled state disagrees with watchdog tier (${DRIFT_COUNT}x); re-applying"
    fi
    apply_tier "$CURRENT_TIER" || true
    refresh_status
  else
    DRIFT_COUNT=0
  fi

  # --- demotion: active path must answer end-to-end ---
  if ip=$(proxy_check); then
    LAST_PROXY_IP=$ip
    FAIL_COUNT=0
    if [ "$PENDING_RESTART" -eq 1 ]; then
      restart_sessions "path recovered after total outage"
    fi
    rescue_failed_sessions
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    LAST_PROXY_IP="CHECK_FAILED"
    if [ "$FAIL_COUNT" -ge "$FAIL_THRESHOLD" ] && [ "$CURRENT_TIER" -lt 2 ]; then
      demote "active path failed ${FAIL_COUNT}x (~$((FAIL_COUNT * CHECK_INTERVAL))s)"
      continue
    fi
    if [ "$FAIL_COUNT" -ge "$FAIL_THRESHOLD" ] && [ "$CURRENT_TIER" -eq 2 ]; then
      # direct egress failing = host internet problem; nothing to switch to
      if [ $((FAIL_COUNT % (FAIL_THRESHOLD * 5))) -eq 0 ]; then
        log_event error direct "" "direct egress failing" "failed ${FAIL_COUNT}x; no lower tier exists"
      fi
    fi
  fi

  # --- promotion: dampened switch-back to the best recovered phone ---
  cand=""
  t=0
  while [ "$t" -lt "$CURRENT_TIER" ]; do
    if tier_available "$t" && ! quarantined "$t" && peer_online "$t"; then
      cand=$t
      break
    fi
    t=$((t + 1))
  done
  if [ -n "$cand" ]; then
    if [ "$cand" = "$PROMO_TARGET" ]; then
      PROMO_COUNT=$((PROMO_COUNT + 1))
    else
      PROMO_TARGET=$cand
      PROMO_COUNT=1
    fi
    if [ $((PROMO_COUNT % 5)) -eq 0 ] && [ "$PROMO_COUNT" -lt "$RECOVERY_CHECKS" ]; then
      log_event recovery_progress "$(tier_name "$CURRENT_TIER")" "$(tier_name "$cand")" \
        "candidate online" "$PROMO_COUNT/$RECOVERY_CHECKS consecutive checks; dwell $(($(now) - LAST_SWITCH_TS))/${MIN_DWELL}s"
    fi
    if [ "$PROMO_COUNT" -ge "$RECOVERY_CHECKS" ] && [ $(($(now) - LAST_SWITCH_TS)) -ge "$MIN_DWELL" ]; then
      try_switch "$cand" "recovered: online ${PROMO_COUNT} consecutive checks, dwell satisfied" || true
    fi
  else
    PROMO_TARGET=""
    PROMO_COUNT=0
  fi

  # --- heartbeat every ~15 min ---
  if [ $((LOOP_N % 45)) -eq 0 ]; then
    # keep the containerboot log bounded (truncate leaves a sparse file;
    # the writer's fd offset is unaffected and tail keeps working)
    if [ "$(wc -c < /tmp/boot.log 2>/dev/null || echo 0)" -gt 5242880 ]; then
      : > /tmp/boot.log
    fi
    exit_node=$(printf %s "$STATUS_JSON" | jq -r '.ExitNodeStatus.TailscaleIPs[0] // "none"' 2>/dev/null)
    log_event heartbeat "" "$(tier_name "$CURRENT_TIER")" "periodic" \
      "tier=$(tier_name "$CURRENT_TIER") exit_node=$exit_node fail_count=$FAIL_COUNT promo=$PROMO_TARGET:$PROMO_COUNT"
  fi
done
