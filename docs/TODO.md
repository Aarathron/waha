# TODO List
# WhatsApp API Service - Complete Implementation Checklist

**Version**: 1.0
**Last Updated**: January 2, 2026

Each task includes:
- **Task description**
- **Verification steps**
- **Edge cases to test**
- **Definition of Done**

---

## Legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked

**Priority**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Phase 0: Prerequisites & Setup

### 0.1 Environment Setup

#### 0.1.1 Development Machine Setup
- [ ] 🔴 Install Docker Desktop (24.x+)
  - **Verification**: Run `docker --version` → Should show 24.x or higher
  - **Edge Case**: On Linux, ensure user is in docker group (`sudo usermod -aG docker $USER`)
  - **DoD**: Can run `docker run hello-world` without sudo

- [ ] 🔴 Install Node.js 20 LTS
  - **Verification**: Run `node --version` → Should show v20.x.x
  - **Edge Case**: If using nvm, run `nvm use 20`
  - **DoD**: `node -e "console.log('OK')"` executes successfully

- [ ] 🔴 Install pnpm (preferred) or npm
  - **Verification**: Run `pnpm --version` → Should show 8.x+
  - **Edge Case**: If npm only, adjust all pnpm commands in docs
  - **DoD**: Can install packages globally

- [ ] 🟠 Install PostgreSQL client tools
  - **Verification**: Run `psql --version`
  - **Edge Case**: Not needed if using Docker-only PostgreSQL
  - **DoD**: Can connect to local/remote PostgreSQL

- [ ] 🟠 Install Git
  - **Verification**: Run `git --version`
  - **Edge Case**: Configure user.name and user.email
  - **DoD**: Can clone repositories

#### 0.1.2 External Accounts
- [ ] 🔴 GitHub account with SSH key configured
  - **Verification**: Run `ssh -T git@github.com` → "Hi username!"
  - **Edge Case**: Firewall may block port 22; use HTTPS fallback
  - **DoD**: Can clone private repositories

- [ ] 🟡 Obtain test WhatsApp number (burner)
  - **Verification**: Can receive SMS for WhatsApp verification
  - **Edge Case**: Some virtual numbers blocked by WhatsApp
  - **DoD**: WhatsApp installed and verified on test device

- [ ] 🟡 VPS provider account (for production)
  - **Verification**: Can create and SSH into droplet/instance
  - **Edge Case**: Some providers require ID verification
  - **DoD**: API access configured if needed

---

### 0.2 WAHA Fork Setup

#### 0.2.1 Fork Repository
- [ ] 🔴 Fork WAHA to personal GitHub
  - **Verification**: Repository appears in your GitHub profile
  - **Edge Case**: If organization fork, ensure write access
  - **DoD**: Fork URL accessible: `github.com/YOUR_USERNAME/waha`

- [ ] 🔴 Clone forked repository locally
  ```bash
  git clone git@github.com:YOUR_USERNAME/waha.git
  cd waha
  ```
  - **Verification**: `ls -la` shows WAHA files
  - **Edge Case**: Large repo; may take time on slow connections
  - **DoD**: Can see `package.json`, `docker-compose.yml`

- [ ] 🔴 Add upstream remote
  ```bash
  git remote add upstream https://github.com/devlikeapro/waha.git
  git fetch upstream
  ```
  - **Verification**: `git remote -v` shows both origin and upstream
  - **Edge Case**: N/A
  - **DoD**: Can fetch updates from original WAHA

#### 0.2.2 Initial WAHA Test
- [ ] 🔴 Run WAHA with Docker (quick test)
  ```bash
  docker run -it -p 3000:3000 \
    -e "WHATSAPP_DEFAULT_ENGINE=NOWEB" \
    -e "WAHA_API_KEY=test-api-key" \
    devlikeapro/waha
  ```
  - **Verification**: Access http://localhost:3000 → Shows WAHA dashboard
  - **Edge Case**: Port 3000 may be in use; change port mapping
  - **DoD**: Dashboard accessible, no errors in logs

- [ ] 🔴 Test API key authentication
  ```bash
  curl -X GET http://localhost:3000/api/sessions \
    -H "X-Api-Key: test-api-key"
  ```
  - **Verification**: Returns `{"sessions": []}`
  - **Edge Case**: Wrong API key returns 401
  - **DoD**: Can authenticate with configured key

- [ ] 🔴 Create test session
  ```bash
  curl -X POST http://localhost:3000/api/sessions \
    -H "X-Api-Key: test-api-key" \
    -H "Content-Type: application/json" \
    -d '{"name": "test-session"}'
  ```
  - **Verification**: Returns session object with status "STARTING"
  - **Edge Case**: Duplicate name returns error
  - **DoD**: Session created, QR code available

- [ ] 🔴 Scan QR code and connect
  - **Verification**: Session status changes to "CONNECTED"
  - **Edge Case**: QR expires after 20s; refresh needed
  - **DoD**: `GET /api/sessions/test-session` shows `"status": "CONNECTED"`

- [ ] 🔴 Send test message
  ```bash
  curl -X POST http://localhost:3000/api/sendText \
    -H "X-Api-Key: test-api-key" \
    -H "Content-Type: application/json" \
    -d '{
      "session": "test-session",
      "chatId": "YOUR_NUMBER@c.us",
      "text": "Test from WAHA!"
    }'
  ```
  - **Verification**: Message appears on recipient's WhatsApp
  - **Edge Case**: Invalid phone format; must be `NUMBER@c.us`
  - **DoD**: Message delivered, messageId returned

---

## Phase 1: Database & Ban Prevention Foundation (Week 1)

### 1.1 Database Setup

#### 1.1.1 PostgreSQL with Docker Compose
- [ ] 🔴 Create custom docker-compose.yml
  ```yaml
  # Create file: docker-compose.dev.yml
  ```
  - **Verification**: File exists in project root
  - **Edge Case**: N/A
  - **DoD**: Valid YAML syntax

- [ ] 🔴 Add PostgreSQL service to compose
  - **Verification**: `docker-compose -f docker-compose.dev.yml config` validates
  - **Edge Case**: Port 5432 conflicts; use alternative
  - **DoD**: PostgreSQL container starts

- [ ] 🔴 Add Redis service to compose
  - **Verification**: Redis container starts, port 6379 accessible
  - **Edge Case**: Memory limits for Redis on low-RAM machines
  - **DoD**: `redis-cli ping` returns "PONG"

- [ ] 🔴 Configure WAHA to use PostgreSQL
  - **Verification**: WAHA connects to PostgreSQL (check logs)
  - **Edge Case**: Connection refused if DB not ready; add depends_on
  - **DoD**: No DB connection errors in WAHA logs

- [ ] 🔴 Test database persistence
  - **Verification**: Create session, restart containers, session still exists
  - **Edge Case**: Volume not mounted → data lost
  - **DoD**: Sessions survive container restart

#### 1.1.2 Prisma Setup
- [ ] 🔴 Install Prisma dependencies
  ```bash
  npm install @prisma/client
  npm install -D prisma
  ```
  - **Verification**: Packages in node_modules
  - **Edge Case**: Version conflicts with existing deps
  - **DoD**: `npx prisma --version` works

- [ ] 🔴 Initialize Prisma
  ```bash
  npx prisma init
  ```
  - **Verification**: `prisma/` directory created with schema.prisma
  - **Edge Case**: Existing Prisma setup in WAHA (check first)
  - **DoD**: schema.prisma file exists

- [ ] 🔴 Create ban prevention schema
  - **Verification**: Schema includes WarmupConfig, RecipientRateLimit, SafetyMetrics
  - **Edge Case**: Enum syntax differences between Prisma versions
  - **DoD**: `npx prisma validate` passes

- [ ] 🔴 Run initial migration
  ```bash
  npx prisma migrate dev --name init_ban_prevention
  ```
  - **Verification**: Migration files created, tables exist in DB
  - **Edge Case**: DB connection string must be correct
  - **DoD**: `npx prisma studio` shows empty tables

- [ ] 🔴 Generate Prisma client
  ```bash
  npx prisma generate
  ```
  - **Verification**: `node_modules/.prisma/client` exists
  - **Edge Case**: May need to regenerate after schema changes
  - **DoD**: Can import PrismaClient in code

- [ ] 🟠 Test Prisma client connection
  ```typescript
  // Quick test script
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()
  prisma.$connect().then(() => console.log('Connected!'))
  ```
  - **Verification**: "Connected!" printed
  - **Edge Case**: Connection pool exhaustion under load
  - **DoD**: Can perform CRUD operations

---

### 1.2 Warmup Service Implementation

#### 1.2.1 Service Structure
- [ ] 🔴 Create ban-prevention module directory
  ```
  src/ban-prevention/
  ├── ban-prevention.module.ts
  ├── warmup.service.ts
  ├── recipient-rate-limit.service.ts
  ├── message.interceptor.ts
  ├── safety.controller.ts
  └── cron.service.ts
  ```
  - **Verification**: All files created
  - **Edge Case**: NestJS module registration order matters
  - **DoD**: Directory structure matches plan

- [ ] 🔴 Create NestJS module file
  - **Verification**: Module exports all services
  - **Edge Case**: Circular dependencies if importing other WAHA modules
  - **DoD**: `npm run build` succeeds

#### 1.2.2 Warmup Service Core Logic
- [ ] 🔴 Implement WarmupService class
  - **Verification**: Class compiles without errors
  - **Edge Case**: Prisma client initialization timing
  - **DoD**: Service injectable in other classes

- [ ] 🔴 Implement checkMessageAllowed()
  ```typescript
  async checkMessageAllowed(sessionName: string): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  }>
  ```
  - **Verification**: Returns correct decision based on warmup stage
  - **Edge Cases**:
    - New session (no config) → create config, return not allowed
    - Daily quota exceeded → return not allowed with retryAfter
    - Valid quota → return allowed
  - **DoD**: All edge cases handled with tests

- [ ] 🔴 Implement recordMessage()
  - **Verification**: dailyQuota increments by 1
  - **Edge Case**: Race condition if called concurrently
  - **DoD**: Database record updated

- [ ] 🔴 Implement advanceStage()
  - **Verification**: Stage advances based on days since startDate
  - **Edge Cases**:
    - Day 1 → PHASE_1_PROFILE (no change)
    - Day 2 → PHASE_2_RECEIVE
    - Day 3 → PHASE_3_LIMITED
    - Day 7 → PHASE_4_GRADUAL
    - Day 21+ → COMPLETED
  - **DoD**: All stage transitions work correctly

- [ ] 🔴 Implement getSecondsUntilMidnight()
  - **Verification**: Returns correct seconds until local midnight
  - **Edge Case**: Timezone considerations
  - **DoD**: Unit test passes for various times of day

#### 1.2.3 Warmup Service Tests
- [ ] 🟠 Write unit tests for checkMessageAllowed()
  - **Verification**: Tests cover all warmup stages
  - **Edge Cases to test**:
    - Session doesn't exist
    - PHASE_1 (always blocked)
    - PHASE_2 at quota 4 (allowed)
    - PHASE_2 at quota 5 (blocked)
    - PHASE_3 at quota 39 (allowed)
    - PHASE_3 at quota 40 (blocked)
    - COMPLETED at quota 99 (allowed)
    - COMPLETED at quota 100 (blocked)
  - **DoD**: 100% branch coverage

- [ ] 🟠 Write unit tests for advanceStage()
  - **Verification**: Stage transitions are correct
  - **Edge Cases to test**:
    - Exactly day 2 boundary
    - Exactly day 21 boundary
    - Already COMPLETED (no change)
  - **DoD**: All date boundary conditions tested

---

### 1.3 Recipient Rate Limiting

#### 1.3.1 Rate Limit Service
- [ ] 🔴 Implement RecipientRateLimitService class
  - **Verification**: Class compiles
  - **Edge Case**: Service injection
  - **DoD**: Injectable service

- [ ] 🔴 Implement checkAllowed()
  ```typescript
  async checkAllowed(sessionName: string, recipient: string): Promise<{
    allowed: boolean;
    retryAfter?: number;
  }>
  ```
  - **Verification**: Correctly enforces limits
  - **Edge Cases**:
    - First message to recipient → allowed
    - 15th message → allowed
    - 16th message → blocked with retryAfter
    - Message within 3 minutes → blocked
    - Window expired (24h+) → reset and allow
  - **DoD**: All edge cases pass

- [ ] 🔴 Implement recordMessage()
  - **Verification**: messageCount increments, lastMessageAt updated
  - **Edge Case**: First message (record may not exist yet)
  - **DoD**: Database updated correctly

#### 1.3.2 Rate Limit Service Tests
- [ ] 🟠 Write unit tests for checkAllowed()
  - **Verification**: All limit scenarios covered
  - **Edge Cases to test**:
    - 15 messages spread across 24h (all allowed)
    - 16th message immediately (blocked)
    - 2 messages 2 minutes apart (second blocked)
    - 2 messages 4 minutes apart (both allowed)
    - Window reset after 24 hours
  - **DoD**: 100% branch coverage

---

### 1.4 Message Interceptor

#### 1.4.1 Interceptor Implementation
- [ ] 🔴 Create BanPreventionInterceptor
  - **Verification**: Implements NestInterceptor interface
  - **Edge Case**: Ensure it's a NestJS interceptor, not Express middleware
  - **DoD**: Class structure correct

- [ ] 🔴 Implement intercept() method
  - **Verification**: Checks warmup, then rate limit, then proceeds
  - **Edge Cases**:
    - Non-message endpoints → skip all checks
    - Warmup blocked → throw 429
    - Rate limit blocked → throw 429
    - All checks pass → proceed with delay
  - **DoD**: All checks executed in order

- [ ] 🔴 Implement random delay logic
  ```typescript
  const delay = 2000 + Math.random() * 3000; // 2-5 seconds
  await new Promise(resolve => setTimeout(resolve, delay));
  ```
  - **Verification**: Delay applied before message send
  - **Edge Case**: Delay should not block other requests
  - **DoD**: Average delay is ~3.5 seconds

- [ ] 🔴 Implement post-send recording
  - **Verification**: recordMessage() called for both warmup and rate limit
  - **Edge Case**: Don't record if message fails
  - **DoD**: Counts only increment on success

#### 1.4.2 Apply Interceptor to WAHA Controllers
- [ ] 🔴 Identify all message sending endpoints in WAHA
  ```
  POST /api/sendText
  POST /api/sendImage
  POST /api/sendFile
  POST /api/sendVideo
  POST /api/sendVoice
  POST /api/sendLocation
  POST /api/sendContact
  POST /api/sendButtons
  POST /api/sendList
  ```
  - **Verification**: All endpoints listed
  - **Edge Case**: WAHA may add new endpoints in updates
  - **DoD**: Complete list documented

- [ ] 🔴 Apply interceptor to SendMessagesController
  ```typescript
  @UseInterceptors(BanPreventionInterceptor)
  ```
  - **Verification**: All send endpoints go through interceptor
  - **Edge Case**: Some endpoints may be in different controllers
  - **DoD**: Every send endpoint is intercepted

- [ ] 🔴 Register interceptor in module providers
  - **Verification**: No "cannot resolve dependency" errors
  - **Edge Case**: Circular dependency between interceptor and services
  - **DoD**: Application starts successfully

#### 1.4.3 Interceptor Integration Tests
- [ ] 🟠 Test warmup blocking
  ```bash
  # New session should block in PHASE_1
  curl -X POST /api/sendText -d '{"session": "new", ...}'
  # Expected: 429 with warmup reason
  ```
  - **Verification**: 429 returned with clear message
  - **Edge Case**: Message should not be sent
  - **DoD**: API returns proper error response

- [ ] 🟠 Test rate limiting blocking
  ```bash
  # Send 16 messages to same recipient
  for i in {1..16}; do curl POST /sendText...; done
  # Expected: First 15 succeed, 16th returns 429
  ```
  - **Verification**: 16th message blocked
  - **Edge Case**: Concurrent requests may race
  - **DoD**: Rate limits enforced correctly

- [ ] 🟠 Test delay is applied
  - **Verification**: Time between request and response is 2-5s
  - **Edge Case**: Timeout may trigger if client has short timeout
  - **DoD**: Delays measurably affect response time

---

### 1.5 Safety Controller

#### 1.5.1 Safety Endpoints
- [ ] 🔴 Create SafetyController
  - **Verification**: Controller registered in module
  - **Edge Case**: Route conflicts with existing WAHA routes
  - **DoD**: Controller accessible at /api/safety

- [ ] 🔴 Implement GET /api/safety/:sessionName
  ```typescript
  @Get(':sessionName')
  async getSafetyStatus(@Param('sessionName') sessionName: string)
  ```
  - **Verification**: Returns comprehensive safety status
  - **Edge Cases**:
    - Session doesn't exist → 404 or init status
    - Session in warmup → show progress
    - Session fully warmed up → show full stats
  - **DoD**: All scenarios return appropriate response

- [ ] 🔴 Implement generateWarnings()
  - **Verification**: Warnings generated based on usage
  - **Edge Cases**:
    - Usage > 90% of limit → warning
    - Still in warmup → warning with days remaining
    - No issues → empty array
  - **DoD**: Warnings are actionable

- [ ] 🔴 Implement generateRecommendations()
  - **Verification**: Phase-appropriate recommendations
  - **Edge Cases**:
    - PHASE_1 → profile setup tips
    - PHASE_2 → reply-only tips
    - COMPLETED → maintenance tips
  - **DoD**: Recommendations help user avoid bans

---

### 1.6 Cron Jobs

#### 1.6.1 Scheduled Tasks
- [ ] 🔴 Install NestJS schedule module
  ```bash
  npm install @nestjs/schedule
  ```
  - **Verification**: Package installed
  - **Edge Case**: Version compatibility with NestJS
  - **DoD**: Can use @Cron decorator

- [ ] 🔴 Register ScheduleModule in app
  - **Verification**: No import errors
  - **Edge Case**: Module must be in imports array
  - **DoD**: Cron jobs can be registered

- [ ] 🔴 Implement advanceWarmupStages cron
  ```typescript
  @Cron('0 0 * * *') // Daily at midnight
  async advanceWarmupStages()
  ```
  - **Verification**: All sessions advanced at midnight
  - **Edge Case**: Long-running if many sessions
  - **DoD**: Logs show advancement

- [ ] 🔴 Implement resetDailyQuotas cron
  ```typescript
  @Cron('0 0 * * *') // Daily at midnight
  async resetDailyQuotas()
  ```
  - **Verification**: All dailyQuota values reset to 0
  - **Edge Case**: Timezone considerations
  - **DoD**: Quotas reset correctly

#### 1.6.2 Cron Job Tests
- [ ] 🟠 Test warmup advancement
  - **Verification**: Manual trigger advances stages correctly
  - **Edge Case**: Already COMPLETED sessions unchanged
  - **DoD**: Advancement logic verified

- [ ] 🟠 Test quota reset
  - **Verification**: All sessions reset to 0
  - **Edge Case**: Partial failures don't break other resets
  - **DoD**: All quotas reset

---

## Phase 2: Advanced Features (Week 2)

### 2.1 Media Messaging

#### 2.1.1 Image Sending
- [ ] 🟠 Verify WAHA image endpoint works
  ```bash
  curl -X POST /api/sendImage \
    -d '{"session": "test", "chatId": "123@c.us", "file": {"url": "..."}}'
  ```
  - **Verification**: Image delivered to recipient
  - **Edge Case**: Large images (>16MB) rejected
  - **DoD**: Images send successfully

- [ ] 🟠 Test ban prevention applies to images
  - **Verification**: Image blocked if over quota
  - **Edge Case**: Images count toward daily limit
  - **DoD**: Rate limits enforced for media

- [ ] 🟠 Test base64 image upload
  - **Verification**: Base64 data converted and sent
  - **Edge Case**: Invalid base64 handling
  - **DoD**: Both URL and base64 work

#### 2.1.2 Video Sending
- [ ] 🟠 Verify WAHA video endpoint
  - **Verification**: Video plays on recipient's device
  - **Edge Case**: Unsupported formats
  - **DoD**: MP4 videos send correctly

#### 2.1.3 Document Sending
- [ ] 🟠 Verify WAHA document endpoint
  - **Verification**: Document downloadable by recipient
  - **Edge Case**: Files >100MB rejected
  - **DoD**: PDF, DOC, XLS send correctly

#### 2.1.4 Audio Sending
- [ ] 🟠 Test voice message (PTT)
  - **Verification**: Audio plays as voice message
  - **Edge Case**: Non-OGG files converted
  - **DoD**: Voice messages work

---

### 2.2 Interactive Messages

#### 2.2.1 Button Messages
- [ ] 🟠 Verify WAHA button endpoint
  - **Verification**: Buttons display on recipient's device
  - **Edge Case**: >3 buttons rejected
  - **DoD**: Buttons render correctly

- [ ] 🟠 Test button click webhook
  - **Verification**: Button ID returned in webhook
  - **Edge Case**: Button clicked twice
  - **DoD**: Clicks captured

#### 2.2.2 List Messages
- [ ] 🟠 Verify WAHA list endpoint
  - **Verification**: List opens on button tap
  - **Edge Case**: >10 items per section
  - **DoD**: Selection captured in webhook

---

### 2.3 Group Operations

#### 2.3.1 List Groups
- [ ] 🟠 Verify WAHA groups list
  - **Verification**: All groups returned
  - **Edge Case**: Not a member of any groups
  - **DoD**: Groups list accurate

#### 2.3.2 Get Group Info
- [ ] 🟠 Verify WAHA group info
  - **Verification**: Participants and settings returned
  - **Edge Case**: Very large group (256+ members)
  - **DoD**: Full info returned

#### 2.3.3 Send to Group
- [ ] 🟠 Test sending message to group
  - **Verification**: All group members receive message
  - **Edge Case**: Banned from group
  - **DoD**: Group messages work

---

### 2.4 Webhook System

#### 2.4.1 Webhook Configuration
- [ ] 🟠 Verify WAHA webhook registration
  - **Verification**: Webhook URL stored
  - **Edge Case**: Invalid URL format
  - **DoD**: Can register webhooks

#### 2.4.2 Webhook Delivery
- [ ] 🟠 Test incoming message webhook
  - **Verification**: Message payload delivered to URL
  - **Edge Case**: Webhook URL down (retry logic)
  - **DoD**: Messages trigger webhooks

- [ ] 🟠 Test message status webhook
  - **Verification**: Delivery/read status updates sent
  - **Edge Case**: Status changes rapidly
  - **DoD**: Status updates accurate

- [ ] 🟠 Test connection status webhook
  - **Verification**: Disconnect/reconnect events sent
  - **Edge Case**: Flaky connection
  - **DoD**: Connection changes captured

#### 2.4.3 Webhook Security
- [ ] 🟠 Test HMAC signature
  - **Verification**: X-Webhook-Signature header present
  - **Edge Case**: Signature validation on receiver
  - **DoD**: Signatures verifiable

---

### 2.5 Analytics Endpoints

#### 2.5.1 Daily Analytics
- [ ] 🟡 Implement analytics data collection
  - **Verification**: Message counts stored per day
  - **Edge Case**: Timezone handling
  - **DoD**: Counts accurate

- [ ] 🟡 Create GET /api/{session}/analytics/daily endpoint
  - **Verification**: Returns daily breakdown
  - **Edge Case**: No data for requested period
  - **DoD**: Useful analytics returned

#### 2.5.2 Recipient Analytics
- [ ] 🟡 Track per-recipient metrics
  - **Verification**: Response rate calculated
  - **Edge Case**: Recipient never responds
  - **DoD**: Per-recipient stats available

---

## Phase 3: Production Readiness (Week 3)

### 3.1 Docker Production Setup

#### 3.1.1 Production Docker Compose
- [ ] 🟠 Create docker-compose.prod.yml
  - **Verification**: All services configured for production
  - **Edge Case**: Secrets not in compose file
  - **DoD**: Production-ready compose file

- [ ] 🟠 Configure environment variables
  - **Verification**: All required vars documented
  - **Edge Case**: Missing required vars → clear error
  - **DoD**: .env.example complete

- [ ] 🟠 Set up persistent volumes
  - **Verification**: Data survives container restart
  - **Edge Case**: Volume permissions
  - **DoD**: Data persists

- [ ] 🟠 Configure health checks
  - **Verification**: Unhealthy containers restarted
  - **Edge Case**: False positive health failures
  - **DoD**: Health checks working

#### 3.1.2 Build Custom Docker Image
- [ ] 🟠 Create production Dockerfile
  - **Verification**: Image builds successfully
  - **Edge Case**: Build cache invalidation
  - **DoD**: Image size optimized

- [ ] 🟠 Test Docker image locally
  - **Verification**: All features work in container
  - **Edge Case**: File permissions inside container
  - **DoD**: Ready for deployment

---

### 3.2 Security Hardening

#### 3.2.1 API Security
- [ ] 🔴 Verify API key is required for all endpoints
  - **Verification**: Unauthenticated requests return 401
  - **Edge Case**: Some endpoints may be public (health)
  - **DoD**: No unauthorized access possible

- [ ] 🔴 Test rate limiting works
  - **Verification**: Exceeding limits returns 429
  - **Edge Case**: Redis down → fallback to memory?
  - **DoD**: Rate limits enforced

- [ ] 🟠 Verify HTTPS configuration
  - **Verification**: HTTP redirects to HTTPS
  - **Edge Case**: SSL certificate renewal
  - **DoD**: All traffic encrypted

#### 3.2.2 Data Security
- [ ] 🔴 Verify credentials encrypted at rest
  - **Verification**: Database contains encrypted data
  - **Edge Case**: Key rotation
  - **DoD**: No plaintext credentials

- [ ] 🟠 Implement audit logging
  - **Verification**: Security events logged
  - **Edge Case**: Log rotation
  - **DoD**: Audit trail available

---

### 3.3 Testing Suite

#### 3.3.1 Unit Tests
- [ ] 🟠 Warmup service tests (100% coverage)
  - **Verification**: All methods tested
  - **Edge Case**: Date boundary conditions
  - **DoD**: No untested branches

- [ ] 🟠 Rate limit service tests (100% coverage)
  - **Verification**: All limits tested
  - **Edge Case**: Concurrent requests
  - **DoD**: Thread safety verified

- [ ] 🟠 Interceptor tests
  - **Verification**: All paths tested
  - **Edge Case**: Error handling
  - **DoD**: Interceptor works correctly

#### 3.3.2 Integration Tests
- [ ] 🟠 End-to-end message sending test
  - **Verification**: Message sent and received
  - **Edge Case**: WhatsApp down
  - **DoD**: Full flow works

- [ ] 🟠 Warmup progression integration test
  - **Verification**: Stages advance correctly
  - **Edge Case**: Manual date manipulation
  - **DoD**: 21-day flow verified

#### 3.3.3 Load Tests
- [ ] 🟡 Test 5 concurrent sessions
  - **Verification**: All sessions function
  - **Edge Case**: Resource exhaustion
  - **DoD**: <1GB RAM usage

- [ ] 🟡 Test 100 messages per session
  - **Verification**: No failures under load
  - **Edge Case**: Rate limiting kicks in
  - **DoD**: System stable under load

---

### 3.4 Documentation

#### 3.4.1 API Documentation
- [ ] 🟠 Update Swagger docs
  - **Verification**: All endpoints documented
  - **Edge Case**: New ban prevention endpoints
  - **DoD**: Swagger UI complete

- [ ] 🟠 Create API usage examples
  - **Verification**: Examples in multiple languages
  - **Edge Case**: Edge case examples
  - **DoD**: Developer-friendly docs

#### 3.4.2 Deployment Guide
- [ ] 🟠 Write VPS deployment guide
  - **Verification**: Can deploy following guide
  - **Edge Case**: Different VPS providers
  - **DoD**: Step-by-step instructions

- [ ] 🟠 Write Docker deployment guide
  - **Verification**: Docker-compose up works
  - **Edge Case**: Environment differences
  - **DoD**: Works on fresh machine

#### 3.4.3 Warmup Guide
- [ ] 🟠 Create WARMUP_GUIDE.md
  - **Verification**: Explains 21-day process
  - **Edge Case**: What if user skips phases?
  - **DoD**: User understands warmup

---

### 3.5 Monitoring & Alerts

#### 3.5.1 Health Endpoints
- [ ] 🟡 Implement /health endpoint
  - **Verification**: Returns system status
  - **Edge Case**: Partial health (DB up, Redis down)
  - **DoD**: Detailed health info

- [ ] 🟡 Implement /ready endpoint
  - **Verification**: Returns readiness status
  - **Edge Case**: During startup
  - **DoD**: K8s-compatible probes

#### 3.5.2 Logging
- [ ] 🟡 Configure structured logging (Pino)
  - **Verification**: Logs in JSON format
  - **Edge Case**: Sensitive data masking
  - **DoD**: Production-ready logs

- [ ] 🟡 Configure log levels
  - **Verification**: DEBUG/INFO/WARN/ERROR
  - **Edge Case**: Performance at DEBUG level
  - **DoD**: Appropriate verbosity

#### 3.5.3 External Monitoring
- [ ] 🟢 Set up uptime monitoring
  - **Verification**: Alerts on downtime
  - **Edge Case**: False positives
  - **DoD**: Monitoring active

---

### 3.6 Production Deployment

#### 3.6.1 VPS Setup
- [ ] 🔴 Provision VPS (2 vCPU, 4GB RAM)
  - **Verification**: SSH access works
  - **Edge Case**: Firewall configuration
  - **DoD**: Server accessible

- [ ] 🔴 Install Docker on VPS
  - **Verification**: docker --version works
  - **Edge Case**: Linux distro differences
  - **DoD**: Docker running

- [ ] 🔴 Configure firewall
  - **Verification**: Only required ports open (22, 80, 443, 3000)
  - **Edge Case**: Lockout prevention
  - **DoD**: Secure configuration

- [ ] 🔴 Set up SSL certificate (Let's Encrypt)
  - **Verification**: HTTPS works
  - **Edge Case**: Certificate renewal automation
  - **DoD**: Auto-renewal configured

#### 3.6.2 Application Deployment
- [ ] 🔴 Deploy application with Docker
  - **Verification**: Containers running
  - **Edge Case**: First-time initialization
  - **DoD**: App accessible via HTTPS

- [ ] 🔴 Configure backups
  - **Verification**: Daily backups running
  - **Edge Case**: Backup restore tested
  - **DoD**: Backup/restore verified

- [ ] 🔴 Test with real WhatsApp number
  - **Verification**: Full flow works
  - **Edge Case**: Start with burner number
  - **DoD**: Production-ready

---

## Verification Checklist Summary

### Phase 0 Verification
- [ ] Docker, Node.js, pnpm installed
- [ ] WAHA fork cloned and running
- [ ] Test message sent successfully

### Phase 1 Verification
- [ ] PostgreSQL + Redis running
- [ ] Prisma schema migrated
- [ ] Warmup service blocking correctly
- [ ] Rate limiting working
- [ ] Interceptor applied to all endpoints
- [ ] Cron jobs running at midnight

### Phase 2 Verification
- [ ] Media messages work
- [ ] Interactive messages work
- [ ] Groups work
- [ ] Webhooks deliver reliably
- [ ] Analytics endpoints return data

### Phase 3 Verification
- [ ] Docker production image built
- [ ] Security hardening complete
- [ ] Test suite passing
- [ ] Documentation complete
- [ ] Monitoring active
- [ ] Production deployment successful

---

## Edge Case Master List

### Session Management
- Duplicate session name
- Session disconnect during message send
- QR code expired without scan
- Session banned by WhatsApp

### Ban Prevention
- New session (no warmup config)
- Exactly at quota limit
- Exactly at 24-hour boundary
- Concurrent message sends
- Clock skew between servers

### Rate Limiting
- First message to recipient
- 15th vs 16th message
- Messages 2:59 apart vs 3:01 apart
- Window reset exactly at boundary

### Media
- File exactly 16MB
- Invalid MIME type
- URL returns 404
- Slow URL response

### Groups
- Very large groups (256+ members)
- User is admin vs not admin
- Group settings change during operation

### Webhooks
- Webhook URL returns 500
- Webhook URL timeout
- Webhook URL unreachable
- Rapid successive events

---

## Final Production Checklist

Before going live:

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Load tests completed
- [ ] Security audit completed
- [ ] Documentation reviewed
- [ ] Backup/restore tested
- [ ] Monitoring alerts configured
- [ ] Runbook for common issues created
- [ ] SSL certificate valid for 90+ days
- [ ] First WhatsApp number in warmup phase 3+
