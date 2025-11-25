# TypeScript Types Reference

Complete type definitions for BC Claude Agent backend APIs.

> **Last Updated**: 2025-11-24 (SDK 0.71+)

---

## Agent Event Types

### AgentEvent (Discriminated Union)

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
  | UserMessageConfirmedEvent // User message confirmed with sequence
  | TurnPausedEvent          // SDK 0.71: Agentic turn paused
  | ContentRefusedEvent;     // SDK 0.71: Content refused
```

### Base Event Fields

```typescript
interface BaseAgentEvent {
  eventId: string;              // UUID for tracing
  sequenceNumber: number;        // Atomic ordering (Redis INCR)
  persistenceState: 'queued' | 'persisted' | 'failed';
  timestamp: Date;
  correlationId?: string;        // Link related events
  parentEventId?: string;        // Hierarchical relationships
}
```

### SessionStartEvent

```typescript
interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}
```

### ThinkingEvent

```typescript
interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  content?: string;
}
```

### MessageChunkEvent

```typescript
interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  content: string;  // Incremental text
}
```

### MessageEvent

```typescript
// ⭐ UPDATED 2025-11-24: Added tokenUsage, model, new stop reasons
interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  messageId: string;          // Anthropic ID format: msg_01ABC...
  role: 'user' | 'assistant';
  content: string;
  stopReason?: StopReason;    // SDK native type
  // ⭐ Phase 1A: Token usage for billing
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;  // Extended Thinking tokens
  };
  model?: string;             // e.g., "claude-sonnet-4-5-20250929"
}

// ⭐ SDK 0.71 StopReason - 6 values
type StopReason =
  | 'end_turn'      // Natural completion
  | 'tool_use'      // Wants to use tool
  | 'max_tokens'    // Token limit hit
  | 'stop_sequence' // Custom stop sequence
  | 'pause_turn'    // ⭐ NEW: Agentic turn paused
  | 'refusal';      // ⭐ NEW: Policy violation
```

### ToolUseEvent

```typescript
interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  toolName: string;
  toolArgs: Record<string, unknown>;
  requiresApproval: boolean;
}
```

### ToolResultEvent

```typescript
interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolName: string;
  toolResult: unknown;
  success: boolean;
  error?: string;
}
```

### CompleteEvent

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

### ErrorEvent

```typescript
interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;
  errorCode?: string;
  isRecoverable: boolean;
}
```

---

## Message Types

### MessageDbRecord

```typescript
// ⭐ UPDATED 2025-11-24: Added token tracking columns
interface MessageDbRecord {
  id: string;                    // Anthropic ID (msg_*, toolu_*) - NOT UUID
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  message_type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: string;             // JSON string (may include citations)
  stop_reason?: StopReason;      // SDK native type
  token_count?: number;          // Legacy - use input_tokens + output_tokens
  sequence_number?: number;      // Event sourcing (Redis INCR)
  event_id?: string;             // Links to message_events table
  tool_use_id?: string;          // Correlates tool_use and tool_result
  // ⭐ Phase 1A: Token tracking columns
  model?: string;                // e.g., "claude-sonnet-4-5-20250929"
  input_tokens?: number;
  output_tokens?: number;
  // Note: total_tokens is a computed column in DB
  created_at: Date;
}
```

---

## Approval Types

```typescript
interface ApprovalRequest {
  id: string;
  session_id: string;
  tool_name: string;
  tool_args: string;  // JSON string
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  priority: 'high' | 'medium' | 'low';
  created_at: Date;
  expires_at: Date;
  decided_at?: Date;
  decided_by?: string;
}

interface ChangeSummary {
  title: string;
  description: string;
  changes: string[];
  risks?: string[];
}
```

---

## Session Types

```typescript
interface Session {
  id: string;
  user_id: string;
  title: string;
  status: 'active' | 'archived';
  last_activity_at: Date;
  created_at: Date;
}
```

---

## WebSocket Types

```typescript
interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
}

interface ApprovalResponseData {
  approvalId: string;
  approved: boolean;
  userId: string;
}
```

---

### TurnPausedEvent (SDK 0.71+)

```typescript
interface TurnPausedEvent extends BaseAgentEvent {
  type: 'turn_paused';
  messageId: string;
  content?: string;
  reason?: string;
}
```

### ContentRefusedEvent (SDK 0.71+)

```typescript
interface ContentRefusedEvent extends BaseAgentEvent {
  type: 'content_refused';
  messageId: string;
  reason?: string;
  content?: string;
}
```

### UserMessageConfirmedEvent

```typescript
interface UserMessageConfirmedEvent extends BaseAgentEvent {
  type: 'user_message_confirmed';
  messageId: string;
  userId: string;
  content: string;
  sequenceNumber: number;
  eventId: string;
}
```

### ThinkingChunkEvent

```typescript
interface ThinkingChunkEvent extends BaseAgentEvent {
  type: 'thinking_chunk';
  content: string;
  blockIndex?: number;
}
```

---

**Last Updated**: 2025-11-24
