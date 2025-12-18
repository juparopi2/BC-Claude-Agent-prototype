# Technical Debt Registry

**Created**: 2025-12-17
**Last Updated**: 2025-12-18
**QA Evaluation**: Phase 4 E2E Testing Framework
**Status**: Phase 4.7 COMPLETE - 9 items resolved, 1 improved, 8 pending

This document tracks technical debt identified during QA evaluations. Each item includes root cause analysis, impact assessment, and recommended fix approach.

## Table of Contents

- [Critical Priority](#critical-priority) - D1, D2
- [High Priority](#high-priority) - D3, D4, D5, D6
- [Medium Priority](#medium-priority) - D7, D8, D9, D10, D11
- [Low Priority](#low-priority) - D12, D13, D16, D17, D18
- [Resolved](#resolved) - D14, D15
- [E2E Test Failures Analysis](#e2e-test-failures-analysis-16-failures-with-real-api)
- [Development Environment Prerequisites](#development-environment-prerequisites)
- [Quick Reference Commands](#quick-reference-commands)

---

## Critical Priority

### D1: EventStore Fallback Database Race Condition

**Location**: `backend/src/services/events/EventStore.ts:551-578`

**Description**: The `fallbackToDatabase()` function is NOT atomic. When Redis is unavailable, sequence numbers are generated via `SELECT MAX(sequence_number) + 1`, which creates a race condition under concurrent load.

**Root Cause**:
```typescript
// RACE CONDITION: Two concurrent requests can get same sequence number
private async fallbackToDatabase(sessionId: string): Promise<number> {
  const result = await executeQuery(
    `SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_seq...`
  );
  return result.recordset[0]?.next_seq ?? 0;
  // Between SELECT and INSERT, another request can get same value
}
```

**Impact**:
- Duplicate sequence numbers when Redis fails under load
- Message ordering corruption in edge cases
- Only affects fallback path (when Redis is down)

**Recommended Fix**:
- Option A: Use `SERIALIZABLE` transaction isolation
- Option B: Use `INSERT...OUTPUT INSERTED.sequence_number` pattern
- Option C: Implement database-level sequence with `IDENTITY` column

**Status**: Documented (lines 530-549 in source)
**Target Phase**: Phase 5

---

### [IMPROVED] D2: FakeAnthropicClient Does Not Support Dynamic enableThinking

**Location**: `backend/src/services/agent/FakeAnthropicClient.ts`

**Description**: The mock client did not respect the `enableThinking` parameter passed in requests.

**Resolution** (2025-12-17):
FakeAnthropicClient now supports dynamic thinking:
1. ✅ Reads `request.thinking.type === 'enabled'` from request
2. ✅ Auto-generates thinking blocks when enabled (proportional to `budget_tokens`)
3. ✅ Both `createChatCompletion` and `createChatCompletionStream` support this
4. ✅ Added `suppressAutoThinking` flag for explicit control in tests

**Remaining Work**:
- The integration test `message-flow.integration.test.ts:178` is still skipped
- Need to verify the full DirectAgentService integration passes thinking config correctly
- Consider enabling the test after verifying end-to-end flow

**Status**: Improved - FakeAnthropicClient updated
**Target Phase**: Phase 5 (verify integration test)

---

## High Priority

### D3: E2E Tests Database PK Violations with Real Claude API

**Location**: Multiple E2E test files

**Description**: When running E2E tests with `E2E_USE_REAL_API=true`, the real Claude API returns tool IDs (`toolu_*`) that may already exist in the database from previous test runs.

**Root Cause**:
```
Error: Violation of PRIMARY KEY constraint 'PK_messages'.
Cannot insert duplicate key in object 'dbo.messages'.
The duplicate key value is (toolu_01FosQFrADXtG8ru2wZH5Zpu).
```

The `messages` table uses the tool ID as primary key. Real API responses can include previously seen tool IDs when:
- Same prompts trigger same tool suggestions
- Test database not cleaned between runs
- Anthropic's API reuses tool IDs in some scenarios

**Impact**:
- 10+ test failures with real API
- Tests work fine with FakeAnthropicClient
- Prevents full validation of real API behavior

**Recommended Fix**:
- Option A: Use `INSERT...ON CONFLICT DO UPDATE` (upsert pattern)
- Option B: Clean test data before each E2E run
- Option C: Generate unique session-scoped message IDs

**Status**: Identified during QA evaluation
**Target Phase**: Phase 5

---

### [RESOLVED] D4: Health Endpoint Response Format Mismatch

**Location**: `backend/src/__tests__/e2e/api/health.api.test.ts:96`

**Description**: Test expects `/health/liveness` to return plain text `"OK"`, but actual API returns JSON.

**Root Cause**:
```typescript
// Test expects:
expect(response.body).toBe('OK');

// Actual response:
{
  "status": "alive",
  "timestamp": "2025-12-17T21:06:08.344Z"
}
```

**Resolution** (verified 2025-12-18):
Test assertion was already updated to match actual API response:
```typescript
expect(response.body).toEqual({
  status: 'alive',
  timestamp: expect.any(String),
});
```

**Resolved Date**: 2025-12-18 (verified - code already fixed)
**Resolution**: Test assertion updated to match JSON response format

---

### [RESOLVED] D5: Sequence Numbers Not Set on Some Events

**Location**: `backend/src/services/agent/DirectAgentService.ts`

**Description**: Events marked as `persistenceState: 'persisted'` were emitted WITHOUT `sequenceNumber` because the event object was created BEFORE persisting to the database.

---

#### Resolución (2025-12-17)

**Causa raíz identificada**:
```typescript
// ANTES (bug): Objeto creado ANTES de persistir
const turnEndMessage = { type: 'message', persistenceState: 'persisted' }; // SIN sequenceNumber
const dbEvent = await eventStore.appendEvent(...);
emitEvent(turnEndMessage); // ❌ Emitía objeto SIN sequenceNumber
```

**Solución implementada**:
```typescript
// DESPUÉS (fix): Persistir PRIMERO, crear objeto DESPUÉS
const dbEvent = await eventStore.appendEvent(...);
const turnEndMessage = {
    type: 'message',
    sequenceNumber: dbEvent.sequence_number, // ✅ Incluido
    persistenceState: 'persisted'
};
emitEvent(turnEndMessage);
```

**Puntos corregidos** (4 lugares en DirectAgentService.ts):
1. ✅ Turn-end message (líneas 584-678)
2. ✅ Intermediate message before tools (líneas 863-959)
3. ✅ Thinking block (líneas 1172-1263)
4. ✅ Final message (líneas 1265-1330)

**Patrón establecido**:
- Generar IDs primero (messageId, eventId, timestamp)
- Persistir PRIMERO para obtener sequence_number
- Validar que sequence_number existe
- Crear objeto de evento CON sequenceNumber
- Emitir evento completo

**Documentación creada**:
- `docs/plans/SEQUENCE_NUMBER_ARCHITECTURE.md` - Arquitectura completa del sistema

**Resolved Date**: 2025-12-17
**Resolution**: Refactorizado flujo de emisión en 4 puntos para persistir PRIMERO

---

### [RESOLVED] D6: Input Sanitization Tests Disconnected from Source

**Location**: `backend/src/__tests__/unit/services/agent/input-sanitization.test.ts`

**Description**: Tests were disconnected because they imported from `__testExports` which was removed during refactoring. The actual sanitization functions EXIST and are ACTIVE in production code.

**Root Cause**: The tests imported from a now-deleted `__testExports` in DirectAgentService instead of the actual location in `@/modules/agents/business-central/tools`.

**Resolution**: Tests reconnected with correct imports:
```typescript
import {
  sanitizeEntityName,
  sanitizeKeyword,
  isValidOperationType,
  sanitizeOperationId
} from '@/modules/agents/business-central/tools';
```

**Result**:
- 53 tests now passing
- Security-critical functions fully covered
- Path traversal, injection protection tested

**Resolved Date**: 2025-12-17
**Resolution**: Tests rewritten and connected to correct source module

---

## Medium Priority

### [RESOLVED] D7: session_start Event Not Implemented

**Location**: `backend/src/__tests__/e2e/flows/04-streaming-flow.e2e.test.ts:62,77`

**Description**: Two tests expected a `session_start` event that is NEVER emitted by the backend.

**Root Cause**: Design decision - the backend uses `session:ready` (Socket.IO event) instead of an agent event. The frontend works correctly without `session_start`.

**Impact**: 2 skipped tests (noise in test reports)

**Resolution**: Tests DELETED. The backend does NOT emit session_start events by design. Frontend uses socket.io 'session:ready' event instead.

**Resolved Date**: 2025-12-17
**Resolution**: Tests removed from streaming-flow.e2e.test.ts

---

### D8: Model Hardcoded in DirectAgentService

**Location**: `backend/src/services/agent/DirectAgentService.ts:961`

**Description**: The Claude model is hardcoded instead of being read from session metadata or configuration.

**Impact**: Cannot dynamically switch models per user/session

**Recommended Fix**: Read model from `env.ANTHROPIC_MODEL` or session metadata

**Status**: Low priority enhancement
**Target Phase**: Phase 6

---

### D9: WebSocket Emission for Usage Alerts Not Implemented

**Location**: `backend/src/services/usage/UsageAggregationService.ts:842`

**Description**: Comment indicates WebSocket alerts should be emitted when usage thresholds are exceeded, but implementation is TODO.

**Impact**: Users don't receive real-time alerts for usage limits

**Recommended Fix**: Implement WebSocket emission when thresholds exceeded

**Status**: TODO in code
**Target Phase**: Phase 6

---

### D10: Message Replay Not Implemented

**Location**: `backend/src/services/messages/MessageService.ts:582`

**Description**: Session recovery via message replay from EventStore is not implemented.

**Impact**: Session continuity after disconnection may be incomplete

**Recommended Fix**: Implement replay from EventStore on reconnection

**Status**: TODO in code
**Target Phase**: Phase 6

---

### D11: Tool Execution Queue Not Implemented

**Location**: `backend/src/services/queue/MessageQueue.ts:1210`

**Description**: Queue for tool execution jobs exists but processor is not implemented.

**Impact**: Tools execute synchronously instead of through queue

**Recommended Fix**: Implement tool execution worker

**Status**: TODO in code
**Target Phase**: Phase 6

---

## Low Priority

### [RESOLVED] D12: Hardcoded Timeouts in E2E Tests

**Location**: Multiple E2E test files

**Description**: Tests use magic numbers like `10000` for timeouts instead of constants.

**Root Cause**:
```typescript
// Found in tests:
await new Promise(resolve => setTimeout(resolve, 10000));

// Should use:
import { TEST_TIMEOUTS } from '../helpers/constants';
await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.EVENT_WAIT));
```

**Resolution** (verified 2025-12-18):
~95% of E2E test files now use `TEST_TIMEOUTS` constants from `constants.ts`:
- `TEST_TIMEOUTS.BEFORE_ALL`, `TEST_TIMEOUTS.AFTER_ALL`
- `TEST_TIMEOUTS.MESSAGE_CLEANUP`, `TEST_TIMEOUTS.ASYNC_OPERATION`
- `TEST_TIMEOUTS.SHORT_DELAY`, `TEST_TIMEOUTS.EVENT_WAIT`

Constants are defined in `backend/src/__tests__/integration/helpers/constants.ts`.

**Resolved Date**: 2025-12-18 (verified - ~95% migrated)
**Resolution**: TEST_TIMEOUTS constants widely adopted across E2E tests

---

### D13: Redis Chaos Tests Missing

**Location**: N/A (tests don't exist)

**Description**: No tests verify behavior when Redis fails mid-request or recovers during operation.

**Scenarios not tested**:
1. Redis unavailable at startup → fallback to database
2. Redis fails mid-request → graceful degradation
3. Redis recovery → automatic reconnection
4. Concurrent requests during fallback → race conditions

**Impact**: Unknown behavior in Redis failure scenarios

**Recommended Fix**: Create chaos test suite simulating Redis failures

**Implementation Plan**:

Create file: `backend/src/__tests__/integration/event-ordering/redis-chaos.integration.test.ts`

```typescript
// Proposed test structure:
describe('Redis Chaos Tests', () => {
  describe('Redis Unavailable at Startup', () => {
    it('should fallback to database for sequence numbers');
    it('should log warning about Redis unavailability');
    it('should continue processing messages');
  });

  describe('Redis Fails Mid-Request', () => {
    it('should gracefully switch to database fallback');
    it('should not lose sequence number integrity');
    it('should emit events with correct ordering');
  });

  describe('Redis Recovery', () => {
    it('should automatically reconnect when Redis becomes available');
    it('should resume using Redis for sequence numbers');
    it('should not create gaps in sequence numbers');
  });

  describe('Concurrent Requests During Fallback', () => {
    it('should handle 10 concurrent requests without duplicate sequences');
    it('should maintain message ordering under load');
    // This tests D1 (EventStore race condition)
  });
});
```

**Prerequisites**:
- Docker Redis container for controlled start/stop
- Mock or control over Redis connection in tests
- May need to expose Redis client for test manipulation

**Related Issues**:
- D1 (EventStore Race Condition) - This test suite would expose the race condition

**Status**: Tests needed
**Target Phase**: Phase 5
**Estimated Effort**: 4-6 hours

---

### D16: Integration Tests Use Deprecated executeQueryStreaming

**Location**: 3 integration test files
- `backend/src/__tests__/integration/agent/DirectAgentService.integration.test.ts`
- `backend/src/__tests__/integration/agent/DirectAgentService.attachments.integration.test.ts`
- `backend/src/__tests__/integration/agent/thinking-state-transitions.integration.test.ts`

**Description**: These integration tests use `executeQueryStreaming` method which was deprecated in Phase 1 when DirectAgentService was refactored to use `runGraph()`.

**Root Cause**: During Phase 1 refactoring, the method signature changed:
```typescript
// OLD (deprecated):
agentService.executeQueryStreaming(prompt, sessionId, callback, userId)

// NEW (current):
agentService.runGraph(prompt, sessionId, onEvent?, userId?, options?)
```

**Impact**:
- 32 tests currently skipped (marked with `describe.skip`)
- Important integration coverage temporarily unavailable
- Tests for thinking state transitions, attachments, and message flow

**Recommended Fix**:
- Update test files to use `runGraph()` with new callback signature
- Update event assertions to match new event structure
- Verify test data factories work with new method

**Status**: Skipped with TODO comment (2025-12-17)
**Target Phase**: Phase 5
**Estimated Effort**: 2-4 hours

---

### [RESOLVED] D17: Null Check Missing in DirectAgentService.runGraph()

**Location**: `backend/src/services/agent/DirectAgentService.ts:1265-1330`

**Description**: The `runGraph()` method accessed `finalMessageDbEvent.sequence_number` without null checking, causing crashes when event persistence failed.

---

#### Resolución (2025-12-17)

**Cambios implementados**:

1. ✅ **Try-catch robusto** en 4 puntos de persistencia:
   - Final message persistence (líneas 1265-1330)
   - Turn-end message (líneas 584-678)
   - Intermediate message (líneas 863-959)
   - Thinking block (líneas 1172-1263)

2. ✅ **Método `analyzePersistenceError()`** (líneas 1366-1395):
   - Detecta: PK violations, FK violations, sequence conflicts, timeouts, Redis errors, connection errors
   - Retorna array de causas posibles para debugging

3. ✅ **Trazabilidad completa**:
   - Logging con: sessionId, messageId, phase, contentLength, possibleCauses
   - Error stack trace incluido

4. ✅ **Notificación al frontend**:
   - Emite evento `type: 'error'` con `persistenceState: 'failed'`
   - Incluye `debugInfo` con errorType, errorMessage, possibleCauses

5. ✅ **Tests unitarios** (20 tests):
   - `DirectAgentService.persistence-errors.test.ts`
   - Cobertura de todos los patrones de error detectables

**Archivos modificados**:
- `backend/src/services/agent/DirectAgentService.ts`
- `backend/src/__tests__/unit/services/agent/DirectAgentService.persistence-errors.test.ts` (nuevo)

**Resolved Date**: 2025-12-17
**Resolution**: Try-catch robusto con trazabilidad y método analyzePersistenceError()

---

### [RESOLVED] D18: Integration Test Cleanup FK Constraint Violation

**Location**: `backend/src/__tests__/integration/websocket/message-flow.integration.test.ts`

**Description**: Test cleanup fails because it tries to DELETE users before deleting their usage_events records, violating the FK constraint.

**Root Cause**:
```
RequestError: The DELETE statement conflicted with the REFERENCE constraint "FK_usage_events_user".
The conflict occurred in database "sqldb-bcagent-dev", table "dbo.usage_events", column 'user_id'.
```

**Resolution** (verified 2025-12-18):
`TestDataCleanup.ts` now handles deletion in correct FK order:
1. messages (has FK to message_events via event_id)
2. message_events
3. approvals
4. todos
5. usage_events (FK to users)
6. token_usage, files
7. sessions
8. users (base table - now safe)

The file also includes:
- FK violation detection with force delete fallback
- Comprehensive error logging

**Resolved Date**: 2025-12-18 (verified - cleanup order already correct)
**Resolution**: TestDataCleanup.ts implements proper FK-respecting deletion order

---

## Resolved

### [RESOLVED] D14: E2E Infrastructure - Multiple Server Startups

**Location**: `backend/src/__tests__/e2e/setup.e2e.ts`

**Description**: In single-fork mode, each test file tried to start its own server instance, causing EADDRINUSE errors.

**Resolution**: Implemented `globalThis` state tracking to ensure:
- Server starts ONCE on first test file
- Subsequent test files reuse existing server
- Cleanup happens only on process exit

**Resolved Date**: 2025-12-17
**Resolution PR**: N/A (in-session fix)

---

### [RESOLVED] D15: Factory Initialization Pattern

**Location**: 15 E2E test files

**Description**: Factory was initialized inside `beforeAll`, causing undefined errors in `afterAll` if `beforeAll` failed.

**Resolution**: Changed pattern from:
```typescript
let factory: TestSessionFactory;
beforeAll(async () => {
  factory = createTestSessionFactory(); // Inside beforeAll
});
```

To:
```typescript
const factory = createTestSessionFactory(); // At describe scope
beforeAll(async () => {
  // factory already exists
});
```

**Resolved Date**: 2025-12-17
**Files Fixed**: 15 test files

---

## E2E Test Failures Analysis (16 failures with Real API)

**Context**: When running E2E tests with `E2E_USE_REAL_API=true`, 16 tests fail due to various assertion mismatches between expected and actual behavior.

**Environment**:
- `.env` setting: `E2E_USE_REAL_API=true`
- Tests work correctly with `E2E_USE_REAL_API=false` (FakeAnthropicClient)

### Category 1: Database Primary Key Violations (10+ failures)

**Root Cause**: Real Claude API returns tool IDs (`toolu_*`) that may already exist in database.

**Affected Tests**:
- `tool-use.golden.test.ts` - Multiple tests
- `approval.golden.test.ts` - Approval flow tests
- Any test that triggers tool calls with real API

**Error Pattern**:
```
Error: Violation of PRIMARY KEY constraint 'PK_messages'.
Cannot insert duplicate key in object 'dbo.messages'.
The duplicate key value is (toolu_01FosQFrADXtG8ru2wZH5Zpu).
```

**Fix Options**:
1. **Database Cleanup Script**: Run before E2E tests to clear old tool IDs
   ```sql
   DELETE FROM messages WHERE id LIKE 'toolu_%' AND created_at < DATEADD(day, -1, GETDATE());
   ```
2. **Upsert Pattern**: Change INSERT to INSERT...ON CONFLICT DO UPDATE
3. **Unique ID Generation**: Prefix tool IDs with session-specific UUID

**Tracked As**: D3

---

### Category 2: Health Endpoint Response Format (1 failure)

**Affected Test**: `health.api.test.ts:96`

**Error**:
```typescript
// Expected:
expect(response.body).toBe('OK');

// Actual:
{ "status": "alive", "timestamp": "2025-12-17T21:06:08.344Z" }
```

**Fix**:
```typescript
// Update test assertion:
expect(response.body).toEqual({
  status: 'alive',
  timestamp: expect.any(String)
});
```

**Tracked As**: D4

---

### Category 3: Sequence Number Missing (1 failure)

**Affected Test**: `04-streaming-flow.e2e.test.ts:764`

**Error**:
```typescript
expect(msgData.sequenceNumber).toBeDefined();
// Fails because some events don't have sequenceNumber
```

**Investigation Needed**:
- Which event types should have sequence numbers?
- Is this a race condition (event emitted before persistence)?
- Are transient events (thinking_chunk, message_chunk) intentionally without sequence?

**Potential Fix**:
```typescript
// Only check persisted event types
const persistedEventTypes = ['message', 'tool_use', 'tool_result', 'user_message'];
if (persistedEventTypes.includes(msgData.type)) {
  expect(msgData.sequenceNumber).toBeDefined();
}
```

**Tracked As**: D5

---

### Category 4: Timing/Race Conditions (2-4 failures)

**Affected Tests**: Various streaming and event ordering tests

**Symptoms**:
- Events arrive out of order intermittently
- Timeouts waiting for specific events
- Assertions fail on event content

**Root Cause Hypotheses**:
1. Real API has variable latency (50-500ms vs mock's fixed 100ms)
2. Event batching differs between real and mock
3. WebSocket delivery timing varies

**Mitigation**:
```typescript
// Increase timeouts for real API mode
const timeout = E2E_CONFIG.apiMode.useRealApi ? 30000 : 10000;
```

---

### Running E2E Tests

**With Mock (Fast, Free)**:
```bash
cd backend
E2E_USE_REAL_API=false npm run test:e2e
```

**With Real API (Slow, Costs Money)**:
```bash
cd backend
E2E_USE_REAL_API=true npm run test:e2e
```

**Prerequisites for Real API**:
1. Valid `ANTHROPIC_API_KEY` in `.env`
2. Database cleaned of old tool IDs
3. Docker Redis running on port 6399

---

### Recommended Fix Order

1. **D4 (Health Endpoint)** - 5 min fix, update test assertion
2. **D5 (Sequence Numbers)** - 30 min investigation + fix
3. **D3 (PK Violations)** - 1-2 hours, requires database schema decision
4. **Timing Issues** - 1 hour, add conditional timeouts

---

## Summary Statistics

| Priority | Total | Resolved | Improved | Pending |
|----------|-------|----------|----------|---------|
| Critical | 2 | 0 | 1 | 1 |
| High | 4 | 3 | 0 | 1 |
| Medium | 5 | 1 | 0 | 4 |
| Low | 5 | 3 | 0 | 2 |
| **Total** | **18** | **9** | **1** | **8** |

*Updated 2025-12-18: D4, D12, D18 verified as resolved*

---

## Phase Assignment

### Phase 4.7 (Immediate - This Sprint) ✅ COMPLETADO
- ~~D4: Health endpoint response format~~ ✅ RESOLVED (2025-12-18)
- ~~D5: Sequence number investigation~~ ✅ RESOLVED (2025-12-17)
- ~~D6: Input sanitization test reconnection~~ ✅ RESOLVED
- ~~D7: Remove session_start tests~~ ✅ RESOLVED
- ~~D12: Timeout constants cleanup~~ ✅ RESOLVED (2025-12-18)
- ~~D17: Null check missing in DirectAgentService.runGraph()~~ ✅ RESOLVED (2025-12-17)
- ~~D18: Integration test cleanup FK constraint~~ ✅ RESOLVED (2025-12-18)

### Phase 5 (Next Sprint)
- D1: EventStore atomic fallback (race condition en DB fallback)
- D2: FakeAnthropicClient enableThinking (verificar integración)
- D3: Database PK violation handling (UPSERT pattern)
- D13: Redis chaos tests
- D16: Integration tests using deprecated executeQueryStreaming
- Frontend: Unificar ordenamiento de mensajes (ver PHASE_5_SEQUENCE_REFACTOR.md)

### Phase 6 (Backlog)
- D8: Dynamic model selection
- D9: WebSocket usage alerts
- D10: Message replay
- D11: Tool execution queue

---

## Development Environment Prerequisites

### For Running E2E Tests

**Required Services**:
```bash
# 1. Docker Redis on port 6399 (test isolation)
docker run -d --name redis-test -p 6399:6379 redis:latest

# 2. Verify Redis is running
redis-cli -p 6399 PING
# Expected: PONG

# 3. Azure SQL Database accessible
# Check DATABASE_* variables in .env
```

**Environment Variables** (`.env`):
```bash
# Redis for tests (local Docker)
REDIS_HOST=localhost
REDIS_PORT=6399
REDIS_PASSWORD=

# E2E API Mode
E2E_USE_REAL_API=false  # Use mock (fast, free)
# E2E_USE_REAL_API=true # Use real API (slow, costs money)
```

### For Running Unit Tests

```bash
cd backend
npm test  # Runs all unit tests
npm run test:ui  # Opens Vitest UI
```

### TypeScript Memory Issues

The codebase is large and TypeScript type-checking may run out of memory:

```bash
# If `npm run type-check` fails with OOM:
NODE_OPTIONS='--max-old-space-size=8192' npm run type-check

# For builds:
NODE_OPTIONS='--max-old-space-size=8192' npm run build
```

---

## Quick Reference: Commands

| Task | Command |
|------|---------|
| Run unit tests | `cd backend && npm test` |
| Run E2E tests (mock) | `cd backend && E2E_USE_REAL_API=false npm run test:e2e` |
| Run E2E tests (real) | `cd backend && E2E_USE_REAL_API=true npm run test:e2e` |
| Type check | `cd backend && npm run type-check` |
| Lint | `cd backend && npm run lint` |
| Build | `cd backend && npm run build` |
| Start dev server | `cd backend && npm run dev` |
| View E2E report | Open `backend/test-results/e2e-report.html` |

---

## Files Modified During QA Evaluation (2025-12-17)

| File | Change |
|------|--------|
| `backend/src/__tests__/e2e/setup.e2e.ts` | Added globalThis state tracking |
| `backend/src/__tests__/unit/services/agent/input-sanitization.test.ts` | Rewrote with correct imports |
| `backend/src/__tests__/e2e/flows/04-streaming-flow.e2e.test.ts` | Removed session_start tests |
| `backend/src/services/agent/FakeAnthropicClient.ts` | Added dynamic enableThinking support |
| 15 E2E test files | Fixed factory initialization pattern |

---

*Document maintained by: QA Master (Claude)*
*Last Updated: 2025-12-17*
*Next review: End of Phase 5*
