# WebSocket Contract

**Real-Time Event Streaming with Socket.IO**

This document defines the complete WebSocket contract between the BC Claude Agent backend and frontend applications.

---

## Connection Setup

### Establish Connection

```typescript
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('ws://localhost:3002', {  // ⭐ Port 3002 (check .env)
  transports: ['websocket'],  // Force WebSocket (no polling fallback)
  withCredentials: true,       // Include session cookie
  reconnection: true,          // Auto-reconnect
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// Connection events
socket.on('connect', () => {
  console.log('Connected:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

### Authentication

WebSocket connections **require valid session authentication**. The session cookie (`connect.sid`) is automatically included when `withCredentials: true`.

**If session is invalid**:
```typescript
socket.on('error', (error) => {
  if (error.message === 'Unauthorized') {
    // Redirect to login
    window.location.href = '/api/auth/login';
  }
});
```

---

## Client → Server Events

### 1. Join Session Room

**Event**: `session:join`

**Purpose**: Subscribe to events for a specific chat session

**Payload**:
```typescript
interface SessionJoinData {
  sessionId: string;  // UUID of the session
}
```

**Example**:
```typescript
socket.emit('session:join', {
  sessionId: '123e4567-e89b-12d3-a456-426614174000'
});
```

**Response**: No direct response. After joining, you'll receive all `agent:event` emissions for that session.

---

### 2. Leave Session Room

**Event**: `session:leave`

**Purpose**: Unsubscribe from session events

**Payload**:
```typescript
interface SessionLeaveData {
  sessionId: string;
}
```

**Example**:
```typescript
socket.emit('session:leave', {
  sessionId: '123e4567-e89b-12d3-a456-426614174000'
});
```

---

### 3. Send Chat Message

**Event**: `chat:message`

**Purpose**: Send a new user message to the agent

**Payload**:
```typescript
// ⭐ UPDATED 2025-11-24: Added Extended Thinking configuration
interface ChatMessageData {
  message: string;    // User's message
  sessionId: string;  // UUID of the session
  userId: string;     // UUID of the user (for multi-tenant safety)

  // ⭐ Extended Thinking configuration (per-request, optional)
  thinking?: ExtendedThinkingConfig;
}

interface ExtendedThinkingConfig {
  /**
   * Enable Extended Thinking mode for this request
   * @default false (falls back to server env.ENABLE_EXTENDED_THINKING)
   */
  enableThinking?: boolean;

  /**
   * Budget tokens for extended thinking
   * Only used when enableThinking is true.
   * @minimum 1024
   * @maximum 100000
   * @default 10000
   */
  thinkingBudget?: number;
}
```

**Validation**:
- `thinkingBudget` must be between 1024 and 100000 (Anthropic API limits)
- If invalid budget is provided, the request will be rejected with an `agent:error` event

**Examples**:

```typescript
// Basic message (no thinking)
socket.emit('chat:message', {
  message: 'List all customers',
  sessionId: '123e4567-e89b-12d3-a456-426614174000',
  userId: '987fcdeb-51a3-12d3-b456-426614174111'
});

// ⭐ Message with Extended Thinking enabled
socket.emit('chat:message', {
  message: 'Analyze this complex business scenario...',
  sessionId: '123e4567-e89b-12d3-a456-426614174000',
  userId: '987fcdeb-51a3-12d3-b456-426614174111',
  thinking: {
    enableThinking: true,
    thinkingBudget: 15000  // Custom budget (default: 10000)
  }
});

// ⭐ Explicitly disable thinking (overrides server default)
socket.emit('chat:message', {
  message: 'Quick question...',
  sessionId: '123e4567-e89b-12d3-a456-426614174000',
  userId: '987fcdeb-51a3-12d3-b456-426614174111',
  thinking: {
    enableThinking: false
  }
});
```

**What Happens Next**:
1. Backend saves user message to database
2. Backend executes agent query (DirectAgentService with thinking config)
3. Backend streams events back via `agent:event`
4. If thinking enabled, `thinking_chunk` events stream reasoning in real-time

---

### 4. Stop Agent Execution

**Event**: `chat:stop`

**Purpose**: Cancel ongoing agent execution

**Payload**:
```typescript
interface StopAgentData {
  sessionId: string;
  userId: string;
}
```

**Example**:
```typescript
socket.emit('chat:stop', {
  sessionId: '123e4567-e89b-12d3-a456-426614174000',
  userId: '987fcdeb-51a3-12d3-b456-426614174111'
});
```

**Note**: Currently implemented in frontend, backend support in progress.

---

### 5. Respond to Approval

**Event**: `approval:respond`

**Purpose**: Approve or reject a tool execution approval request

**Payload**:
```typescript
interface ApprovalResponseData {
  approvalId: string;  // UUID of the approval request
  approved: boolean;   // true = approve, false = reject
  userId: string;      // UUID of the user
}
```

**Example**:
```typescript
socket.emit('approval:respond', {
  approvalId: 'abc12345-e89b-12d3-a456-426614174222',
  approved: true,
  userId: '987fcdeb-51a3-12d3-b456-426614174111'
});
```

---

## Server → Client Events

### 1. Agent Event (Primary Event)

**Event**: `agent:event`

**Purpose**: **Single unified event** for all agent activities (thinking, messages, tools, errors)

**Type**: Discriminated union

**Payload**:
```typescript
// ⭐ UPDATED 2025-11-24: 16 event types (SDK 0.71+)
type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | ThinkingChunkEvent       // Extended Thinking streaming
  | MessagePartialEvent      // Partial message during streaming
  | MessageChunkEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompleteEvent
  | ErrorEvent
  | SessionEndEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UserMessageConfirmedEvent // User message persisted with sequence_number
  | TurnPausedEvent          // SDK 0.71: Long agentic turn paused
  | ContentRefusedEvent;     // SDK 0.71: Content refused (policy violation)
```

**All events include these base fields**:
```typescript
interface BaseAgentEvent {
  eventId: string;              // UUID for tracing
  sequenceNumber: number;        // Atomic ordering (use this, NOT timestamp)
  persistenceState: 'queued' | 'persisted' | 'failed';
  timestamp: Date;
  correlationId?: string;        // Link related events
  parentEventId?: string;        // Hierarchical relationships
}
```

---

#### 1.1 Session Start Event

**Type**: `'session_start'`

**When**: Agent execution begins

**Payload**:
```typescript
interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}
```

---

#### 1.2 Thinking Event

**Type**: `'thinking'`

**When**: Agent is thinking (before responding)

**Payload**:
```typescript
interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  content?: string;  // Optional thinking content
}
```

**UI Recommendation**: Show "Thinking..." indicator

---

#### 1.3 Message Chunk Event (Streaming)

**Type**: `'message_chunk'`

**When**: During streaming, one chunk per text fragment

**Payload**:
```typescript
interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  content: string;  // Incremental text chunk
}
```

**Usage**:
```typescript
let accumulatedText = '';

socket.on('agent:event', (event: AgentEvent) => {
  if (event.type === 'message_chunk') {
    accumulatedText += event.content;
    updateUI(accumulatedText);  // Update in real-time
  }
});
```

**Critical**: You will receive **many** `message_chunk` events for a single message. Accumulate them.

---

#### 1.4 Message Event (Complete Message)

**Type**: `'message'`

**When**: Message is complete (after all chunks)

**Payload**:
```typescript
// ⭐ UPDATED 2025-11-24: Added tokenUsage, model, and new stop reasons
interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  messageId: string;          // Anthropic message ID (format: msg_01ABC..., NOT UUID)
  role: 'user' | 'assistant'; // Message role
  content: string;            // Full message content
  stopReason?: StopReason;    // Why the message ended (SDK 0.71 native type)
  // ⭐ Phase 1A: Token usage for billing/admin visibility
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;  // Extended Thinking tokens (if enabled)
  };
  // ⭐ Phase 1A: Model that generated this response
  model?: string;             // e.g., "claude-sonnet-4-5-20250929"
}

// ⭐ SDK 0.71 StopReason - 6 possible values
type StopReason =
  | 'end_turn'      // Agent finished normally - final message
  | 'tool_use'      // Agent wants to use a tool - intermediate message
  | 'max_tokens'    // Hit max token limit - may be truncated
  | 'stop_sequence' // Hit custom stop sequence
  | 'pause_turn'    // ⭐ NEW: Long agentic turn paused (can be resumed)
  | 'refusal';      // ⭐ NEW: Content refused due to policy violation
```

**Stop Reason Logic**:
```typescript
if (event.stopReason === 'end_turn') {
  // Agent finished, ready for next user message
  enableInputField();
} else if (event.stopReason === 'tool_use') {
  // Agent wants to execute a tool, expect tool_use event
  showToolIndicator();
} else if (event.stopReason === 'pause_turn') {
  // ⭐ NEW: Long operation paused - inform user
  showPausedIndicator('Operation paused. Resuming...');
} else if (event.stopReason === 'refusal') {
  // ⭐ NEW: Policy violation - show appropriate message
  showWarning('Request could not be completed due to content policy.');
}
```

---

#### 1.5 Tool Use Event

**Type**: `'tool_use'`

**When**: Agent starts executing a tool

**Payload**:
```typescript
interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  toolName: string;           // Name of the tool
  toolArgs: Record<string, unknown>;  // Tool arguments (JSON)
  requiresApproval: boolean;  // If true, approval request will follow
}
```

**UI Recommendation**: Show "Executing tool: {toolName}..." indicator

---

#### 1.6 Tool Result Event

**Type**: `'tool_result'`

**When**: Tool execution completes

**Payload**:
```typescript
interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolName: string;
  toolResult: unknown;        // Tool execution result (JSON)
  success: boolean;
  error?: string;             // Error message if failed
}
```

**UI Recommendation**: Hide tool indicator, show result if needed

---

#### 1.7 Complete Event

**Type**: `'complete'`

**When**: Agent execution finishes (final result)

**Payload**:
```typescript
interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  result: AgentExecutionResult;
}

interface AgentExecutionResult {
  success: boolean;
  finalResponse?: string;
  toolsUsed: string[];
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}
```

**UI Recommendation**: Show execution summary (tokens, duration, tools used)

---

#### 1.8 Error Event

**Type**: `'error'`

**When**: An error occurs during agent execution

**Payload**:
```typescript
interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;              // Error message
  errorCode?: string;         // Error code
  isRecoverable: boolean;     // Can user retry?
}
```

**UI Recommendation**: Show error message, offer retry if recoverable

---

#### 1.9 Turn Paused Event (SDK 0.71+)

**Type**: `'turn_paused'`

**When**: Claude pauses a long-running agentic turn

**Payload**:
```typescript
interface TurnPausedEvent extends BaseAgentEvent {
  type: 'turn_paused';
  messageId: string;      // Anthropic message ID
  content?: string;       // Partial content before pause
  reason?: string;        // Why the turn was paused
}
```

**UI Recommendation**: Show "Processing paused, will resume..." indicator

---

#### 1.10 Content Refused Event (SDK 0.71+)

**Type**: `'content_refused'`

**When**: Claude refuses to generate content due to policy violation

**Payload**:
```typescript
interface ContentRefusedEvent extends BaseAgentEvent {
  type: 'content_refused';
  messageId: string;      // Anthropic message ID
  reason?: string;        // Policy violation explanation
  content?: string;       // Partial content before refusal (may be empty)
}
```

**UI Recommendation**: Show appropriate warning message to user

---

#### 1.11 User Message Confirmed Event

**Type**: `'user_message_confirmed'`

**When**: User message has been persisted with sequence number

**Payload**:
```typescript
interface UserMessageConfirmedEvent extends BaseAgentEvent {
  type: 'user_message_confirmed';
  messageId: string;      // Message ID from database
  userId: string;         // User who sent the message
  content: string;        // Message content
  sequenceNumber: number; // Atomic sequence number (Redis INCR)
  eventId: string;        // Event ID for tracing
}
```

**Usage**: Update optimistic UI message with server-confirmed sequence number

---

#### 1.12 Thinking Chunk Event (Extended Thinking)

**Type**: `'thinking_chunk'`

**When**: During Extended Thinking streaming, one chunk per thinking fragment

**Payload**:
```typescript
interface ThinkingChunkEvent extends BaseAgentEvent {
  type: 'thinking_chunk';
  content: string;        // Chunk of thinking content
  blockIndex?: number;    // Index for multi-block responses
}
```

**Usage**: Display real-time thinking process to user (if enabled)

---

### 2. Agent Error (Legacy)

**Event**: `agent:error`

**Purpose**: Error notification (legacy, prefer `agent:event` with `type: 'error'`)

**Payload**:
```typescript
interface AgentErrorData {
  error: string;
  sessionId: string;
}
```

---

### 3. Approval Requested

**Event**: `approval:requested`

**Purpose**: Request user approval for a write operation

**Payload**:
```typescript
interface ApprovalRequestData {
  approvalId: string;         // UUID of the approval request
  sessionId: string;
  toolName: string;           // Tool requiring approval
  toolArgs: Record<string, unknown>;
  summary: ChangeSummary;     // Human-readable summary
  priority: 'high' | 'medium' | 'low';
  expiresAt: string;          // ISO 8601 datetime (5 minutes default)
}

interface ChangeSummary {
  title: string;              // "Create new customer"
  description: string;        // "Create new customer: Acme Corp"
  changes: string[];          // ["Name: Acme Corp", "Email: info@acme.com"]
  risks?: string[];           // Optional risk warnings
}
```

**UI Flow**:
```typescript
socket.on('approval:requested', (data) => {
  showApprovalDialog({
    title: data.summary.title,
    description: data.summary.description,
    changes: data.summary.changes,
    priority: data.priority,
    expiresAt: new Date(data.expiresAt),
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

---

### 4. Approval Resolved

**Event**: `approval:resolved`

**Purpose**: Notify that approval was resolved (approved/rejected/expired)

**Payload**:
```typescript
interface ApprovalResolvedData {
  approvalId: string;
  approved: boolean;
  resolvedAt: string;  // ISO 8601 datetime
}
```

---

## Enhanced Contract Fields

**All events include these fields for Event Sourcing**:

### 1. Sequence Number

**Type**: `number`

**Purpose**: Guaranteed ordering of events (atomic, multi-tenant safe)

**Source**: Redis `INCR` command

**Critical**: **Use `sequenceNumber` for ordering, NOT `timestamp`**

```typescript
// ✅ CORRECT - Sort by sequence number
messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

// ❌ INCORRECT - Sort by timestamp (race conditions)
messages.sort((a, b) => a.timestamp - b.timestamp);
```

---

### 2. Persistence State

**Type**: `'queued' | 'persisted' | 'failed'`

**Purpose**: Real-time DB persistence status

**States**:
- `'queued'` - Event queued for persistence (eventual consistency)
- `'persisted'` - Event successfully persisted to database
- `'failed'` - Persistence failed (retry or log error)

**UI Usage**:
```typescript
if (event.persistenceState === 'queued') {
  showSavingIndicator();  // Show "Saving..." spinner
} else if (event.persistenceState === 'persisted') {
  hideSavingIndicator();  // Remove spinner
} else if (event.persistenceState === 'failed') {
  showErrorIndicator();   // Show error icon
}
```

---

### 3. Event ID

**Type**: `string` (UUID)

**Purpose**: Unique identifier for tracing and debugging

---

### 4. Correlation ID

**Type**: `string` (UUID, optional)

**Purpose**: Link related events (e.g., tool_use + tool_result)

**Example**:
```typescript
const correlationId = uuidv4();

// Tool use event
{ type: 'tool_use', correlationId, ... }

// Tool result event (same correlationId)
{ type: 'tool_result', correlationId, ... }
```

---

### 5. Parent Event ID

**Type**: `string` (UUID, optional)

**Purpose**: Hierarchical event relationships (parent → child)

---

## Complete Example: Frontend Integration

```typescript
import { io } from 'socket.io-client';
import type { AgentEvent } from './types';

// 1. Connect
const socket = io('ws://localhost:3001', {
  transports: ['websocket'],
  withCredentials: true
});

// 2. Join session
socket.emit('session:join', { sessionId });

// 3. Listen for events
let accumulatedText = '';

socket.on('agent:event', (event: AgentEvent) => {
  // Update persistence indicator
  if (event.persistenceState === 'queued') {
    showSaving();
  } else if (event.persistenceState === 'persisted') {
    hideSaving();
  }

  // Handle event by type
  switch (event.type) {
    case 'session_start':
      console.log('Session started');
      break;

    case 'thinking':
      showThinkingIndicator();
      break;

    case 'message_chunk':
      // Real-time streaming
      accumulatedText += event.content;
      updateMessageUI(accumulatedText);
      break;

    case 'message':
      // Message complete
      hideThinkingIndicator();
      if (event.stopReason === 'end_turn') {
        enableInputField();
      }
      break;

    case 'tool_use':
      showToolIndicator(event.toolName);
      break;

    case 'tool_result':
      hideToolIndicator();
      if (!event.success) {
        showError(`Tool failed: ${event.error}`);
      }
      break;

    case 'complete':
      showExecutionSummary(event.result);
      break;

    case 'error':
      showError(event.error);
      if (event.isRecoverable) {
        showRetryButton();
      }
      break;
  }
});

// 4. Handle approvals
socket.on('approval:requested', (data) => {
  showApprovalDialog({
    title: data.summary.title,
    description: data.summary.description,
    changes: data.summary.changes,
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

// 5. Send message
function sendMessage(message: string) {
  accumulatedText = '';  // Reset
  socket.emit('chat:message', {
    message,
    sessionId,
    userId
  });
}
```

---

## Best Practices

### 1. Use Sequence Numbers for Ordering

**Always sort by `sequenceNumber`, never by `timestamp`**. This prevents race conditions in distributed systems.

### 2. Accumulate Message Chunks

**Never display a single `message_chunk` alone**. Accumulate all chunks until you receive the `message` event.

### 3. Handle Persistence State

**Show UI indicators** for persistence state (`queued`, `persisted`, `failed`) to provide feedback.

### 4. Implement Approval Timeout UI

**Show countdown timer** for approval requests (5 minutes default). Warn user when approaching expiration.

### 5. Reconnection Strategy

**Implement reconnection logic**:
```typescript
socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected after', attemptNumber, 'attempts');
  // Rejoin session room
  socket.emit('session:join', { sessionId });
  // Fetch missed messages from REST API
  fetchMessages(sessionId);
});
```

### 6. Error Recovery

**For recoverable errors**, offer retry button:
```typescript
if (event.type === 'error' && event.isRecoverable) {
  showRetryButton(() => {
    socket.emit('chat:message', { message: lastMessage, sessionId, userId });
  });
}
```

---

## Performance Considerations

### Streaming Benefits

- **80-90% better perceived latency** (Time to First Token < 1s vs 5-10s)
- **Real-time "typing" effect** for better UX
- **Cancellable mid-generation** (user can stop agent)

### Rate Limiting

- **Max 100 jobs per session per hour**
- If rate limit exceeded, backend will emit error event

---

## Troubleshooting

### Connection Fails

**Check**:
1. Session cookie is included (`withCredentials: true`)
2. CORS origin is configured (`CORS_ORIGIN` env var)
3. User is authenticated (valid session)

### Events Not Received

**Check**:
1. Joined session room (`session:join` emitted)
2. WebSocket transport is used (not polling)
3. Firewall allows WebSocket connections

### Messages Out of Order

**Use `sequenceNumber` for sorting**, not `timestamp`.

---

## See Also

- [Backend README](./README.md) - Quick start guide
- [TypeScript Types](./types-reference.md) - Full type definitions
- [Error Handling](./error-handling.md) - Error codes

---

**Last Updated**: 2025-11-24 (SDK 0.71, added TurnPausedEvent, ContentRefusedEvent, tokenUsage)
