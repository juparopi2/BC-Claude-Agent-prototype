# Integration Test Inventory

## Purpose

This document catalogs all integration tests covering DirectAgentService and related agent functionality, documenting what each test validates for use as a golden baseline before refactoring.

---

## Test Files Overview

| File | Lines | Tests | Focus |
|------|-------|-------|-------|
| `DirectAgentService.integration.test.ts` | 378 | 4 | Core message flow, persistence, multi-tenant |
| `DirectAgentService.attachments.integration.test.ts` | 489 | 13 | File attachments, context, citations |
| `orchestrator.integration.test.ts` | 743 | 18 | LangGraph orchestrator, routing, thinking |
| `thinking-state-transitions.integration.test.ts` | 493 | 10 | Extended thinking, state machine |
| `approval-lifecycle.integration.test.ts` | 434 | 6 | Approval flow, security |

**Total**: 51 integration tests covering agent functionality.

---

## 1. DirectAgentService.integration.test.ts

**Location**: `backend/src/__tests__/integration/agent/DirectAgentService.integration.test.ts`

**Infrastructure**:
- Azure SQL: Real database persistence
- Redis (Docker port 6399): EventStore + MessageQueue
- Socket.IO: Real server for approval events
- FakeAnthropicClient: Mock external API via DI

### Tests

| Test | Flow Covered | Events Validated | Edge Cases |
|------|--------------|------------------|------------|
| Complete message flow with tool use | user → tool_use → tool_result → message → complete | Sequence numbers consecutive, all events persisted | - |
| Sequence numbers across multiple turns | Multi-turn conversation | Sequence gaps = 0 (consecutive) | Multiple turns |
| Tool execution failure graceful | Tool that doesn't exist | Events still persisted, no crash | Invalid tool name |
| Multi-tenant isolation | Concurrent sessions | Session isolation, sequence independence | Race conditions |

### Validation Points

- [ ] `result.success === true` for successful flows
- [ ] `events.recordset.length > 4` for complete flow
- [ ] Sequence numbers are consecutive `[0, 1, 2, ...]`
- [ ] All events have correct `session_id`
- [ ] MessageQueue jobs completed > 0
- [ ] Messages table has user + assistant entries

---

## 2. DirectAgentService.attachments.integration.test.ts

**Location**: `backend/src/__tests__/integration/agent/DirectAgentService.attachments.integration.test.ts`

**Infrastructure**:
- Azure SQL DEV (database records)
- Azure Blob Storage DEV (file storage)
- Redis Docker (session cache)
- FakeAnthropicClient via DI

### Section 1: Ownership Validation (3 tests)

| Test | Validates |
|------|-----------|
| Accept valid attachments owned by user | File ownership check passes |
| Return error for other user's file | `Access denied` error |
| Return error for non-existent file | `not found` error |

### Section 2: File Context Integration (4 tests)

| Test | Validates |
|------|-----------|
| E2E flow with file attachments | `result.success === true`, Anthropic called |
| EXTRACTED_TEXT strategy (PDF) | Extracted text used, not raw bytes |
| Multiple file attachments | Both files tracked |
| Request sent even without file context | Anthropic called regardless |

### Section 3: Citation Persistence (2 tests)

| Test | Validates |
|------|-----------|
| Complete successfully with attachments | `result.success`, message attachments recorded |
| Handle citations in response | Response contains cited file name |

### Section 4: Error Handling (2 tests)

| Test | Validates |
|------|-----------|
| Ghost file (DB record, no blob) | Graceful continue, success |
| File context preparation fails | Response still completes |

### Section 5: Image Handling (1 test)

| Test | Validates |
|------|-----------|
| Accept image file attachments | Query executes with image, Anthropic called |

### Section 6: Usage Tracking (1 test)

| Test | Validates |
|------|-----------|
| Record usage events when processing files | Usage events exist after request |

---

## 3. orchestrator.integration.test.ts

**Location**: `backend/src/__tests__/integration/agent/orchestrator.integration.test.ts`

**Infrastructure**:
- Mocks: LangGraph components, ModelFactory
- Real: StreamAdapter, event processing logic

### Section: Extended Thinking Configuration (4 tests)

| Test | Status | Validates |
|------|--------|-----------|
| Pass thinking config to ModelFactory | TDD (FAIL) | ModelFactory receives thinking options |
| Emit thinking events during streaming | PASS | `thinking` events emitted with content |
| NOT pass thinking config when disabled | PASS | No thinking options when disabled |
| Use custom thinking budget | TDD (FAIL) | Custom budget passed to ModelFactory |

### Section: Routing (3 tests)

| Test | Validates |
|------|-----------|
| Route /bc command to BC agent | `activeAgent: 'business-central'` |
| Route /search command to RAG agent | `activeAgent: 'rag-knowledge'` |
| Route general queries to orchestrator | `activeAgent: 'orchestrator'` |

### Section: Event Streaming (4 tests)

| Test | Validates |
|------|-----------|
| Emit correct AgentEvent sequence | message_chunk events, content accumulated |
| Emit tool_use and tool_result | Tool events with correct IDs and names |
| Emit usage events for token tracking | Usage NOT emitted to callback (internal only) |
| Handle graph execution errors | Throws on error |

### Section: Error Handling (2 tests)

| Test | Validates |
|------|-----------|
| Handle graph execution errors gracefully | Exception thrown |
| Emit error events when graph fails | Error events in stream (TDD - not yet implemented) |

### Section: Context Injection (2 tests)

| Test | Validates |
|------|-----------|
| Inject userId into graph state context | `context.userId` set |
| Inject sessionId into graph state | `sessionId` in graph input |

---

## 4. thinking-state-transitions.integration.test.ts

**Location**: `backend/src/__tests__/integration/agent/thinking-state-transitions.integration.test.ts`

**Infrastructure**:
- Azure SQL: Real persistence
- Redis (Docker port 6399): EventStore + MessageQueue
- Socket.IO: Real server
- FakeAnthropicClient via DI

### Section: Extended Thinking Events (4 tests)

| Test | Validates |
|------|-----------|
| Emit thinking block before text response | thinking events >= 0, message events > 0 |
| Persist thinking with correct sequence numbers | Sequence consecutive, events > 0 |
| Handle thinking then tool use sequence | tool_use > 0, tool_result > 0 |
| Maintain event ordering with multiple thinking phases | Sequence continuous across messages |

### Section: Streaming State Machine (3 tests)

| Test | Validates |
|------|-----------|
| Transition session_start → thinking → message → complete | Key events present, complete last |
| Handle error state transition | `result.success === false`, error defined |
| Emit correct reason in complete event | `reason === 'success'` |

### Section: Persistence State Validation (3 tests)

| Test | Validates |
|------|-----------|
| Persist message events with sequenceNumber | `sequenceNumber` defined, typeof number |
| Mark message_chunk as transient | `sequenceNumber === undefined` for chunks |
| Mark message as persisted with sequenceNumber | `sequenceNumber` defined on final message |

---

## 5. approval-lifecycle.integration.test.ts

**Location**: `backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts`

**Infrastructure**:
- Azure SQL via setupDatabaseForTests
- Redis (via redis package, not ioredis)
- Socket.IO with session middleware
- ApprovalManager singleton

### Section: Approval Request Lifecycle (3 tests)

| Test | Validates |
|------|-----------|
| Create approval via request() | `approval_requested` event emitted |
| Return true when user approves | `result === true` |
| Return false when user rejects | `result === false` |

### Section: Approval Security (2 tests)

| Test | Validates |
|------|-----------|
| Prevent User A responding to User B approval | `success: false`, `error: 'UNAUTHORIZED'` |
| Use authenticated userId from socket | Spoofed userId ignored, approval succeeds |

### Section: Concurrent Approvals (1 test)

| Test | Validates |
|------|-----------|
| Handle first response, reject subsequent | One success, one `ALREADY_RESOLVED` |

---

## Coverage Gaps Identified

### Gap 1: executeQueryStreaming (Legacy)

The legacy `executeQueryStreaming` method is no longer tested directly. All tests use `runGraph`. This is acceptable as `executeQueryStreaming` was deprecated in Phase 1.

### Gap 2: Approval Flow in DirectAgentService

The approval flow integration with DirectAgentService (approval → tool execution → resume) is not explicitly tested in agent tests. It's covered in `approval-lifecycle.integration.test.ts` but not as part of a full agent flow.

### Gap 3: Semantic Search Auto-Context

The `enableAutoSemanticSearch` option is not covered by integration tests. Only explicit attachments are tested.

### Gap 4: Image Vision API

Image handling test exists but doesn't verify that images are actually sent to Claude's vision API (just that the request completes).

### Gap 5: Citation Recording

Citation recording is tested but the citation parsing logic (from response text to file IDs) is not deeply validated.

---

## Recommended Baseline Commands

```bash
# Run all agent integration tests
cd backend && npm test -- DirectAgentService.integration orchestrator.integration thinking-state-transitions approval-lifecycle

# Run with verbose output to capture event sequences
npm test -- --reporter=verbose thinking-state-transitions

# Run specific test file
npm test -- DirectAgentService.attachments.integration.test.ts
```

---

*Generated: 2025-12-17*
