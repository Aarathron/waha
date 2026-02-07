# WhatsApp Mass Messaging Strategy — Anti-Ban Playbook

> Internal reference for sending broadcast messages to 2,000+ contacts via WAHA without triggering WhatsApp bans.
>
> Last updated: 2026-02-07

---

## Table of Contents

1. [Understanding WhatsApp's Detection System](#1-understanding-whatsapps-detection-system)
2. [Hard Limits and Safe Thresholds](#2-hard-limits-and-safe-thresholds)
3. [Number Warm-Up Protocol](#3-number-warm-up-protocol)
4. [Sending Architecture](#4-sending-architecture)
5. [Message Content Rules](#5-message-content-rules)
6. [Contact List Hygiene](#6-contact-list-hygiene)
7. [Multi-Number Strategy for 2,000+ Contacts](#7-multi-number-strategy-for-2000-contacts)
8. [Monitoring and Circuit Breakers](#8-monitoring-and-circuit-breakers)
9. [Recovery Protocol (If Banned)](#9-recovery-protocol-if-banned)
10. [Technical Implementation Guide](#10-technical-implementation-guide)
11. [Risk Assessment](#11-risk-assessment)

---

## 1. Understanding WhatsApp's Detection System

WhatsApp does **not** use simple hard rate limits. It uses a **behavioral AI/ML scoring system** that evaluates trust across multiple dimensions:

### What WhatsApp Monitors

| Signal | Weight | Description |
|--------|--------|-------------|
| **Send velocity** | High | Messages per minute/hour, sudden spikes |
| **Reply ratio** | High | % of recipients who respond to your messages |
| **Block/report rate** | Critical | Even 2-3 reports in a short window can trigger a ban |
| **Contact relationship** | High | Whether recipient has your number saved |
| **Message similarity** | Medium | Identical messages to many recipients |
| **Account age** | Medium | New accounts are under stricter scrutiny |
| **Activity pattern** | Medium | Human-like vs bot-like sending patterns |
| **Content signals** | Medium | Links, media, forwarded content, spam keywords |
| **Online/offline pattern** | Low | Always-online accounts look automated |

### How Bans Escalate

```
Warning (quality rating drops)
    |
    v
Temporary Ban (30 min - 48 hours)
    |
    v
Extended Temporary Ban (up to 60 days)
    |
    v
Permanent Ban (number blacklisted, no recovery)
```

**Key insight**: WhatsApp's system builds a **trust score** over time. High engagement (replies, saves) increases trust. Reports, blocks, and bot-like patterns destroy it. Every action either deposits into or withdraws from this trust account.

---

## 2. Hard Limits and Safe Thresholds

### Daily Sending Limits

| Account Type | Conservative (Safe) | Moderate (Some Risk) | Aggressive (High Risk) |
|---|---|---|---|
| **New number (< 10 days)** | 20/day | 30/day | 50/day |
| **Warming number (10-30 days)** | 50/day | 100/day | 150/day |
| **Established number (30+ days)** | 200/day | 300/day | 500/day |
| **Well-aged, high-trust number** | 300/day | 500/day | 800/day |

### Delay Between Messages

| Risk Level | Delay | With Jitter |
|---|---|---|
| **Ultra-safe** | 60 seconds | 45-75 seconds |
| **Conservative** | 30 seconds | 20-40 seconds |
| **Moderate** | 15 seconds | 10-25 seconds |
| **Aggressive** | 8 seconds | 5-15 seconds |

**Recommendation**: Start at conservative and only move to moderate after 2+ weeks of zero issues.

### Session Limits

| Constraint | Limit |
|---|---|
| Campaign hours per day | Max 8 hours |
| Consecutive campaign days | Max 3, then 1 day rest |
| Messages per hour | Max 50 (conservative) |
| Unique new contacts per day | Max 20 (first 10 days) |

---

## 3. Number Warm-Up Protocol

Every new WhatsApp number used for broadcasting **must** go through a warm-up period. Skipping this is the #1 cause of early bans.

### Week-by-Week Schedule

#### Week 0: Registration (Day 1-2)
- Register the number on a real phone
- Complete WhatsApp profile (photo, about, status)
- **Wait 24 hours** before linking to WAHA/Web
- Join 2-3 group chats
- Send/receive messages with 5-10 known contacts who have your number saved

#### Week 1: Light Activity (Day 3-9)
- Send to **5 contacts/day** maximum
- Only message contacts who have your number saved
- Have genuine back-and-forth conversations
- Reply to messages promptly
- Post 1-2 status updates

#### Week 2: Gradual Increase (Day 10-16)
- Increase to **10-15 contacts/day**
- Start messaging contacts who may not have your number saved (but opted in)
- Continue genuine conversations
- Maintain >50% reply rate

#### Week 3: Moderate Volume (Day 17-23)
- Increase to **20-30 contacts/day**
- Begin using message templates with personalization
- Monitor for any quality warnings
- Track reply and block rates

#### Week 4+: Production Ready
- Scale to **50-100 contacts/day**
- Gradually increase to 200/day over the next 2 weeks
- If zero issues for 2+ weeks at 200/day, cautiously test 300/day

### Warm-Up Rules
- **Never skip warm-up**. A fresh number sending 200 messages on day 1 will be banned within hours
- **Each number warms independently**. You cannot transfer trust between numbers
- **Trust degrades if unused**. A number dormant for 30+ days needs partial re-warming (1 week)
- **Bans on one number do NOT affect others** (unless on the same device/IP pattern)

---

## 4. Sending Architecture

### Queue-Based Sending (Required)

Never send messages in a tight loop. Use a proper queue system.

```
                                   +---> [WAHA Session 1] ---> WhatsApp
                                   |
[Contact List] --> [Message Queue] +---> [WAHA Session 2] ---> WhatsApp
                   (Redis/BullMQ)  |
                                   +---> [WAHA Session 3] ---> WhatsApp
```

### Delay Calculation with Jitter

```
delay = BASE_DELAY + random(0, JITTER_RANGE)
```

| Parameter | Value |
|---|---|
| `BASE_DELAY` | 20 seconds |
| `JITTER_RANGE` | 15 seconds |
| Effective range | 20-35 seconds between messages |

**Why jitter matters**: Fixed intervals (exactly 20s, 20s, 20s) look automated. Random intervals (23s, 18s, 31s, 22s) look human.

### Sending Windows

Mimic human behavior by sending during business hours with natural patterns:

```
06:00 - 09:00  |  Light sending (30% speed)
09:00 - 12:00  |  Peak sending (100% speed)
12:00 - 14:00  |  Reduced (lunch, 50% speed)
14:00 - 18:00  |  Peak sending (100% speed)
18:00 - 21:00  |  Light sending (30% speed)
21:00 - 06:00  |  NO SENDING
```

### Activity Simulation

Between message sends, simulate human-like activity:
- Mark some incoming messages as read
- Occasionally go "offline" for 5-15 minutes
- Change online/offline presence naturally
- Don't maintain 24/7 online presence

---

## 5. Message Content Rules

### DO

- **Personalize every message**: Use the recipient's name, reference their context
- **Vary content**: Use 5-10 template variants and rotate them
- **Include a question**: Prompts replies, which boost your trust score
- **Add unsubscribe option**: "Reply STOP to opt out" — reduces report rate
- **Keep it short**: 1-3 sentences perform better than long messages
- **Send text first**: Text-only messages are lowest risk

### DO NOT

- **Never send identical messages** to all recipients — this is the strongest spam signal
- **Avoid URLs in first messages** — links dramatically increase ban risk
- **Don't forward messages** — forwarded content is flagged differently
- **Avoid spam keywords**: "FREE", "OFFER", "CLICK HERE", "LIMITED TIME", excessive caps
- **Don't send only media** — a message with just an image and no context looks spammy
- **Never send to contacts who blocked/reported you before**

### Template Rotation Example

Instead of one message to all 2,000 contacts:

```
Template A: "Hi {name}, wanted to share an update about {topic}. What do you think?"
Template B: "Hey {name}! Quick question about {topic} — would love your thoughts."
Template C: "{name}, we've got something new on {topic}. Interested in hearing more?"
Template D: "Hi {name}, hope you're well! Reaching out about {topic}. Any thoughts?"
Template E: "Hey {name} - got a minute? Wanted to discuss {topic} with you."
```

Rotate across these with random selection per recipient.

### Media Strategy

| Content Type | Risk Level | Guidance |
|---|---|---|
| Text only | Lowest | Prefer for first contact |
| Text + 1 image | Low | Good for follow-ups |
| Document/PDF | Medium | Only to engaged contacts |
| Link/URL | High | Avoid in broadcasts, use in replies |
| Video | Medium | Only to warm contacts |
| Forwarded content | High | Never use in broadcasts |

---

## 6. Contact List Hygiene

### Before Any Campaign

1. **Verify all numbers exist on WhatsApp**
   - Use WAHA's `/api/contacts/check-exists` endpoint
   - Do this in batches of 50, with 2-second delays between batches
   - Remove numbers that don't exist — sending to non-existent numbers wastes rate limit and looks spammy

2. **Remove previously blocked/reported contacts**
   - Maintain a permanent blocklist
   - Never re-add contacts who opted out

3. **Segment by engagement history**

   | Segment | Description | Priority |
   |---|---|---|
   | **Hot** | Replied to previous messages | Send first |
   | **Warm** | Have your number saved, no reply yet | Send second |
   | **Cold** | Opted in but never engaged | Send last, carefully |
   | **Dead** | Blocked/reported/opted out | Never send |

4. **Validate phone number format**
   - Must include country code (e.g., `919511936948`, not `9511936948`)
   - No `+` prefix, no spaces, no dashes
   - No leading zeros after country code

### Ongoing Maintenance

- After every campaign, move contacts who replied to "Hot"
- Move contacts who blocked/reported to "Dead" permanently
- Re-verify numbers monthly (people change numbers)
- Track per-contact engagement score over time

---

## 7. Multi-Number Strategy for 2,000+ Contacts

To reach 2,000+ contacts safely, distribute across multiple warmed-up numbers.

### Recommended Setup

| Numbers | Contacts/Number/Day | Total/Day | Days to Reach 2,000 |
|---|---|---|---|
| 3 numbers | 200 each | 600/day | ~3.5 days |
| 5 numbers | 200 each | 1,000/day | 2 days |
| 5 numbers | 150 each (safer) | 750/day | ~3 days |

### Number Allocation Strategy

```
Number 1: Contacts   1 - 400   (200/day over 2 days)
Number 2: Contacts 401 - 800   (200/day over 2 days)
Number 3: Contacts 801 - 1200  (200/day over 2 days)
Number 4: Contacts 1201 - 1600 (200/day over 2 days)
Number 5: Contacts 1601 - 2000 (200/day over 2 days)
```

### WAHA Session Configuration

Each number runs as a separate WAHA session:

```
Session "broadcast-1" → Number 1 → Contacts 1-400
Session "broadcast-2" → Number 2 → Contacts 401-800
Session "broadcast-3" → Number 3 → Contacts 801-1200
Session "broadcast-4" → Number 4 → Contacts 1201-1600
Session "broadcast-5" → Number 5 → Contacts 1601-2000
```

### Number Isolation Rules

- **Different SIM cards** — don't use numbers from the same batch/provider
- **Stagger send times** — don't start all 5 numbers at the same minute
- **Independent warm-up** — each number must complete its own warm-up cycle
- **Separate failure domains** — if one number gets banned, others should be unaffected

### Staggered Start Schedule

```
Session 1: Start at 09:00
Session 2: Start at 09:15
Session 3: Start at 09:30
Session 4: Start at 10:00
Session 5: Start at 10:15
```

---

## 8. Monitoring and Circuit Breakers

### Metrics to Track (Per Number)

| Metric | Healthy | Warning | Critical — STOP |
|---|---|---|---|
| **Reply rate** | > 30% | 10-30% | < 10% |
| **Block rate** | < 1% | 1-3% | > 3% |
| **Delivery failures** | < 2% | 2-5% | > 5% |
| **Send errors (4xx/5xx)** | 0 | 1-2 per hour | > 3 per hour |
| **Connection drops** | 0 | 1 per day | > 2 per day |
| **Quality rating** (if visible) | High | Medium | Low |

### Circuit Breaker Logic

Implement automatic stop conditions:

```
IF block_rate > 3% in last 100 messages:
    STOP sending immediately
    ALERT team
    WAIT 24 hours before resuming at 50% volume

IF delivery_failures > 5% in last 50 messages:
    PAUSE for 30 minutes
    RETRY at 50% speed
    IF still failing: STOP and investigate

IF connection_drops > 2 in 1 hour:
    STOP sending
    Check session health
    May indicate impending ban

IF send_errors > 3 in 1 hour:
    PAUSE for 15 minutes
    Reduce speed by 50%
    IF continues: STOP session

IF temporary_ban detected (401/403):
    STOP immediately
    DO NOT retry
    Wait full ban duration + 24 hours buffer
    Resume at 25% volume, gradually increase
```

### Alerting

Set up alerts for:
- Any temporary ban (immediate notification)
- Block rate exceeding 2% (within 1 hour)
- Reply rate dropping below 15% (daily check)
- Session disconnections (immediate)
- Delivery failure spikes (within 30 minutes)

---

## 9. Recovery Protocol (If Banned)

### Temporary Ban (30 min - 48 hours)

1. **Stop all sending immediately** — do not attempt to send even 1 message
2. **Do not restart the session** — leave it disconnected
3. Wait the **full ban duration + 24 hours** buffer
4. Resume with the number at **25% of previous volume**
5. Gradually increase over 1 week back to normal volume
6. Investigate what triggered the ban (check block rate, content, velocity)

### Extended Ban (up to 60 days)

1. This number is effectively out of rotation for the ban period
2. **Shift its contacts to other numbers** (respecting their limits)
3. After ban lifts, treat the number as **requiring full re-warm-up**
4. Consider retiring the number if it was banned twice

### Permanent Ban

1. The number is lost. Do not attempt recovery
2. Remove from all systems
3. **Audit what went wrong** — was it content, velocity, or reports?
4. Ensure the same mistake isn't being made on other numbers
5. Provision a replacement number and begin warm-up

### Post-Ban Audit Checklist

- [ ] Review send velocity at time of ban
- [ ] Check block/report rate in the 24 hours before ban
- [ ] Analyze message content that was being sent
- [ ] Check if any contacts reported the number
- [ ] Verify warm-up was completed before bulk sending
- [ ] Review if identical messages were sent
- [ ] Check for unusual connection patterns

---

## 10. Technical Implementation Guide

### Recommended Queue Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Campaign    │     │  Redis/Bull  │     │   Workers    │
│  Manager     │────>│  Job Queue   │────>│  (per WAHA   │
│  (API/UI)    │     │              │     │   session)   │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                          ┌──────────────────────┼──────────────────────┐
                          │                      │                      │
                    ┌─────v─────┐          ┌─────v─────┐          ┌─────v─────┐
                    │  WAHA     │          │  WAHA     │          │  WAHA     │
                    │  Session 1│          │  Session 2│          │  Session 3│
                    └───────────┘          └───────────┘          └───────────┘
```

### Per-Message Send Flow

```
1. Dequeue next contact from job queue
2. Check circuit breaker status → if tripped, re-queue with delay
3. Check if contact was recently messaged → skip if within 24h
4. Select random message template
5. Personalize template with contact data
6. Calculate delay: BASE_DELAY + random(0, JITTER)
7. Wait the calculated delay
8. Send message via WAHA API: POST /api/sendText
9. Record result (success/failure/error)
10. Update contact engagement record
11. Update metrics (send count, failure count)
12. Check circuit breaker thresholds
13. If approaching daily limit → stop worker
```

### WAHA API Calls for Broadcasting

```bash
# 1. Verify number exists (do this in advance, not at send time)
POST /api/contacts/check-exists
{
  "phone": "919511936948",
  "session": "broadcast-1"
}

# 2. Send personalized message
POST /api/sendText
{
  "chatId": "919511936948@c.us",
  "text": "Hi Amol, wanted to share...",
  "session": "broadcast-1"
}

# 3. Monitor session health
GET /api/sessions?all=true
```

### Database Schema (Tracking)

```sql
-- Contact engagement tracking
CREATE TABLE broadcast_contacts (
    phone           VARCHAR(20) PRIMARY KEY,
    name            VARCHAR(255),
    segment         ENUM('hot', 'warm', 'cold', 'dead'),
    last_sent_at    TIMESTAMP,
    last_replied_at TIMESTAMP,
    send_count      INT DEFAULT 0,
    reply_count     INT DEFAULT 0,
    blocked         BOOLEAN DEFAULT FALSE,
    assigned_number VARCHAR(20)  -- which broadcast number handles this contact
);

-- Campaign tracking
CREATE TABLE broadcast_campaigns (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255),
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    total_contacts  INT,
    sent_count      INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    replied_count   INT DEFAULT 0,
    failed_count    INT DEFAULT 0,
    blocked_count   INT DEFAULT 0,
    status          ENUM('queued', 'running', 'paused', 'completed', 'aborted')
);

-- Per-message log
CREATE TABLE broadcast_messages (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id     INT,
    phone           VARCHAR(20),
    session_name    VARCHAR(50),
    template_used   VARCHAR(50),
    sent_at         TIMESTAMP,
    status          ENUM('sent', 'delivered', 'read', 'replied', 'failed', 'blocked'),
    error_message   TEXT,
    waha_message_id VARCHAR(100)
);

-- Number health tracking
CREATE TABLE broadcast_numbers (
    phone           VARCHAR(20) PRIMARY KEY,
    session_name    VARCHAR(50),
    status          ENUM('warming', 'active', 'paused', 'banned', 'retired'),
    warm_up_day     INT DEFAULT 0,
    daily_sent      INT DEFAULT 0,
    daily_limit     INT DEFAULT 200,
    total_sent      INT DEFAULT 0,
    total_blocked   INT DEFAULT 0,
    last_ban_at     TIMESTAMP NULL,
    ban_count       INT DEFAULT 0
);
```

---

## 11. Risk Assessment

### Using WAHA/Baileys (Unofficial API) for Broadcasting

| Factor | Assessment |
|---|---|
| **Ban risk** | **HIGH** — WhatsApp actively detects and bans unofficial API usage |
| **2024 ban wave** | Baileys users reported sudden bans after years of stability |
| **Detection method** | Behavioral analysis + browser fingerprinting |
| **Account recovery** | Temporary bans are recoverable; permanent bans are not |
| **Legal risk** | Violates WhatsApp ToS; not illegal but account can be terminated |

### Risk Mitigation Priority

1. **Never use your primary business number** for broadcasting
2. **Use dedicated SIM cards** that you can afford to lose
3. **Follow this playbook strictly** — most bans come from skipping warm-up or sending too fast
4. **Monitor aggressively** — catch issues early before they escalate to permanent bans
5. **Have backup numbers** warmed up and ready to rotate in
6. **Consider official WhatsApp Business API** for compliance-critical campaigns

### Official API Comparison

| Feature | WAHA (Unofficial) | WhatsApp Business API (Official) |
|---|---|---|
| Cost | Free / self-hosted | Per-message pricing |
| Ban risk | High | Very low (within limits) |
| Daily limit | ~200/number (safe) | 1K → 10K → 100K (tiered) |
| Warm-up needed | Yes, weeks | Minimal |
| Template approval | Not needed | Required for outbound |
| Support | Community | Meta support |
| Best for | Small scale, testing | Production broadcasting |

---

## Quick Reference Card

```
BEFORE CAMPAIGN:
  [ ] All numbers warmed up (4+ weeks)
  [ ] Contact list verified (numbers exist on WhatsApp)
  [ ] Dead contacts removed
  [ ] 5+ message templates prepared
  [ ] Circuit breakers configured
  [ ] Monitoring/alerting active

DURING CAMPAIGN:
  [ ] Max 200 messages/number/day
  [ ] 20-35 second delay with jitter
  [ ] Sending only during business hours
  [ ] Templates rotating randomly
  [ ] Metrics dashboard open
  [ ] Reply rate above 30%

AFTER CAMPAIGN:
  [ ] Update contact segments based on engagement
  [ ] Review block/report rates
  [ ] Add blockers to dead list
  [ ] Calculate campaign effectiveness
  [ ] Rest numbers for 1 day before next campaign
```
