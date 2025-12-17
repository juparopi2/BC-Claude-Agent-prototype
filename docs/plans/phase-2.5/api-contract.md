# API Contract Documentation

## Purpose

This document defines the public API contract for DirectAgentService that MUST be preserved after refactoring. Any changes to these contracts require updating all consumers (ChatMessageHandler, WebSocket handlers, tests).

---

## 1. DirectAgentService Public API

### 1.1 runGraph() Method Signature

```typescript
async runGraph(
  prompt: string,
  sessionId: string,
  onEvent?: (event: AgentEvent) => void,
  userId?: string,
  options?: ExecuteStreamingOptions
): Promise<AgentExecutionResult>
```

**Location**: `backend/src/services/agent/DirectAgentService.ts:299-1211`

### 1.2 ExecuteStreamingOptions

```typescript
interface ExecuteStreamingOptions {
  /** Enable Extended Thinking mode. @default false */
  enableThinking?: boolean;

  /** Budget tokens for thinking (1024-100000). @default 10000 */
  thinkingBudget?: number;

  /** List of file IDs to attach to message context */
  attachments?: string[];

  /** Enable automatic semantic file search. @default false */
  enableAutoSemanticSearch?: boolean;

  /** Semantic search relevance threshold (0.0-1.0). @default 0.7 */
  semanticThreshold?: number;

  /** Maximum files from semantic search. @default 3 */
  maxSemanticFiles?: number;
}
```

**Location**: `backend/src/services/agent/DirectAgentService.ts:65-104`

### 1.3 AgentExecutionResult

```typescript
interface AgentExecutionResult {
  response: string;      // Final response content
  success: boolean;      // true if completed, false on error
  toolsUsed?: string[];  // Names of tools executed
  sessionId: string;     // Session ID
  error?: string;        // Error message if success=false
  messageId?: string;    // ID of final message (if available)
}
```

**Location**: `backend/src/types/agent.types.ts`

---

## 2. Event Types Contract

### 2.1 Base Event Structure

All events MUST include these fields:

```typescript
interface BaseAgentEvent {
  type: AgentEventType;
  timestamp: string;           // ISO 8601 format
  eventId: string;             // UUID v4
  persistenceState: 'transient' | 'pending' | 'persisted';
  eventIndex?: number;         // Sequential index for ordering
  sessionId?: string;          // Session scope
}
```

### 2.2 Event Type Definitions

| Type | Persistence | Description | Required Fields |
|------|-------------|-------------|-----------------|
| `session_start` | transient | Agent session begins | sessionId |
| `thinking_chunk` | transient | Streaming thinking content | content, blockIndex |
| `thinking_complete` | transient | Thinking phase ended | content, blockIndex |
| `thinking` | persisted | Final thinking block | content, messageId, sequenceNumber |
| `message_chunk` | transient | Streaming response content | content, blockIndex |
| `message` | persisted | Final response message | content, messageId, sequenceNumber, stopReason, role |
| `tool_use` | persisted | Tool execution requested | toolUseId, toolName, args |
| `tool_result` | persisted | Tool execution completed | toolUseId, toolName, result, success |
| `approval_requested` | pending | User approval needed | approvalId, toolName, description |
| `approval_resolved` | transient | User responded | approvalId, approved |
| `complete` | transient | Execution finished | reason |
| `error` | persisted | Error occurred | error, code |
| `user_message_confirmed` | persisted | User message saved | messageId, content, sequenceNumber |

### 2.3 Detailed Event Payloads

#### ThinkingEvent
```typescript
interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  content: string;
  messageId: string;
  sequenceNumber: number;
}
```

#### MessageEvent
```typescript
interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  content: string;
  messageId: string;
  role: 'assistant';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal';
  sequenceNumber: number;
}
```

#### ToolUseEvent
```typescript
interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  toolUseId: string;       // Anthropic ID (e.g., 'toolu_01ABC')
  toolName: string;
  args: Record<string, unknown>;
  sequenceNumber?: number; // Present when persisted
}
```

#### ToolResultEvent
```typescript
interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolUseId: string;
  toolName: string;
  args?: Record<string, unknown>;
  result: string | Record<string, unknown>;
  success: boolean;
  error?: string;
  sequenceNumber?: number;
}
```

#### CompleteEvent
```typescript
interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
}
```

#### ErrorEvent
```typescript
interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;
  code?: string;
}
```

---

## 3. Event Ordering Contract

### 3.1 Guaranteed Order

```
1. user_message_sent (always first)
2. [thinking_chunk*] (if thinking enabled)
3. [thinking_complete] (signals transition)
4. [message_chunk*] (streaming)
5. [message] (intermediate, stopReason='tool_use')
6. [tool_use → tool_result]* (may repeat)
7. [message_chunk*] (final turn streaming)
8. thinking (persisted, if thinking enabled)
9. message (final, persisted)
10. complete (always last, or error)
```

### 3.2 Invariants (MUST NOT BREAK)

| Invariant | Description |
|-----------|-------------|
| INV-1 | `user_message_sent` is ALWAYS persisted first |
| INV-2 | `thinking_chunk` comes BEFORE `message_chunk` |
| INV-3 | `tool_use` is ALWAYS followed by `tool_result` |
| INV-4 | `message` has `sequenceNumber` when persisted |
| INV-5 | `complete` or `error` is ALWAYS last |
| INV-6 | Sequence numbers are consecutive (no gaps) |
| INV-7 | `message_chunk` NEVER has `sequenceNumber` |
| INV-8 | Tool events use Anthropic IDs, not LangChain IDs |

---

## 4. Consumer Dependencies

### 4.1 ChatMessageHandler

**Location**: `backend/src/services/websocket/ChatMessageHandler.ts`

**Consumes**:
- `runGraph()` method
- All `AgentEvent` types via `onEvent` callback

**Expectations**:
- Events emitted to `io.to(sessionId).emit('agent:event', event)`
- Validates `persistenceState` on message events
- Falls back to manual persistence if not `persisted`

**Event Handling by Type**:

```typescript
switch (event.type) {
  case 'thinking':
    // Expects transient (streaming) or persisted (final)
    break;
  case 'message_chunk':
    // Expects transient, warns if not
    break;
  case 'message':
    // Expects persisted, logs error if not
    break;
  case 'tool_use':
    // Expects persisted, falls back if not
    break;
  case 'tool_result':
    // Expects persisted, falls back if not
    break;
  case 'complete':
    // Logs completion
    break;
  case 'error':
    // Logs error
    break;
}
```

### 4.2 WebSocket Emission Contract

**Event Name**: `agent:event`

**Payload**: Full `AgentEvent` object

**Room**: `sessionId` (clients must join session room)

**Example**:
```typescript
io.to(sessionId).emit('agent:event', {
  type: 'message',
  content: 'Response text',
  messageId: 'uuid',
  sequenceNumber: 5,
  ...
});
```

### 4.3 Frontend Expectations

The frontend expects:

1. **Real-time streaming**: `message_chunk` events for typing effect
2. **Final content**: `message` event with complete content
3. **Thinking visibility**: `thinking_chunk` for showing thinking
4. **Tool progress**: `tool_use` and `tool_result` for tool UI
5. **Completion signal**: `complete` event to finalize UI
6. **Error handling**: `error` event for error display

---

## 5. Singleton Pattern

### 5.1 Getter Function

```typescript
function getDirectAgentService(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager,
  client?: IAnthropicClient
): DirectAgentService
```

### 5.2 Reset Function (Testing Only)

```typescript
function __resetDirectAgentService(): void
```

**Usage**: Only in tests to allow FakeAnthropicClient injection.

---

## 6. Error Contracts

### 6.1 Thrown Errors

| Error | When | Recoverable |
|-------|------|-------------|
| `UserId required for file attachments` | attachments without userId | No |
| `Access denied or file not found: {id}` | Invalid attachment | No |
| Graph execution errors | LangGraph stream fails | No (propagated) |

### 6.2 Error Events

Errors are emitted via `onEvent` callback and persisted to EventStore:

```typescript
{
  type: 'error',
  error: 'Error message',
  code: 'ERROR_CODE',
  persistenceState: 'persisted'
}
```

---

## 7. Dependency Injection

### 7.1 Constructor

```typescript
constructor(
  approvalManager?: ApprovalManager,  // For approval flow
  _todoManager?: TodoManager,         // Deprecated
  client?: IAnthropicClient           // For testing (FakeAnthropicClient)
)
```

### 7.2 Test Usage

```typescript
const fakeClient = new FakeAnthropicClient();
const service = new DirectAgentService(approvalManager, undefined, fakeClient);
```

---

## 8. Breaking Change Checklist

When modifying DirectAgentService, check:

- [ ] `runGraph()` signature unchanged
- [ ] `ExecuteStreamingOptions` fields preserved
- [ ] All event types still emitted correctly
- [ ] Event field names unchanged (camelCase)
- [ ] `persistenceState` set correctly
- [ ] `sequenceNumber` on persisted events
- [ ] Tool IDs use Anthropic format
- [ ] Singleton pattern preserved
- [ ] DI for testing preserved
- [ ] ChatMessageHandler still works
- [ ] WebSocket emission unchanged

---

*Generated: 2025-12-17*
