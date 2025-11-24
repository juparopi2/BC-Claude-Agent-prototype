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

### Dual-Table Architecture (Event Sourcing + Materialized View)

The backend uses **two tables** for message persistence to achieve both fast writes and fast reads:

1. **message_events** - Append-only event log (source of truth)
   - Every SDK event is written here **immediately** (synchronous)
   - Atomic sequence numbers via Redis INCR prevent race conditions
   - Immutable - never updated or deleted
   - Used for event replay, debugging, and audit compliance

2. **messages** - Materialized view (query optimization)
   - Built **asynchronously** from message_events via BullMQ workers
   - Used for fast frontend queries (no need to aggregate events)
   - Can be rebuilt by replaying events
   - Eventual consistency model

**Event Flow**:
```
DirectAgentService emits SDK event
  ↓
EventStore.appendEvent() → message_events table (sync, ~10ms)
  ↓
MessageQueue.addMessagePersistence() → BullMQ job (async)
  ↓
Worker processes job → messages table (eventual consistency)
```

### message_events (Event Sourcing)

⭐ **CRITICAL TABLE** - Source of truth for all message events

```sql
CREATE TABLE message_events (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  session_id UNIQUEIDENTIFIER NOT NULL,
  event_type NVARCHAR(50) NOT NULL,  -- 'message_start', 'content_block_delta', 'message_stop', etc.
  sequence_number INT NOT NULL,      -- Atomic sequence via Redis INCR
  timestamp DATETIME2 NOT NULL DEFAULT GETDATE(),
  data NVARCHAR(MAX) NOT NULL,       -- JSON event payload
  processed BIT NOT NULL DEFAULT 0,  -- For async processing queue

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, sequence_number)  -- Guarantee ordering
);

-- Indexes
CREATE INDEX idx_message_events_session ON message_events(session_id, sequence_number);
CREATE INDEX idx_message_events_processed ON message_events(processed) WHERE processed = 0;
CREATE INDEX idx_message_events_type ON message_events(event_type);
```

**Event Types**:
- `message_start` - Message initiated
- `content_block_start` - Content block started
- `content_block_delta` - Incremental content chunk
- `content_block_stop` - Content block finished
- `message_delta` - Message-level delta
- `message_stop` - Message completed (includes stop_reason)

**Why This Matters**:
- Frontend ordering **MUST** use `sequence_number`, not `timestamp`
- `timestamp` can have collisions in distributed systems
- Event sourcing enables full replay for debugging
- Complete audit trail for compliance

### messages (Materialized View)

Built from message_events for fast queries

```sql
CREATE TABLE messages (
  -- Phase 1B (2025-11-24): Changed from UNIQUEIDENTIFIER to NVARCHAR(255) to use Anthropic message IDs
  id NVARCHAR(255) PRIMARY KEY NOT NULL,  -- Anthropic message ID format: msg_01ABC...
  session_id UNIQUEIDENTIFIER NOT NULL,
  event_id UNIQUEIDENTIFIER NULL,     -- FK to message_events (source event)
  role NVARCHAR(50) NOT NULL,         -- 'user', 'assistant'
  message_type NVARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text', 'thinking', 'tool_use', 'tool_result'
  content NVARCHAR(MAX) NOT NULL,
  metadata NVARCHAR(MAX) NULL,        -- JSON for tool calls, thinking, etc.
  token_count INT NULL,
  stop_reason NVARCHAR(20) NULL,      -- 'end_turn', 'tool_use', 'max_tokens'
  sequence_number INT NULL,           -- Links to message_events.sequence_number
  tool_use_id NVARCHAR(255) NULL,     -- Anthropic SDK tool_use block ID (e.g., toolu_01ABC123)

  -- Phase 1A (2025-11-24): Token tracking for billing and cost analysis
  model NVARCHAR(100) NULL,           -- Claude model name (e.g., "claude-sonnet-4-5-20250929")
  input_tokens INT NULL,              -- Input tokens from Anthropic API
  output_tokens INT NULL,             -- Output tokens from Anthropic API
  total_tokens AS (ISNULL(input_tokens, 0) + ISNULL(output_tokens, 0)) PERSISTED,

  created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE NO ACTION,

  CONSTRAINT chk_messages_role CHECK (role IN ('user', 'assistant')),
  CONSTRAINT chk_messages_type CHECK (message_type IN ('text', 'thinking', 'tool_use', 'tool_result', 'error')),
  CONSTRAINT chk_messages_stop_reason CHECK (stop_reason IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence'))
);

-- Indexes
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_event ON messages(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_messages_stop_reason ON messages(stop_reason) WHERE stop_reason IS NOT NULL;
CREATE INDEX idx_messages_tool_use_id ON messages(tool_use_id) WHERE tool_use_id IS NOT NULL;

-- Phase 1A: Token tracking index for billing queries
CREATE NONCLUSTERED INDEX IX_messages_tokens
ON messages(session_id, created_at)
INCLUDE (input_tokens, output_tokens, model);
```

**Key Features**:
- `stop_reason='tool_use'` → Agentic loop continues (intermediate message)
- `stop_reason='end_turn'` → Agentic loop terminates (final response)
- `event_id` links back to message_events for event sourcing replay
- `sequence_number` ensures correct ordering (NOT created_at)

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
