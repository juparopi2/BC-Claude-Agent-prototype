# Backend Architecture Deep Dive

Detailed architecture documentation for BC Claude Agent backend.

---

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (Next.js)                    │
│              WebSocket + REST API Client                │
└────────────┬──────────────────────────────┬─────────────┘
             │                              │
             │ WebSocket (Socket.IO)        │ REST API
             │                              │
┌────────────▼──────────────────────────────▼─────────────┐
│              Backend (Express + Socket.IO)               │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Chat Message Handler                       │  │
│  │  (receives user messages via WebSocket)            │  │
│  └───────────┬────────────────────────────────────────┘  │
│              │                                            │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │       DirectAgentService                           │  │
│  │  - Native streaming with Claude API                │  │
│  │  - Vendored MCP tools (115 BC entities)            │  │
│  │  - Agentic loop (Think → Act → Verify → Repeat)    │  │
│  └───────────┬────────────────────────────────────────┘  │
│              │ Events                                     │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │         Event Store (Event Sourcing)               │  │
│  │  - Append-only event log                           │  │
│  │  - Atomic sequence numbers (Redis INCR)            │  │
│  └───────────┬────────────────────────────────────────┘  │
│              │                                            │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │        Message Queue (BullMQ)                      │  │
│  │  - Async persistence (eliminates 600ms delay)      │  │
│  │  - Rate limiting (100 jobs/session/hour)           │  │
│  └───────────┬────────────────────────────────────────┘  │
│              │                                            │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │       Approval Manager (Human-in-the-Loop)         │  │
│  │  - Promise-based approval requests                 │  │
│  │  - WebSocket event emission                        │  │
│  └────────────────────────────────────────────────────┘  │
└────────────┬──────────────────────────────┬─────────────┘
             │                              │
             ▼                              ▼
┌────────────────────────┐      ┌────────────────────────┐
│     Azure SQL          │      │       Redis            │
│  - Messages            │      │  - Sessions            │
│  - Events              │      │  - Queue metadata      │
│  - Approvals           │      │  - Sequence numbers    │
└────────────────────────┘      └────────────────────────┘
             │
             ▼
┌────────────────────────┐
│  Business Central      │
│  (OData v4 API)        │
└────────────────────────┘
```

---

## Core Patterns

### 1. Event Sourcing Pattern

**Purpose**: Immutable event log with guaranteed ordering

**Components**:
- `EventStore` - Append-only log in `message_events` table
- Redis `INCR` - Atomic sequence number generation
- `MessageQueue` - Async processing of events

**Flow**:
```
User sends message
  → EventStore.appendEvent()  // Fast, synchronous
    → Generates sequence number (Redis INCR)
    → Inserts to message_events table
  → MessageQueue.addMessagePersistence()  // Async, non-blocking
    → Worker persists to messages table  // Eventual consistency
```

**Benefits**:
- **Guaranteed ordering** - Sequence numbers prevent race conditions
- **Audit trail** - Complete history of all events
- **State reconstruction** - Replay events to rebuild state
- **Multi-tenant safe** - Atomic sequence per session

---

### 2. Streaming Architecture

**Purpose**: Real-time text generation with low latency

**Implementation**:
```typescript
// DirectAgentService.executeQueryStreaming()
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-5',
  messages: conversationHistory,
  tools: mcpTools,
  max_tokens: 4096,
  stream: true
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    if (event.delta.type === 'text_delta') {
      // Emit chunk immediately
      onEvent({
        type: 'message_chunk',
        content: event.delta.text,
        ...enhancedFields
      });
    }
  }
}
```

**Benefits**:
- **80-90% better perceived latency** (TTFT < 1s vs 5-10s)
- **Real-time "typing" effect**
- **Cancellable mid-generation**

---

### 3. Multi-Tenant Architecture

**Principles**:
1. **All operations scoped by `userId` + `sessionId`**
2. **Session ownership validation** (TODO: implement in ChatMessageHandler)
3. **Rate limiting per session** (100 jobs/hour)
4. **Per-user BC tokens** (encrypted in database)

**Implementation**:
```typescript
// All queries filter by user_id
SELECT * FROM sessions WHERE user_id = @userId;

// Rate limiting per session
const key = `queue:ratelimit:${sessionId}`;
const count = await redis.incr(key);  // Atomic
await redis.expire(key, 3600);  // 1 hour TTL

// Per-user BC tokens
const bcToken = decrypt(user.bc_access_token_encrypted);
```

---

### 4. Approval System Pattern

**Purpose**: Human-in-the-Loop for write operations

**Implementation**:
```typescript
// ApprovalManager.request()
const promise = new Promise<boolean>((resolve, reject) => {
  // Store resolver in memory map
  this.pendingApprovals.set(approvalId, { resolve, reject });

  // Create DB record
  await db.insert('approvals', { id: approvalId, ... });

  // Emit WebSocket event
  io.to(sessionId).emit('approval:requested', { approvalId, ... });
});

// Wait for user response (Promise resolves when user responds)
const approved = await promise;

if (approved) {
  // Continue operation
} else {
  // Cancel operation
}
```

**Benefits**:
- **Non-blocking** - Agent waits for approval asynchronously
- **User-driven** - User has full control
- **Timeout handling** - Auto-expires after 5 minutes

---

### 5. Queue-Based Persistence

**Purpose**: Eliminate 600ms database write delay

**Implementation**:
```typescript
// Fast path (synchronous)
await EventStore.appendEvent(event);  // ~10ms

// Slow path (asynchronous)
await MessageQueue.addMessagePersistence({
  sessionId,
  message: ...
});  // Returns immediately, actual persistence happens in worker
```

**Benefits**:
- **Non-blocking** - No wait for DB writes
- **Rate limiting** - Built-in queue rate limiting
- **Retry logic** - Automatic retries on failure
- **Eventual consistency** - Messages eventually persisted

---

## Key Services

### DirectAgentService

**File**: `backend/src/services/agent/DirectAgentService.ts`

**Purpose**: Core agent orchestration with native streaming

**Why Not Use Agent SDK?**
- ProcessTransport bug (fixed in v0.1.30+ but still using workaround)
- Vendored MCP tools eliminate external dependencies
- Full control over streaming and tool execution

**Key Methods**:
- `executeQueryStreaming()` - Main query handler
- `getMCPToolDefinitions()` - Load 7 BC tools from vendored data
- `executeMCPTool()` - Execute tools directly (bypasses SDK)
- `generateEnhancedFields()` - Create Event Sourcing metadata

**MCP Tools** (7 total):
1. `list_all_entities`
2. `search_entity_operations`
3. `get_entity_details`
4. `get_entity_relationships`
5. `validate_workflow_structure`
6. `build_knowledge_base_workflow`
7. `get_endpoint_documentation`

**Data Source**: `mcp-server/data/v1.0/` (115 JSON files)

---

### EventStore

**File**: `backend/src/services/events/EventStore.ts`

**Purpose**: Append-only event log with atomic sequence numbers

**Key Methods**:
- `appendEvent()` - Append immutable event
- `getEvents()` - Retrieve events by sequence range
- `getNextSequenceNumber()` - Atomic sequence via Redis INCR
- `replayEvents()` - Reconstruct state from events

**Sequence Number Generation**:
```typescript
// Redis INCR is atomic - perfect for distributed systems
const sequenceNumber = await redis.incr(`event:sequence:${sessionId}`);
await redis.expire(key, 7 * 24 * 60 * 60);  // 7 days TTL
```

---

### MessageQueue

**File**: `backend/src/services/queue/MessageQueue.ts`

**Purpose**: BullMQ-based async processing with rate limiting

**3 Queues**:
1. `message-persistence` - Async message persistence
2. `tool-execution` - Tool execution (unused)
3. `event-processing` - Event processing

**Configuration**:
- Concurrency: 10 (messages), 5 (tools), 10 (events)
- Retry: 3 attempts with exponential backoff
- Keep completed: 100 jobs, 1 hour TTL
- Keep failed: 500 jobs, 24 hour TTL

**Rate Limiting**:
```typescript
const key = `queue:ratelimit:${sessionId}`;
const count = await redis.incr(key);  // Atomic
await redis.expire(key, 3600);  // 1 hour TTL
return count <= 100;  // Max 100 jobs per session per hour
```

---

### ApprovalManager

**File**: `backend/src/services/approval/ApprovalManager.ts`

**Purpose**: Human-in-the-Loop approval system

**Key Methods**:
- `request()` - Request approval (returns Promise)
- `respondToApproval()` - Handle user decision
- `generateChangeSummary()` - Human-readable UI data

**Priority Calculation**:
- `high` - Delete operations, batch operations
- `medium` - Create/update operations
- `low` - Read operations

---

## Database Schema

### message_events (Event Sourcing)

```sql
CREATE TABLE message_events (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id) ON DELETE CASCADE,
  event_type NVARCHAR(50) NOT NULL,
  sequence_number INT NOT NULL,  -- Atomic (Redis INCR)
  timestamp DATETIME2 NOT NULL,
  data NVARCHAR(MAX) NOT NULL,  -- JSON event payload
  processed BIT DEFAULT 0,
  UNIQUE (session_id, sequence_number)  -- Guarantee ordering
);
```

### messages (Eventual Consistency)

```sql
CREATE TABLE messages (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id) ON DELETE CASCADE,
  role NVARCHAR(50) NOT NULL,
  message_type NVARCHAR(50) NOT NULL,
  content NVARCHAR(MAX),
  metadata NVARCHAR(MAX),  -- JSON
  stop_reason NVARCHAR(50),  -- SDK stop_reason
  token_count INT,
  sequence_number INT,  -- Links to event sequence
  event_id UNIQUEIDENTIFIER REFERENCES message_events(id),
  created_at DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## Performance Optimizations

### 1. Prompt Caching

**SDK Handles Automatically** - No manual configuration needed

**Benefits**:
- 80-90% faster for repeated context
- Significant cost savings

---

### 2. Connection Pooling

**Azure SQL**:
- Max: 20 connections
- Min: 2 connections
- Idle timeout: 30s

**Redis**:
- Single connection (ioredis handles pooling internally)

---

### 3. Database Keepalive

**Purpose**: Prevent Azure SQL idle connection closure

**Implementation**:
```typescript
// Run SELECT 1 every 5 minutes
setInterval(async () => {
  await executeQuery('SELECT 1');
}, 5 * 60 * 1000);
```

---

## Deployment Architecture

### Azure Container Apps

```yaml
containers:
  - name: bc-agent-backend
    image: bcagent.azurecr.io/backend:latest
    resources:
      cpu: 0.5
      memory: 1Gi
    env:
      - name: NODE_ENV
        value: production
      - name: ANTHROPIC_API_KEY
        secretRef: anthropic-api-key
    probes:
      liveness: /health/liveness
      readiness: /health
    scale:
      minReplicas: 1
      maxReplicas: 10
      rules:
        - http:
            concurrent Requests: 100
```

---

**Last Updated**: 2025-11-19
