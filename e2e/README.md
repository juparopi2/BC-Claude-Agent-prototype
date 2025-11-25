# E2E Testing Guide

End-to-end tests for BC Claude Agent using Playwright and API-only testing strategy.

## Quick Start

```bash
# 1. Install dependencies (from root)
npm install

# 2. Seed test data
npm run e2e:seed

# 3. Run E2E tests
npm run test:e2e
```

## Prerequisites

### Database Connection

E2E tests require a connection to the Azure SQL database. Configuration is loaded from `backend/.env`:

```env
DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
DATABASE_NAME=sqldb-bcagent-dev
DATABASE_USER=bcagentadmin
DATABASE_PASSWORD=<your-password>
```

### Backend Server

For API tests, the backend must be running:

```bash
cd backend && npm run dev
```

The backend runs on `http://localhost:3002` by default.

## Test Data Management

### Seeding Test Data

Creates deterministic test data in the database:

```bash
npm run e2e:seed
```

This creates:
- **2 test users**: `e2e-test@bcagent.test` (editor), `e2e-admin@bcagent.test` (admin)
- **6 test sessions**: Empty, with history, with tools, with approval, deleted, admin
- **8 test messages**: Conversation history and tool use examples
- **3 test approvals**: Pending, approved, rejected

### Cleaning Test Data

Removes all E2E test data (safe - only removes data with `e2e` prefix):

```bash
npm run e2e:clean
```

### Data Identification

All E2E test data uses specific patterns for safe identification:
- **User IDs**: `e2e00001-...`, `e2e00002-...`
- **User emails**: `*@bcagent.test`
- **Session IDs**: `e2e10001-...`, `e2e10002-...`
- **Message IDs**: `msg_e2e_user_*`, `msg_e2e_asst_*`
- **Approval IDs**: `e2e30001-...`

## Running Tests

### All Tests

```bash
npm run test:e2e
```

### Specific Browser

```bash
npm run test:e2e:chromium
npm run test:e2e:firefox
```

### With UI (Interactive)

```bash
npm run test:e2e:ui
```

### With Browser Visible

```bash
npm run test:e2e:headed
```

### Debug Mode

```bash
npm run test:e2e:debug
```

## Test Structure

```
e2e/
├── README.md                    # This file
├── fixtures/
│   ├── test-data.ts             # Test constants (users, sessions, messages)
│   └── db-helpers.ts            # Database seed/clean functions
├── scripts/
│   ├── seed-test-data.ts        # npm run e2e:seed
│   └── clean-test-data.ts       # npm run e2e:clean
├── support/                     # (TODO: Phase F1-002)
│   ├── api-client.ts            # REST API helper
│   ├── ws-client.ts             # WebSocket helper
│   └── assertions.ts            # Custom assertions
└── example.spec.ts              # Example test (placeholder)
```

## Writing Tests

### API-Only Strategy

Since there's no frontend, tests interact directly with:
1. **REST API** - For CRUD operations
2. **WebSocket** - For real-time events (chat, approvals)

### Test Data Constants

Import from `fixtures/test-data.ts`:

```typescript
import {
  TEST_USER,
  TEST_SESSIONS,
  TEST_MESSAGES,
  API_ENDPOINTS,
  WS_EVENTS,
} from './fixtures/test-data';

test('should get session messages', async ({ request }) => {
  const response = await request.get(
    API_ENDPOINTS.messages(TEST_SESSIONS.withHistory.id)
  );

  expect(response.ok()).toBe(true);
  const messages = await response.json();
  expect(messages.length).toBeGreaterThan(0);
});
```

### Database Helpers

For custom test scenarios:

```typescript
import {
  createTestSession,
  deleteTestSession,
  getSessionMessages,
} from './fixtures/db-helpers';

test('should create dynamic session', async () => {
  const sessionId = await createTestSession(TEST_USER.id, 'My Test Session');

  // ... test logic ...

  // Cleanup
  await deleteTestSession(sessionId);
});
```

## Test Categories

### Planned Test Suites (Phase 2)

| Suite | Description | Priority |
|-------|-------------|----------|
| `auth/` | OAuth flow, session management | HIGH |
| `chat/` | Sessions, messages, streaming | HIGH |
| `approvals/` | Human-in-the-loop flow | MEDIUM |
| `api/` | REST endpoint validation | HIGH |
| `websocket/` | Real-time event handling | HIGH |

## Timeouts

Default timeouts (configurable in `fixtures/test-data.ts`):

| Operation | Timeout |
|-----------|---------|
| Short (UI actions) | 5s |
| Medium (API calls) | 15s |
| Long (Claude responses) | 60s |
| Extra Long (approval flows) | 120s |

## CI Integration

E2E tests are configured in `.github/workflows/test.yml` but currently **disabled** pending:
- Mock authentication setup for CI
- Database access from GitHub runners

To enable, uncomment the `e2e-tests` job in the workflow file.

## Troubleshooting

### Database Connection Errors

```
Error: Database configuration missing
```

**Solution**: Ensure `backend/.env` exists with valid credentials.

### Test Data Not Found

```
Warning: Test user not found
```

**Solution**: Run `npm run e2e:seed` to create test data.

### Tests Hanging

Check if backend is running:
```bash
curl http://localhost:3002/api/health
```

### Cleanup Stuck Data

If tests leave orphaned data:
```bash
npm run e2e:clean
```

## Development Workflow

1. **Before PR**: Run `npm run e2e:seed && npm run test:e2e`
2. **After schema changes**: Update `fixtures/test-data.ts` and `db-helpers.ts`
3. **Adding new test data**: Use `e2e` prefix for all IDs

## Related Documentation

- [DIAGNOSTIC-AND-TESTING-PLAN.md](../docs/DIAGNOSTIC-AND-TESTING-PLAN.md) - Full testing strategy
- [Backend WebSocket Contract](../docs/backend/websocket-contract.md) - Event schemas
- [Database Schema](../docs/common/03-database-schema.md) - Table definitions
