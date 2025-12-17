# E2E Testing Guide

## Table of Contents

1. [Overview](#overview)
2. [How to Run Tests](#how-to-run-tests)
3. [Test Infrastructure](#test-infrastructure)
4. [Test Coverage](#test-coverage)
5. [Writing New E2E Tests](#writing-new-e2e-tests)
6. [Debugging Failed Tests](#debugging-failed-tests)
7. [CI/CD Integration](#cicd-integration)

---

## Overview

### What are E2E Tests?

End-to-End (E2E) tests validate the complete backend system by simulating a real client application. Unlike unit tests (single functions) or integration tests (multiple components), E2E tests exercise:

- **Full HTTP request/response cycle** (Express middleware, routing, controllers)
- **WebSocket connections** (Socket.IO with session authentication)
- **Database persistence** (Azure SQL with real transactions)
- **Redis caching** (Session storage, rate limiting)
- **Agent orchestration** (DirectAgentService with FakeAnthropicClient)

### Why E2E Tests?

E2E tests provide confidence that:
- ✅ REST APIs work as documented (52 endpoints)
- ✅ WebSocket events stream correctly (12+ event types)
- ✅ Golden flows execute end-to-end (5 critical scenarios)
- ✅ Multi-tenant isolation is enforced
- ✅ Error handling works across the stack

### E2E vs Integration vs Unit

| Aspect | Unit Tests | Integration Tests | E2E Tests |
|--------|-----------|-------------------|-----------|
| **Scope** | Single function | Multiple services | Full system |
| **Dependencies** | Mocked | Real + Some mocks | Real (except Claude API) |
| **Speed** | Fast (~ms) | Medium (~100ms) | Slow (~1-5s) |
| **Isolation** | Complete | Partial | Minimal |
| **Purpose** | Logic correctness | Service interaction | User flows |

**Example**:
- **Unit**: Test `createSession(userId, title)` returns correct session object
- **Integration**: Test `SessionService` + `EventStore` + Database persistence
- **E2E**: Test `POST /api/sessions` → creates session → returns 201 → persists to DB

---

## How to Run Tests

### Prerequisites

1. **Redis running** (required for sessions):
   ```bash
   # Start test Redis in Docker
   docker compose -f docker-compose.test.yml up -d
   ```

2. **Database access** (Azure SQL):
   - Ensure `.env` has valid `DATABASE_*` credentials
   - Database must be accessible from your network

3. **Environment variables**:
   ```bash
   # Required in backend/.env
   DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
   DATABASE_NAME=sqldb-bcagent-dev
   DATABASE_USER=bcagent-admin
   DATABASE_PASSWORD=<your-password>
   REDIS_TEST_HOST=localhost
   REDIS_TEST_PORT=6399
   ```

### Run Commands

#### Mock Mode (Default, Fast, CI-Ready)

```bash
# Run all E2E tests with mock Claude API
cd backend
npm run test:e2e

# Run with interactive UI (best for debugging)
npm run test:e2e:ui

# Run specific test file
npm run test:e2e -- auth.api.test.ts

# Run with verbose output
npm run test:e2e -- --reporter=verbose

# Generate HTML report only
npm run test:e2e -- --reporter=html
```

#### Real API Mode (Pre-Release Validation)

```bash
# Run with real Claude API (requires valid ANTHROPIC_API_KEY)
E2E_USE_REAL_API=true npm run test:e2e

# Warning: This will consume Claude API credits!
# Only use for final validation before production deployment
```

### Understanding Test Output

**Vitest Verbose Reporter**:
```
✓ backend/src/__tests__/e2e/api/health.api.test.ts (2 tests) 234ms
  ✓ GET /health returns 200 OK with system status (123ms)
  ✓ GET /health/detailed returns database and Redis status (111ms)

✓ backend/src/__tests__/e2e/websocket/connection.ws.test.ts (5 tests) 1.2s
  ✓ Client can connect to Socket.IO server (456ms)
  ✓ Session authentication validates connect.sid cookie (234ms)
  ...
```

**HTML Report** (`backend/test-results/e2e-report.html`):
- Visual test results with pass/fail status
- Detailed error messages and stack traces
- Test duration and performance metrics
- Filterable by test suite or status

---

## Test Infrastructure

### Core Test Helpers

#### 1. E2ETestClient

**Location**: `backend/src/__tests__/e2e/helpers/E2ETestClient.ts`

**Purpose**: Unified client for HTTP + WebSocket testing. Simulates a real frontend application.

**Key Features**:
- HTTP requests with session cookie management
- WebSocket connection with automatic authentication
- Event stream capturing for `agent:event` types
- Multi-tenant isolation (userId + sessionId scoped)

**Usage**:
```typescript
import { E2ETestClient } from '../helpers/E2ETestClient';

const client = new E2ETestClient();
await client.connect();

// HTTP request (session cookie auto-attached)
const response = await client.get('/api/sessions');

// WebSocket event listener
const events: AgentEvent[] = [];
client.onEvent('message_chunk', (event) => events.push(event));

// Send WebSocket message
await client.sendMessage('Hello Claude', sessionId, userId);

// Wait for specific event type
const completeEvent = await client.waitForEvent('complete', 5000);

await client.disconnect();
```

#### 2. GoldenResponses

**Location**: `backend/src/__tests__/e2e/helpers/GoldenResponses.ts`

**Purpose**: Pre-configured FakeAnthropicClient response patterns for the 5 golden flows.

**Golden Flows**:
1. **Simple text response** - Basic conversational exchange
2. **Extended thinking** - Claude using thinking blocks before responding
3. **Tool use (read)** - Claude executing BC entity queries
4. **Approval flow (write)** - Claude requesting user approval for mutations
5. **Error handling** - API errors and graceful degradation

**Usage**:
```typescript
import { configureSimpleTextResponse } from '../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';

const fakeClient = new FakeAnthropicClient();
configureSimpleTextResponse(fakeClient);

// Now DirectAgentService will use this pre-configured response
const service = new DirectAgentService(undefined, undefined, fakeClient);
```

**Why Golden Responses?**
- ✅ Consistent test data across all E2E tests
- ✅ No external Claude API dependency (fast, free)
- ✅ Deterministic outputs (no flaky tests)
- ✅ CI/CD compatible (mock mode default)

#### 3. TestDataFactory

**Location**: `backend/src/__tests__/e2e/helpers/TestDataFactory.ts`

**Purpose**: Factory for creating test sessions, users, and messages.

**Usage**:
```typescript
import { TestDataFactory } from '../helpers/TestDataFactory';

// Create authenticated test session
const { userId, sessionId } = await TestDataFactory.createAuthenticatedSession();

// Create test user with specific attributes
const user = await TestDataFactory.createTestUser({
  email: 'test@example.com',
  displayName: 'Test User',
});

// Create test session with title
const session = await TestDataFactory.createTestSession(userId, 'My Chat');
```

#### 4. TestSessionFactory

**Location**: `backend/src/__tests__/e2e/helpers/TestSessionFactory.ts`

**Purpose**: Helper for managing test session lifecycle (create, authenticate, cleanup).

**Usage**:
```typescript
import { TestSessionFactory } from '../helpers/TestSessionFactory';

const sessionFactory = new TestSessionFactory();

// Setup authenticated session for test
const { userId, sessionId, cookie } = await sessionFactory.createAuthenticatedSession();

// Cleanup after test
await sessionFactory.cleanup();
```

### Test File Organization

```
backend/src/__tests__/e2e/
├── helpers/
│   ├── E2ETestClient.ts         # HTTP + WebSocket unified client
│   ├── GoldenResponses.ts       # Pre-configured mock responses
│   ├── TestDataFactory.ts       # Test data creation utilities
│   └── TestSessionFactory.ts    # Session lifecycle management
├── api/                         # REST endpoint tests
│   ├── health.api.test.ts       # 3 tests - Health check endpoints
│   ├── auth.api.test.ts         # 10 tests - OAuth login/logout/profile
│   ├── sessions.api.test.ts     # ~20 tests - CRUD + list + search
│   ├── files.api.test.ts        # 20 tests - Upload, download, CRUD
│   ├── billing.api.test.ts      # 16 tests - Plans, subscriptions, payments
│   ├── token-usage.api.test.ts  # 17 tests - Token tracking and aggregation
│   ├── usage.api.test.ts        # 12 tests - Usage analytics
│   ├── logs.api.test.ts         # 9 tests - Query logs with filters
│   └── gdpr.api.test.ts         # 8 tests - Data export, deletion, portability
├── websocket/                   # WebSocket event tests
│   ├── connection.ws.test.ts    # Connection, authentication, disconnection
│   ├── session-rooms.ws.test.ts # Socket.IO rooms (join/leave/broadcast)
│   ├── events.ws.test.ts        # 12+ agent:event types
│   └── error-handling.ws.test.ts # Error propagation via WebSocket
└── flows/                       # Golden flow tests
    ├── 01-authentication.e2e.test.ts      # Auth flow
    ├── 02-session-management.e2e.test.ts  # Session lifecycle
    ├── 03-message-flow-basic.e2e.test.ts  # Simple message
    ├── 04-streaming-flow.e2e.test.ts      # Message streaming
    ├── 05-extended-thinking.e2e.test.ts   # Golden flow #2
    ├── 06-tool-execution.e2e.test.ts      # Golden flow #3
    ├── 07-approval-flow.e2e.test.ts       # Golden flow #4
    ├── 09-session-recovery.e2e.test.ts    # Reconnection
    ├── 10-multi-tenant-isolation.e2e.test.ts # Security
    └── 11-error-handling.e2e.test.ts      # Golden flow #5
```

---

## Test Coverage

### REST API Coverage (52 Endpoints)

| Category | Endpoints | Test File | Tests | Status |
|----------|-----------|-----------|-------|--------|
| **Health** | 3 | `health.api.test.ts` | 3 | ✅ Complete |
| **Auth** | 6 | `auth.api.test.ts` | 10 | ✅ Complete |
| **Sessions** | 6 | `sessions.api.test.ts` | ~20 | ✅ Complete |
| **Files** | 9 | `files.api.test.ts` | 20 | ✅ Complete |
| **Billing** | 7 | `billing.api.test.ts` | 16 | ✅ Complete |
| **Token Usage** | 6 | `token-usage.api.test.ts` | 17 | ✅ Complete |
| **Usage** | 5 | `usage.api.test.ts` | 12 | ✅ Complete |
| **Logs** | 1 | `logs.api.test.ts` | 9 | ✅ Complete |
| **GDPR** | 3 | `gdpr.api.test.ts` | 8 | ✅ Complete |
| **Messaging** | 6 | `flows/*.e2e.test.ts` | Integrated | ✅ Complete |
| **TOTAL** | **52** | 9 test files | **115+** | ✅ Complete |

### WebSocket Event Coverage (12+ Event Types)

| Event Type | Description | Test File | Status |
|------------|-------------|-----------|--------|
| `session_start` | Agent session begins | `events.ws.test.ts` | ✅ |
| `thinking` | Extended thinking mode | `events.ws.test.ts` | ✅ |
| `message_chunk` | Streaming text delta | `events.ws.test.ts` | ✅ |
| `message` | Complete message | `events.ws.test.ts` | ✅ |
| `tool_use` | Tool execution request | `events.ws.test.ts` | ✅ |
| `tool_result` | Tool execution result | `events.ws.test.ts` | ✅ |
| `approval_requested` | User approval needed | `events.ws.test.ts` | ✅ |
| `approval_resolved` | Approval response | `events.ws.test.ts` | ✅ |
| `complete` | Agent finished | `events.ws.test.ts` | ✅ |
| `error` | Error occurred | `error-handling.ws.test.ts` | ✅ |
| `user_message_confirmed` | User message persisted | `events.ws.test.ts` | ✅ |
| `reconnect` / `disconnect` | Connection lifecycle | `connection.ws.test.ts` | ✅ |

### Golden Flow Coverage (5 Critical Scenarios)

| Golden Flow | Test File | Description | Status |
|-------------|-----------|-------------|--------|
| 1. Simple Text | `03-message-flow-basic.e2e.test.ts` | Basic conversational exchange | ✅ |
| 2. Extended Thinking | `05-extended-thinking.e2e.test.ts` | Thinking blocks before response | ✅ |
| 3. Tool Use (Read) | `06-tool-execution.e2e.test.ts` | BC entity queries | ✅ |
| 4. Approval Flow (Write) | `07-approval-flow.e2e.test.ts` | Human-in-the-loop approval | ✅ |
| 5. Error Handling | `11-error-handling.e2e.test.ts` | Graceful error propagation | ✅ |

### Multi-Tenant Isolation

| Test Scenario | Test File | Status |
|---------------|-----------|--------|
| User A cannot access User B's sessions | `10-multi-tenant-isolation.e2e.test.ts` | ✅ |
| User A cannot read User B's messages | `10-multi-tenant-isolation.e2e.test.ts` | ✅ |
| User A cannot join User B's WebSocket rooms | `10-multi-tenant-isolation.e2e.test.ts` | ✅ |
| Rate limiting per userId + sessionId | `10-multi-tenant-isolation.e2e.test.ts` | ✅ |

---

## Writing New E2E Tests

### Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { E2ETestClient } from '../helpers/E2ETestClient';
import { TestDataFactory } from '../helpers/TestDataFactory';

describe('E2E: Your Feature Name', () => {
  let client: E2ETestClient;
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    client = new E2ETestClient();
    await client.connect();

    // Create authenticated test session
    const session = await TestDataFactory.createAuthenticatedSession();
    userId = session.userId;
    sessionId = session.sessionId;
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('should do something meaningful', async () => {
    // Arrange - Setup test data
    const testData = { /* ... */ };

    // Act - Execute the operation
    const response = await client.post('/api/your-endpoint', testData);

    // Assert - Verify results
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      // Expected response structure
    });
  });

  it('should handle errors gracefully', async () => {
    // Test error scenarios
    const response = await client.post('/api/your-endpoint', { invalid: 'data' });

    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });
});
```

### Best Practices

#### 1. Use Descriptive Test Names

```typescript
// ❌ Bad
it('should work', async () => { /* ... */ });

// ✅ Good
it('should create session and return 201 with session ID', async () => { /* ... */ });
```

#### 2. Test Both Success and Error Cases

```typescript
describe('POST /api/sessions', () => {
  it('should create session with valid data', async () => { /* ... */ });
  it('should return 400 when title is missing', async () => { /* ... */ });
  it('should return 401 when not authenticated', async () => { /* ... */ });
  it('should return 403 when accessing another user\'s session', async () => { /* ... */ });
});
```

#### 3. Use Factories for Test Data

```typescript
// ❌ Bad - Hardcoded test data
const userId = '123';
const sessionId = '456';

// ✅ Good - Factory-generated data
const { userId, sessionId } = await TestDataFactory.createAuthenticatedSession();
```

#### 4. Assert on Meaningful Properties

```typescript
// ❌ Bad - Too broad
expect(response.data).toBeDefined();

// ✅ Good - Specific assertions
expect(response.data).toMatchObject({
  id: expect.any(String),
  title: 'My Session',
  userId: userId,
  createdAt: expect.any(String),
});
```

#### 5. Test Multi-Tenant Isolation

```typescript
it('should not allow User A to access User B\'s sessions', async () => {
  // Create User A's session
  const userA = await TestDataFactory.createAuthenticatedSession();

  // Create User B's session
  const userB = await TestDataFactory.createAuthenticatedSession();

  // User A tries to access User B's session
  const response = await client.get(`/api/sessions/${userB.sessionId}`, {
    headers: { Cookie: userA.cookie },
  });

  expect(response.status).toBe(403);
});
```

#### 6. Use Golden Responses for Agent Tests

```typescript
import { configureSimpleTextResponse } from '../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';

it('should stream message events via WebSocket', async () => {
  // Configure golden response
  const fakeClient = new FakeAnthropicClient();
  configureSimpleTextResponse(fakeClient);

  // Capture events
  const events: AgentEvent[] = [];
  client.onEvent('message_chunk', (event) => events.push(event));

  // Send message
  await client.sendMessage('Hello', sessionId, userId);

  // Wait for completion
  await client.waitForEvent('complete', 5000);

  // Assert on event sequence
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].type).toBe('message_chunk');
});
```

### Anti-Patterns to Avoid

❌ **Don't test implementation details**:
```typescript
// Bad - testing internal service methods
expect(sessionService.internalMethod).toHaveBeenCalled();
```

❌ **Don't rely on test execution order**:
```typescript
// Bad - assumes previous test ran
it('should update session', async () => {
  // Depends on session created in previous test
});
```

❌ **Don't hardcode wait times**:
```typescript
// Bad - arbitrary sleep
await new Promise(resolve => setTimeout(resolve, 1000));

// Good - wait for specific event
await client.waitForEvent('complete', 5000);
```

❌ **Don't mix unit and E2E test concerns**:
```typescript
// Bad - mocking internal services in E2E test
vi.mock('@/services/SessionService');

// Good - use real services, only mock external APIs (Claude)
```

---

## Debugging Failed Tests

### 1. Use Interactive UI

```bash
cd backend
npm run test:e2e:ui
```

**Benefits**:
- Visual test execution timeline
- Click to re-run individual tests
- Filter by test name or status
- Detailed error messages with stack traces

### 2. Enable Verbose Logging

```bash
# Run with verbose reporter
npm run test:e2e -- --reporter=verbose

# Run with debug logs (if supported by test)
DEBUG=* npm run test:e2e
```

### 3. Inspect HTML Report

After running tests, open the generated HTML report:

```bash
# Report location
open backend/test-results/e2e-report.html
```

**What to look for**:
- Test duration (identify slow tests)
- Error messages and stack traces
- Failed assertion details
- Test execution order

### 4. Check Database State

If tests fail due to data issues:

```bash
# Connect to test database
sqlcmd -S sqlsrv-bcagent-dev.database.windows.net -d sqldb-bcagent-dev -U bcagent-admin -P <password>

# Query recent test sessions
SELECT TOP 10 * FROM sessions WHERE title LIKE '%test%' ORDER BY created_at DESC;

# Query recent messages
SELECT TOP 10 * FROM messages ORDER BY created_at DESC;
```

### 5. Check Redis State

If tests fail due to session issues:

```bash
# Connect to test Redis
redis-cli -h localhost -p 6399

# List all keys
KEYS *

# Inspect session data
GET sess:test-session-id

# Check rate limit counters
KEYS rate_limit:*
```

### 6. Isolate Failing Test

```bash
# Run only the failing test file
npm run test:e2e -- auth.api.test.ts

# Run single test by name
npm run test:e2e -- -t "should create session"
```

### 7. Common Issues and Solutions

#### Issue: Tests timeout waiting for events

**Cause**: WebSocket event listener not configured before sending message.

**Solution**:
```typescript
// ❌ Bad - listener registered after message sent
await client.sendMessage('Hello', sessionId, userId);
client.onEvent('complete', (event) => { /* ... */ });

// ✅ Good - listener registered first
const completePromise = client.waitForEvent('complete', 5000);
await client.sendMessage('Hello', sessionId, userId);
await completePromise;
```

#### Issue: Multi-tenant isolation tests fail

**Cause**: Test sessions sharing the same userId.

**Solution**:
```typescript
// ❌ Bad - same user for both sessions
const userA = await TestDataFactory.createAuthenticatedSession();
const userB = await TestDataFactory.createAuthenticatedSession(); // Same user!

// ✅ Good - create separate users
const userA = await TestDataFactory.createTestUser({ email: 'a@test.com' });
const userB = await TestDataFactory.createTestUser({ email: 'b@test.com' });
const sessionA = await TestDataFactory.createTestSession(userA.id, 'Session A');
const sessionB = await TestDataFactory.createTestSession(userB.id, 'Session B');
```

#### Issue: Golden responses not working

**Cause**: FakeAnthropicClient not injected into DirectAgentService.

**Solution**:
```typescript
// ❌ Bad - using real Anthropic client
const service = new DirectAgentService();

// ✅ Good - inject FakeAnthropicClient
const fakeClient = new FakeAnthropicClient();
configureSimpleTextResponse(fakeClient);
const service = new DirectAgentService(undefined, undefined, fakeClient);
```

#### Issue: Tests pass locally but fail in CI

**Cause**: Environment variable differences or network access.

**Solution**:
1. Check `.github/workflows/test.yml` environment variables
2. Ensure Redis service container is running in CI
3. Verify database firewall rules allow GitHub Actions IPs
4. Check for hardcoded localhost URLs (should use env vars)

---

## CI/CD Integration

### GitHub Actions Workflow

**Location**: `.github/workflows/test.yml`

**Job Name**: `e2e-tests`

**Runs After**: `backend-integration-tests`

### How E2E Tests Run in CI

1. **Setup Redis** - Spins up Redis 7 service container (port 6399)
2. **Install dependencies** - Runs `npm ci` in backend directory
3. **Wait for Redis** - Health check ensures Redis is ready
4. **Run tests** - Executes `npm run test:e2e` with mock mode
5. **Upload artifacts** - Uploads HTML report to GitHub Actions artifacts

### Environment Variables in CI

```yaml
env:
  E2E_USE_REAL_API: false              # Mock mode (no Claude API calls)
  E2E_TEST: true                       # Flag for E2E test mode
  NODE_ENV: test                       # Test environment
  REDIS_TEST_HOST: localhost           # Redis service container
  REDIS_TEST_PORT: 6399                # Mapped Redis port
  DATABASE_SERVER: ${{ secrets.DATABASE_SERVER }}
  DATABASE_NAME: ${{ secrets.DATABASE_NAME }}
  DATABASE_USER: ${{ secrets.DATABASE_USER }}
  DATABASE_PASSWORD: ${{ secrets.DATABASE_PASSWORD }}
  MICROSOFT_CLIENT_ID: mock-client-id  # Mock OAuth (not used in tests)
  MICROSOFT_CLIENT_SECRET: mock-client-secret
  SESSION_SECRET: test-secret-key-for-ci
  ENCRYPTION_KEY: dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw==
  ANTHROPIC_API_KEY: mock-api-key      # Not used in mock mode
```

### Downloading Test Reports from CI

1. **Navigate to GitHub Actions**:
   - Go to your repository on GitHub
   - Click "Actions" tab
   - Select the workflow run

2. **Find E2E Test Job**:
   - Scroll to "E2E Tests" job
   - Click to expand details

3. **Download Artifacts**:
   - Scroll to "Artifacts" section at bottom
   - Click "e2e-test-report" to download ZIP
   - Extract and open `e2e-report.html` in browser

### Interpreting CI Test Results

**Green Checkmark** ✅:
- All E2E tests passed
- 52 REST endpoints working
- 12+ WebSocket events streaming correctly
- 5 golden flows validated
- Safe to merge PR

**Red X** ❌:
- One or more E2E tests failed
- Check test report artifact for details
- Review logs for error messages
- Debug locally before pushing fix

### CI Best Practices

1. **Always run E2E tests before merging to main**
2. **Review HTML report artifacts for failed runs**
3. **Don't skip E2E tests to "go faster" - they catch critical bugs**
4. **Update golden responses when API contract changes**
5. **Add new E2E tests for new endpoints or WebSocket events**

---

## Summary

E2E tests provide comprehensive validation of the BC Claude Agent backend:

- ✅ **52 REST endpoints** tested across 9 API categories
- ✅ **12+ WebSocket event types** validated for streaming
- ✅ **5 golden flows** ensuring critical user scenarios work end-to-end
- ✅ **Multi-tenant isolation** enforced and tested
- ✅ **CI/CD integrated** with mock mode for fast, reliable automation
- ✅ **HTML reports** for visual debugging and historical analysis

**When to write E2E tests**:
- New REST API endpoints
- New WebSocket event types
- New golden flows or critical user scenarios
- Major refactoring (as safety net)
- Bug fixes (regression prevention)

**When NOT to write E2E tests**:
- Pure utility functions (use unit tests)
- Internal service methods (use integration tests)
- Database query logic (use integration tests with test DB)

---

**Questions?** Check the example test files:
- `backend/src/__tests__/e2e/api/health.api.test.ts` - Simple REST endpoint test
- `backend/src/__tests__/e2e/websocket/events.ws.test.ts` - WebSocket event test
- `backend/src/__tests__/e2e/flows/03-message-flow-basic.e2e.test.ts` - Golden flow test
