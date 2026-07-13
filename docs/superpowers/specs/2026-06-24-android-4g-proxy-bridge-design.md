# Android 4G Proxy Bridge for WAHA — Design / Runbook

Date: 2026-06-24
Status: Approved design, pending implementation
Author: pairing session (Amol + Claude)

> **Partially superseded (2026-07-13):** the exit node is no longer set via
> `TS_EXTRA_ARGS` at container boot (that made the phone a hard single point of
> failure — phone off → containerboot crash-loop → proxy down → all sessions
> dead). It is now runtime-managed by a failover watchdog with the chain
> phone1 → phone2 → direct Hetzner egress.
> See `2026-07-13-tailscale-exit-node-failover.md`.

## Problem

WAHA (NOWEB/Baileys engine) runs in a Docker container on a Hetzner datacenter IP
(`94.136.188.253`, via Coolify). WhatsApp/Meta flags datacenter ASNs; the +91 number
also has a geo mismatch (India number, EU server IP). Both raise ban/block risk and
shorten session life. Paid India residential/4G proxies (~$32–79/mo) are out of budget.

Goal: route the WhatsApp connection through a spare Android phone on India 4G so Meta
sees an India mobile carrier IP, at zero recurring cost.

## Constraints

- No SSH to the host (root denied). Only Coolify API/UI + the repo we build.
- WAHA app deploys via Coolify `build_pack: dockercompose` from `/docker-compose.yaml`
  on branch `core` → editing that compose + pushing redeploys.
- WAHA fork proxy support is **HTTP/HTTPS only** (`helpers.proxy.ts` uses
  `HttpsProxyAgent` + undici `ProxyAgent`); sets both socket + fetch agents (no IP leak).
  IPv4 only (NOWEB IPv6 proxy bug, devlikeapro/waha#1685).
- Phone is on **4G SIM, fixed location, 24/7** → behind CGNAT (cannot accept inbound),
  high-trust carrier ASN, exit IP shifts occasionally.
- 2–3 WhatsApp numbers planned; **one** spare phone available.

## Architecture

```
WAHA container ──HTTP proxy──► ts-bridge sidecar ──WireGuard──► Android (exit node) ──4G──► WhatsApp
   (Coolify)      ts-bridge:8080  (userspace, no caps)          Jio/Airtel IP
       └──────────── same docker-compose project network ───────────────┘
```

CGNAT is crossed by Tailscale (both ends dial out to coordination; WireGuard P2P/DERP).
The phone's Tailscale IP is stable even when its 4G IP churns, so the WAHA↔phone link
never breaks on CGNAT reassignment — only the final WhatsApp-facing IP shifts.

Verified facts (official Tailscale docs, 2026):
- Android can advertise as an exit node (GA). "Not performant" warning is about
  throughput — irrelevant for ~5–20 MB/day chat traffic.
- `tailscale/tailscale` container in **userspace mode** (`TS_USERSPACE=true`, default)
  needs **no** `NET_ADMIN` / `/dev/net/tun`.
- Userspace SOCKS5/HTTP proxy honors the configured exit node for public internet
  (Tailscale ≥1.20). So a sibling container using `ts-bridge:8080` egresses via the phone.

## Components

### 1. Phone — Tailscale exit node
- Tailscale app, sign in to the tailnet.
- Enable "Run as exit node"; approve in admin console (Machines → phone → Use as exit node).
- **Disable key expiry** on the phone node.
- Battery optimization OFF for Tailscale; auto-start on boot ON; mobile data always-on;
  plugged in 24/7 at fixed location; ventilated; optional charge cap ~80%.

### 2. `ts-bridge` sidecar — added to `docker-compose.yaml`
```yaml
  ts-bridge:
    image: tailscale/tailscale:latest
    restart: always
    hostname: waha-ts-bridge
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}                 # Coolify env (secret, reusable, no/long expiry)
      - TS_USERSPACE=true                         # no NET_ADMIN / /dev/net/tun
      - TS_EXTRA_ARGS=--exit-node=${PHONE_TS_IP} --exit-node-allow-lan-access
      - TS_OUTBOUND_HTTP_PROXY_LISTEN=0.0.0.0:8080
      - TS_STATE_DIR=/var/lib/tailscale
    volumes:
      - ts-bridge-state:/var/lib/tailscale        # persist node identity across restarts
# (add to the top-level volumes: block)
volumes:
  ts-bridge-state: {}
```
- No `ports:` mapping → the HTTP proxy is reachable only on the internal Coolify network,
  never published to the host. Not an open internet proxy.
- Optional: `waha` service gets `depends_on: [ts-bridge]` for start ordering.

### 3. WAHA wiring — per-session proxy
Point each session (`amolendait`, plus the other 1–2) at the bridge:
```
PUT https://waha.skillit.in/api/sessions/{session}
{ "config": {
    "noweb": { "store": { "enabled": true, "fullSync": false }, "markOnline": false },
    "webhooks": [ <preserve that session's existing webhook(s) verbatim> ],
    "proxy": { "server": "ts-bridge:8080" }
} }
```
- `config` REPLACES the stored config — always resend the session's existing webhooks.
- Reconnects from SQLite auth; no QR.
- `server` has no scheme (fork prepends `http://`). IPv4/service-name only.

## Coolify environment variables (only two new)

| Variable | Value | Notes |
|---|---|---|
| `TS_AUTHKEY` | `tskey-auth-…` | Secret. Reusable, no/long expiry. Sidecar only. |
| `PHONE_TS_IP` | `100.x.y.z` | Phone's Tailscale IP. Fill after phone joins (step 1). |

"Build Variable?" OFF for both. Coolify interpolates `${...}` into `docker_compose_raw`.

## Scaling (2–3 numbers, one phone)

- All 2–3 sessions point at the same `ts-bridge:8080` → share the one phone's IP.
  Household-plausible; acceptable. Risk: if one number gets the IP flagged, the others
  share the blast radius (WhatsApp correlates accounts by IP).
- Fan-out path when a 2nd phone is available: add `ts-bridge-2` (its own `PHONE_TS_IP_2`,
  its own listen port/service name), point some sessions at it. The fork's
  `WHATSAPP_PROXY_SERVER_LIST` + `WHATSAPP_PROXY_SERVER_INDEX_PREFIX` also support
  session→proxy mapping. Bandwidth is never the limit; IP-sharing is.

## Resilience & monitoring

- No-expiry auth key + disable node key expiry on BOTH phone and sidecar (else the bridge
  silently de-auths in ~180 days → session drops).
- `restart: always` (sidecar) + autostart-on-boot (phone apps).
- Health probe: periodic `curl --proxy http://ts-bridge:8080 https://api.ipify.org`
  → expect an India mobile IP. Alert via the existing n8n `session.status` webhook if the
  WAHA session leaves WORKING.

## Tradeoffs & failure modes

- Phone becomes critical path: the whole WA websocket rides it. Phone off / no signal /
  reboot-without-autostart → session drops until recovery. Trading datacenter-ban-risk for
  phone-uptime-dependency. Acceptable for a plugged-in fixed-spot spare phone.
- 4G CGNAT exit IP shifts occasionally → rare WhatsApp "IP changed" events; low-risk
  (same carrier/city), still far better than datacenter.
- Tailscale ACLs keep the proxy private; verify it is never published to the host.

## Rollback

Drop `proxy` from a session's config (PUT without the `proxy` key) → instantly back to the
direct datacenter connection. The `ts-bridge` sidecar is harmless when unused. Removing the
sidecar = revert the compose change + push.

## Runbook (ordered)

1. Phone: install Tailscale, sign in, advertise exit node, approve in admin, disable key
   expiry, battery/autostart settings, plug in. Note its `100.x.y.z`.
2. Tailscale admin: generate a reusable, no/long-expiry auth key.
3. Coolify: add `TS_AUTHKEY` and `PHONE_TS_IP` env vars.
4. Repo (`core`): add the `ts-bridge` service + `ts-bridge-state` volume to
   `docker-compose.yaml`; push → Coolify redeploys.
5. Verify: `ts-bridge` appears in Tailscale admin; disable its key expiry; run the health
   probe → confirm India mobile exit IP.
6. PUT each session's config with `proxy.server = ts-bridge:8080` (preserve webhooks);
   confirm each returns to WORKING (no QR).
7. Observe for a few days; watch `session.status`; capture any disconnect code.

## Open items / verification

- Confirm Coolify interpolates `${TS_AUTHKEY}`/`${PHONE_TS_IP}` into compose (expected yes).
- Confirm the `waha` and `ts-bridge` services share the Coolify project network and resolve
  by service name (expected yes for single-compose deploy).
- Separately: Coolify reports the app `running:unhealthy` (healthcheck mismatch though the
  session is WORKING) — investigate the healthcheck definition; not blocking this work.
