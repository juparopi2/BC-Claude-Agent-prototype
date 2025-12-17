# Golden Behavior Snapshots

## Purpose

This document captures the expected event sequences for each major flow in DirectAgentService. These "golden snapshots" serve as the baseline for validating behavior after refactoring in Phase 5.

---

## Flow 1: Simple Message (No Thinking, No Tools)

### Input

```typescript
await agentService.runGraph(
  'Hello, what is Business Central?',
  sessionId,
  onEvent,
  userId
);
```

### Expected Event Sequence

```
SEQ  EVENT TYPE        PERSISTENCE    KEY FIELDS
───  ─────────────────────────────────────────────────────────────
0    user_message_sent persisted      content, timestamp
*    message_chunk     transient      content (streaming), blockIndex
*    message_chunk     transient      content (streaming), blockIndex
...
N    message           persisted      content (final), messageId, sequenceNumber, stopReason='end_turn'
N+1  complete          transient      reason='success'
```

### Invariants

1. `user_message_sent` is ALWAYS first (persisted to EventStore)
2. `message_chunk` events are TRANSIENT (no sequenceNumber)
3. `message` event has FINAL content (accumulated from chunks)
4. `complete` event is ALWAYS last
5. Sequence numbers are consecutive starting from 0

### Code Reference

`DirectAgentService.ts:1154-1165` - Final message emission

---

## Flow 2: Message with Extended Thinking

### Input

```typescript
await agentService.runGraph(
  'Explain the accounting cycle in Business Central',
  sessionId,
  onEvent,
  userId,
  { enableThinking: true, thinkingBudget: 10000 }
);
```

### Expected Event Sequence

```
SEQ  EVENT TYPE         PERSISTENCE    KEY FIELDS
───  ─────────────────────────────────────────────────────────────
0    user_message_sent  persisted      content, timestamp
*    thinking_chunk     transient      content (streaming), blockIndex
*    thinking_chunk     transient      content (streaming), blockIndex
...
*    thinking_complete  transient      content (accumulated), blockIndex
*    message_chunk      transient      content (streaming), blockIndex
...
N    thinking           persisted      content (final), messageId, sequenceNumber
N+1  message            persisted      content (final), messageId, sequenceNumber, stopReason
N+2  complete           transient      reason='success'
```

### Invariants

1. `thinking_chunk` events come BEFORE `message_chunk` events
2. `thinking_complete` signals transition from thinking to text
3. Final `thinking` event has accumulated content (persisted)
4. Final `message` event has response content (persisted)
5. Both `thinking` and `message` have sequenceNumbers

### Code Reference

`DirectAgentService.ts:871-906` - Thinking accumulation and transition
`DirectAgentService.ts:1072-1117` - Thinking persistence

---

## Flow 3: Message with Tool Use

### Input

```typescript
// FakeAnthropicClient configured with:
fakeClient.addResponse({
  textBlocks: ['Let me list the entities.'],
  toolUseBlocks: [{ id: 'toolu_01ABC', name: 'list_all_entities', input: {} }],
  stopReason: 'tool_use',
});
fakeClient.addResponse({
  textBlocks: ['I found the entities.'],
  stopReason: 'end_turn',
});

await agentService.runGraph('List all BC entities', sessionId, onEvent, userId);
```

### Expected Event Sequence

```
SEQ  EVENT TYPE        PERSISTENCE    KEY FIELDS
───  ─────────────────────────────────────────────────────────────
0    user_message_sent persisted      content
*    message_chunk     transient      content (streaming)
...
1    message           persisted      content (turn 1), stopReason='tool_use'
2    tool_use          persisted      toolUseId, toolName, args
3    tool_result       persisted      toolUseId, toolName, result, success
*    message_chunk     transient      content (streaming, turn 2)
...
N    message           persisted      content (final), stopReason='end_turn'
N+1  complete          transient      reason='success'
```

### Invariants

1. `tool_use` ALWAYS followed by `tool_result` for same toolUseId
2. Tool events use ANTHROPIC IDs (e.g., `toolu_01ABC`), not LangChain run IDs
3. Intermediate `message` with `stopReason='tool_use'` before tool events
4. Tool events are persisted to EventStore AND MessageQueue
5. No duplicate tool events (deduplication by toolUseId)

### Code Reference

`DirectAgentService.ts:653-775` - Tool event processing and deduplication
`DirectAgentService.ts:580-629` - Intermediate message on new model turn

---

## Flow 4: Approval Flow (Write Operation)

### Input

```typescript
// Tool that requires approval (e.g., create_customer)
fakeClient.addResponse({
  textBlocks: ['I will create a customer.'],
  toolUseBlocks: [{ id: 'toolu_02XYZ', name: 'create_customer', input: { name: 'Test Corp' } }],
  stopReason: 'tool_use',
});

await agentService.runGraph('Create a customer named Test Corp', sessionId, onEvent, userId);
```

### Expected Event Sequence

```
SEQ  EVENT TYPE          PERSISTENCE    KEY FIELDS
───  ─────────────────────────────────────────────────────────────
0    user_message_sent   persisted      content
*    message_chunk       transient      content (streaming)
1    message             persisted      content, stopReason='tool_use'
2    tool_use            persisted      toolUseId, toolName='create_customer'
3    approval_requested  pending        approvalId, toolName, description

     [WAITING FOR USER RESPONSE]

4    approval_resolved   transient      approvalId, approved=true/false
5    tool_result         persisted      toolUseId, result, success
*    message_chunk       transient      content (streaming)
N    message             persisted      content (final)
N+1  complete            transient      reason='success'
```

### If User Rejects

```
4    approval_resolved   transient      approved=false
5    tool_result         persisted      success=false, error='User rejected'
N    message             persisted      content='I cannot proceed without approval'
N+1  complete            transient      reason='success'
```

### Invariants

1. `approval_requested` emitted for write operations (create, update, delete)
2. Execution PAUSES until user responds
3. `approval_resolved` reflects user's decision
4. `tool_result.success` reflects approval outcome
5. Agent continues with tool result (approved) or error message (rejected)

### Code Reference

`ApprovalManager.ts` - Promise-based approval flow
`approval-lifecycle.integration.test.ts` - Full approval flow tests

---

## Flow 5: Error Handling

### Input

```typescript
// FakeAnthropicClient configured to throw
fakeClient.throwOnNextCall(new Error('API Error'));

await agentService.runGraph('This will fail', sessionId, onEvent, userId);
```

### Expected Event Sequence

```
SEQ  EVENT TYPE        PERSISTENCE    KEY FIELDS
───  ─────────────────────────────────────────────────────────────
0    user_message_sent persisted      content
*    error             persisted      error='API Error', code
```

### Invariants

1. User message is ALWAYS persisted (even on error)
2. Error is persisted to EventStore
3. `result.success === false`
4. `result.error` contains error message
5. No `complete` event on error (error is terminal)

### Code Reference

`DirectAgentService.ts:1039-1050` - Error handling in stream
`thinking-state-transitions.integration.test.ts:315-345` - Error state test

---

## Flow 6: File Attachments

### Input

```typescript
await agentService.runGraph(
  'Analyze this file',
  sessionId,
  onEvent,
  userId,
  { attachments: [fileId] }
);
```

### Expected Event Sequence

Same as Flow 1, but with file context injected into prompt.

### Invariants

1. File ownership validated BEFORE processing
2. Access denied returns `result.success === false` immediately
3. File context injected into enhanced prompt
4. Response may contain citations (file name references)
5. File usage recorded after message completion (fire-and-forget)

### Code Reference

`DirectAgentService.ts:160-228` - prepareFileContext
`DirectAgentService.ts:337-413` - File attachment validation in runGraph

---

## Persistence State Reference

| State | Meaning | Has sequenceNumber |
|-------|---------|-------------------|
| `transient` | Streaming only, not persisted | No |
| `pending` | Will be persisted async | No (pending) |
| `persisted` | Written to EventStore + MessageQueue | Yes |

---

## Event Index vs Sequence Number

| Field | Purpose | Source |
|-------|---------|--------|
| `eventIndex` | Frontend ordering during stream | Counter in runGraph |
| `sequenceNumber` | Database ordering | Redis INCR (atomic) |

- `eventIndex` is assigned to ALL events (including transient)
- `sequenceNumber` is ONLY on persisted events
- Frontend should use `eventIndex` for real-time ordering
- Database queries should use `sequenceNumber` for historical ordering

---

## Validation Commands

```bash
# Capture event sequence for a specific test
cd backend && npm test -- --reporter=verbose thinking-state-transitions

# Run all golden snapshot validation
npm test -- DirectAgentService.integration thinking-state-transitions

# Check for sequence number gaps
npm test -- "should persist events with consecutive sequence numbers"
```

---

*Generated: 2025-12-17*
