# Product Requirements Document (PRD)
# WhatsApp API Service - WAHA Fork with Ban Prevention

**Version**: 1.0
**Date**: January 2, 2026
**Status**: Draft
**Author**: AI-Assisted Development

---

## 1. Executive Summary

### 1.1 Product Vision
Build a cost-effective, self-hosted WhatsApp API service as an alternative to Whapi.cloud, achieving 91-93% cost reduction while maintaining feature parity and adding robust ban prevention mechanisms.

### 1.2 Key Value Proposition
| Metric | Whapi.cloud | Our Solution |
|--------|-------------|--------------|
| Monthly Cost (5 numbers) | $145-175 | $13 |
| Annual Savings | - | $1,584 |
| Ban Prevention | Basic | Advanced (21-day warmup) |
| Server Control | None | Full |
| Customization | Limited | Unlimited |

### 1.3 Target Users
- **Primary**: Individual developers and small businesses needing WhatsApp automation for 1-5 numbers
- **Secondary**: Technical users comfortable with self-hosting who want cost optimization

---

## 2. Problem Statement

### 2.1 Current Pain Points
1. **High Cost**: Whapi.cloud charges $29-35/month per WhatsApp number, making multi-number setups expensive
2. **Ban Risk**: 40% of WhatsApp accounts get banned in the first week without proper warmup strategies
3. **No Control**: SaaS solutions offer limited customization and no server control
4. **Vendor Lock-in**: Dependency on third-party services for critical business communication

### 2.2 Opportunity
Open-source WhatsApp libraries (Baileys) and projects (WAHA) provide the technical foundation, but lack:
- Automated ban prevention systems
- 21-day warmup progression
- Recipient-level rate limiting
- Safety monitoring dashboards

---

## 3. Goals and Objectives

### 3.1 Primary Goals
| Goal | Success Metric | Target |
|------|----------------|--------|
| Cost Reduction | Monthly hosting cost | < $15/month for 5 numbers |
| Ban Prevention | Account survival rate (30 days) | > 95% |
| Feature Parity | Whapi.cloud feature coverage | > 90% |
| Performance | API response time (p95) | < 200ms |
| Reliability | Uptime | > 99% |

### 3.2 Secondary Goals
- Maintain < 1GB RAM usage for 5 instances
- Zero mandatory external dependencies beyond PostgreSQL
- Full webhook support for real-time event delivery
- Comprehensive API documentation

---

## 4. User Personas

### 4.1 Primary Persona: Solo Developer "Alex"
- **Background**: Freelance developer building WhatsApp bots for clients
- **Technical Level**: Intermediate (comfortable with Docker, APIs)
- **Budget**: Limited ($50-100/month for all tools)
- **Pain Points**:
  - Whapi.cloud costs eating into profit margins
  - Previous bans from aggressive messaging
  - Needs reliable service for client projects
- **Goals**:
  - Reduce costs by 80%+
  - Avoid account bans
  - Simple deployment and maintenance

### 4.2 Secondary Persona: Small Business Owner "Maria"
- **Background**: Runs e-commerce business, needs order notifications
- **Technical Level**: Basic (can follow documentation)
- **Budget**: Moderate ($100-200/month)
- **Pain Points**:
  - Paying for 3 WhatsApp numbers across regions
  - Occasional bans disrupting customer communication
- **Goals**:
  - Reliable message delivery
  - Cost predictability
  - Easy monitoring dashboard

---

## 5. Functional Requirements

### 5.1 Core Messaging (Priority: Critical)

#### FR-001: Send Text Messages
- **Description**: Send text messages to individual WhatsApp users
- **Input**: Session ID, recipient phone number, message text
- **Output**: Message ID, delivery status
- **Acceptance Criteria**:
  - Messages delivered within 5 seconds
  - Support Unicode, emojis, and formatting (*bold*, _italic_)
  - Return unique message ID for tracking

#### FR-002: Send Media Messages
- **Description**: Send images, videos, documents, and audio
- **Supported Types**:
  - Images: JPEG, PNG, GIF, WebP (max 16MB)
  - Videos: MP4, 3GP (max 16MB)
  - Documents: PDF, DOC, XLS, etc. (max 100MB)
  - Audio: MP3, OGG, M4A (max 16MB)
- **Acceptance Criteria**:
  - Accept URL or base64-encoded content
  - Support optional captions for media
  - Thumbnail generation for videos

#### FR-003: Send Interactive Messages
- **Description**: Send buttons, lists, and quick reply messages
- **Types**:
  - Button messages (up to 3 buttons)
  - List messages (up to 10 sections, 10 items each)
  - Quick reply buttons
- **Acceptance Criteria**:
  - Correct rendering on recipient devices
  - Callback data returned on button clicks

#### FR-004: Receive Messages
- **Description**: Receive and process incoming messages via webhooks
- **Event Types**:
  - Text messages
  - Media messages (with download URL)
  - Interactive responses (button clicks, list selections)
  - Reactions
- **Acceptance Criteria**:
  - Webhook delivery within 2 seconds of receipt
  - Include sender info, timestamp, message content
  - Support retry on webhook failure

### 5.2 Group & Channel Management (Priority: High)

#### FR-005: Group Operations
- **Description**: Full CRUD operations for WhatsApp groups
- **Operations**:
  - List all groups
  - Create new group
  - Get group metadata (name, description, participants)
  - Add/remove participants
  - Promote/demote admins
  - Update group settings (name, description, photo)
  - Send messages to groups
- **Acceptance Criteria**:
  - Proper permission checking (must be admin for admin actions)
  - Rate limiting applied to group operations

#### FR-006: Channel Operations
- **Description**: Support for WhatsApp Channels (broadcast channels)
- **Operations**:
  - List subscribed channels
  - Get channel info
  - Send messages to owned channels
- **Acceptance Criteria**:
  - Channel messages delivered to all subscribers
  - Support for channel-specific message types

### 5.3 Session Management (Priority: Critical)

#### FR-007: Session Creation
- **Description**: Create new WhatsApp session and generate QR code
- **Flow**:
  1. Create session with unique name
  2. Generate QR code for WhatsApp mobile scanning
  3. Handle pairing and connection
  4. Persist session credentials
- **Acceptance Criteria**:
  - QR code refreshes automatically every 20 seconds
  - Session persists across server restarts
  - Multiple sessions supported simultaneously

#### FR-008: Session Status
- **Description**: Monitor session connection status
- **States**: DISCONNECTED, CONNECTING, CONNECTED, BANNED
- **Acceptance Criteria**:
  - Real-time status updates via webhook
  - Automatic reconnection on temporary disconnection
  - Clear indication when account is banned

### 5.4 Ban Prevention System (Priority: Critical)

#### FR-009: 21-Day Warmup System
- **Description**: Automated progressive warmup for new sessions
- **Phases**:
  | Phase | Days | Max Daily | Min Interval | Activities |
  |-------|------|-----------|--------------|------------|
  | 1 | 1-2 | 0 | N/A | Profile setup only |
  | 2 | 2-4 | 5 | 2 hours | Receive & reply only |
  | 3 | 3-7 | 40 | 3 min | Limited outbound |
  | 4 | 7-21 | 80 | 2 min | Gradual increase |
  | 5 | 21+ | 100 | 1 min | Full operation |
- **Acceptance Criteria**:
  - Automatic phase advancement based on days since creation
  - Hard blocks when daily quota exceeded
  - Clear error messages with retry-after timing

#### FR-010: Recipient Rate Limiting
- **Description**: Limit messages per recipient to avoid spam flags
- **Limits**:
  - Maximum 15 messages per recipient per 24 hours
  - Minimum 3-minute interval between messages to same recipient
- **Acceptance Criteria**:
  - Per-session, per-recipient tracking
  - Automatic window reset after 24 hours
  - Graceful 429 responses with retry-after header

#### FR-011: Human-Like Behavior
- **Description**: Simulate human messaging patterns
- **Features**:
  - Random delays (2-5 seconds) between messages
  - Typing indicators before sending
  - Read receipts (mark as seen)
- **Acceptance Criteria**:
  - Configurable delay ranges
  - Optional typing indicator duration based on message length

#### FR-012: Safety Monitoring Dashboard
- **Description**: Real-time visibility into account health
- **Metrics**:
  - Current warmup phase and progress
  - Daily quota usage
  - Messages sent/delivered/failed
  - Response rate from recipients
  - Ban risk score
- **Acceptance Criteria**:
  - API endpoint returning JSON metrics
  - Warnings when approaching limits
  - Recommendations based on current phase

### 5.5 Webhook System (Priority: High)

#### FR-013: Webhook Registration
- **Description**: Register URLs to receive real-time events
- **Configuration**:
  - Webhook URL (HTTPS required for production)
  - Events to subscribe (message, status, connection, etc.)
  - Secret key for HMAC signature verification
- **Acceptance Criteria**:
  - Multiple webhooks per session supported
  - Enable/disable without deletion

#### FR-014: Webhook Delivery
- **Description**: Reliable delivery of events to registered webhooks
- **Features**:
  - HMAC-SHA256 signature in header
  - Exponential backoff retry (3 attempts)
  - Dead letter queue for failed deliveries
- **Acceptance Criteria**:
  - Delivery within 2 seconds (p95)
  - Retry intervals: 10s, 60s, 300s
  - Log all delivery attempts

### 5.6 API & Authentication (Priority: Critical)

#### FR-015: API Key Authentication
- **Description**: Secure API access via API keys
- **Features**:
  - Cryptographically random API keys
  - Key rotation support
  - Per-key rate limiting
- **Acceptance Criteria**:
  - 256-bit random keys
  - Keys stored as bcrypt hashes
  - Invalid keys return 401 immediately

#### FR-016: Rate Limiting
- **Description**: Multi-tier rate limiting to prevent abuse
- **Tiers**:
  | Tier | Scope | Limit |
  |------|-------|-------|
  | Global | Per IP | 1000 req/15min |
  | User | Per API Key | 500 req/15min |
  | Endpoint | Per Session | Varies by warmup phase |
- **Acceptance Criteria**:
  - Clear 429 response with rate limit headers
  - Redis-backed for distributed deployments

---

## 6. Non-Functional Requirements

### 6.1 Performance

#### NFR-001: Response Time
- API response time (p95): < 200ms
- API response time (p99): < 500ms
- Webhook delivery time (p95): < 2 seconds

#### NFR-002: Throughput
- Support 100 messages/minute per instance
- Handle 50 concurrent API requests

#### NFR-003: Resource Usage
- RAM per WhatsApp instance: < 150MB (NOWEB engine)
- Total RAM for 5 instances: < 1GB
- CPU usage at idle: < 5%

### 6.2 Reliability

#### NFR-004: Availability
- Target uptime: 99%
- Maximum unplanned downtime: 7.2 hours/month
- Automatic recovery from crashes

#### NFR-005: Data Durability
- Session credentials persisted to database
- Message logs retained for 30 days
- Daily automated backups

### 6.3 Security

#### NFR-006: Data Protection
- Session credentials encrypted at rest (AES-256)
- All API traffic over HTTPS
- No plaintext storage of sensitive data

#### NFR-007: Access Control
- API key required for all endpoints
- IP allowlisting option
- Audit logging for security events

### 6.4 Scalability

#### NFR-008: Horizontal Scaling
- Stateless API design (Redis for shared state)
- Support for load balancing across multiple servers
- Database connection pooling

### 6.5 Maintainability

#### NFR-009: Code Quality
- TypeScript for type safety
- 80%+ test coverage for ban prevention logic
- ESLint + Prettier enforced
- Comprehensive inline documentation

#### NFR-010: Observability
- Structured JSON logging (Pino)
- Health check endpoints
- Error tracking with stack traces

---

## 7. Technical Requirements

### 7.1 Technology Stack
| Component | Technology | Version |
|-----------|------------|---------|
| Base Platform | WAHA | Latest |
| WhatsApp Engine | NOWEB (Baileys) | 6.7.x |
| Runtime | Node.js | 20 LTS |
| Framework | NestJS | 10.x |
| Database | PostgreSQL | 16 |
| Cache | Redis | 7.x |
| ORM | Prisma | 5.x |
| Queue | BullMQ | 5.x |
| Containerization | Docker | 24.x |

### 7.2 Infrastructure Requirements
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| vCPUs | 2 | 4 |
| RAM | 4GB | 8GB |
| Storage | 40GB SSD | 80GB SSD |
| Network | 100 Mbps | 1 Gbps |

### 7.3 External Dependencies
| Dependency | Purpose | Required |
|------------|---------|----------|
| PostgreSQL | Ban prevention data, session storage | Yes |
| Redis | Rate limiting, queue | Recommended |
| S3/MinIO | Media storage | Optional |

---

## 8. Success Metrics

### 8.1 Key Performance Indicators (KPIs)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Account Survival Rate (30 days) | > 95% | Accounts not banned after 30 days |
| Message Delivery Rate | > 98% | Messages successfully delivered |
| API Availability | > 99% | Uptime monitoring |
| Cost per Number (monthly) | < $3 | Total hosting / number of instances |
| API Response Time (p95) | < 200ms | Latency monitoring |
| Ban Prevention Effectiveness | > 90% | Warmup completion rate |

### 8.2 User Satisfaction Metrics
- Time to first successful message: < 10 minutes
- Documentation completeness: All endpoints documented
- Error message clarity: Actionable error descriptions

---

## 9. Constraints and Assumptions

### 9.1 Constraints
1. **WhatsApp ToS**: Service operates in gray area; WhatsApp may change policies
2. **Baileys Stability**: Library may break with WhatsApp updates (every 2-3 months)
3. **Rate Limits**: WhatsApp's undocumented rate limits may cause temporary blocks
4. **Single Device**: Each number can only be connected to one server at a time

### 9.2 Assumptions
1. Users have technical ability to deploy Docker containers
2. Users have access to VPS or cloud hosting
3. Users understand WhatsApp's unofficial API risks
4. Burner/test numbers available for development
5. Users will follow warmup schedule for new numbers

### 9.3 Dependencies
1. WAHA project continues to be maintained
2. Baileys library receives updates for WhatsApp changes
3. WhatsApp does not implement stricter anti-automation measures

---

## 10. Out of Scope (v1.0)

The following features are explicitly excluded from the initial release:

1. **Multi-Platform Support**: Instagram, Messenger, Telegram (future roadmap)
2. **Web Dashboard UI**: API-only initially; UI in future versions
3. **Call Handling**: Voice/video calls not supported
4. **Status/Stories**: WhatsApp Status feature not included
5. **Payment Messages**: WhatsApp Pay integration not included
6. **Business API Features**: Catalog, cart, order messages
7. **Template Message Management**: For official WhatsApp Business API
8. **Multi-Server Clustering**: Single server deployment only
9. **Mobile App**: No native mobile application
10. **Managed Hosting**: Self-hosted only; no SaaS offering

---

## 11. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WhatsApp account bans | Medium | High | 21-day warmup, rate limiting, monitoring |
| Baileys breaking changes | High | Medium | Pin versions, staging tests, fallback to WEBJS |
| WhatsApp policy changes | Low | Critical | Monitor announcements, diversify platforms |
| Server downtime | Low | Medium | Health checks, auto-restart, backups |
| Security breach | Low | Critical | Encryption, rate limiting, audit logs |

---

## 12. Timeline and Milestones

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Week 1 | 5 days | WAHA setup, PostgreSQL integration, basic testing |
| Week 2 | 5 days | Ban prevention layer (warmup, rate limiting, interceptor) |
| Week 3 | 5 days | Integration testing, documentation, production deployment |
| Post-Launch | Ongoing | Monitoring, bug fixes, feature enhancements |

---

## 13. Approval and Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Technical Lead | | | |
| Developer | | | |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| WAHA | WhatsApp HTTP API - open-source project we're forking |
| NOWEB | WAHA engine using Baileys (WebSocket, no browser) |
| Baileys | Open-source WhatsApp Web API library |
| Warmup | Process of gradually increasing message volume to avoid bans |
| Session | A connected WhatsApp account instance |
| Webhook | HTTP callback for real-time event delivery |

---

## Appendix B: Related Documents

- [Feature_List.md](./Feature_List.md) - Detailed feature specifications
- [TODO.md](./TODO.md) - Implementation task list
- [PREREQUISITES.md](./PREREQUISITES.md) - User actions before implementation
