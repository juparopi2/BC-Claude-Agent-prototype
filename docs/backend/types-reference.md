# TypeScript Types Reference

Complete type definitions for BC Claude Agent backend APIs.

---

## Agent Event Types

### AgentEvent (Discriminated Union)

```typescript
type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | MessageChunkEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompleteEvent
  | ErrorEvent;
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
interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  content: string;
  stopReason?: StopReason;
  tokenCount?: number;
}

type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | null;
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
interface MessageDbRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  message_type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  content: string;
  metadata?: string;             // JSON string
  stop_reason?: StopReason;
  token_count?: number;
  sequence_number?: number;
  event_id?: string;
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

**Last Updated**: 2025-11-19
