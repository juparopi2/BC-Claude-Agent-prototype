# Backend API - Quick Start Guide

**BC Claude Agent Backend Documentation**

Welcome to the BC Claude Agent backend API documentation. This guide will help you quickly understand and integrate with the backend services.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture Overview](#architecture-overview)
4. [Authentication](#authentication)
5. [API Endpoints](#api-endpoints)
6. [WebSocket Events](#websocket-events)
7. [TypeScript Types](#typescript-types)
8. [Error Handling](#error-handling)
9. [Rate Limiting](#rate-limiting)
10. [Examples](#examples)

---

## Overview

The BC Claude Agent backend is a **TypeScript Express server** that provides an AI-powered interface to Microsoft Business Central via Claude AI.

### Key Features

- **Real-Time Streaming**: WebSocket-based streaming with incremental text chunks (80-90% better perceived latency)
- **Event Sourcing**: Immutable event log with atomic sequence numbers for guaranteed ordering
- **Multi-Tenant**: Per-user authentication and BC token management with encryption
- **Human-in-the-Loop**: Approval system for write operations with Promise-based pattern
- **Queue System**: BullMQ-based async processing with rate limiting (100 jobs/session/hour)
- **Microsoft OAuth 2.0**: Single Sign-On with delegated Business Central permissions

### Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express 5.1.0 + Socket.IO 4.8.1
- **Database**: Azure SQL (mssql 12.1.0)
- **Cache**: Redis (ioredis 5.4.1)
- **Queue**: BullMQ 5.63.2
- **AI**: Anthropic Claude SDK 0.68.0
- **Authentication**: Microsoft OAuth 2.0 (@azure/msal-node 3.8.1)
- **Validation**: Zod 3.25.76

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- NPM >= 9.0.0
- Azure SQL database
- Redis instance
- Anthropic API key
- Microsoft Azure App Registration (for OAuth)

### Installation

```bash
cd backend
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Required Variables**:
```env
# Server
NODE_ENV=development
PORT=3001

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Microsoft OAuth
MICROSOFT_CLIENT_ID=<your-client-id>
MICROSOFT_CLIENT_SECRET=<your-client-secret>
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/callback

# Database
DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
DATABASE_NAME=sqldb-bcagent-dev
DATABASE_USER=sqladmin
DATABASE_PASSWORD=<password>

# Redis
REDIS_HOST=redis-bcagent-dev.redis.cache.windows.net
REDIS_PORT=6380
REDIS_PASSWORD=<password>

# Session & Encryption
SESSION_SECRET=<generate with: openssl rand -base64 32>
ENCRYPTION_KEY=<generate with: openssl rand -base64 32>

# Business Central
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=<your-bc-tenant-id>

# Frontend
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

### Run Development Server

```bash
npm run dev
```

Server will start on `http://localhost:3001`

### Health Check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-19T10:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "mcp": "connected",
    "bc": "connected"
  }
}
```

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────┐
│   Frontend  │
│  (Next.js)  │
└──────┬──────┘
       │ WebSocket (Socket.IO)
       │ REST API (Express)
       ▼
┌─────────────────────────────────┐
│      Backend (Express)          │
│  ┌──────────────────────────┐   │
│  │   Socket.IO Server       │   │  Real-time events
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │   DirectAgentService     │   │  Agent orchestration
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │   EventStore             │   │  Event sourcing
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │   MessageQueue (BullMQ)  │   │  Async processing
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │   ApprovalManager        │   │  Human-in-the-Loop
│  └──────────────────────────┘   │
└─────────────────────────────────┘
       │                    │
       ▼                    ▼
┌─────────────┐      ┌─────────────┐
│  Azure SQL  │      │   Redis     │
│  (Database) │      │   (Cache)   │
└─────────────┘      └─────────────┘
       │
       ▼
┌──────────────────────┐
│  Business Central    │
│  (OData v4 API)      │
└──────────────────────┘
```

### Key Components

1. **DirectAgentService** (`services/agent/DirectAgentService.ts`)
   - Core agent orchestration
   - Native streaming with Claude API
   - Vendored MCP tools (115 BC entity files)
   - Agentic loop (Think → Act → Verify → Repeat)

2. **EventStore** (`services/events/EventStore.ts`)
   - Append-only event log
   - Atomic sequence numbers (Redis INCR)
   - Event replay for state reconstruction

3. **MessageQueue** (`services/queue/MessageQueue.ts`)
   - BullMQ-based async processing
   - Rate limiting (100 jobs/session/hour)
   - 3 queues: message-persistence, tool-execution, event-processing

4. **ApprovalManager** (`services/approval/ApprovalManager.ts`)
   - Promise-based approval requests
   - WebSocket event emission
   - Auto-expiration (5 minutes default)

5. **MicrosoftOAuthService** (`services/auth/MicrosoftOAuthService.ts`)
   - Microsoft Entra ID OAuth 2.0
   - Token refresh automation
   - Business Central consent flow

For detailed architecture documentation, see [architecture-deep-dive.md](./architecture-deep-dive.md).

---

## Event Sourcing Pattern

The backend implements **Event Sourcing** with a dual-table architecture for optimal performance.

### Two-Table Architecture

The system uses **two tables** for message persistence:

1. **`message_events`** - Append-only event log (source of truth)
   - Every SDK event written **immediately** (synchronous, ~10ms)
   - Atomic sequence numbers via Redis INCR
   - Immutable - never updated or deleted
   - Used for event replay, debugging, and audit trail

2. **`messages`** - Materialized view (query optimization)
   - Built **asynchronously** from `message_events` via BullMQ workers
   - Used for fast frontend queries
   - Can be rebuilt by replaying events
   - Eventual consistency model

### Why Two Tables?

- **Fast writes**: Append-only log is extremely fast
- **Fast reads**: Materialized view optimized for queries
- **Complete audit trail**: Events never deleted
- **Recovery capability**: Rebuild `messages` by replaying `message_events`
- **Multi-tenant safe**: Atomic sequence numbers prevent race conditions

### Event Flow

```
DirectAgentService emits SDK event
  ↓
EventStore.appendEvent() → message_events table (sync, ~10ms)
  ↓ (non-blocking)
MessageQueue.addMessagePersistence() → BullMQ job queued
  ↓ (async worker)
Worker processes job → messages table (eventual consistency)
```

### Frontend Usage

**⚠️ CRITICAL**: Always use `sequence_number` for ordering, **NOT** `created_at`

- `timestamp` / `created_at` can have collisions in distributed systems
- `sequence_number` is atomic (Redis INCR) and guarantees correct order
- Messages include both `sequence_number` and `event_id` for tracing

### Database Schema

```sql
-- Source of truth (append-only)
CREATE TABLE message_events (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  event_type NVARCHAR(50) NOT NULL,
  sequence_number INT NOT NULL,
  data NVARCHAR(MAX) NOT NULL,
  UNIQUE (session_id, sequence_number)
);

-- Materialized view (fast queries)
CREATE TABLE messages (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  event_id UNIQUEIDENTIFIER REFERENCES message_events(id),
  role NVARCHAR(50) NOT NULL,
  message_type NVARCHAR(20) NOT NULL,
  content NVARCHAR(MAX) NOT NULL,
  token_count INT NULL,
  stop_reason NVARCHAR(20) NULL,
  sequence_number INT NULL,
  created_at DATETIME2 DEFAULT GETDATE()
);
```

For complete schema documentation, see [database-schema.md](../common/03-database-schema.md).

---

## Authentication

The backend uses **Microsoft OAuth 2.0** with session-based authentication.

### OAuth Flow

```
1. User clicks login → GET /api/auth/login
2. Redirect to Microsoft login page
3. User authenticates with Microsoft account
4. Redirect to → GET /api/auth/callback?code=...
5. Exchange code for access + refresh tokens
6. Fetch user profile from Microsoft Graph
7. Create/update user in database
8. Store session in Redis with tokens
9. Redirect to frontend /new
```

### Session Management

Sessions are stored in Redis and include:

```typescript
{
  userId: string;
  microsoftId: string;
  displayName: string;
  email: string;
  accessToken: string;       // Microsoft Graph token
  refreshToken?: string;      // For token refresh
  tokenExpiresAt: string;     // ISO 8601 datetime
}
```

**Session Cookie**: `connect.sid` (httpOnly, secure in production)

**Session Expiration**: 24 hours (configurable via `SESSION_MAX_AGE`)

### Business Central Access

After Microsoft OAuth, users must grant BC consent:

```
POST /api/auth/bc-consent
```

This acquires a **delegated BC token** with the user's permissions, stored encrypted in the database.

### Protected Endpoints

All endpoints except `/api/auth/*` and `/health/*` require authentication.

**Middleware**: `authenticateMicrosoft` validates session and auto-refreshes expired tokens.

For detailed authentication documentation, see [authentication.md](./authentication.md).

---

## API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/login` | Start Microsoft OAuth flow |
| GET | `/api/auth/callback` | Handle OAuth callback |
| POST | `/api/auth/logout` | Logout user (destroy session) |
| GET | `/api/auth/me` | Get current user info |
| GET | `/api/auth/bc-status` | Check BC token status |
| POST | `/api/auth/bc-consent` | Grant BC consent |

### Session Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/sessions` | Get all sessions for user |
| POST | `/api/chat/sessions` | Create new session |
| GET | `/api/chat/sessions/:id` | Get specific session |
| GET | `/api/chat/sessions/:id/messages` | Get session messages |
| PATCH | `/api/chat/sessions/:id` | Update session title |
| DELETE | `/api/chat/sessions/:id` | Delete session (cascade) |

### Approval Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/approvals/:id/respond` | Respond to approval request |
| GET | `/api/approvals/pending` | Get all pending approvals |
| GET | `/api/approvals/session/:sessionId` | Get session approvals |

### Health Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health check (DB, Redis, MCP, BC) |
| GET | `/health/liveness` | Simple liveness probe |

For complete API reference with examples, see [api-reference.md](./api-reference.md).

---

## WebSocket Events

The backend emits a **single event type** for all agent activities:

### Connection

```typescript
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3001', {
  transports: ['websocket'],
  withCredentials: true  // Include session cookie
});
```

### Join Session Room

```typescript
socket.emit('session:join', { sessionId: '<uuid>' });
```

### Send Chat Message

```typescript
socket.emit('chat:message', {
  message: 'List all customers',
  sessionId: '<uuid>',
  userId: '<uuid>'
});
```

### Listen for Agent Events

```typescript
socket.on('agent:event', (event: AgentEvent) => {
  switch (event.type) {
    case 'thinking':
      // Agent is thinking
      console.log('Thinking...');
      break;
    case 'message_chunk':
      // Streaming text chunk
      appendText(event.content);
      break;
    case 'message':
      // Complete message
      if (event.stopReason === 'end_turn') {
        console.log('Agent finished');
      }
      break;
    case 'tool_use':
      // Tool execution started
      showToolIndicator(event.toolName);
      break;
    case 'tool_result':
      // Tool execution completed
      hideToolIndicator();
      break;
    case 'complete':
      // Agent completed (final result)
      showFinalResult(event.result);
      break;
    case 'error':
      // Error occurred
      showError(event.error);
      break;
  }
});
```

### Handle Approval Requests

```typescript
socket.on('approval:requested', (data) => {
  showApprovalDialog({
    title: data.summary.title,
    description: data.summary.description,
    onApprove: () => {
      socket.emit('approval:respond', {
        approvalId: data.approvalId,
        approved: true,
        userId
      });
    },
    onReject: () => {
      socket.emit('approval:respond', {
        approvalId: data.approvalId,
        approved: false,
        userId
      });
    }
  });
});
```

For complete WebSocket documentation, see [websocket-contract.md](./websocket-contract.md).

---

## TypeScript Types

### AgentEvent (Discriminated Union)

```typescript
type AgentEvent =
  | ThinkingEvent
  | MessageChunkEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompleteEvent
  | ErrorEvent;

interface BaseAgentEvent {
  eventId: string;              // UUID for tracing
  sequenceNumber: number;        // Atomic ordering (Redis INCR)
  persistenceState: 'queued' | 'persisted' | 'failed';
  timestamp: Date;
  correlationId?: string;        // Link related events
  parentEventId?: string;        // Hierarchical relationships
}
```

### Message Types

```typescript
interface MessageDbRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  message_type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: string;             // JSON string
  stop_reason?: StopReason;      // SDK stop_reason
  token_count?: number;
  sequence_number?: number;      // Event sourcing sequence
  event_id?: string;             // Links to message_events table
  created_at: Date;
}
```

### Stop Reason

```typescript
// Imported from @anthropic-ai/sdk
type StopReason =
  | 'end_turn'      // Agent finished normally
  | 'tool_use'      // Agent wants to use a tool
  | 'max_tokens'    // Hit max token limit
  | 'stop_sequence' // Hit stop sequence
  | null;
```

For complete type definitions, see [types-reference.md](./types-reference.md).

---

## Error Handling

### Error Response Format

All errors follow a consistent structure:

```json
{
  "error": "Unauthorized",
  "message": "Microsoft OAuth session not found. Please log in.",
  "code": "AUTH_SESSION_MISSING"
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Invalid input, missing required fields |
| 401 | Unauthorized | No session, expired token |
| 403 | Forbidden | No BC access, missing permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource, concurrency conflict |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Database error, service unavailable |

### WebSocket Errors

```typescript
socket.on('agent:error', (data) => {
  console.error(`Error: ${data.error}`);
  // Show user-friendly message
});
```

For complete error handling documentation, see [error-handling.md](./error-handling.md).

---

## Rate Limiting

### Multi-Tenant Rate Limits

- **Max Jobs per Session**: 100 jobs per hour
- **Queues**: message-persistence, tool-execution, event-processing
- **Enforcement**: Redis-based atomic counters

### Rate Limit Response

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for session. Maximum 100 jobs per hour.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 1800
}
```

### Check Rate Limit Status

```typescript
const status = await messageQueue.getRateLimitStatus(sessionId);
console.log(`Jobs used: ${status.count} / ${status.max}`);
```

---

## Examples

### Example 1: Basic Chat Query

```typescript
// 1. Authenticate
const loginUrl = 'http://localhost:3001/api/auth/login';
// Redirect user to loginUrl

// 2. Create session
const session = await fetch('/api/chat/sessions', {
  method: 'POST',
  credentials: 'include'
}).then(r => r.json());

// 3. Connect to WebSocket
const socket = io('ws://localhost:3001', {
  transports: ['websocket'],
  withCredentials: true
});

// 4. Join session room
socket.emit('session:join', { sessionId: session.id });

// 5. Listen for events
socket.on('agent:event', (event) => {
  console.log(event);
});

// 6. Send message
socket.emit('chat:message', {
  message: 'Show me top 10 customers',
  sessionId: session.id,
  userId: '<user-id>'
});
```

### Example 2: Approval Flow

```typescript
// 1. Listen for approval requests
socket.on('approval:requested', (data) => {
  console.log(`Approval needed: ${data.summary.title}`);

  // 2. Show UI dialog
  const approved = confirm(data.summary.description);

  // 3. Respond
  socket.emit('approval:respond', {
    approvalId: data.approvalId,
    approved,
    userId
  });
});
```

### Example 3: Fetch Messages

```typescript
const messages = await fetch(
  `/api/chat/sessions/${sessionId}/messages`,
  { credentials: 'include' }
).then(r => r.json());

console.log(messages);
```

---

## Additional Resources

- **[WebSocket Contract](./websocket-contract.md)** - Real-time event streaming
- **[REST API Reference](./api-reference.md)** - All HTTP endpoints
- **[TypeScript Types](./types-reference.md)** - Type definitions
- **[Authentication](./authentication.md)** - Microsoft OAuth flow
- **[Error Handling](./error-handling.md)** - Error codes and handling
- **[Architecture Deep Dive](./architecture-deep-dive.md)** - Detailed architecture

---

## Support

- **Issues**: Report at https://github.com/anthropics/claude-code/issues
- **Documentation Gaps**: Create GitHub issue with label `documentation`

---

**Last Updated**: 2025-11-19
