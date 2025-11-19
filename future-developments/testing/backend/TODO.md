# Backend Testing Implementation - Master TODO

**Created**: 2025-11-19
**Status**: In Progress (Phase 1)
**Target Coverage**: 70% (from current 14%)
**Estimated Duration**: 4-5 weeks

---

## 📊 Executive Summary

### Current State
- **Test Infrastructure**: ✅ Complete (Vitest, MSW, Supertest all installed)
- **Existing Tests**: 7 test files, 93 total tests
- **Tests Passing**: 82/93 (11 failing in DirectAgentService.test.ts)
- **Current Coverage**: ~14%
- **Source Files**: 55 TypeScript files
- **Test File Ratio**: 12.7% (7/55)

### Critical Issues
1. **DirectAgentService.test.ts**: 11 tests failing due to streaming refactor
   - Tests use deprecated `executeQuery()` → Need `executeQueryStreaming()`
   - Mock client uses non-streaming `createChatCompletion` → Need `createChatCompletionStream`
   - Need AsyncIterable generator for streaming events

2. **Major Coverage Gaps**:
   - EventStore: 0% (CRITICAL - event sourcing foundation)
   - MessageQueue: 0% (CRITICAL - BullMQ rate limiting)
   - Authentication Services: 0% (MicrosoftOAuthService, BCTokenManager)
   - BC Integration: 0% (BCClient, MCPService)
   - Message Handling: 0% (MessageService, ChatMessageHandler)

### Success Criteria
- [ ] All 93 existing tests passing
- [ ] ≥70% overall coverage
- [ ] ≥80% coverage for critical services (EventStore, MessageQueue, DirectAgentService)
- [ ] ≥70% coverage for auth services (OAuth, BCTokenManager)
- [ ] Integration tests implemented (4 core flows)
- [ ] Documentation updated (docs/backend/README.md)
- [ ] CI/CD threshold set to 70%

---

## 🏗️ Architecture Context

### DirectAgentService - Manual Agentic Loop

**Current Implementation** (as of 2025-11-19):
- Uses `@anthropic-ai/sdk@0.68.0` (Direct API, NOT Agent SDK)
- Implements **manual agentic loop** with streaming
- Stop reason pattern: `tool_use` = continue, `end_turn` = finish
- Event sourcing via EventStore with atomic sequences (Redis INCR)
- BullMQ queues for async processing (3 queues: persistence, tools, events)
- Approval hooks for write operations

**Key Methods**:
```typescript
// ❌ DEPRECATED (throws error)
async executeQuery(prompt, sessionId, onEvent): Promise<AgentExecutionResult>

// ✅ CURRENT (streaming)
async executeQueryStreaming(prompt, sessionId, onEvent): Promise<AgentExecutionResult>
```

**IAnthropicClient Interface**:
```typescript
interface IAnthropicClient {
  // ❌ Non-streaming (not used in production)
  createChatCompletion(request): Promise<ChatCompletionResponse>

  // ✅ Streaming (current implementation)
  createChatCompletionStream(request): AsyncIterable<MessageStreamEvent>
}
```

**Streaming Event Flow**:
1. `message_start` → Message begins, capture ID and input tokens
2. `content_block_start` → New content (text or tool_use)
3. `content_block_delta` → Incremental chunks (`text_delta` or `input_json_delta`)
4. `content_block_stop` → Content block complete
5. `message_delta` → Token usage and stop_reason updates
6. `message_stop` → Full message complete

**Stop Reason Pattern** (migration 008):
- `stop_reason='tool_use'` → Intermediate message, continue loop
- `stop_reason='end_turn'` → Final response, exit loop
- `stop_reason='max_tokens'` → Warning + exit loop

### Event Sourcing Pattern

**Architecture**:
- **Append-only log**: `message_events` table
- **Atomic sequences**: Redis INCR for `sequence_number`
- **Event replay**: Reconstruct messages from events
- **Multi-tenant**: Session-scoped isolation
- **TTL cleanup**: Automatic event expiration

**BullMQ Queues**:
1. **message-persistence**: Persist complete messages to DB
2. **tool-execution**: Execute tools post-approval
3. **event-processing**: Process special events (TodoWrite, errors)

**Rate Limiting**:
- 100 jobs/session/hour
- Concurrency: 10 (messages), 5 (tools)

### Authentication Architecture

**Microsoft OAuth 2.0**:
- Single Sign-On with Entra ID
- Delegated permissions for Business Central
- Refresh tokens stored encrypted in DB
- Per-user BC tokens (NOT global credentials)

**Encryption**:
- AES-256-GCM for token storage
- Encryption key in Azure Key Vault
- IV (initialization vector) per token

### Database Schema

**11/15 Tables Functional**:
- `users`, `sessions`, `user_messages`, `assistant_messages`, `thinking_messages`
- `tool_messages`, `message_events`, `approval_requests`, `todos`
- `conversation_history`, `bc_tokens`

**Key Tables for Testing**:
- `message_events`: Event sourcing log (append-only)
- `approval_requests`: Human-in-the-loop approvals
- `bc_tokens`: Encrypted BC API tokens
- `assistant_messages`: Stop reason pattern

---

## 📋 Implementation Roadmap

### ✅ Phase 0: Documentation (CURRENT)
**Duration**: 1 day
**Status**: ✅ Complete (2025-11-19)

- [x] Create master TODO.md with complete analysis
- [x] Document architecture (DirectAgentService, Event Sourcing, Auth)
- [x] Document current state (14% coverage, 11 failing tests)
- [x] Define success criteria (70% coverage, all tests passing)
- [x] Create detailed roadmap with checkpoints

**Deliverables**:
- `future-developments/testing/backend/TODO.md` ✅

---

### 🔴 Phase 1: Fix Existing Tests (CRITICAL - NEXT)
**Duration**: 2-3 days
**Status**: 🔴 Not Started
**Blocking**: Yes (must complete before Phase 2)

#### Task 1.1: Fix DirectAgentService.test.ts (Day 1-2)

**Problem**: 11 tests failing due to streaming refactor
- Tests call deprecated `executeQuery()` → Should use `executeQueryStreaming()`
- Mock uses `createChatCompletion` → Should use `createChatCompletionStream`
- Need AsyncIterable generator for `MessageStreamEvent[]`

**Solution Approach**:

1. **Create Mock Streaming Generator**:
```typescript
// Helper to create mock streaming response
async function* createMockStreamingResponse(
  streamEvents: MessageStreamEvent[]
): AsyncIterable<MessageStreamEvent> {
  for (const event of streamEvents) {
    yield event;
  }
}
```

2. **Update Mock Client Setup**:
```typescript
beforeEach(() => {
  mockClient = {
    createChatCompletion: vi.fn(), // Keep for backwards compat
    createChatCompletionStream: vi.fn(), // NEW - streaming
  };
});
```

3. **Create Streaming Event Builders**:
```typescript
// Example: Simple text response
const textResponseEvents: MessageStreamEvent[] = [
  {
    type: 'message_start',
    message: {
      id: 'msg-123',
      usage: { input_tokens: 100, output_tokens: 0 }
    }
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello world' }
  },
  {
    type: 'content_block_stop',
    index: 0
  },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 50 }
  },
  {
    type: 'message_stop'
  }
];

// Mock the streaming call
vi.mocked(mockClient.createChatCompletionStream)
  .mockReturnValue(createMockStreamingResponse(textResponseEvents));
```

4. **Test Cases to Fix** (11 total):

   **Basic Tests** (3):
   - [ ] `should execute simple query without tools`
   - [ ] `should execute query with tool use (list_all_entities)`
   - [ ] `should enforce max turns limit (20 turns)`

   **Approval Tests** (2):
   - [ ] `should handle write operation approval (approved)`
   - [ ] `should handle write operation denial (denied)`

   **Error Handling Tests** (3):
   - [ ] `should handle tool execution error`
   - [ ] `should handle max_tokens stop reason`
   - [ ] `should handle API errors gracefully`

   **Event Tests** (1):
   - [ ] `should emit all event types correctly`

   **Private Method Tests** (2):
   - [ ] `should require approval for write operations via tool name detection`
   - [ ] `should not require approval for read operations`

**Complexity**: High (streaming pattern with AsyncIterable)

**Estimated Effort**: 2 days
- Day 1: Create mock generators, fix first 5 tests
- Day 2: Fix remaining 6 tests, verify all passing

**Files to Modify**:
- `backend/src/__tests__/unit/services/agent/DirectAgentService.test.ts`

**Testing Strategy**:
- Run tests incrementally: `npm test -- DirectAgentService.test.ts`
- Verify each test individually before moving to next
- Check console output for streaming logs (`========== TURN N ==========`)

**Known Issues**:
1. **Redis/Database mocking**: Tests fail with "Database not connected"
   - Need to mock `getEventStore()` → `getNextSequenceNumber()`
   - Mock Redis INCR or fallback to database mock

2. **MCP Tools loading**: Mock file system properly
   - Already mocked in test setup (line 46-60)
   - Ensure `bc_index.json` structure matches expectations

**Success Criteria**:
- [ ] All 11 tests passing
- [ ] No deprecated `executeQuery()` calls
- [ ] Streaming properly mocked with AsyncIterable
- [ ] Test execution time <5 seconds
- [ ] Coverage maintained at ~60% for DirectAgentService

**Verification**:
```bash
cd backend
npm test -- DirectAgentService.test.ts
# Expected: 11/11 tests passing
```

#### Task 1.2: Verify Baseline (Day 3)

**Goal**: Confirm all 93 tests passing

**Steps**:
1. Run full test suite:
   ```bash
   cd backend
   npm test
   ```
   - Expected: 93/93 tests passing

2. Run coverage report:
   ```bash
   npm run test:coverage
   ```
   - Expected: ~14% coverage baseline

3. Verify existing tests:
   - [ ] ApprovalManager.test.ts (11 tests) ✅
   - [ ] messageHelpers.test.ts (15 tests) ✅
   - [ ] sessions.routes.test.ts (18 tests) ✅
   - [ ] sessions.transformers.test.ts (18 tests) ✅
   - [ ] server.socket.test.ts (35 tests) ✅
   - [ ] DirectAgentService.test.ts (11 tests) 🔴 → ✅
   - [ ] example.test.ts (3 tests) ✅

**Success Criteria**:
- [ ] 93/93 tests passing
- [ ] Coverage ~14% (baseline established)
- [ ] No console errors or warnings
- [ ] Test execution time <30 seconds

---

### Phase 2: Critical Services Testing (Week 1-2)
**Duration**: 9 days
**Status**: Pending
**Dependencies**: Phase 1 complete
**Target Coverage**: 14% → 40%

#### Task 2.1: EventStore.test.ts (Days 4-5)

**File**: `backend/src/__tests__/unit/services/events/EventStore.test.ts`

**Priority**: 🔴 CRITICAL (event sourcing foundation)

**Service Under Test**: `backend/src/services/events/EventStore.ts`
- Append-only event log
- Atomic sequence numbers via Redis INCR
- Event replay and message reconstruction
- Multi-tenant isolation
- TTL-based cleanup

**Test Cases** (Estimated: ~40 tests):

**Atomic Sequences** (8 tests):
- [ ] `should generate atomic sequence numbers via Redis INCR`
- [ ] `should handle concurrent sequence generation`
- [ ] `should fallback to database when Redis unavailable`
- [ ] `should maintain sequence order across multiple sessions`
- [ ] `should reset sequence on new message`
- [ ] `should handle Redis INCR errors gracefully`
- [ ] `should increment sequence for each event in same message`
- [ ] `should start sequence from 1 for new messages`

**Append-Only Log** (10 tests):
- [ ] `should append event to message_events table`
- [ ] `should store all required fields (session_id, message_id, sequence_number, event_type, event_data)`
- [ ] `should serialize event_data as JSON`
- [ ] `should handle large event payloads (>10KB)`
- [ ] `should reject events with missing required fields`
- [ ] `should append multiple events in order`
- [ ] `should handle database write failures`
- [ ] `should not allow event updates (append-only)`
- [ ] `should not allow event deletions (append-only)`
- [ ] `should store timestamp with millisecond precision`

**Event Replay** (8 tests):
- [ ] `should replay events for a message in sequence order`
- [ ] `should reconstruct message from events`
- [ ] `should handle partial messages (incomplete event stream)`
- [ ] `should return empty array for non-existent message`
- [ ] `should filter events by event_type`
- [ ] `should replay only events for specific session`
- [ ] `should handle corrupted event_data gracefully`
- [ ] `should replay large event streams (>100 events)`

**Multi-Tenant Isolation** (6 tests):
- [ ] `should isolate events by session_id`
- [ ] `should not return events from other sessions`
- [ ] `should prevent cross-session sequence conflicts`
- [ ] `should handle multiple sessions writing concurrently`
- [ ] `should enforce session_id on all queries`
- [ ] `should not leak events between tenants`

**TTL Cleanup** (4 tests):
- [ ] `should mark events for cleanup based on TTL`
- [ ] `should delete expired events older than TTL`
- [ ] `should preserve recent events within TTL`
- [ ] `should handle cleanup failures gracefully`

**Error Handling** (4 tests):
- [ ] `should handle Redis connection errors`
- [ ] `should handle database connection errors`
- [ ] `should handle malformed event_data`
- [ ] `should log errors without crashing`

**Mock Strategy**:
```typescript
// Mock Redis
vi.mock('@/config/redis', () => ({
  getRedis: vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1), // Atomic sequence
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

// Mock Database
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    recordset: [],
    rowsAffected: [1],
  }),
}));
```

**Target Coverage**: 80%+

**Estimated Effort**: 2 days

---

#### Task 2.2: MessageQueue.test.ts (Days 6-7)

**File**: `backend/src/__tests__/unit/services/queue/MessageQueue.test.ts`

**Priority**: 🔴 CRITICAL (rate limiting, async processing)

**Service Under Test**: `backend/src/services/queue/MessageQueue.ts`
- BullMQ integration (3 queues)
- Rate limiting (100 jobs/session/hour)
- Job processing with workers
- Error handling and retries
- Queue health monitoring

**Test Cases** (Estimated: ~35 tests):

**Queue Initialization** (5 tests):
- [ ] `should initialize 3 queues (message-persistence, tool-execution, event-processing)`
- [ ] `should connect to Redis on startup`
- [ ] `should register workers for each queue`
- [ ] `should set concurrency limits (10 messages, 5 tools)`
- [ ] `should handle Redis connection errors on init`

**Rate Limiting** (8 tests):
- [ ] `should enforce 100 jobs/session/hour limit`
- [ ] `should track job count per session`
- [ ] `should reset job count after 1 hour window`
- [ ] `should reject jobs exceeding rate limit`
- [ ] `should allow jobs within rate limit`
- [ ] `should rate limit per session (not globally)`
- [ ] `should handle concurrent job submissions`
- [ ] `should log rate limit violations`

**Message Persistence Queue** (6 tests):
- [ ] `should add job to message-persistence queue`
- [ ] `should process job with persistence worker`
- [ ] `should retry on persistence failure (max 3 attempts)`
- [ ] `should handle job completion`
- [ ] `should handle job failure after retries`
- [ ] `should track job progress`

**Tool Execution Queue** (6 tests):
- [ ] `should add job to tool-execution queue`
- [ ] `should process job with tool worker`
- [ ] `should execute tool with correct parameters`
- [ ] `should retry on tool failure (max 3 attempts)`
- [ ] `should handle tool timeout`
- [ ] `should respect concurrency limit (5 tools max)`

**Event Processing Queue** (5 tests):
- [ ] `should add job to event-processing queue`
- [ ] `should process TodoWrite events`
- [ ] `should process error events`
- [ ] `should handle unknown event types`
- [ ] `should batch process events`

**Error Handling** (5 tests):
- [ ] `should handle worker crashes`
- [ ] `should handle Redis disconnections`
- [ ] `should handle malformed job data`
- [ ] `should log all errors`
- [ ] `should not crash on job failure`

**Mock Strategy**:
```typescript
// Mock BullMQ
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    close: vi.fn(),
  })),
  Worker: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));
```

**Target Coverage**: 80%+

**Estimated Effort**: 2 days

---

#### Task 2.3: ChatMessageHandler.test.ts (Days 8-9)

**File**: `backend/src/__tests__/unit/services/websocket/ChatMessageHandler.test.ts`

**Priority**: High (WebSocket message handling)

**Service Under Test**: `backend/src/services/websocket/ChatMessageHandler.ts`

**Test Cases** (Estimated: ~25 tests):

**Message Validation** (8 tests):
- [ ] `should validate message has required fields (message, sessionId, userId)`
- [ ] `should reject empty messages`
- [ ] `should reject messages exceeding max length`
- [ ] `should sanitize message content`
- [ ] `should validate sessionId format (UUID)`
- [ ] `should validate userId format`
- [ ] `should handle malformed JSON`
- [ ] `should trim whitespace from messages`

**Session Ownership** (5 tests):
- [ ] `should verify user owns session before processing`
- [ ] `should reject messages for other users' sessions`
- [ ] `should handle non-existent sessions`
- [ ] `should handle deleted sessions`
- [ ] `should cache session ownership checks`

**Agent Event Handling** (7 tests):
- [ ] `should invoke DirectAgentService.executeQueryStreaming()`
- [ ] `should pass onEvent callback to agent`
- [ ] `should emit agent events via WebSocket`
- [ ] `should handle agent errors gracefully`
- [ ] `should track message processing time`
- [ ] `should handle concurrent messages`
- [ ] `should respect max concurrent messages limit`

**WebSocket Emission** (5 tests):
- [ ] `should emit events to correct socket`
- [ ] `should emit thinking event on start`
- [ ] `should emit message_chunk events during streaming`
- [ ] `should emit complete event on finish`
- [ ] `should emit error event on failure`

**Target Coverage**: 75%+

**Estimated Effort**: 2 days

---

#### Task 2.4: MessageService.test.ts (Days 10-11)

**File**: `backend/src/__tests__/unit/services/messages/MessageService.test.ts`

**Priority**: High (message persistence)

**Service Under Test**: `backend/src/services/messages/MessageService.ts`

**Test Cases** (Estimated: ~30 tests):

**User Message Persistence** (8 tests):
- [ ] `should persist user message to user_messages table`
- [ ] `should generate message ID (UUID)`
- [ ] `should store session_id, user_id, content, timestamp`
- [ ] `should handle long messages (>10KB)`
- [ ] `should sanitize content before storage`
- [ ] `should return stored message with ID`
- [ ] `should handle database errors`
- [ ] `should validate required fields`

**Assistant Message Storage** (10 tests):
- [ ] `should persist assistant message to assistant_messages table`
- [ ] `should store stop_reason (tool_use, end_turn, max_tokens)`
- [ ] `should detect partial messages (stop_reason='tool_use')`
- [ ] `should mark final messages (stop_reason='end_turn')`
- [ ] `should store token usage (input_tokens, output_tokens)`
- [ ] `should link to parent user message`
- [ ] `should handle empty content`
- [ ] `should handle multiple text blocks`
- [ ] `should store model name`
- [ ] `should handle database errors`

**Thinking/Tool Message Handling** (6 tests):
- [ ] `should persist thinking messages to thinking_messages table`
- [ ] `should persist tool messages to tool_messages table`
- [ ] `should store tool name and arguments`
- [ ] `should store tool results`
- [ ] `should link tool messages to assistant message`
- [ ] `should handle tool execution errors`

**Message History Retrieval** (4 tests):
- [ ] `should retrieve messages for session in chronological order`
- [ ] `should include user, assistant, thinking, and tool messages`
- [ ] `should paginate results (limit, offset)`
- [ ] `should handle empty sessions`

**Multi-Tenant Isolation** (2 tests):
- [ ] `should only return messages for specified session`
- [ ] `should not leak messages between sessions`

**Target Coverage**: 75%+

**Estimated Effort**: 2 days

---

**Phase 2 Checkpoint**:
- [ ] 4 critical services tested (EventStore, MessageQueue, ChatMessageHandler, MessageService)
- [ ] ~130 new tests added
- [ ] Coverage: 14% → 40%
- [ ] All tests passing (93 + 130 = 223 tests)

---

### Phase 3: Auth & BC Integration (Week 3)
**Duration**: 5 days
**Status**: Pending
**Dependencies**: Phase 2 complete
**Target Coverage**: 40% → 55%

#### Task 3.1: MicrosoftOAuthService.test.ts (Days 12-13)

**File**: `backend/src/__tests__/unit/services/auth/MicrosoftOAuthService.test.ts`

**Priority**: High (authentication foundation)

**Service Under Test**: `backend/src/services/auth/MicrosoftOAuthService.ts`
- Microsoft Entra ID OAuth 2.0
- Authorization code flow
- Token acquisition and refresh
- User profile retrieval
- BC token acquisition

**Test Cases** (Estimated: ~30 tests):

**Authorization Code Flow** (8 tests):
- [ ] `should generate authorization URL with correct parameters`
- [ ] `should include required scopes (openid, profile, BC API)`
- [ ] `should use PKCE (code_challenge, code_verifier)`
- [ ] `should redirect to correct callback URL`
- [ ] `should exchange code for access token`
- [ ] `should handle invalid authorization code`
- [ ] `should handle expired authorization code`
- [ ] `should validate state parameter (CSRF protection)`

**Token Acquisition** (8 tests):
- [ ] `should acquire access token with valid code`
- [ ] `should acquire refresh token`
- [ ] `should acquire ID token`
- [ ] `should store tokens in database (encrypted)`
- [ ] `should return token expiration time`
- [ ] `should handle network errors`
- [ ] `should handle invalid client credentials`
- [ ] `should handle rate limiting`

**Token Refresh** (6 tests):
- [ ] `should refresh access token using refresh token`
- [ ] `should update token in database`
- [ ] `should handle expired refresh token`
- [ ] `should handle revoked refresh token`
- [ ] `should retry on transient errors`
- [ ] `should fallback to re-authentication if refresh fails`

**User Profile** (4 tests):
- [ ] `should retrieve user profile from Microsoft Graph`
- [ ] `should parse user info (name, email, UPN)`
- [ ] `should cache user profile`
- [ ] `should handle API errors`

**BC Token Acquisition** (4 tests):
- [ ] `should acquire BC API token with delegated permissions`
- [ ] `should include BC scopes (Financials.ReadWrite.All)`
- [ ] `should store BC token separately`
- [ ] `should handle BC token errors`

**Mock Strategy**:
```typescript
// Mock MSAL
vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: vi.fn(() => ({
    getAuthCodeUrl: vi.fn().mockResolvedValue('https://login.microsoft.com/...'),
    acquireTokenByCode: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      idToken: 'mock-id-token',
      expiresOn: new Date(Date.now() + 3600000),
    }),
    acquireTokenByRefreshToken: vi.fn(),
  })),
}));

// Mock Microsoft Graph API
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        displayName: 'Test User',
        mail: 'test@example.com',
        userPrincipalName: 'test@example.com',
      },
    }),
  },
}));
```

**Target Coverage**: 70%+

**Estimated Effort**: 2 days

---

#### Task 3.2: BCTokenManager.test.ts (Day 14)

**File**: `backend/src/__tests__/unit/services/auth/BCTokenManager.test.ts`

**Priority**: High (per-user BC tokens, encryption)

**Service Under Test**: `backend/src/services/auth/BCTokenManager.ts`

**Test Cases** (Estimated: ~25 tests):

**Token Encryption** (8 tests):
- [ ] `should encrypt BC token using AES-256-GCM`
- [ ] `should generate unique IV for each token`
- [ ] `should store IV with encrypted token`
- [ ] `should handle large tokens (>1KB)`
- [ ] `should handle encryption errors`
- [ ] `should use key from Azure Key Vault`
- [ ] `should validate encryption key length (32 bytes)`
- [ ] `should produce different ciphertext for same plaintext (due to IV)`

**Token Decryption** (6 tests):
- [ ] `should decrypt token using correct key and IV`
- [ ] `should return original token after decrypt`
- [ ] `should handle corrupted ciphertext`
- [ ] `should handle invalid IV`
- [ ] `should handle wrong encryption key`
- [ ] `should throw error on decryption failure`

**Token Storage** (6 tests):
- [ ] `should store encrypted token in bc_tokens table`
- [ ] `should associate token with user_id`
- [ ] `should store token expiration time`
- [ ] `should store refresh token (encrypted)`
- [ ] `should update existing token for user`
- [ ] `should handle database errors`

**Token Retrieval** (3 tests):
- [ ] `should retrieve and decrypt token for user`
- [ ] `should return null if no token found`
- [ ] `should handle expired tokens`

**Token Refresh** (2 tests):
- [ ] `should refresh expired BC token`
- [ ] `should update stored token after refresh`

**Mock Strategy**:
```typescript
// Mock crypto
vi.mock('crypto', () => ({
  randomBytes: vi.fn().mockReturnValue(Buffer.from('0'.repeat(32))),
  createCipheriv: vi.fn(() => ({
    update: vi.fn().mockReturnValue(Buffer.from('encrypted')),
    final: vi.fn().mockReturnValue(Buffer.from('')),
  })),
  createDecipheriv: vi.fn(() => ({
    update: vi.fn().mockReturnValue(Buffer.from('decrypted')),
    final: vi.fn().mockReturnValue(Buffer.from('')),
  })),
}));
```

**Target Coverage**: 80%+

**Estimated Effort**: 1 day

---

#### Task 3.3: BCClient.test.ts (Day 15)

**File**: `backend/src/__tests__/unit/services/bc/BCClient.test.ts`

**Priority**: Medium (BC API integration)

**Service Under Test**: `backend/src/services/bc/BCClient.ts`

**Test Cases** (Estimated: ~25 tests):

**OAuth Authentication** (5 tests):
- [ ] `should authenticate with user's BC token`
- [ ] `should include Authorization header (Bearer token)`
- [ ] `should refresh expired token automatically`
- [ ] `should handle authentication errors`
- [ ] `should cache valid tokens`

**API Calls** (12 tests):
- [ ] `should make GET request to BC API`
- [ ] `should make POST request with body`
- [ ] `should make PUT request for updates`
- [ ] `should make DELETE request`
- [ ] `should include correct headers (Content-Type, Accept)`
- [ ] `should handle query parameters`
- [ ] `should handle pagination`
- [ ] `should parse JSON responses`
- [ ] `should handle non-JSON responses`
- [ ] `should timeout after 30 seconds`
- [ ] `should handle network errors`
- [ ] `should retry transient errors (3 attempts)`

**Error Handling** (5 tests):
- [ ] `should handle 401 Unauthorized (refresh token)`
- [ ] `should handle 403 Forbidden`
- [ ] `should handle 404 Not Found`
- [ ] `should handle 429 Rate Limit (exponential backoff)`
- [ ] `should handle 500 Server Error`

**Schema Introspection** (3 tests):
- [ ] `should retrieve entity schema from BC`
- [ ] `should cache schema`
- [ ] `should handle schema errors`

**Mock Strategy**:
```typescript
// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({ data: { value: [] } }),
      post: vi.fn().mockResolvedValue({ data: { id: '123' } }),
      put: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));
```

**Target Coverage**: 70%+

**Estimated Effort**: 1 day

---

#### Task 3.4: MCPService.test.ts (Day 16)

**File**: `backend/src/__tests__/unit/services/mcp/MCPService.test.ts`

**Priority**: Medium (MCP tool integration)

**Service Under Test**: `backend/src/services/mcp/MCPService.ts`

**Test Cases** (Estimated: ~20 tests):

**Vendored Tool Loading** (8 tests):
- [ ] `should load 7 vendored MCP tools from tool-definitions.ts`
- [ ] `should parse tool schema (name, description, input_schema)`
- [ ] `should validate tool definitions match MCP server`
- [ ] `should handle missing tools`
- [ ] `should handle malformed tool definitions`
- [ ] `should cache loaded tools`
- [ ] `should reload tools on demand`
- [ ] `should handle file system errors`

**Tool Definition Conversion** (6 tests):
- [ ] `should convert MCP tool to Anthropic tool format`
- [ ] `should map input_schema to Anthropic parameters`
- [ ] `should preserve tool description`
- [ ] `should handle optional parameters`
- [ ] `should handle required parameters`
- [ ] `should validate converted tool schema`

**Tool Execution** (4 tests):
- [ ] `should execute tool with parameters`
- [ ] `should call BCClient for BC operations`
- [ ] `should handle tool errors`
- [ ] `should timeout after max duration`

**Error Handling** (2 tests):
- [ ] `should handle unknown tool names`
- [ ] `should log all errors`

**Mock Strategy**:
```typescript
// Mock BCClient
vi.mock('@/services/bc/BCClient', () => ({
  BCClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn(),
  })),
}));
```

**Target Coverage**: 70%+

**Estimated Effort**: 1 day

---

**Phase 3 Checkpoint**:
- [ ] 4 auth/BC services tested (OAuth, BCTokenManager, BCClient, MCPService)
- [ ] ~100 new tests added
- [ ] Coverage: 40% → 55%
- [ ] All tests passing (223 + 100 = 323 tests)

---

### Phase 4: Supporting Services (Week 4)
**Duration**: 4 days
**Status**: Pending
**Dependencies**: Phase 3 complete
**Target Coverage**: 55% → 65%

#### Task 4.1: TodoManager.test.ts (Day 17)

**File**: `backend/src/__tests__/unit/services/todo/TodoManager.test.ts`

**Test Cases** (Estimated: ~20 tests):
- [ ] Todo creation from agent suggestions
- [ ] Todo updates and completion
- [ ] Priority management
- [ ] WebSocket notifications
- [ ] Multi-user isolation

**Target Coverage**: 75%+
**Estimated Effort**: 0.5 days

---

#### Task 4.2: SessionTitleGenerator.test.ts (Day 17)

**File**: `backend/src/__tests__/unit/services/sessions/SessionTitleGenerator.test.ts`

**Test Cases** (Estimated: ~15 tests):
- [ ] Title generation from messages
- [ ] Summarization logic
- [ ] Edge cases (empty, very long messages)

**Target Coverage**: 70%+
**Estimated Effort**: 0.5 days

---

#### Task 4.3: Utilities Tests (Days 18-19)

**Files**:
- `backend/src/__tests__/unit/utils/retry.test.ts`
- `backend/src/__tests__/unit/utils/logger.test.ts`
- Expand `messageHelpers.test.ts`

**Test Cases** (Estimated: ~25 tests):
- [ ] Retry: Exponential backoff, max attempts, error handling
- [ ] Logger: Log formatting, levels, structured logging
- [ ] MessageHelpers: Additional edge cases

**Target Coverage**: 80%+
**Estimated Effort**: 2 days

---

#### Task 4.4: Remaining Services (Day 20)

**Files**:
- `backend/src/__tests__/unit/services/bc/BCValidator.test.ts`
- Other small services <50% coverage

**Test Cases** (Estimated: ~20 tests)

**Target Coverage**: 70%+
**Estimated Effort**: 1 day

---

**Phase 4 Checkpoint**:
- [ ] Supporting services tested (Todo, SessionTitle, utilities, BCValidator)
- [ ] ~80 new tests added
- [ ] Coverage: 55% → 65%
- [ ] All tests passing (323 + 80 = 403 tests)

---

### Phase 5: Integration Tests (Week 5)
**Duration**: 5 days
**Status**: Pending
**Dependencies**: Phase 4 complete
**Target Coverage**: 65% → 70%+

#### Task 5.1: Chat Flow Integration (Days 21-22)

**File**: `backend/src/__tests__/integration/chat-flow.test.ts`

**Scope**: End-to-end chat flow testing

**Test Cases** (Estimated: ~15 tests):

**Basic Flow** (5 tests):
- [ ] User message → Agent processing → Response (complete flow)
- [ ] Streaming events propagated via WebSocket
- [ ] Event sourcing persistence (events stored in DB)
- [ ] Multi-turn conversation with context
- [ ] Message history retrieval

**Tool Usage Flow** (5 tests):
- [ ] Agent requests tool → Tool executed → Result returned
- [ ] Read operations (no approval needed)
- [ ] Write operations (approval required)
- [ ] Multiple tools in single turn
- [ ] Tool error handling

**Error Recovery** (5 tests):
- [ ] Network error during API call
- [ ] Database error during persistence
- [ ] Redis error during sequence generation
- [ ] Invalid tool parameters
- [ ] Max turns limit exceeded

**Setup**:
- Use real Socket.IO server
- Use test database (transactions for isolation)
- Use test Redis instance
- Mock Anthropic API (MSW)
- Mock BC API (MSW)

**Target Coverage**: 60%+
**Estimated Effort**: 2 days

---

#### Task 5.2: Approval Flow Integration (Day 23)

**File**: `backend/src/__tests__/integration/approval-flow.test.ts`

**Scope**: Human-in-the-loop approval testing

**Test Cases** (Estimated: ~10 tests):

**Approval Flow** (6 tests):
- [ ] Tool call → Approval request → User approves → Tool executed
- [ ] Approval request stored in DB
- [ ] WebSocket notification sent to user
- [ ] User approval triggers tool execution
- [ ] Result returned to agent
- [ ] Conversation continues after approval

**Rejection Flow** (2 tests):
- [ ] User rejects approval → Tool not executed
- [ ] Agent informed of rejection

**Timeout Handling** (2 tests):
- [ ] Approval timeout (60s) → Tool not executed
- [ ] Agent informed of timeout

**Target Coverage**: 70%+
**Estimated Effort**: 1 day

---

#### Task 5.3: Authentication Flow Integration (Day 24)

**File**: `backend/src/__tests__/integration/auth-flow.test.ts`

**Scope**: OAuth and token management testing

**Test Cases** (Estimated: ~10 tests):

**Login Flow** (4 tests):
- [ ] OAuth login → Token acquisition → Session created
- [ ] Tokens stored encrypted in DB
- [ ] User profile retrieved
- [ ] BC token acquired

**Token Refresh** (3 tests):
- [ ] Expired access token → Refresh token used
- [ ] New tokens stored in DB
- [ ] User session maintained

**Session Management** (3 tests):
- [ ] Active session validated on each request
- [ ] Expired session rejected
- [ ] Logout clears session and tokens

**Target Coverage**: 65%+
**Estimated Effort**: 1 day

---

#### Task 5.4: Database Operations Integration (Day 25)

**File**: `backend/src/__tests__/integration/database-operations.test.ts`

**Scope**: Database transaction and isolation testing

**Test Cases** (Estimated: ~10 tests):

**CRUD Operations** (4 tests):
- [ ] Session creation → Message persistence → Retrieval
- [ ] Update operations with transactions
- [ ] Delete operations with cascade
- [ ] Bulk operations

**Transaction Handling** (3 tests):
- [ ] Transaction commit on success
- [ ] Transaction rollback on error
- [ ] Nested transactions

**Multi-Tenant Isolation** (3 tests):
- [ ] Session isolation (no cross-session leaks)
- [ ] User isolation (no cross-user leaks)
- [ ] Concurrent writes to different sessions

**Target Coverage**: 70%+
**Estimated Effort**: 1 day

---

**Phase 5 Checkpoint**:
- [ ] 4 integration test suites (chat, approval, auth, database)
- [ ] ~45 new tests added
- [ ] Coverage: 65% → 70%+
- [ ] All tests passing (403 + 45 = 448 tests)

---

### Phase 6: Documentation & Finalization (Week 6 - Day 26)
**Duration**: 1 day
**Status**: Pending
**Dependencies**: Phase 5 complete

#### Task 6.1: Update Backend Documentation

**File**: `docs/backend/README.md`

**Additions**:

```markdown
## Testing

### Running Tests

**All tests**:
```bash
cd backend
npm test
```

**Single test file**:
```bash
npm test -- DirectAgentService.test.ts
```

**Watch mode**:
```bash
npm test -- --watch
```

**Coverage report**:
```bash
npm run test:coverage
```

Open `coverage/index.html` in browser to view detailed report.

**UI dashboard**:
```bash
npm run test:ui
```

### Test Structure

```
backend/src/__tests__/
├── setup.ts                    # Test environment setup (MSW server)
├── mocks/
│   ├── server.ts               # MSW server instance
│   └── handlers.ts             # API mock handlers (Anthropic, BC)
├── fixtures/
│   ├── AnthropicResponseFactory.ts  # Claude API mocks
│   ├── BCEntityFixture.ts      # BC entity test data
│   └── ApprovalFixture.ts      # Approval test data
├── unit/                       # Unit tests (services, utils)
│   ├── services/
│   │   ├── agent/
│   │   │   └── DirectAgentService.test.ts
│   │   ├── events/
│   │   │   └── EventStore.test.ts
│   │   ├── queue/
│   │   │   └── MessageQueue.test.ts
│   │   └── ...
│   └── utils/
│       └── messageHelpers.test.ts
└── integration/                # Integration tests
    ├── chat-flow.test.ts
    ├── approval-flow.test.ts
    ├── auth-flow.test.ts
    └── database-operations.test.ts
```

### Coverage Thresholds

Current coverage requirements:
- **Overall**: 70%
- **Critical services** (EventStore, MessageQueue, DirectAgentService): 80%
- **Auth services** (OAuth, BCTokenManager): 70%

Coverage is enforced in CI/CD - builds fail below thresholds.

### Writing Tests

**Example unit test**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyService } from '@/services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MyService();
  });

  it('should do something', async () => {
    // Arrange
    const input = 'test';

    // Act
    const result = await service.doSomething(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

**Mocking dependencies**:
```typescript
// Mock database
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({ recordset: [] }),
}));

// Mock Redis
vi.mock('@/config/redis', () => ({
  getRedis: vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1),
  })),
}));
```

### Troubleshooting

**Tests fail with "Database not connected"**:
- Ensure database is mocked: `vi.mock('@/config/database')`

**Tests fail with "Redis not available"**:
- Ensure Redis is mocked: `vi.mock('@/config/redis')`

**Streaming tests fail**:
- Mock `createChatCompletionStream` with AsyncIterable generator
- See `DirectAgentService.test.ts` for examples

**Coverage not meeting threshold**:
- Run `npm run test:coverage` to see which files need more tests
- Focus on critical services first
```

**Estimated Effort**: 2 hours

---

#### Task 6.2: Update vitest.config.ts Threshold

**File**: `backend/vitest.config.ts`

**Changes**:
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  thresholds: {
    lines: 70,        // Updated from 10
    functions: 70,    // Updated from 10
    branches: 70,     // Updated from 10
    statements: 70,   // Updated from 10
  },
  // ... rest unchanged
}
```

**Estimated Effort**: 5 minutes

---

#### Task 6.3: Final Verification

**Checklist**:
- [ ] Run full test suite: `npm test`
  - Expected: 448 tests passing
- [ ] Run coverage: `npm run test:coverage`
  - Expected: ≥70% overall
  - Expected: ≥80% for critical services
- [ ] Verify no console errors
- [ ] Verify test execution time <60 seconds
- [ ] Build project: `npm run build`
  - Expected: No TypeScript errors
- [ ] Commit all changes
- [ ] Update main TODO.md to mark testing complete

**Estimated Effort**: 2 hours

---

**Phase 6 Checkpoint**:
- [ ] Documentation updated
- [ ] Coverage threshold enforced (70%)
- [ ] All 448 tests passing
- [ ] Final coverage: 70%+
- [ ] Project builds successfully

---

## 📊 Progress Tracking

### Overall Progress

```
[■■■□□□□□□□] 30% - Phase 1: Fix Existing Tests (In Progress)
[□□□□□□□□□□]  0% - Phase 2: Critical Services
[□□□□□□□□□□]  0% - Phase 3: Auth & BC Integration
[□□□□□□□□□□]  0% - Phase 4: Supporting Services
[□□□□□□□□□□]  0% - Phase 5: Integration Tests
[□□□□□□□□□□]  0% - Phase 6: Documentation

Overall: [■■■□□□□□□□] 5%
```

### Coverage Progress

```
Current:  [■□□□□□□□□□] 14%
Phase 1:  [■□□□□□□□□□] 14% (baseline)
Phase 2:  [■■■■□□□□□□] 40% (target)
Phase 3:  [■■■■■■□□□□] 55% (target)
Phase 4:  [■■■■■■■□□□] 65% (target)
Phase 5:  [■■■■■■■■□□] 70% (target)
Final:    [■■■■■■■■□□] 70%+ ✅
```

### Test Count Progress

```
Current:     93 tests (82 passing, 11 failing)
Phase 1:     93 tests (93 passing) ✅
Phase 2:    223 tests (223 passing)
Phase 3:    323 tests (323 passing)
Phase 4:    403 tests (403 passing)
Phase 5:    448 tests (448 passing) ✅
```

---

## 🔍 Testing Strategy

### Test Types

**Unit Tests** (70% of effort):
- Test individual functions/methods in isolation
- Mock all external dependencies (DB, Redis, APIs)
- Fast execution (<30 seconds total)
- Target: 80%+ coverage for business logic

**Integration Tests** (20% of effort):
- Test interactions between components
- Use test database with transactions
- Use test Redis instance
- Mock only external APIs (Anthropic, BC)
- Target: 60%+ coverage for integration points

**E2E Tests** (10% of effort - Phase 3 future):
- Test complete user workflows
- Use real backend server
- Use seeded test database
- Tools: Playwright or Cypress (NOT installed yet)

### Mocking Strategy

**Always Mock**:
- Anthropic API (use MSW + AnthropicResponseFactory)
- Business Central API (use MSW)
- External HTTP calls (use MSW)
- File system (use vi.mock('fs'))

**Mock for Unit Tests, Real for Integration**:
- Database (mock in unit, real test DB in integration)
- Redis (mock in unit, real test Redis in integration)
- WebSocket (mock in unit, real Socket.IO in integration)

**Never Mock**:
- Internal business logic
- Pure functions
- Type definitions

### Test Patterns

**AAA Pattern**:
```typescript
it('should do something', async () => {
  // Arrange - Setup test data and mocks
  const input = 'test';
  mockService.method.mockResolvedValue('result');

  // Act - Execute the code under test
  const result = await service.doSomething(input);

  // Assert - Verify expectations
  expect(result).toBe('expected');
  expect(mockService.method).toHaveBeenCalledWith(input);
});
```

**Factory Pattern** (for complex test data):
```typescript
// fixtures/AnthropicResponseFactory.ts
export class AnthropicResponseFactory {
  static createTextResponse(content: string): MessageStreamEvent[] {
    return [
      { type: 'message_start', message: { id: 'msg-123', ... } },
      { type: 'content_block_start', content_block: { type: 'text' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: content } },
      { type: 'content_block_stop' },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
  }
}
```

**Async Testing**:
```typescript
// ✅ Good - explicit async/await
it('should handle async operation', async () => {
  const result = await service.asyncMethod();
  expect(result).toBe('expected');
});

// ✅ Good - return promise
it('should handle async operation', () => {
  return expect(service.asyncMethod()).resolves.toBe('expected');
});

// ❌ Bad - missing await
it('should handle async operation', () => {
  service.asyncMethod(); // Assertion never runs!
  expect(result).toBe('expected');
});
```

---

## 🚨 Known Issues & Workarounds

### Issue 1: DirectAgentService Streaming Tests

**Problem**: Tests use deprecated `executeQuery()`, need `executeQueryStreaming()`

**Root Cause**:
- Service refactored to use native streaming (2025-11-19)
- `executeQuery()` now throws error directing to use streaming
- Mock client uses `createChatCompletion` instead of `createChatCompletionStream`
- Tests expect synchronous response, not AsyncIterable

**Solution**:
1. Update mock client to include `createChatCompletionStream`
2. Create `createMockStreamingResponse()` helper (AsyncIterable generator)
3. Build streaming event arrays matching SDK `MessageStreamEvent` types
4. Mock Redis/Database to avoid "Database not connected" errors

**Status**: 🔴 Not Started (Phase 1, Task 1.1)

---

### Issue 2: Database/Redis Mocking in Tests

**Problem**: Tests fail with "Database not connected. Call initDatabase() first."

**Root Cause**:
- EventStore calls `getNextSequenceNumber()` which requires Redis or DB
- Tests don't initialize database connection
- Need to mock at module level, not instance level

**Solution**:
```typescript
// Mock at top of test file (before imports)
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    recordset: [],
    rowsAffected: [1],
  }),
  getDatabase: vi.fn(() => ({
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    })),
  })),
}));

vi.mock('@/config/redis', () => ({
  getRedis: vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

// Mock EventStore to avoid sequence generation
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn(),
    getNextSequenceNumber: vi.fn().mockResolvedValue(1),
  })),
}));
```

**Status**: Known, documented solution

---

### Issue 3: MCP Tools File Loading in Tests

**Problem**: DirectAgentService loads `bc_index.json` from file system in constructor

**Root Cause**:
- Service reads `mcp-server/data/bc_index.json` at initialization
- Tests run in different environment, file may not exist
- File system operations slow down tests

**Solution**:
```typescript
// Mock fs at top of test file
vi.mock('fs');
vi.mock('path');

beforeEach(() => {
  vi.mocked(path.join).mockReturnValue('/mock/path/bc_index.json');
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
    entities: [
      {
        name: 'customer',
        displayName: 'Customer',
        description: 'Customer entity',
        operations: ['list', 'get', 'create'],
        endpoints: []
      }
    ],
    operationIndex: {}
  }));
});
```

**Status**: ✅ Solved (already implemented in existing tests)

---

### Issue 4: Test Execution Time

**Problem**: Tests may become slow as suite grows (target: <60s for 448 tests)

**Mitigation**:
- Use `vi.mock()` instead of real implementations
- Avoid unnecessary `async/await` in synchronous tests
- Use `--run` flag in CI/CD (no watch mode)
- Consider `--reporter=dot` for faster output
- Run tests in parallel (Vitest default)

**Monitoring**:
```bash
npm test -- --reporter=verbose
# Check "Duration" at end of output
# Target: <60 seconds for full suite
```

**Status**: Preventive measure, not yet an issue

---

### Issue 5: Flaky Integration Tests

**Problem**: Integration tests may fail intermittently due to timing issues

**Causes**:
- WebSocket connection delays
- Database transaction timing
- Redis latency
- Race conditions in async code

**Mitigation**:
- Use `waitFor()` helpers for async assertions
- Increase test timeouts for integration tests
- Use `beforeEach`/`afterEach` for cleanup
- Avoid shared state between tests
- Use transactions for database isolation

**Example**:
```typescript
// ✅ Good - wait for condition
import { waitFor } from '@testing-library/react';

it('should emit WebSocket event', async () => {
  let receivedEvent = false;
  socket.on('agent:event', () => { receivedEvent = true; });

  socket.emit('chat:message', { message: 'test' });

  await waitFor(() => expect(receivedEvent).toBe(true), {
    timeout: 5000
  });
});

// ❌ Bad - race condition
it('should emit WebSocket event', async () => {
  let receivedEvent = false;
  socket.on('agent:event', () => { receivedEvent = true; });

  socket.emit('chat:message', { message: 'test' });

  expect(receivedEvent).toBe(true); // May fail if event not yet received
});
```

**Status**: Documented for future reference

---

## 📚 References

### Documentation
- [Backend Architecture Deep Dive](../../../docs/backend/architecture-deep-dive.md)
- [WebSocket Contract](../../../docs/backend/websocket-contract.md)
- [SDK Message Structures](../../../docs/backend/06-sdk-message-structures.md)
- [API Reference](../../../docs/backend/api-reference.md)
- [Database Schema](../../../docs/common/03-database-schema.md)
- [Authentication](../../../docs/backend/authentication.md)

### Testing Framework Docs
- [Vitest](https://vitest.dev/)
- [Mock Service Worker (MSW)](https://mswjs.io/)
- [Supertest](https://github.com/ladjs/supertest)
- [Socket.IO Testing](https://socket.io/docs/v4/testing/)

### External Dependencies
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)
- [BullMQ](https://docs.bullmq.io/)
- [Socket.IO](https://socket.io/docs/v4/)
- [Azure MSAL](https://github.com/AzureAD/microsoft-authentication-library-for-js)

---

## 🎯 Success Metrics

### Quantitative Metrics
- [x] Test infrastructure complete (Vitest, MSW, Supertest installed)
- [ ] All existing tests passing (93/93)
- [ ] ≥70% overall coverage (from 14%)
- [ ] ≥80% coverage for critical services
- [ ] ≥448 total tests
- [ ] Test execution time <60 seconds
- [ ] Zero failing tests in CI/CD
- [ ] Documentation updated

### Qualitative Metrics
- [ ] Tests are maintainable (clear, well-organized)
- [ ] Tests are reliable (no flaky tests)
- [ ] Tests are fast (quick feedback loop)
- [ ] Tests provide confidence in refactoring
- [ ] Tests document expected behavior
- [ ] Tests catch regressions

---

## 🔄 Maintenance & CI/CD

### Pre-commit Hooks (Future)
```bash
# .husky/pre-commit
npm test
# Fail commit if tests fail
```

### CI/CD Pipeline (Future)
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### Coverage Badges (Future)
```markdown
[![Coverage](https://img.shields.io/codecov/c/github/your-org/bc-agent)](https://codecov.io/gh/your-org/bc-agent)
```

---

## 📝 Change Log

| Date | Phase | Change | Author |
|------|-------|--------|--------|
| 2025-11-19 | Phase 0 | Created master TODO.md | Claude Code |
| 2025-11-19 | Phase 1 | Started DirectAgentService.test.ts refactor | (pending) |

---

## ✅ Completion Checklist

### Phase 0: Documentation ✅
- [x] Master TODO.md created
- [x] Architecture documented
- [x] Roadmap defined

### Phase 1: Fix Existing Tests
- [ ] DirectAgentService.test.ts (11 tests passing)
- [ ] Baseline verified (93/93 tests passing)

### Phase 2: Critical Services
- [ ] EventStore.test.ts (~40 tests, 80%+ coverage)
- [ ] MessageQueue.test.ts (~35 tests, 80%+ coverage)
- [ ] ChatMessageHandler.test.ts (~25 tests, 75%+ coverage)
- [ ] MessageService.test.ts (~30 tests, 75%+ coverage)

### Phase 3: Auth & BC Integration
- [ ] MicrosoftOAuthService.test.ts (~30 tests, 70%+ coverage)
- [ ] BCTokenManager.test.ts (~25 tests, 80%+ coverage)
- [ ] BCClient.test.ts (~25 tests, 70%+ coverage)
- [ ] MCPService.test.ts (~20 tests, 70%+ coverage)

### Phase 4: Supporting Services
- [ ] TodoManager.test.ts (~20 tests, 75%+ coverage)
- [ ] SessionTitleGenerator.test.ts (~15 tests, 70%+ coverage)
- [ ] Utilities tests (~25 tests, 80%+ coverage)
- [ ] BCValidator.test.ts + others (~20 tests, 70%+ coverage)

### Phase 5: Integration Tests
- [ ] chat-flow.test.ts (~15 tests, 60%+ coverage)
- [ ] approval-flow.test.ts (~10 tests, 70%+ coverage)
- [ ] auth-flow.test.ts (~10 tests, 65%+ coverage)
- [ ] database-operations.test.ts (~10 tests, 70%+ coverage)

### Phase 6: Finalization
- [ ] docs/backend/README.md updated
- [ ] vitest.config.ts threshold set to 70%
- [ ] Final verification (448 tests passing, 70%+ coverage)
- [ ] Main TODO.md updated

---

**Last Updated**: 2025-11-19
**Next Review**: After Phase 1 completion
**Owner**: Development Team
**Priority**: 🔴 High (blocking Phase 3 features)
