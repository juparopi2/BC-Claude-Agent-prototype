# E2E Testing Guide

> **Status**: Updated 2025-12-02
> **Version**: 2.0 (Clean Architecture)

## Overview

This document describes the proper E2E testing approach for the BC-Claude-Agent project. The testing architecture uses **real infrastructure** (Azure SQL Database, Azure Redis Cache) in the DEV environment, ensuring tests reflect actual production behavior.

## Key Principles

### 1. No Backend Modifications for Testing

**CRITICAL**: The backend code should be identical for DEV, TEST, and PRODUCTION environments. We do NOT:

- ❌ Add test-specific middleware (e.g., `testAuth.ts`)
- ❌ Add mock authentication routes
- ❌ Use environment flags like `TEST_AUTH_ENABLED`
- ❌ Inject test tokens via headers

### 2. Real Infrastructure Testing

E2E tests use the same DEV infrastructure as manual development:

| Resource | DEV Environment |
|----------|-----------------|
| Database | `sqldb-bcagent-dev` on `sqlsrv-bcagent-dev.database.windows.net` |
| Redis | `redis-bcagent-dev.redis.cache.windows.net:6380` |
| Backend | `http://localhost:3002` (local) |
| Frontend | `http://localhost:3000` (local) |

### 3. Session Injection via Redis

Instead of bypassing authentication, we inject **valid sessions** directly into Redis:

1. **Global Setup** creates test user sessions in Redis
2. **Tests** use the session cookies to authenticate
3. **Same auth flow** as production - just pre-authenticated

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          E2E Test Flow                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Global Setup (runs once)                                        │
│     ├── Verify backend health                                        │
│     ├── Connect to Redis (DEV)                                       │
│     ├── Inject test sessions (sess:e2e-test-session-001)            │
│     └── Write session info to .e2e-sessions.json                    │
│                                                                      │
│  2. Test Execution                                                   │
│     ├── Read session info from .e2e-sessions.json                   │
│     ├── Set connect.sid cookie with session ID                      │
│     └── Make authenticated requests to backend                      │
│                                                                      │
│  3. Authentication Flow                                              │
│     ├── Backend receives connect.sid cookie                         │
│     ├── Express-session looks up session in Redis                   │
│     ├── Session contains microsoftOAuth with userId                 │
│     └── Request is authenticated (same as production!)              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Seed Test Data in DEV Database

Run the SQL seed script once to create test users, sessions, messages, and approvals:

```bash
# Using sqlcmd (Windows)
sqlcmd -S sqlsrv-bcagent-dev.database.windows.net \
  -d sqldb-bcagent-dev \
  -U bcagentadmin \
  -P <password> \
  -i e2e/setup/seed-database.sql \
  -C

# Or using npm script
npm run e2e:seed
```

This creates:

| Entity | ID | Description |
|--------|-----|-------------|
| `TEST_USER` | `e2e00001-0000-0000-0000-000000000001` | Primary test user (editor role) |
| `TEST_ADMIN_USER` | `e2e00002-0000-0000-0000-000000000002` | Admin user |
| Sessions | `e2e10001-*` to `e2e10006-*` | Various test sessions |
| Messages | `msg_e2e_*` | Pre-populated messages |
| Approvals | `e2e30001-*` to `e2e30003-*` | Pending, approved, rejected approvals |

### 2. Start Backend and Frontend

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

### 3. Run E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed
```

## Writing Tests

### Import Test Helpers

```typescript
import { test, expect } from '@playwright/test';
import {
  loginToApp,
  authenticateContext,
  createApiContext,
  connectSocket,
  waitForAgentEvent,
  getTestUserSession,
  TEST_SESSIONS,
  TEST_APPROVALS,
  TIMEOUTS,
} from '../setup/testHelpers';
```

### Browser-Based Tests

```typescript
test.describe('Chat Flow', () => {
  test.beforeEach(async ({ context }) => {
    // Authenticate the browser context
    await authenticateContext(context, 'test');
  });

  test('should display chat interface', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
  });

  test('should send and receive messages', async ({ page }) => {
    await loginToApp(page, 'test');

    // Type a message
    await page.fill('[data-testid="chat-input"]', 'Hello');
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await expect(page.locator('[data-testid="message-assistant"]')).toBeVisible({
      timeout: TIMEOUTS.long,
    });
  });
});
```

### API-Based Tests

```typescript
import { test, expect, APIRequestContext } from '@playwright/test';
import { createApiContext, TEST_SESSIONS } from '../setup/testHelpers';

test.describe('Sessions API', () => {
  let apiContext: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await createApiContext(playwright, 'test');
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('should list user sessions', async () => {
    const response = await apiContext.get('/api/chat/sessions');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('should get session with history', async () => {
    const response = await apiContext.get(`/api/chat/sessions/${TEST_SESSIONS.withHistory}/messages`);
    expect(response.ok()).toBeTruthy();

    const messages = await response.json();
    expect(messages.length).toBeGreaterThan(0);
  });
});
```

### WebSocket Tests

```typescript
import { test, expect } from '@playwright/test';
import {
  connectSocket,
  waitForAgentEvent,
  getTestUserSession,
  TEST_SESSIONS,
  TIMEOUTS,
} from '../setup/testHelpers';
import type { Socket } from 'socket.io-client';

test.describe('WebSocket Flow', () => {
  let socket: Socket;

  test.beforeAll(async () => {
    socket = await connectSocket('test');
  });

  test.afterAll(async () => {
    socket.disconnect();
  });

  test('should receive user_message_confirmed event', async () => {
    const userSession = getTestUserSession();

    // Start waiting for confirmation
    const confirmPromise = waitForAgentEvent(socket, 'user_message_confirmed', TIMEOUTS.medium);

    // Send message
    socket.emit('chat:message', {
      sessionId: TEST_SESSIONS.empty,
      userId: userSession.userId,
      message: 'Test message',
    });

    // Wait for confirmation
    const confirmation = await confirmPromise;
    expect(confirmation).toHaveProperty('type', 'user_message_confirmed');
  });
});
```

## Test Data Reference

### Users

| Constant | ID | Email | Role |
|----------|-----|-------|------|
| `TEST_USER` | `e2e00001-0000-0000-0000-000000000001` | `e2e-test@bcagent.test` | editor |
| `TEST_ADMIN_USER` | `e2e00002-0000-0000-0000-000000000002` | `e2e-admin@bcagent.test` | admin |

### Sessions

| Constant | ID | Description |
|----------|-----|-------------|
| `TEST_SESSIONS.empty` | `e2e10001-*` | Empty session (no messages) |
| `TEST_SESSIONS.withHistory` | `e2e10002-*` | Session with 4 messages |
| `TEST_SESSIONS.withToolUse` | `e2e10003-*` | Session with tool use messages |
| `TEST_SESSIONS.withApproval` | `e2e10004-*` | Session with approval records |
| `TEST_SESSIONS.deleted` | `e2e10005-*` | Soft-deleted session |
| `TEST_SESSIONS.adminSession` | `e2e10006-*` | Admin user's session |

### Approvals

| Constant | ID | Status |
|----------|-----|--------|
| `TEST_APPROVALS.pending` | `e2e30001-*` | Pending (expires in 5 min) |
| `TEST_APPROVALS.approved` | `e2e30002-*` | Approved |
| `TEST_APPROVALS.rejected` | `e2e30003-*` | Rejected |

## File Structure

```
e2e/
├── setup/
│   ├── globalSetup.ts       # Runs before all tests (session injection)
│   ├── testHelpers.ts       # Reusable test utilities
│   ├── seed-database.sql    # SQL to seed test data
│   └── .e2e-sessions.json   # Generated session info (gitignored)
├── fixtures/
│   ├── test-data.ts         # Test data constants
│   └── db-helpers.ts        # Database utilities
├── flows/
│   ├── chatFlow.spec.ts     # Chat flow E2E tests
│   └── approvalFlow.spec.ts # Approval flow E2E tests
└── scripts/
    ├── seed-test-data.ts    # npm run e2e:seed
    └── clean-test-data.ts   # npm run e2e:clean
```

## Troubleshooting

### "Session info file not found"

The global setup didn't run. Make sure:
1. Backend is running (`cd backend && npm run dev`)
2. Redis is accessible
3. Run tests with Playwright (`npm run test:e2e`)

### "Redis connection failed"

Check your connection to Azure Redis:
- Host: `redis-bcagent-dev.redis.cache.windows.net`
- Port: `6380` (TLS)
- Password: From `.env` or Key Vault

### "Authentication failed" in tests

1. Verify test user exists in database (run `seed-database.sql`)
2. Check session was injected in Redis (`sess:e2e-test-session-001`)
3. Verify cookie value is correct (`s:e2e-test-session-001`)

### Tests pass locally but fail in CI

Ensure CI has:
1. Access to Azure SQL (firewall rules)
2. Access to Azure Redis (connection string)
3. Environment variables set

## Best Practices

1. **Never modify backend for tests** - If you need to bypass something, you're testing the wrong thing
2. **Use real data** - Seed realistic test data that mirrors production scenarios
3. **Clean up after tests** - Use `test.afterAll` to clean up created data (or use fixed IDs that get overwritten)
4. **Use meaningful assertions** - Don't just check `response.ok()`, verify the actual data
5. **Handle async properly** - Always await WebSocket events, don't use arbitrary timeouts
6. **Test error cases** - Test what happens when things go wrong (invalid session, expired token, etc.)

## Related Documentation

- [Database Schema](./common/03-database-schema.md)
- [WebSocket Contract](./backend/websocket-contract.md)
- [Authentication Flow](./backend/authentication.md)
