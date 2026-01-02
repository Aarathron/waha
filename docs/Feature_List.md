# Feature List
# WhatsApp API Service - Complete Feature Specification

**Version**: 1.0
**Last Updated**: January 2, 2026

---

## Table of Contents

1. [Session Management](#1-session-management)
2. [Text Messaging](#2-text-messaging)
3. [Media Messaging](#3-media-messaging)
4. [Interactive Messages](#4-interactive-messages)
5. [Group Management](#5-group-management)
6. [Channel Management](#6-channel-management)
7. [Webhook System](#7-webhook-system)
8. [Ban Prevention System](#8-ban-prevention-system)
9. [Safety Monitoring](#9-safety-monitoring)
10. [Analytics & Reporting](#10-analytics--reporting)
11. [API Authentication](#11-api-authentication)
12. [Rate Limiting](#12-rate-limiting)

---

## 1. Session Management

### 1.1 Create Session

**Feature ID**: SM-001
**Priority**: Critical
**Status**: Planned

**Description**: Create a new WhatsApp session and initiate QR code pairing.

**API Endpoint**: `POST /api/sessions`

**Request**:
```json
{
  "name": "my-session",
  "config": {
    "webhooks": [
      {
        "url": "https://example.com/webhook",
        "events": ["message", "message.status", "connection"]
      }
    ]
  }
}
```

**Response**:
```json
{
  "name": "my-session",
  "status": "STARTING",
  "engine": "NOWEB",
  "createdAt": "2026-01-02T10:00:00Z"
}
```

**Acceptance Criteria**:
- [ ] Session name must be unique
- [ ] Session name accepts alphanumeric and hyphens only
- [ ] Session stored in database
- [ ] Warmup config auto-created (PHASE_1_PROFILE)
- [ ] Webhook configuration saved

---

### 1.2 Get QR Code

**Feature ID**: SM-002
**Priority**: Critical

**Description**: Retrieve QR code for WhatsApp mobile app scanning.

**API Endpoint**: `GET /api/sessions/{name}/qr`

**Response Formats**:
- `Accept: application/json` → Base64 encoded QR
- `Accept: image/png` → Direct image

**Response (JSON)**:
```json
{
  "qr": "data:image/png;base64,iVBORw0KGgo...",
  "expiresAt": "2026-01-02T10:00:20Z"
}
```

**Acceptance Criteria**:
- [ ] QR code refreshes every 20 seconds
- [ ] Returns 404 if session not found
- [ ] Returns 400 if already connected
- [ ] Supports both base64 and direct image response

---

### 1.3 Get Session Status

**Feature ID**: SM-003
**Priority**: Critical

**Description**: Check current connection status of a session.

**API Endpoint**: `GET /api/sessions/{name}`

**Response**:
```json
{
  "name": "my-session",
  "status": "CONNECTED",
  "engine": "NOWEB",
  "me": {
    "id": "1234567890@c.us",
    "name": "John Doe",
    "pushName": "John"
  },
  "warmup": {
    "stage": "PHASE_3_LIMITED",
    "daysActive": 5,
    "dailyQuota": 12,
    "maxDaily": 40
  }
}
```

**Status Values**:
| Status | Description |
|--------|-------------|
| STARTING | Session initializing |
| SCAN_QR | Waiting for QR scan |
| CONNECTING | Establishing connection |
| CONNECTED | Fully operational |
| DISCONNECTED | Temporarily disconnected |
| BANNED | Account banned by WhatsApp |
| STOPPED | Manually stopped |

**Acceptance Criteria**:
- [ ] Returns current status within 100ms
- [ ] Includes warmup information
- [ ] Includes connected phone details when available

---

### 1.4 Delete Session

**Feature ID**: SM-004
**Priority**: High

**Description**: Disconnect and remove a session.

**API Endpoint**: `DELETE /api/sessions/{name}`

**Response**:
```json
{
  "name": "my-session",
  "status": "DELETED",
  "message": "Session successfully deleted"
}
```

**Acceptance Criteria**:
- [ ] Gracefully disconnects from WhatsApp
- [ ] Removes session data from database
- [ ] Clears warmup and rate limit records
- [ ] Fires `session.deleted` webhook event

---

### 1.5 Restart Session

**Feature ID**: SM-005
**Priority**: Medium

**Description**: Reconnect an existing session without re-scanning QR.

**API Endpoint**: `POST /api/sessions/{name}/restart`

**Response**:
```json
{
  "name": "my-session",
  "status": "CONNECTING",
  "message": "Session restart initiated"
}
```

**Acceptance Criteria**:
- [ ] Uses stored credentials (no QR needed)
- [ ] Preserves warmup progress
- [ ] Fires `connection` webhook event

---

### 1.6 List All Sessions

**Feature ID**: SM-006
**Priority**: Medium

**Description**: Get list of all sessions with their statuses.

**API Endpoint**: `GET /api/sessions`

**Response**:
```json
{
  "sessions": [
    {
      "name": "session-1",
      "status": "CONNECTED",
      "me": { "id": "1234567890@c.us" }
    },
    {
      "name": "session-2",
      "status": "SCAN_QR"
    }
  ],
  "total": 2
}
```

**Acceptance Criteria**:
- [ ] Returns all sessions
- [ ] Includes brief status for each
- [ ] Sorted by creation date (newest first)

---

## 2. Text Messaging

### 2.1 Send Text Message

**Feature ID**: TM-001
**Priority**: Critical

**Description**: Send a text message to a WhatsApp user.

**API Endpoint**: `POST /api/sendText`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "text": "Hello! How are you today?",
  "options": {
    "quotedMessageId": "3EB0...",
    "linkPreview": true
  }
}
```

**Response**:
```json
{
  "messageId": "3EB0ABC123",
  "status": "PENDING",
  "timestamp": "2026-01-02T10:00:00Z"
}
```

**Text Formatting**:
| Format | Syntax | Example |
|--------|--------|---------|
| Bold | `*text*` | *bold* |
| Italic | `_text_` | _italic_ |
| Strikethrough | `~text~` | ~struck~ |
| Monospace | `` `text` `` | `code` |

**Acceptance Criteria**:
- [ ] Message sent within 5 seconds
- [ ] Unique messageId returned
- [ ] Formatting preserved
- [ ] Link previews generated (when enabled)
- [ ] Ban prevention checks applied
- [ ] Human-like delay applied (2-5s)

---

### 2.2 Reply to Message

**Feature ID**: TM-002
**Priority**: High

**Description**: Send a message as a reply to a specific message.

**API Endpoint**: `POST /api/sendText`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "text": "Thanks for letting me know!",
  "options": {
    "quotedMessageId": "3EB0ORIGINAL123"
  }
}
```

**Acceptance Criteria**:
- [ ] Reply shows quoted message preview
- [ ] Works with text and media messages
- [ ] Returns error if quoted message not found

---

### 2.3 Send to Multiple Recipients

**Feature ID**: TM-003
**Priority**: Medium

**Description**: Send the same message to multiple recipients (with rate limiting).

**API Endpoint**: `POST /api/sendText/bulk`

**Request**:
```json
{
  "session": "my-session",
  "recipients": [
    "1234567890@c.us",
    "0987654321@c.us"
  ],
  "text": "Hello everyone!",
  "options": {
    "delayBetween": 5000
  }
}
```

**Response**:
```json
{
  "jobId": "bulk-12345",
  "status": "QUEUED",
  "totalRecipients": 2,
  "estimatedCompletion": "2026-01-02T10:00:30Z"
}
```

**Acceptance Criteria**:
- [ ] Each recipient checked against rate limits individually
- [ ] Messages queued and sent sequentially
- [ ] Configurable delay between sends (min 5s)
- [ ] Job status trackable via separate endpoint
- [ ] Partial success supported (some may fail)

---

## 3. Media Messaging

### 3.1 Send Image

**Feature ID**: MM-001
**Priority**: Critical

**Description**: Send an image with optional caption.

**API Endpoint**: `POST /api/sendImage`

**Request (URL)**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "url": "https://example.com/image.jpg"
  },
  "caption": "Check out this photo!",
  "options": {
    "viewOnce": false
  }
}
```

**Request (Base64)**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "data": "iVBORw0KGgo...",
    "mimetype": "image/jpeg",
    "filename": "photo.jpg"
  },
  "caption": "Check out this photo!"
}
```

**Supported Formats**: JPEG, PNG, GIF, WebP
**Maximum Size**: 16MB

**Acceptance Criteria**:
- [ ] Accepts both URL and base64
- [ ] Validates file size before sending
- [ ] Generates thumbnail automatically
- [ ] Caption supports text formatting
- [ ] View-once option works correctly

---

### 3.2 Send Video

**Feature ID**: MM-002
**Priority**: High

**Description**: Send a video with optional caption.

**API Endpoint**: `POST /api/sendVideo`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "url": "https://example.com/video.mp4"
  },
  "caption": "Watch this!",
  "options": {
    "gifPlayback": false
  }
}
```

**Supported Formats**: MP4, 3GP
**Maximum Size**: 16MB

**Acceptance Criteria**:
- [ ] Video thumbnail generated
- [ ] Duration detected and displayed
- [ ] GIF playback mode supported
- [ ] Streaming supported for larger files

---

### 3.3 Send Document

**Feature ID**: MM-003
**Priority**: High

**Description**: Send a document file.

**API Endpoint**: `POST /api/sendDocument`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "url": "https://example.com/report.pdf"
  },
  "caption": "Here's the report you requested"
}
```

**Supported Formats**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP
**Maximum Size**: 100MB

**Acceptance Criteria**:
- [ ] Preserves original filename
- [ ] Shows file size in message
- [ ] Correct MIME type detection
- [ ] Large file chunked upload

---

### 3.4 Send Audio

**Feature ID**: MM-004
**Priority**: Medium

**Description**: Send an audio file or voice message.

**API Endpoint**: `POST /api/sendAudio`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "url": "https://example.com/audio.mp3"
  },
  "options": {
    "ptt": true
  }
}
```

**Options**:
- `ptt: true` - Send as voice message (push-to-talk)
- `ptt: false` - Send as audio file

**Supported Formats**: MP3, OGG (Opus), M4A, AAC
**Maximum Size**: 16MB

**Acceptance Criteria**:
- [ ] Voice messages show waveform
- [ ] Duration correctly displayed
- [ ] OGG Opus recommended for voice

---

### 3.5 Send Sticker

**Feature ID**: MM-005
**Priority**: Low

**Description**: Send a sticker.

**API Endpoint**: `POST /api/sendSticker`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "file": {
    "url": "https://example.com/sticker.webp"
  }
}
```

**Requirements**:
- Format: WebP only
- Size: 512x512 pixels (static) or animated WebP
- File size: Max 500KB

**Acceptance Criteria**:
- [ ] Auto-converts PNG/GIF to WebP sticker
- [ ] Validates dimensions
- [ ] Animated stickers supported

---

### 3.6 Send Location

**Feature ID**: MM-006
**Priority**: Low

**Description**: Send a location pin.

**API Endpoint**: `POST /api/sendLocation`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "name": "San Francisco",
    "address": "San Francisco, CA, USA"
  }
}
```

**Acceptance Criteria**:
- [ ] Map preview generated
- [ ] Clickable for directions
- [ ] Name and address optional

---

### 3.7 Send Contact

**Feature ID**: MM-007
**Priority**: Low

**Description**: Send a contact vCard.

**API Endpoint**: `POST /api/sendContact`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "contacts": [
    {
      "fullName": "John Doe",
      "phones": ["+1234567890"],
      "organization": "Acme Inc"
    }
  ]
}
```

**Acceptance Criteria**:
- [ ] vCard format generated
- [ ] Multiple contacts in one message
- [ ] Recipient can save to contacts

---

## 4. Interactive Messages

### 4.1 Button Message

**Feature ID**: IM-001
**Priority**: High

**Description**: Send message with clickable buttons.

**API Endpoint**: `POST /api/sendButtons`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "body": "Please choose an option:",
  "buttons": [
    { "id": "btn1", "text": "Option A" },
    { "id": "btn2", "text": "Option B" },
    { "id": "btn3", "text": "Option C" }
  ],
  "footer": "Powered by WhatsApp API"
}
```

**Response (Button Click Webhook)**:
```json
{
  "event": "message",
  "data": {
    "type": "buttons_response",
    "selectedButtonId": "btn1",
    "selectedButtonText": "Option A"
  }
}
```

**Limits**: Maximum 3 buttons

**Acceptance Criteria**:
- [ ] Buttons render correctly on all devices
- [ ] Button clicks captured via webhook
- [ ] Button ID and text returned in response

---

### 4.2 List Message

**Feature ID**: IM-002
**Priority**: High

**Description**: Send message with selectable list items.

**API Endpoint**: `POST /api/sendList`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "body": "Please select a product:",
  "buttonText": "View Products",
  "sections": [
    {
      "title": "Electronics",
      "rows": [
        { "id": "phone", "title": "Smartphone", "description": "$599" },
        { "id": "laptop", "title": "Laptop", "description": "$999" }
      ]
    },
    {
      "title": "Accessories",
      "rows": [
        { "id": "case", "title": "Phone Case", "description": "$29" }
      ]
    }
  ],
  "footer": "Tap to select"
}
```

**Limits**:
- Maximum 10 sections
- Maximum 10 rows per section
- Title: 24 characters
- Description: 72 characters

**Acceptance Criteria**:
- [ ] List opens on button tap
- [ ] Selected item returned via webhook
- [ ] Character limits enforced

---

### 4.3 Template Message (Quick Replies)

**Feature ID**: IM-003
**Priority**: Medium

**Description**: Send message with quick reply options.

**API Endpoint**: `POST /api/sendTemplate`

**Request**:
```json
{
  "session": "my-session",
  "chatId": "1234567890@c.us",
  "body": "How was your experience?",
  "templateButtons": [
    { "index": 1, "quickReplyButton": { "displayText": "Great!", "id": "rating-5" } },
    { "index": 2, "quickReplyButton": { "displayText": "Good", "id": "rating-4" } },
    { "index": 3, "quickReplyButton": { "displayText": "Poor", "id": "rating-1" } }
  ]
}
```

**Acceptance Criteria**:
- [ ] Quick reply buttons display inline
- [ ] Selection triggers message from user
- [ ] Button ID returned in webhook

---

## 5. Group Management

### 5.1 List Groups

**Feature ID**: GM-001
**Priority**: High

**Description**: Get all groups the session is a member of.

**API Endpoint**: `GET /api/{session}/groups`

**Response**:
```json
{
  "groups": [
    {
      "id": "123456789@g.us",
      "name": "Family Group",
      "participants": 12,
      "isAdmin": true,
      "createdAt": "2025-06-15T10:00:00Z"
    }
  ],
  "total": 1
}
```

**Acceptance Criteria**:
- [ ] Returns all groups
- [ ] Indicates admin status
- [ ] Participant count included

---

### 5.2 Get Group Info

**Feature ID**: GM-002
**Priority**: High

**Description**: Get detailed information about a specific group.

**API Endpoint**: `GET /api/{session}/groups/{groupId}`

**Response**:
```json
{
  "id": "123456789@g.us",
  "name": "Family Group",
  "description": "Our family chat",
  "owner": "1234567890@c.us",
  "createdAt": "2025-06-15T10:00:00Z",
  "participants": [
    {
      "id": "1234567890@c.us",
      "isAdmin": true,
      "isSuperAdmin": true
    },
    {
      "id": "0987654321@c.us",
      "isAdmin": false
    }
  ],
  "settings": {
    "announce": false,
    "restrict": false
  }
}
```

**Acceptance Criteria**:
- [ ] Full participant list with roles
- [ ] Group settings included
- [ ] Profile picture URL available

---

### 5.3 Create Group

**Feature ID**: GM-003
**Priority**: Medium

**Description**: Create a new WhatsApp group.

**API Endpoint**: `POST /api/{session}/groups`

**Request**:
```json
{
  "name": "Project Team",
  "participants": [
    "1234567890@c.us",
    "0987654321@c.us"
  ]
}
```

**Response**:
```json
{
  "id": "123456789-NEW@g.us",
  "name": "Project Team",
  "participants": 3
}
```

**Acceptance Criteria**:
- [ ] Minimum 1 participant (plus creator)
- [ ] Group name 1-25 characters
- [ ] Creator automatically admin

---

### 5.4 Add Participants

**Feature ID**: GM-004
**Priority**: Medium

**Description**: Add participants to a group.

**API Endpoint**: `POST /api/{session}/groups/{groupId}/participants/add`

**Request**:
```json
{
  "participants": ["1111111111@c.us", "2222222222@c.us"]
}
```

**Response**:
```json
{
  "added": ["1111111111@c.us"],
  "failed": [
    {
      "id": "2222222222@c.us",
      "reason": "not_a_contact"
    }
  ]
}
```

**Acceptance Criteria**:
- [ ] Must be group admin
- [ ] Partial success supported
- [ ] Reason provided for failures

---

### 5.5 Remove Participants

**Feature ID**: GM-005
**Priority**: Medium

**Description**: Remove participants from a group.

**API Endpoint**: `POST /api/{session}/groups/{groupId}/participants/remove`

**Request**:
```json
{
  "participants": ["1111111111@c.us"]
}
```

**Acceptance Criteria**:
- [ ] Must be group admin
- [ ] Cannot remove self (use leave)
- [ ] Cannot remove other admins (unless super admin)

---

### 5.6 Promote/Demote Admin

**Feature ID**: GM-006
**Priority**: Low

**Description**: Change participant admin status.

**API Endpoints**:
- `POST /api/{session}/groups/{groupId}/participants/promote`
- `POST /api/{session}/groups/{groupId}/participants/demote`

**Request**:
```json
{
  "participants": ["1111111111@c.us"]
}
```

**Acceptance Criteria**:
- [ ] Must be admin to promote
- [ ] Must be super admin to demote other admins

---

### 5.7 Update Group Info

**Feature ID**: GM-007
**Priority**: Low

**Description**: Update group name, description, or settings.

**API Endpoint**: `PATCH /api/{session}/groups/{groupId}`

**Request**:
```json
{
  "name": "New Group Name",
  "description": "Updated description"
}
```

**Acceptance Criteria**:
- [ ] Must be admin to update
- [ ] Name: 1-25 characters
- [ ] Description: 0-512 characters

---

### 5.8 Leave Group

**Feature ID**: GM-008
**Priority**: Low

**Description**: Leave a group.

**API Endpoint**: `POST /api/{session}/groups/{groupId}/leave`

**Acceptance Criteria**:
- [ ] Session removed from group
- [ ] Group data no longer accessible

---

## 6. Channel Management

### 6.1 List Channels

**Feature ID**: CM-001
**Priority**: Medium

**Description**: Get all channels the session follows or owns.

**API Endpoint**: `GET /api/{session}/channels`

**Response**:
```json
{
  "channels": [
    {
      "id": "123456789@newsletter",
      "name": "Tech News",
      "subscribers": 50000,
      "isOwner": false,
      "isAdmin": false
    }
  ]
}
```

---

### 6.2 Get Channel Info

**Feature ID**: CM-002
**Priority**: Medium

**Description**: Get detailed channel information.

**API Endpoint**: `GET /api/{session}/channels/{channelId}`

---

### 6.3 Send Channel Message

**Feature ID**: CM-003
**Priority**: Medium

**Description**: Send message to an owned channel.

**API Endpoint**: `POST /api/{session}/channels/{channelId}/messages`

**Request**:
```json
{
  "type": "text",
  "text": "Breaking news update!"
}
```

**Acceptance Criteria**:
- [ ] Must be channel owner/admin
- [ ] Same message types as regular chats
- [ ] Delivered to all subscribers

---

## 7. Webhook System

### 7.1 Webhook Events

**Feature ID**: WH-001
**Priority**: Critical

**Supported Events**:

| Event | Description |
|-------|-------------|
| `message` | New incoming message |
| `message.ack` | Message delivery/read status update |
| `message.reaction` | Reaction added/removed |
| `connection` | Session connection status change |
| `qr` | New QR code generated |
| `session.status` | Session status change |
| `group.join` | Session added to group |
| `group.leave` | Session removed from group |
| `call` | Incoming call notification |

---

### 7.2 Webhook Payload Format

**Feature ID**: WH-002
**Priority**: Critical

**Standard Payload**:
```json
{
  "event": "message",
  "session": "my-session",
  "timestamp": "2026-01-02T10:00:00Z",
  "data": {
    "id": "3EB0ABC123",
    "from": "1234567890@c.us",
    "to": "0987654321@c.us",
    "type": "text",
    "body": "Hello!",
    "timestamp": 1735812000
  }
}
```

**Security Headers**:
```
X-Webhook-Signature: sha256=abc123...
X-Webhook-Timestamp: 1735812000
```

---

### 7.3 Webhook Configuration

**Feature ID**: WH-003
**Priority**: High

**API Endpoint**: `POST /api/{session}/webhooks`

**Request**:
```json
{
  "url": "https://example.com/webhook",
  "events": ["message", "message.ack"],
  "secret": "my-webhook-secret",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

**Acceptance Criteria**:
- [ ] HTTPS required for production
- [ ] Multiple webhooks per session
- [ ] Event filtering supported
- [ ] Custom headers supported

---

### 7.4 Webhook Retry Logic

**Feature ID**: WH-004
**Priority**: High

**Retry Schedule**:
| Attempt | Delay | Total Wait |
|---------|-------|------------|
| 1 | Immediate | 0s |
| 2 | 10 seconds | 10s |
| 3 | 60 seconds | 70s |
| 4 | 5 minutes | 370s |
| Failed | Dead letter | - |

**Acceptance Criteria**:
- [ ] Exponential backoff
- [ ] Dead letter queue after 4 failures
- [ ] Webhook status trackable via API

---

## 8. Ban Prevention System

### 8.1 Warmup Stage Management

**Feature ID**: BP-001
**Priority**: Critical

**Stages**:
```
PHASE_1_PROFILE  → Days 1-2   → 0 messages    → Profile setup only
PHASE_2_RECEIVE  → Days 2-4   → 5/day max     → Receive & reply only
PHASE_3_LIMITED  → Days 3-7   → 40/day max    → Limited outbound
PHASE_4_GRADUAL  → Days 7-21  → 80/day max    → Gradual increase
COMPLETED        → Day 21+    → 100/day max   → Full operation
```

**API Endpoint**: `GET /api/{session}/warmup`

**Response**:
```json
{
  "stage": "PHASE_3_LIMITED",
  "startDate": "2025-12-28T10:00:00Z",
  "daysActive": 5,
  "canAdvanceAt": "2025-12-30T10:00:00Z",
  "limits": {
    "maxDaily": 40,
    "minInterval": 180,
    "used": 12,
    "remaining": 28
  }
}
```

**Acceptance Criteria**:
- [ ] Automatic stage advancement at midnight
- [ ] Manual skip option (with warning)
- [ ] Per-session tracking

---

### 8.2 Recipient Rate Limiting

**Feature ID**: BP-002
**Priority**: Critical

**Limits**:
- 15 messages per recipient per 24 hours
- Minimum 3-minute interval between messages to same recipient

**API Response (Rate Limited)**:
```json
{
  "error": "RATE_LIMITED",
  "message": "Recipient rate limit exceeded",
  "retryAfter": 180,
  "details": {
    "recipient": "1234567890@c.us",
    "messagesInWindow": 15,
    "windowResetAt": "2026-01-03T10:00:00Z"
  }
}
```

**Acceptance Criteria**:
- [ ] Per-session, per-recipient tracking
- [ ] 24-hour sliding window
- [ ] Clear retry-after timing

---

### 8.3 Human-Like Delays

**Feature ID**: BP-003
**Priority**: High

**Configuration**:
```json
{
  "delays": {
    "enabled": true,
    "minMs": 2000,
    "maxMs": 5000,
    "typingIndicator": true,
    "typingDurationMs": "auto"
  }
}
```

**Acceptance Criteria**:
- [ ] Random delay between min/max
- [ ] Typing indicator shown before message
- [ ] Typing duration proportional to message length
- [ ] Delays configurable per session

---

### 8.4 Message Content Variation

**Feature ID**: BP-004
**Priority**: Medium

**Anti-Spam Checks**:
- Warning if identical message sent to 3+ recipients
- Warning if sending too many messages without receiving any
- Warning if response rate < 10%

**API Endpoint**: `GET /api/{session}/safety/warnings`

**Response**:
```json
{
  "warnings": [
    {
      "type": "IDENTICAL_MESSAGES",
      "severity": "MEDIUM",
      "message": "Same message sent to 5 recipients today",
      "recommendation": "Vary your message content"
    }
  ]
}
```

---

## 9. Safety Monitoring

### 9.1 Safety Dashboard

**Feature ID**: SF-001
**Priority**: High

**API Endpoint**: `GET /api/{session}/safety`

**Response**:
```json
{
  "session": "my-session",
  "overallScore": 85,
  "riskLevel": "LOW",
  "warmup": {
    "stage": "PHASE_4_GRADUAL",
    "progress": "67%",
    "daysRemaining": 7
  },
  "usage": {
    "today": {
      "sent": 45,
      "delivered": 43,
      "read": 38,
      "failed": 2,
      "responses": 12
    },
    "limits": {
      "dailyMax": 80,
      "used": 45,
      "remaining": 35
    }
  },
  "metrics": {
    "deliveryRate": "95.5%",
    "readRate": "84.4%",
    "responseRate": "26.6%"
  },
  "warnings": [],
  "recommendations": [
    "Maintain current messaging pace",
    "Response rate is healthy"
  ]
}
```

---

### 9.2 Ban Risk Score

**Feature ID**: SF-002
**Priority**: High

**Scoring Factors**:
| Factor | Weight | Good | Bad |
|--------|--------|------|-----|
| Warmup compliance | 30% | Following schedule | Skipping phases |
| Delivery rate | 20% | >95% | <80% |
| Response rate | 20% | >20% | <5% |
| Message variety | 15% | Varied content | Identical spam |
| Rate limit adherence | 15% | Under limits | Hitting limits |

**Risk Levels**:
- 80-100: LOW (green)
- 60-79: MEDIUM (yellow)
- 40-59: HIGH (orange)
- 0-39: CRITICAL (red)

---

## 10. Analytics & Reporting

### 10.1 Daily Analytics

**Feature ID**: AN-001
**Priority**: Medium

**API Endpoint**: `GET /api/{session}/analytics/daily?days=7`

**Response**:
```json
{
  "period": {
    "from": "2025-12-26",
    "to": "2026-01-02"
  },
  "daily": [
    {
      "date": "2026-01-02",
      "sent": 45,
      "delivered": 43,
      "read": 38,
      "failed": 2,
      "received": 15
    }
  ],
  "totals": {
    "sent": 280,
    "delivered": 268,
    "read": 241,
    "failed": 12,
    "received": 89
  }
}
```

---

### 10.2 Recipient Analytics

**Feature ID**: AN-002
**Priority**: Low

**API Endpoint**: `GET /api/{session}/analytics/recipients`

**Response**:
```json
{
  "recipients": [
    {
      "id": "1234567890@c.us",
      "messagesSent": 12,
      "messagesReceived": 8,
      "lastContact": "2026-01-02T09:00:00Z",
      "responseRate": "66.6%"
    }
  ]
}
```

---

## 11. API Authentication

### 11.1 API Key Authentication

**Feature ID**: AU-001
**Priority**: Critical

**Header**: `X-Api-Key: your-api-key-here`

**Key Format**: 64-character hexadecimal string

**Acceptance Criteria**:
- [ ] 256-bit cryptographically random
- [ ] Stored as bcrypt hash
- [ ] Immediate 401 on invalid key
- [ ] Rate limiting by API key

---

### 11.2 Key Management

**Feature ID**: AU-002
**Priority**: Medium

**Operations**:
- Generate new key
- Rotate key (create new, invalidate old)
- Revoke key
- List active keys

---

## 12. Rate Limiting

### 12.1 Global Rate Limits

**Feature ID**: RL-001
**Priority**: Critical

**Limits**:
| Scope | Limit | Window |
|-------|-------|--------|
| Per IP | 1000 requests | 15 minutes |
| Per API Key | 500 requests | 15 minutes |
| Per Endpoint | Varies | Varies |

**Rate Limit Headers**:
```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 423
X-RateLimit-Reset: 1735812900
```

---

### 12.2 Endpoint-Specific Limits

**Feature ID**: RL-002
**Priority**: High

| Endpoint | Limit | Notes |
|----------|-------|-------|
| POST /sendText | Warmup-based | 0-100/day based on phase |
| GET /sessions | 60/min | Read-heavy allowed |
| POST /sessions | 10/hour | Prevent spam creation |
| POST /groups | 5/hour | WhatsApp limits |

---

## Feature Implementation Priority

### Phase 1 (Week 1) - Critical
- [x] SM-001: Create Session
- [x] SM-002: Get QR Code
- [x] SM-003: Get Session Status
- [x] TM-001: Send Text Message
- [x] BP-001: Warmup Stage Management
- [x] BP-002: Recipient Rate Limiting

### Phase 2 (Week 2) - High Priority
- [ ] MM-001: Send Image
- [ ] MM-002: Send Video
- [ ] MM-003: Send Document
- [ ] IM-001: Button Message
- [ ] IM-002: List Message
- [ ] WH-001: Webhook Events
- [ ] SF-001: Safety Dashboard

### Phase 3 (Week 3) - Medium Priority
- [ ] GM-001: List Groups
- [ ] GM-002: Get Group Info
- [ ] GM-003: Create Group
- [ ] CM-001: List Channels
- [ ] AN-001: Daily Analytics
- [ ] BP-003: Human-Like Delays

### Future Releases
- [ ] All remaining features
- [ ] Web dashboard UI
- [ ] Advanced analytics
- [ ] Multi-server clustering
