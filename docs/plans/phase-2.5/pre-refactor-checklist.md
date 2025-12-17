# Pre-Refactor Checklist

## Purpose

This checklist defines what MUST NOT BREAK during the Phase 5 refactoring of DirectAgentService. Use this as a validation checklist before and after any structural changes.

---

## 1. Critical Invariants (MUST NOT BREAK)

### 1.1 Event Ordering

- [ ] `user_message_sent` is ALWAYS the first persisted event
- [ ] `thinking_chunk` events come BEFORE `message_chunk` events
- [ ] `tool_use` is ALWAYS followed by `tool_result` with same `toolUseId`
- [ ] `complete` or `error` is ALWAYS the last event
- [ ] Sequence numbers are consecutive (no gaps in `message_events` table)

### 1.2 Persistence States

- [ ] `message_chunk` has `persistenceState: 'transient'` (no sequenceNumber)
- [ ] `thinking_chunk` has `persistenceState: 'transient'`
- [ ] `message` has `persistenceState: 'persisted'` (with sequenceNumber)
- [ ] `thinking` has `persistenceState: 'persisted'` (with sequenceNumber)
- [ ] `tool_use` has `persistenceState: 'persisted'` (with sequenceNumber)
- [ ] `tool_result` has `persistenceState: 'persisted'` (with sequenceNumber)

### 1.3 Tool ID Consistency

- [ ] Tool events use Anthropic IDs (format: `toolu_XXXXX`)
- [ ] Tool events do NOT use LangChain run IDs
- [ ] `tool_use.toolUseId === tool_result.toolUseId` for matching pairs
- [ ] No duplicate tool events (deduplication active)

### 1.4 Multi-Tenant Isolation

- [ ] File attachments validate ownership (userId owns file)
- [ ] Session events are scoped by sessionId
- [ ] Concurrent sessions don't share sequence numbers
- [ ] User A cannot access User B's approvals

---

## 2. API Contract Preservation

### 2.1 runGraph() Signature

```typescript
// This signature MUST be preserved
async runGraph(
  prompt: string,
  sessionId: string,
  onEvent?: (event: AgentEvent) => void,
  userId?: string,
  options?: ExecuteStreamingOptions
): Promise<AgentExecutionResult>
```

- [ ] All parameters in same order
- [ ] All parameters same types
- [ ] Return type unchanged
- [ ] Optional parameters remain optional

### 2.2 ExecuteStreamingOptions

- [ ] `enableThinking?: boolean` preserved
- [ ] `thinkingBudget?: number` preserved
- [ ] `attachments?: string[]` preserved
- [ ] `enableAutoSemanticSearch?: boolean` preserved
- [ ] `semanticThreshold?: number` preserved
- [ ] `maxSemanticFiles?: number` preserved

### 2.3 AgentExecutionResult

- [ ] `response: string` preserved
- [ ] `success: boolean` preserved
- [ ] `toolsUsed?: string[]` preserved
- [ ] `sessionId: string` preserved
- [ ] `error?: string` preserved

---

## 3. Event Type Preservation

### 3.1 All Event Types Emitted

- [ ] `session_start`
- [ ] `thinking_chunk`
- [ ] `thinking_complete`
- [ ] `thinking`
- [ ] `message_chunk`
- [ ] `message`
- [ ] `tool_use`
- [ ] `tool_result`
- [ ] `approval_requested`
- [ ] `approval_resolved`
- [ ] `complete`
- [ ] `error`
- [ ] `user_message_confirmed`

### 3.2 Event Field Names

All field names must remain in camelCase:

- [ ] `eventId` (not `event_id`)
- [ ] `messageId` (not `message_id`)
- [ ] `toolUseId` (not `tool_use_id`)
- [ ] `toolName` (not `tool_name`)
- [ ] `sequenceNumber` (not `sequence_number`)
- [ ] `persistenceState` (not `persistence_state`)
- [ ] `blockIndex` (not `block_index`)
- [ ] `stopReason` (not `stop_reason`)

---

## 4. Consumer Compatibility

### 4.1 ChatMessageHandler

- [ ] `handleAgentEvent()` receives all event types
- [ ] WebSocket emission to `agent:event` unchanged
- [ ] Session room joining unchanged
- [ ] Persistence fallback logic unchanged

### 4.2 WebSocket Handlers

- [ ] `agent:event` is the only emission channel
- [ ] Event payloads match type definitions
- [ ] Room-based emission (`io.to(sessionId)`) preserved

### 4.3 Frontend Expectations

- [ ] Streaming chunks for real-time UI
- [ ] Final `message` event for content display
- [ ] `complete` event for UI finalization
- [ ] `error` event for error display
- [ ] `eventIndex` for ordering during stream

---

## 5. Singleton Pattern

### 5.1 Getter Function

- [ ] `getDirectAgentService()` returns singleton
- [ ] First call creates instance
- [ ] Subsequent calls return same instance
- [ ] Optional DI parameters work

### 5.2 Reset Function

- [ ] `__resetDirectAgentService()` exists for tests
- [ ] Allows injecting FakeAnthropicClient
- [ ] Does not affect production code

---

## 6. Error Handling

### 6.1 Thrown Errors

- [ ] Invalid attachments throw immediately
- [ ] Missing userId for files throws immediately
- [ ] Graph errors propagate to caller

### 6.2 Error Events

- [ ] `error` event emitted on failure
- [ ] `error` event persisted to EventStore
- [ ] `result.success === false` on error
- [ ] `result.error` contains message

---

## 7. Integration Test Validation

Run these tests BEFORE and AFTER refactoring:

```bash
# All agent integration tests
npm test -- DirectAgentService.integration orchestrator.integration thinking-state-transitions

# Attachment tests
npm test -- DirectAgentService.attachments.integration

# Approval flow
npm test -- approval-lifecycle.integration

# Full suite
npm test
```

### Expected Results

- [ ] All tests pass (1855+ tests)
- [ ] No test timeouts
- [ ] No sequence number gaps
- [ ] No duplicate tool events

---

## 8. Database Verification

### 8.1 After Each Test Run

```sql
-- Check for sequence gaps
SELECT
  session_id,
  sequence_number,
  LAG(sequence_number) OVER (PARTITION BY session_id ORDER BY sequence_number) as prev_seq,
  sequence_number - LAG(sequence_number) OVER (PARTITION BY session_id ORDER BY sequence_number) as gap
FROM message_events
WHERE gap > 1;  -- Should return 0 rows
```

### 8.2 Event Type Distribution

```sql
-- Verify all event types are being persisted
SELECT event_type, COUNT(*) as count
FROM message_events
WHERE created_at > DATEADD(hour, -1, GETDATE())
GROUP BY event_type
ORDER BY count DESC;
```

---

## 9. Refactoring Guidelines

### 9.1 Safe Changes

- Internal method extraction
- Adding new private methods
- Adding new optional parameters (with defaults)
- Improving logging
- Performance optimizations (same behavior)

### 9.2 Dangerous Changes

- Changing event emission order
- Changing event field names
- Changing event types
- Removing parameters from runGraph
- Changing return type structure
- Modifying persistence logic

### 9.3 Requires Review

- Adding new event types (may need frontend update)
- Adding new required parameters
- Changing default values
- Modifying error handling

---

## 10. Sign-Off Checklist

Before merging Phase 5 refactor:

- [ ] All integration tests pass
- [ ] Event sequence matches golden-snapshots.md
- [ ] API contract matches api-contract.md
- [ ] ChatMessageHandler unchanged
- [ ] WebSocket emission unchanged
- [ ] No database schema changes required
- [ ] Frontend works without changes

---

## 11. Rollback Plan

If refactoring introduces issues:

1. Revert to pre-refactor commit
2. Run integration tests to confirm
3. Document issue in Phase 5 README
4. Create targeted fix instead of full refactor

---

*Generated: 2025-12-17*
