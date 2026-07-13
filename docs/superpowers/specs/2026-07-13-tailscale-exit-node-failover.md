# Tailscale Exit-Node Failover (phone1 → phone2 → direct)

**Status:** Approved design, implemented 2026-07-13.
**Supersedes** the exit-node wiring in `2026-06-24-android-4g-proxy-bridge-design.md` (§ compose config): the exit node is no longer set via `TS_EXTRA_ARGS` at container boot; it is managed at runtime by a watchdog.

## Problem

The original design baked the phone exit node into containerboot's startup args:
`TS_EXTRA_ARGS=--exit-node=${PHONE_TS_IP}`. If the phone was off, `tailscale up`
failed, containerboot crash-looped, the HTTP proxy at `ts-bridge:8080` never came
up, and **every WhatsApp session dropped** until the phone returned. The phone was
a hard single point of failure for the whole WhatsApp websocket path.

## Design

The proxy endpoint `ts-bridge:8080` now stays up unconditionally; only the egress
path *behind* it changes. `scripts/ts-bridge-failover.sh` is the ts-bridge
container entrypoint: it backgrounds containerboot FIRST (no exit-node args →
always starts, and before any package installation, so the proxy comes up even
when apk mirrors/DNS are unreachable), then runs a watchdog loop that applies
the exit node at runtime via `tailscale set --exit-node=…` (no re-auth, no
restart).

### Fallback chain (tiers)

| Tier | Egress | Env |
|---|---|---|
| 0 | Phone 1, India 4G (preferred) | `PHONE_TS_IP` |
| 1 | Phone 2, India 4G (optional backup) | `PHONE_TS_IP_2` |
| 2 | Direct — Hetzner datacenter IP (last resort, degraded ban posture, never offline) | — |

### Health checks

- **Active path** (authoritative): end-to-end curl through the proxy against a
  LIST of independent egress-IP probes (`FAILOVER_CHECK_URLS`, default
  api.ipify.org + checkip.amazonaws.com + ifconfig.me), every
  `FAILOVER_CHECK_INTERVAL` (20s). The path counts as dead only when **all**
  probes fail — a single probe service outage must never trigger a failover
  (that would invalidate healthy WhatsApp sockets).
- **Candidates**: `tailscale status --json` peer must be `Online` and advertise
  `ExitNodeOption`. (A candidate cannot be tested end-to-end without switching to
  it — there is one global exit node — so every switch is verified after applying
  and rolled back / cascaded if the new path doesn't answer.)
- **Switch verification is two-fold**: `tailscale set`'s exit status is checked,
  and after applying, `ExitNodeStatus` in `tailscale status --json` must actually
  match the requested node before the proxy probe counts — the proxy answering
  alone could be the OLD path still working after a `set` that didn't take
  effect. A failed rollback resyncs the watchdog's tier from tailscaled's real
  state, and a per-tick drift check re-applies the intended tier if tailscaled
  ever disagrees.

### State machine

- **Demotion** (fast): `FAILOVER_FAIL_THRESHOLD` (3) consecutive active-path
  failures ≈ 60–75s of real outage → switch to the first lower tier whose peer is
  online (tier 2 always eligible). Dwell time never blocks a demotion.
- **Promotion** (dampened — the anti-ban lever): a recovered phone must be online
  for `FAILOVER_RECOVERY_CHECKS` (15) consecutive checks (5 min) **and**
  `FAILOVER_MIN_DWELL` (1800s = 30 min) must have passed since the last switch.
  Worst case churn: one Meta-visible egress-IP change per 30 minutes. A phone
  flapping every few minutes keeps resetting its counter and stays demoted.
- **Verification & quarantine**: after `tailscale set`, the new path must answer
  through the proxy within ~60s. A failed promotion reverts to the old tier and
  quarantines the candidate for `FAILOVER_QUARANTINE` (3600s) — catches "phone in
  tailnet but 4G data dead". A failed demotion cascades to the next-worse tier.
  If the whole cascade fails (total outage), the session restart is **deferred**
  until the next successful proxy check — restarting sessions with no working
  path would only churn them into FAILED.
- **Session restarts**: after every verified switch the watchdog calls the WAHA
  API (`GET /api/sessions` with 3 retries — a listing failure is logged as an
  `error`, never mistaken for "no sessions"; filter
  `config.proxy.server == "ts-bridge:8080"` and `status != STOPPED`; names are
  URI-encoded since this fork allows arbitrary session names; then
  `POST /api/sessions/{name}/restart` with 3 retries per session). The watchdog
  needs the PLAIN API key — if `WAHA_API_KEY` is stored hashed (`sha512:…`),
  set `WAHA_API_KEY_PLAIN` (compose falls back automatically; a hash is
  detected and logged as an `error`).
  Old Baileys sockets are dead after an egress change either way; the restart
  makes reconnection immediate and deterministic. Suppressed during the first 90s
  after container start (WAHA is booting too). A full WAHA-container restart is
  neither possible from inside compose on Coolify (no docker socket) nor needed —
  the proxy endpoint sessions point at never changes.

### Why single-container (watchdog inside ts-bridge)

- The active-path check must exercise `localhost:8080`; the CLI needs
  containerboot's socket (`/tmp/tailscaled.sock`).
- One failure domain: containerboot dies → wrapper exits 1 → `restart: always`
  restarts both atomically.
- In userspace Tailscale only **proxied** traffic rides the exit node. The
  watchdog's own psql (logging) and curl to `waha:3000` (restarts) go direct over
  the docker network — structurally immune to exit-node failures.

## Observability (Coolify has no logs/SSH — Postgres is the only channel)

Table `ts_bridge_failover` in the `BAN_PREVENTION_DATABASE_URL` database
(auto-created, 30-day retention pruned at startup):

| column | meaning |
|---|---|
| `event` | `startup` \| `switch` \| `switch_failed` \| `recovery_progress` \| `sessions_restart` \| `heartbeat` \| `error` |
| `from_node` / `to_node` | `phone1` \| `phone2` \| `direct` |
| `reason` | human-readable trigger |
| `phone1_online` / `phone2_online` | peer flags at log time |
| `proxy_ip` | last egress IP seen through the proxy (or `CHECK_FAILED`) |
| `detail` | counters, session restart results, error text |

Logging is strictly best-effort (`|| true`, 5s connect timeout, always *after*
the state change) — Postgres being down degrades observability only, never
failover.

### Runbook queries

```sql
-- what happened lately
SELECT at, event, from_node, to_node, reason, proxy_ip, detail
FROM ts_bridge_failover ORDER BY at DESC LIMIT 50;

-- current state (last heartbeat/switch)
SELECT * FROM ts_bridge_failover
WHERE event IN ('switch','heartbeat') ORDER BY at DESC LIMIT 5;

-- churn audit: switches per day
SELECT date_trunc('day', at) d, count(*) FROM ts_bridge_failover
WHERE event = 'switch' GROUP BY 1 ORDER BY 1 DESC;
```

Heartbeat cadence: one row every ~15 min. No heartbeats + no startup row after a
deploy → the bind mount of `scripts/ts-bridge-failover.sh` failed or the
container is stuck pre-backend (check `ts_bridge_probe` and the `error` events).

## Env vars (Coolify)

| var | required | notes |
|---|---|---|
| `TS_AUTHKEY` | yes | reusable, no/long expiry (existing) |
| `PHONE_TS_IP` | yes | phone 1 Tailscale IP (existing) |
| `PHONE_TS_IP_2` | no | phone 2 Tailscale IP (new; empty = tier skipped) |
| `BAN_PREVENTION_DATABASE_URL` | yes | log destination (existing) |
| `WAHA_API_KEY` | yes | reused for session restarts (existing) |
| `WAHA_API_KEY_PLAIN` | only if key is hashed | plain key for watchdog auth when `WAHA_API_KEY=sha512:…` |
| `FAILOVER_*` | no | tunables, defaults in compose/script |

## Failure-mode guarantees

| Scenario | Behavior |
|---|---|
| Phone 1 dies | ~60–75s → demote to phone 2 (or direct), verify, restart sessions, log |
| Both phones dead | Direct Hetzner egress; sessions stay alive (logged) |
| Phone recovers | Promote after 5 min continuous online + 30 min dwell; one restart cycle |
| Phone flaps every 2 min | Stays demoted; zero churn |
| Phone in tailnet, 4G data dead | Promotion verify fails → revert + 1h quarantine |
| Postgres down | Failover fully functional; log rows dropped |
| WAHA API down during restart | 3 retries, logged; Baileys reconnects organically |
| containerboot crashes | Wrapper exits 1 → `restart: always` → clean re-election |
| All phones offline at deploy | containerboot starts anyway — crash-loop eliminated |

## Production drill

1. Deploy; confirm `startup` row + heartbeats in `ts_bridge_failover`, and
   `ts_bridge_probe` shows the India mobile IP.
2. Turn phone 1's Tailscale/data off → expect `switch` (phone1→phone2) +
   `sessions_restart` rows within ~2 min; sessions back to `WORKING`.
3. Turn phone 1 back on → `recovery_progress` rows, then exactly one `switch`
   back after ~35 min.
4. Turn both phones off → `switch` to `direct`; sessions keep working on the
   Hetzner IP.
