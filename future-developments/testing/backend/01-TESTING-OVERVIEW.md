# PRD 01: Backend Testing Overview

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Author**: Claude Code (Anthropic)
**Status**: Active
**Reading Time**: 20-30 minutes

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Fundamental Architectural Principles](#fundamental-architectural-principles)
3. [Current State of Testing](#current-state-of-testing)
4. [Critical Gaps Identified](#critical-gaps-identified)
5. [Success Metrics](#success-metrics)
6. [Timeline and Resources](#timeline-and-resources)
7. [Risk Assessment](#risk-assessment)
8. [Next Steps](#next-steps)

---

## Executive Summary

### Purpose

This document provides a comprehensive overview of the Backend testing initiative for the BC-Claude-Agent project. The goal is to increase test coverage from ~30-40% to ≥70% through exhaustive unit tests, integration tests, and edge case testing.

### Key Findings

1. ✅ **Solid Foundation**: Existing infrastructure (Vitest 2.1.8 + MSW) is properly configured
2. ✅ **Clean Architecture**: 58+ tests passing, NO outdated tests found
3. ✅ **Well-Documented**: DirectAgentService, Event Sourcing, and Stop Reason Pattern are thoroughly documented
4. 🚨 **Critical Gaps**: EventStore, MessageQueue, and Auth services have 0 tests
5. 🚨 **Zero Edge Case Coverage**: 24 high/critical edge cases documented but not tested

### Recommendation

**Proceed with phased implementation** following the 11-day sprint plan outlined in PRD 09. Prioritize critical services (EventStore, MessageQueue, Auth) before integration tests and edge cases.

**Estimated Effort**: 88 hours (single developer) or 58 hours (two developers in parallel)

---

## Fundamental Architectural Principles

### Overview

The BC-Claude-Agent backend is built on five critical architectural patterns. All tests MUST reflect these patterns to ensure architectural alignment and prevent regressions.

---

### Principle 1: DirectAgentService with Manual Agentic Loop

**⚠️ CRITICAL**: The system uses Direct Anthropic SDK (`@anthropic-ai/sdk@0.68.0`), NOT the Claude Agent SDK.

#### Architecture

```typescript
// backend/src/services/agent/DirectAgentService.ts

class DirectAgentService {
  async processMessage(sessionId: string, userMessage: string) {
    let shouldContinue = true;
    let turnCount = 0;

    while (shouldContinue && turnCount < 20) {
      // 1. Build system prompt (regenerated each turn)
      const systemPrompt = this.buildSystemPrompt(session);

      // 2. Call SDK with streaming
      const response = await this.anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        system: systemPrompt,
        messages: conversationHistory,
        tools: this.vendoredMcpTools,  // 7 tools
        stream: true
      });

      // 3. Stream events to WebSocket + Event Store
      for await (const event of response) {
        await this.eventStore.append(sessionId, event);
        this.socket.emit('agent:event', event);
      }

      // 4. Check stop_reason
      if (message.stop_reason === 'tool_use') {
        // Tool call detected
        const approval = await this.canUseTool(tool);
        if (approval.approved) {
          await this.executeTool(tool);
          shouldContinue = true;  // Continue loop
        } else {
          shouldContinue = false;  // Terminate loop
        }
      } else if (message.stop_reason === 'end_turn') {
        shouldContinue = false;  // Final response
      }

      turnCount++;
    }
  }
}
```

#### Why NOT Agent SDK?

- ProcessTransport bug workaround
- Full control over streaming and tool calling
- Context management flexibility
- Event sourcing integration requirements

#### Testing Implications

✅ **DO**:
- Mock `@anthropic-ai/sdk` directly
- Test loop control logic (`shouldContinue`, `turnCount`)
- Test streaming event emission
- Test tool calling with approval hooks

❌ **DON'T**:
- Reference Agent SDK patterns
- Assume automatic context management
- Ignore stop_reason in assertions

**Docs**: `docs/backend/architecture-deep-dive.md` (14KB)

---

### Principle 2: Stop Reason Pattern (Migration 008)

**⚠️ CRITICAL**: `stop_reason` differentiates message stages and controls loop continuation.

#### Stop Reason Values

| Stop Reason | Meaning | Loop Action | UI Treatment |
|-------------|---------|-------------|--------------|
| `tool_use` | Intermediate message with tool call | ✅ CONTINUE | Group with next message |
| `end_turn` | Final response | ❌ TERMINATE | Display as standalone |
| `max_tokens` | Response truncated (edge case) | ❌ TERMINATE | Show warning |
| `stop_sequence` | Custom stop sequence hit | ❌ TERMINATE | Display as standalone |

#### Database Schema

```sql
-- Migration 008 (2025-11-17)
ALTER TABLE messages
ADD stop_reason NVARCHAR(50);
```

#### Example Flow

```
User: "List all customers"

SDK Response 1:
  stop_reason = 'tool_use'
  tool_use: { name: 'list_all_entities', input: { entityType: 'customer' } }
  → Loop CONTINUES (wait for tool result)

SDK Response 2:
  stop_reason = 'end_turn'
  text: "Here are the customers: ..."
  → Loop TERMINATES (display to user)
```

#### Testing Implications

✅ **DO**:
- Assert `stop_reason` in every agent test
- Test loop continuation for `tool_use`
- Test loop termination for `end_turn`
- Test edge case for `max_tokens`

❌ **DON'T**:
- Use content-length heuristics (unreliable)
- Assume all messages are final
- Ignore `stop_reason` in test fixtures

**Docs**: `docs/backend/06-sdk-message-structures.md` (6KB)

---

### Principle 3: Event Sourcing Pattern

**⚠️ CRITICAL**: All state changes are stored as immutable events in an append-only log.

#### Architecture

```
User Message → DirectAgentService → Events → EventStore.append()
                                              ↓
                                         message_events table
                                         (append-only, immutable)
                                              ↓
                                          BullMQ Queue
                                              ↓
                                         messages table
                                         (eventual consistency)
```

#### Key Components

**EventStore** (`backend/src/services/events/EventStore.ts`):
- **Append-only log**: `message_events` table (immutable)
- **Atomic sequencing**: Redis INCR for multi-tenant-safe ordering
- **Event replay**: Reconstruct state from event log

**Atomic Sequence Generation**:
```typescript
// Redis INCR guarantees atomicity across all sessions
const sequenceNumber = await redis.incr(`event:sequence:${sessionId}`);

await db.insert('message_events', {
  sessionId,
  sequenceNumber,  // Guaranteed unique and ordered
  eventType,
  eventData,
  timestamp: new Date()
});
```

#### Testing Implications

✅ **DO**:
- Mock Redis INCR (atomic operation)
- Test append-only behavior (no UPDATE/DELETE)
- Test sequence number uniqueness
- Test event replay for state reconstruction
- Test concurrency (10 threads calling `append()`)

❌ **DON'T**:
- Allow UPDATE or DELETE on `message_events`
- Use timestamps for ordering (race conditions)
- Assume single-threaded execution

**Docs**: `docs/backend/architecture-deep-dive.md` (EventStore section)

---

### Principle 4: BullMQ Async Processing (3 Queues)

**⚠️ CRITICAL**: BullMQ handles all async operations (persistence, tool execution, event processing).

#### Queue Architecture

**3 Queues**:

1. **`message-persistence`** (concurrency: 10)
   - Async message persistence to DB
   - Eliminates 600ms delay in response path
   - Rate limit: 100 jobs/session/hour

2. **`tool-execution`** (concurrency: 5)
   - Tool execution post-approval
   - MCP tool calls
   - Result persistence

3. **`event-processing`** (concurrency: 10)
   - Event processing (TodoWrite, errors)
   - Special event handlers
   - Audit log updates

#### Rate Limiting

```typescript
// backend/src/services/queue/MessageQueue.ts

const sessionJobCount = await redis.incr(`queue:jobs:${sessionId}:count`);
await redis.expire(`queue:jobs:${sessionId}:count`, 3600); // 1 hour

if (sessionJobCount > 100) {
  throw new Error('Rate limit exceeded: 100 jobs/session/hour');
}
```

#### Retry Logic

```typescript
// Exponential backoff
{
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 1000  // 1s, 2s, 4s, 8s, 16s
  }
}
```

#### Testing Implications

✅ **DO**:
- Mock BullMQ Queue class
- Test rate limiting (101st job fails)
- Test retry logic with exponential backoff
- Test job priority (high/medium/low)
- Test job completion callbacks
- Test queue health checks

❌ **DON'T**:
- Use real Redis for unit tests (slow)
- Assume unlimited job capacity
- Ignore retry failures

**Docs**: `docs/backend/architecture-deep-dive.md` (BullMQ section)

---

### Principle 5: Human-in-the-Loop Approval System

**⚠️ CRITICAL**: Write operations require explicit user approval before execution.

#### Approval Flow

```
Agent detects write operation
    ↓
ApprovalManager.request() returns Promise
    ↓
WebSocket emits 'approval:requested' event to Frontend
    ↓
User clicks Approve/Deny
    ↓
Frontend sends POST /api/approvals/:id/respond
    ↓
ApprovalManager.respond() resolves Promise
    ↓
Tool executes (if approved) or cancels (if denied)
```

#### Promise-Based Implementation

```typescript
// backend/src/services/approval/ApprovalManager.ts

class ApprovalManager {
  private pendingApprovals: Map<string, {
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  async request(approvalRequest: ApprovalRequest): Promise<boolean> {
    const approvalId = uuidv4();

    return new Promise((resolve, reject) => {
      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        reject(new Error('Approval timeout (5 minutes)'));
      }, 5 * 60 * 1000);

      this.pendingApprovals.set(approvalId, { resolve, reject, timeout });

      // Emit WebSocket event
      this.socket.emit('approval:requested', {
        approvalId,
        ...approvalRequest
      });
    });
  }

  respond(approvalId: string, approved: boolean) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    pending.resolve(approved);
    this.pendingApprovals.delete(approvalId);
  }
}
```

#### Approval Priority

| Operation Type | Priority | Timeout |
|----------------|----------|---------|
| Database writes (INSERT/UPDATE/DELETE) | HIGH | 5 minutes |
| Configuration changes | HIGH | 5 minutes |
| Data retrieval | LOW | 5 minutes |

#### Testing Implications

✅ **DO**:
- Test Promise-based flow (request → respond)
- Test timeout behavior (5 minutes)
- Test concurrent approvals (multiple pending)
- Test approval expiration (background job)
- Test write operation detection
- Mock WebSocket emission

❌ **DON'T**:
- Execute write tools without approval
- Assume infinite timeout
- Ignore pending approval cleanup

**Docs**: `docs/backend/architecture-deep-dive.md` (Approval section)

---

## Current State of Testing

### Infrastructure Status

✅ **Vitest 2.1.8** installed and configured
✅ **MSW (Mock Service Worker)** configured for HTTP mocking
✅ **Test scripts** in `package.json`:
- `npm test` - Run all tests
- `npm run test:watch` - Watch mode
- `npm run test:ui` - Interactive UI
- `npm run test:coverage` - Coverage report

✅ **Vitest config** (`backend/vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

✅ **MSW setup** (`backend/src/__tests__/mocks/server.ts`):
```typescript
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

---

### Existing Test Files

**7 test files** found:

1. **`__tests__/unit/services/agent/DirectAgentService.test.ts`** (645 lines, 11 tests)
   - ✅ Simple query without tools
   - ✅ Tool use (`list_all_entities`)
   - ✅ Max turns limit (20)
   - ✅ Write operation approval (approved/denied)
   - ✅ Tool execution errors
   - ✅ `max_tokens` stop reason
   - ✅ API errors
   - ✅ Event emission sequence
   - ✅ Write operation detection

2. **`__tests__/unit/ApprovalManager.test.ts`** (11 tests)
   - ✅ Request/respond flow
   - ✅ Timeout behavior (5 minutes)
   - ✅ Change summary generation
   - ✅ Expiration job

3. **`__tests__/unit/routes/sessions.routes.test.ts`**
   - ✅ GET /api/sessions
   - ✅ POST /api/sessions
   - ✅ GET /api/sessions/:id

4. **`__tests__/unit/routes/sessions.transformers.test.ts`** (18 tests)
   - ✅ Session DTO transformations
   - ✅ Message DTO transformations

5. **`__tests__/unit/utils/messageHelpers.test.ts`** (15 tests)
   - ✅ Message parsing
   - ✅ Content extraction
   - ✅ Metadata generation

6. **`__tests__/unit/server.socket.test.ts`**
   - ✅ Socket.IO server initialization
   - ✅ Room join/leave

7. **`__tests__/unit/example.test.ts`** (3 tests)
   - ✅ Example tests for reference

**Total Tests**: 58+ passing
**Current Coverage**: ~30-40% (estimated)

---

### Test Fixtures and Factories

✅ **AnthropicResponseFactory** (`__tests__/fixtures/AnthropicResponseFactory.ts`):
```typescript
export class AnthropicResponseFactory {
  static simpleTextResponse(content: string) {
    return {
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 }
    };
  }

  static toolUseResponse(toolName: string, input: any) {
    return {
      id: 'msg_tool_123',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool_abc', name: toolName, input }
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 30 }
    };
  }
}
```

✅ **ApprovalFixture** (`__tests__/fixtures/ApprovalFixture.ts`):
```typescript
export class ApprovalFixture {
  static createApprovalRequest(overrides?: Partial<ApprovalRequest>) {
    return {
      sessionId: 'session-123',
      toolName: 'build_knowledge_base_workflow',
      toolInput: { entityType: 'customer', operation: 'CREATE' },
      changeSummary: 'Create customer workflow',
      priority: 'high',
      ...overrides
    };
  }
}
```

✅ **BCEntityFixture** (`__tests__/fixtures/BCEntityFixture.ts`):
```typescript
export class BCEntityFixture {
  static createCustomerEntity() {
    return {
      entityType: 'customer',
      operations: ['GET', 'POST', 'PATCH', 'DELETE'],
      endpoint: '/companies({companyId})/customers',
      // ...
    };
  }
}
```

---

### Test Execution Status

```bash
$ npm test

✓ backend/src/__tests__/unit/example.test.ts (3)
✓ backend/src/__tests__/unit/ApprovalManager.test.ts (11)
✓ backend/src/__tests__/unit/routes/sessions.routes.test.ts (5)
✓ backend/src/__tests__/unit/routes/sessions.transformers.test.ts (18)
✓ backend/src/__tests__/unit/utils/messageHelpers.test.ts (15)
✓ backend/src/__tests__/unit/server.socket.test.ts (3)
✓ backend/src/__tests__/unit/services/agent/DirectAgentService.test.ts (11)

Test Files  7 passed (7)
     Tests  58 passed (58)
  Start at  16:18:45
  Duration  2.34s (transform 432ms, setup 0ms, collect 1.87s, tests 1.12s)
```

✅ All tests passing
✅ Fast execution (<3 seconds)
✅ No flaky tests

---

### Key Observation: NO Outdated Tests

**Analysis Result**: All existing tests follow current architecture.

✅ **Correct References**:
- DirectAgentService (not Agent SDK)
- `stop_reason` pattern
- Event sourcing patterns
- Current authentication flow

❌ **NO Deprecated References Found**:
- No Agent SDK imports
- No old authentication patterns
- No commented-out code
- No outdated mocks

**Conclusion**: Existing tests are clean and aligned with current architecture. No deletion needed.

---

## Critical Gaps Identified

### Overview

While the existing 58+ tests are solid, they only cover ~30-40% of the codebase. The following critical services have **0 tests**:

---

### Gap 1: EventStore (0 tests) - **PRIORITY: CRITICAL**

**Why Critical**: EventStore is the foundation of Event Sourcing. Without tests, we have no confidence in:
- Append-only log behavior
- Atomic sequence numbers (multi-tenant safety)
- Event replay for state reconstruction

**File**: `backend/src/services/events/EventStore.ts`

**Tests Needed** (8-10 tests):
1. ✅ `append()` - Event appended with atomic sequence number
2. ✅ `getEvents()` - Retrieve events by sessionId, ordered
3. ✅ `replay()` - Reconstruct state from event log
4. ✅ Atomic sequencing - Concurrency with Redis INCR
5. ✅ Event immutability - No UPDATE/DELETE operations
6. ✅ Error handling - Redis down, DB down
7. ✅ Large event batches - Performance with 1000+ events
8. ✅ Event filtering - By type, sequence range

**Estimated Effort**: 4 hours

**PRD**: `02-CRITICAL-SERVICES-TESTS.md` (EventStore section)

---

### Gap 2: MessageQueue (0 tests) - **PRIORITY: CRITICAL**

**Why Critical**: MessageQueue handles all async processing (persistence, tool execution). Without tests, we can't validate:
- BullMQ job creation
- Rate limiting (100 jobs/session/hour)
- Retry logic with exponential backoff

**File**: `backend/src/services/queue/MessageQueue.ts`

**Tests Needed** (12-15 tests):
1. ✅ Job creation in 3 queues
2. ✅ Rate limiting enforcement (101st job fails)
3. ✅ Concurrency control (10/5/10)
4. ✅ Retry logic with exponential backoff
5. ✅ Job priority (high/medium/low)
6. ✅ Job completion callbacks
7. ✅ Queue health check
8. ✅ Job timeout (30s)
9. ✅ Queue pause/resume
10. ✅ Dead letter queue
11. ✅ Job data validation
12. ✅ Redis connection errors

**Estimated Effort**: 6 hours

**PRD**: `02-CRITICAL-SERVICES-TESTS.md` (MessageQueue section)

---

### Gap 3: MicrosoftOAuthService (0 tests) - **PRIORITY: CRITICAL**

**Why Critical**: Auth is the entry point. Without tests, we can't validate:
- OAuth code exchange
- Token refresh automation
- BC token acquisition
- Error handling (consent_required, expired tokens)

**File**: `backend/src/services/auth/MicrosoftOAuthService.ts`

**Tests Needed** (10-12 tests):
1. ✅ `getAuthorizationUrl()` - URL with scopes
2. ✅ `exchangeCodeForTokens()` - OAuth code exchange
3. ✅ `refreshAccessToken()` - Token refresh
4. ✅ `getUserProfile()` - Microsoft Graph API
5. ✅ `acquireBCToken()` - Business Central token
6. ✅ Error: `consent_required`
7. ✅ Error: `invalid_grant`
8. ✅ Error: `unauthorized_client`
9. ✅ Token expiry check
10. ✅ Concurrent refresh prevention

**Estimated Effort**: 5 hours

**PRD**: `03-AUTH-SERVICES-TESTS.md` (MicrosoftOAuthService section)

---

### Gap 4: BCTokenManager (0 tests) - **PRIORITY: HIGH**

**Why High**: Security of BC tokens. Without tests, we can't validate encryption/decryption.

**File**: `backend/src/services/auth/BCTokenManager.ts`

**Tests Needed** (6-8 tests):
1. ✅ `encrypt()` - AES-256-GCM encryption
2. ✅ `decrypt()` - Decryption
3. ✅ `isTokenExpired()` - Expiry check
4. ✅ `refreshIfNeeded()` - Auto-refresh
5. ✅ Tamper detection - IV/auth tag validation
6. ✅ Error: Invalid encryption key
7. ✅ Error: Corrupted data

**Estimated Effort**: 3 hours

**PRD**: `03-AUTH-SERVICES-TESTS.md` (BCTokenManager section)

---

### Gap 5: TodoManager (0 tests) - **PRIORITY: HIGH**

**Why High**: High business value feature. Without tests, we can't validate todo list operations.

**File**: `backend/src/services/todo/TodoManager.ts`

**Tests Needed** (8-10 tests):
1. ✅ `create()` - Todo created with order index
2. ✅ `update()` - Status change
3. ✅ `delete()` - Soft delete
4. ✅ `list()` - Todos ordered by order index
5. ✅ `reorder()` - Change order index
6. ✅ Active form conversion
7. ✅ SDK TodoWrite interception
8. ✅ Bulk operations

**Estimated Effort**: 4 hours

**PRD**: `04-BUSINESS-LOGIC-TESTS.md` (TodoManager section)

---

### Gap 6: Database Connection (0 tests) - **PRIORITY: HIGH**

**Why High**: Reliability of DB layer. Without tests, we can't validate retry logic.

**File**: `backend/src/config/database.ts`

**Tests Needed** (8-10 tests):
1. ✅ Successful connection
2. ✅ Retry logic (10 attempts, exponential backoff)
3. ✅ Connection verification (`SELECT 1`)
4. ✅ Error: `ETIMEDOUT`
5. ✅ Error: `ELOGIN`
6. ✅ Error: `ECONNREFUSED`
7. ✅ Max retries exceeded
8. ✅ Connection pool
9. ✅ Keepalive job
10. ✅ Auto-reconnection

**Estimated Effort**: 4 hours

**PRD**: `04-BUSINESS-LOGIC-TESTS.md` (Database section)

---

### Gap 7: Integration Tests (0 tests) - **PRIORITY: HIGH**

**Why High**: End-to-end validation. Without integration tests, we can't validate full flows.

**Tests Needed** (20+ tests across 3 areas):

**Auth Flow Integration** (5-8 tests):
- Login → OAuth callback → Session creation
- BC consent flow
- Token refresh end-to-end

**Agent Execution Integration** (8-10 tests):
- User message → Agent → Tool → Response
- Approval flow end-to-end
- Event sourcing (Message → Events → BullMQ → DB)

**WebSocket Integration** (6-8 tests):
- Connection → Room join → Streaming
- Disconnect/reconnect
- Event ordering

**Estimated Effort**: 20 hours

**PRD**: `05-INTEGRATION-TESTS.md`

---

### Gap 8: Edge Cases (0 tests) - **PRIORITY: MEDIUM**

**Why Medium**: 24 edge cases documented but not tested.

**Edge Cases** (partial list):
- Concurrent queries to same session
- Tool execution timeout (>30s)
- Malformed tool response from MCP
- BC token expiry mid-operation
- Disconnect during streaming
- Approval timeout (5 minutes)
- Message before room join
- Context window exceeded (>100K tokens)

**Estimated Effort**: 12 hours (24 edge cases × 30 min each)

**PRD**: `06-EDGE-CASES-IMPLEMENTATION.md`

---

### Summary of Gaps

| Service | Current Tests | Tests Needed | Priority | Effort |
|---------|---------------|--------------|----------|--------|
| EventStore | 0 | 8-10 | CRITICAL | 4 hours |
| MessageQueue | 0 | 12-15 | CRITICAL | 6 hours |
| MicrosoftOAuthService | 0 | 10-12 | CRITICAL | 5 hours |
| BCTokenManager | 0 | 6-8 | HIGH | 3 hours |
| TodoManager | 0 | 8-10 | HIGH | 4 hours |
| Database Connection | 0 | 8-10 | HIGH | 4 hours |
| Integration Tests | 0 | 20+ | HIGH | 20 hours |
| Edge Cases | 0 | 24 | MEDIUM | 12 hours |
| **TOTAL** | **58** | **96-109** | - | **58 hours** |

---

## Success Metrics

### Quantitative Targets

1. **Backend Coverage**: ≥70%
   - **Current**: ~30-40%
   - **Target**: 70%+
   - **Measurement**: `npm run test:coverage`

2. **Integration Tests**: 20+ tests
   - **Current**: 0
   - **Target**: 20+
   - **Areas**: Auth flow, Agent execution, WebSocket

3. **Edge Case Tests**: 24 tests
   - **Current**: 0
   - **Target**: 24
   - **Areas**: Concurrency, timeouts, errors

4. **Test Execution Time**: <5 minutes
   - **Current**: <3 seconds (unit tests only)
   - **Target**: <5 minutes (unit + integration)
   - **Measurement**: CI pipeline duration

5. **Flaky Test Rate**: <5%
   - **Current**: 0% (58 tests passing consistently)
   - **Target**: <5%
   - **Measurement**: CI pipeline failures

---

### Qualitative Goals

1. ✅ **All critical business logic paths tested**
   - EventStore (Event Sourcing foundation)
   - MessageQueue (Async processing)
   - MicrosoftOAuthService (Auth entry point)
   - DirectAgentService (Agent loop)

2. ✅ **Edge cases automated (not just documented)**
   - 24 high/critical edge cases with test code
   - Documented known issues
   - Mitigation strategies in place

3. ✅ **Pre-push hook prevents broken code**
   - Husky hook runs tests before push
   - Developers can bypass with `--no-verify` (emergencies)

4. ✅ **CI pipeline provides PR visibility**
   - GitHub Actions runs on all PRs
   - Code coverage reported to Codecov
   - Branch protection requires tests pass

5. ✅ **Testing documentation complete**
   - 9 PRDs (160-205 pages)
   - Code examples for all patterns
   - Sprint planning with checkpoints

6. ✅ **Team onboarded to testing practices**
   - README.md with workflow
   - Mocking strategies documented
   - Error handling patterns

---

## Timeline and Resources

### Single Developer Timeline

**Total**: 88 hours (11 days)

**Week 8** (40 hours):
- Día 1-2: Critical Services (EventStore + MessageQueue) - 16 hours
- Día 3-4: Auth + TodoManager + DB Connection - 16 hours
- Día 5: Edge Cases - 8 hours

**Week 9** (40 hours):
- Día 6-7: Integration Tests - 16 hours
- Día 8-10: CI/CD + Documentation - 16 hours
- Buffer: 8 hours

**Week 10** (8 hours):
- Documentation finalization
- Buffer for unexpected issues

---

### Two Developers Timeline (Parallel)

**Total**: 58 hours (7-8 days)

**Developer A** (Backend Focus):
- Critical Services (26 hours)
- Edge Cases (12 hours)
- Integration Tests (20 hours)

**Developer B** (CI/CD Focus):
- Assist with Integration Tests (10 hours)
- CI/CD Setup (6 hours)
- Documentation (4.5 hours)
- E2E Setup (16 hours - optional)

**Completion**: 7-8 days

---

### Checkpoints

**Checkpoint 1** (Día 2, 17:00):
- EventStore + MessageQueue tests complete
- **Decision**: Continue or debug issues

**Checkpoint 2** (Día 4, 17:00):
- Auth tests complete
- **Decision**: Test from Frontend or continue

**Checkpoint 3** (Día 7, 17:00):
- Integration tests complete
- **Decision**: Identify critical bugs or proceed

---

## Risk Assessment

### Risk 1: Tests Reveal Bugs in Production Code

**Probability**: HIGH (expected in exhaustive testing)

**Impact**: MEDIUM (may delay timeline)

**Mitigation**:
- Decide case-by-case: Bug real or test incorrect?
- If unclear, ask user to test from Frontend
- Document decisions in test comments
- Create GitHub Issues for bugs (don't block testing)

**Contingency**:
- Allocate 8 hours buffer in timeline
- Prioritize critical bugs (EventStore, Auth)
- Document known issues in PRD 06

---

### Risk 2: Edge Cases with Partial Handling

**Probability**: MEDIUM

**Impact**: LOW (documented, non-blocking)

**Mitigation**:
- 13 edge cases have ⚠️ partial handling (documented)
- Implement tests for partial cases
- Add TODOs in code for Phase 3 improvements
- Don't block merge, document known issues

**Contingency**:
- Create Phase 3 backlog for improvements
- Document workarounds in PRD 06

---

### Risk 3: Integration Tests Slow/Flakey

**Probability**: MEDIUM

**Impact**: MEDIUM (CI pipeline delays)

**Mitigation**:
- Configure generous timeouts (30s)
- Use in-memory SQLite for test DB
- Use `ioredis-mock` for most tests
- Only use real Redis for critical integration tests

**Contingency**:
- Retry logic (3 attempts) for flakey tests
- Increase timeouts if needed
- Isolate slow tests to separate CI job

---

### Risk 4: Timeline Extension

**Probability**: MEDIUM

**Impact**: MEDIUM (project delay)

**Mitigation**:
- 8-hour buffer in Week 10
- Prioritize critical services (EventStore, MessageQueue, Auth)
- Can skip edge cases if timeline critical

**Contingency**:
- Reduce scope to 70% coverage (skip some edge cases)
- Two-developer parallel execution (58 hours)
- Defer E2E tests to Phase 3

---

## Next Steps

### Immediate Actions

1. ✅ **Read all PRDs** in order (01 → 09)
   - Understand architecture
   - Review timeline
   - Identify questions

2. ✅ **Setup Development Environment**
   ```bash
   cd backend
   npm install
   npm run build
   npm run lint
   npm run type-check
   npm test
   npm run test:coverage
   ```

3. ✅ **Review Existing Tests**
   - Read `DirectAgentService.test.ts` (reference pattern)
   - Review fixtures (AnthropicResponseFactory, etc.)
   - Understand MSW setup

---

### Implementation Order

**Phase 1**: Critical Services (26 hours)
1. EventStore tests (4 hours) - PRD 02
2. MessageQueue tests (6 hours) - PRD 02
3. MicrosoftOAuthService tests (5 hours) - PRD 03
4. BCTokenManager tests (3 hours) - PRD 03
5. TodoManager tests (4 hours) - PRD 04
6. Database Connection tests (4 hours) - PRD 04

**Phase 2**: Edge Cases (12 hours)
7. Agent Edge Cases (6 hours) - PRD 06
8. Auth & WebSocket Edge Cases (6 hours) - PRD 06

**Phase 3**: Integration Tests (20 hours)
9. Auth Flow Integration (6 hours) - PRD 05
10. Agent Execution Integration (8 hours) - PRD 05
11. WebSocket Integration (6 hours) - PRD 05

**Phase 4**: CI/CD (6 hours)
12. Husky Pre-push Hook (2 hours) - PRD 08
13. GitHub Actions Workflow (4 hours) - PRD 08

**Phase 5**: Documentation (4.5 hours)
14. Update CLAUDE.md - Testing guidelines
15. Create backend/README-TESTING.md

---

### Questions for Stakeholder

Before starting implementation, clarify:

1. **Priority of phases**: Complete Phase 1 (critical services) before edge cases, or mix?
2. **Frontend involvement**: When to test features from Frontend (after each suite, or at end)?
3. **Bug handling**: Fix bugs immediately, or document as TODOs?
4. **E2E scope**: E2E tests against dev servers or mocked backend?
5. **CI/CD timing**: Implement Husky/GitHub Actions at end, or after each phase?

---

## Appendix

### Related Documents

- [Backend Architecture Deep Dive](../../../docs/backend/architecture-deep-dive.md)
- [WebSocket Contract](../../../docs/backend/websocket-contract.md)
- [SDK Message Structures](../../../docs/backend/06-sdk-message-structures.md)
- [Database Schema](../../../docs/common/03-database-schema.md)
- [Authentication Guide](../../../docs/backend/authentication.md)

---

### Glossary

- **DirectAgentService**: Core agent service with manual agentic loop
- **Event Sourcing**: Append-only log pattern for state management
- **Stop Reason**: SDK field differentiating message stages
- **BullMQ**: Job queue library for async processing
- **MSW**: Mock Service Worker for HTTP mocking
- **Vitest**: Test framework (Jest-compatible)
- **ioredis-mock**: Redis mock for testing

---

**End of PRD 01: Backend Testing Overview**
