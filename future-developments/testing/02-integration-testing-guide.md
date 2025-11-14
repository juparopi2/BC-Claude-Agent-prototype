# Integration Testing Guide

> **Document Status**: Phase 3 Implementation Guide
> **Framework**: Vitest + Supertest + Real Database
> **Last Updated**: 2025-11-14
> **Related**: `00-testing-strategy.md`, `01-unit-testing-guide.md`

---

## Table of Contents

1. [Integration Testing Overview](#integration-testing-overview)
2. [Test Environment Setup](#test-environment-setup)
3. [API Integration Tests](#api-integration-tests)
4. [Database Integration Tests](#database-integration-tests)
5. [WebSocket Integration Tests](#websocket-integration-tests)
6. [Authentication Integration Tests](#authentication-integration-tests)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Integration Testing Overview

**Definition**: Integration tests verify that multiple components work together correctly (API → Service → Database).

**Scope**:
- API endpoints (HTTP + WebSocket)
- Service layer integration
- Database transactions
- Authentication flows
- Agent execution with MCP

**Key Differences from Unit Tests**:

| Aspect | Unit Tests | Integration Tests |
|--------|------------|-------------------|
| **Scope** | Single function/component | Multiple components |
| **Dependencies** | Mocked | Real (or test doubles) |
| **Database** | Mocked | Real test database |
| **Speed** | Fast (<1s) | Slower (1-5s per test) |
| **Isolation** | Complete | Partial |

---

## Test Environment Setup

### Test Database Setup

**Option 1: Separate Test Database** (Recommended)

Create a dedicated test database in Azure SQL:

```bash
# Azure CLI
az sql db create \
  --resource-group rg-BCAgentPrototype-app-dev \
  --server sqlsrv-bcagent-dev \
  --name sqldb-bcagent-test \
  --edition Basic \
  --capacity 5
```

**Option 2: In-Memory SQLite** (Faster, but less realistic)

```bash
npm install --save-dev --save-exact better-sqlite3@11.8.1
```

---

### Environment Variables for Testing

**Create `.env.test`**:
```env
# Test environment
NODE_ENV=test
PORT=3999  # Different from dev port

# Test database (Azure SQL)
DATABASE_URL=sqlsrv-bcagent-dev.database.windows.net
DATABASE_NAME=sqldb-bcagent-test
DATABASE_USER=bcagentadmin
DATABASE_PASSWORD=<test-password>

# Test Redis (optional, can use ioredis-mock)
REDIS_URL=redis://localhost:6379/1  # DB 1 for tests

# Mock secrets
ANTHROPIC_API_KEY=test-api-key-12345
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
SESSION_SECRET=test-session-secret-67890

# Microsoft OAuth (mock)
MICROSOFT_CLIENT_ID=test-client-id
MICROSOFT_CLIENT_SECRET=test-client-secret
MICROSOFT_TENANT_ID=test-tenant-id
```

**Load in tests**:
```typescript
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });
```

---

### Database Migration for Tests

**Script**: `backend/scripts/reset-test-db.ts`

```typescript
import { sql } from '../src/config/database';
import fs from 'fs';
import path from 'path';

async function resetTestDatabase() {
  try {
    console.log('🗑️  Dropping all tables...');

    // Drop tables in reverse dependency order
    const dropQueries = [
      'DROP TABLE IF EXISTS todos',
      'DROP TABLE IF EXISTS approvals',
      'DROP TABLE IF EXISTS messages',
      'DROP TABLE IF EXISTS checkpoints',
      'DROP TABLE IF EXISTS audit_log',
      'DROP TABLE IF EXISTS agent_executions',
      'DROP TABLE IF EXISTS sessions',
      'DROP TABLE IF EXISTS users'
    ];

    for (const query of dropQueries) {
      await sql.query(query);
    }

    console.log('✅ All tables dropped');

    console.log('📋 Running init-db.sql...');
    const initScript = fs.readFileSync(
      path.join(__dirname, 'init-db.sql'),
      'utf-8'
    );

    // Split by GO statements and execute
    const statements = initScript.split(/\nGO\n/i);
    for (const statement of statements) {
      if (statement.trim()) {
        await sql.query(statement);
      }
    }

    console.log('✅ Test database reset complete');
  } catch (error) {
    console.error('❌ Test database reset failed:', error);
    process.exit(1);
  }
}

resetTestDatabase();
```

**Run before tests**:
```bash
npm run test:db:reset
```

---

### Supertest Setup

**Install**:
```bash
npm install --save-dev --save-exact supertest@7.0.0
npm install --save-dev --save-exact @types/supertest@6.0.2
```

**Usage**:
```typescript
import request from 'supertest';
import { app } from '@/server';  // Express app (not server.listen())

describe('API Integration Tests', () => {
  it('should return 200 OK', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
  });
});
```

---

## API Integration Tests

### Test Directory Structure

```
backend/src/
├── __tests__/
│   ├── integration/
│   │   ├── auth.integration.test.ts
│   │   ├── sessions.integration.test.ts
│   │   ├── agent.integration.test.ts
│   │   ├── approvals.integration.test.ts
│   │   └── websocket.integration.test.ts
│   └── fixtures/
│       ├── users.fixture.ts
│       ├── sessions.fixture.ts
│       └── messages.fixture.ts
```

---

### Example 1: Authentication Integration Test

**File**: `backend/src/__tests__/integration/auth.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '@/server';
import { sql } from '@/config/database';
import { createTestUser, cleanupTestUsers } from '../fixtures/users.fixture';

describe('Authentication Integration', () => {
  let testUserId: string;

  beforeAll(async () => {
    // Ensure database is connected
    await sql.connect();
  });

  afterAll(async () => {
    // Cleanup
    await cleanupTestUsers();
    await sql.close();
  });

  beforeEach(async () => {
    // Create test user
    testUserId = await createTestUser({
      email: 'test@example.com',
      display_name: 'Test User',
      role: 'editor'
    });
  });

  describe('GET /api/auth/status', () => {
    it('should return 401 when not authenticated', async () => {
      // Act
      const response = await request(app).get('/api/auth/status');

      // Assert
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return user when authenticated', async () => {
      // Arrange - Login first to get session cookie
      const agent = request.agent(app);  // Persist cookies

      // Mock OAuth callback (simplified for test)
      await agent.post('/api/auth/test/login').send({ userId: testUserId });

      // Act
      const response = await agent.get('/api/auth/status');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.id).toBe(testUserId);
      expect(response.body.user.email).toBe('test@example.com');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear session and return 200', async () => {
      // Arrange
      const agent = request.agent(app);
      await agent.post('/api/auth/test/login').send({ userId: testUserId });

      // Act
      const response = await agent.post('/api/auth/logout');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Logged out');

      // Verify session is cleared
      const statusResponse = await agent.get('/api/auth/status');
      expect(statusResponse.status).toBe(401);
    });
  });

  describe('OAuth Flow Integration', () => {
    it('should redirect to Microsoft OAuth', async () => {
      // Act
      const response = await request(app).get('/api/auth/login');

      // Assert
      expect(response.status).toBe(302);
      expect(response.header.location).toContain('login.microsoftonline.com');
    });

    // Note: Full OAuth flow requires mocking Microsoft API
    // See mocks/microsoft-oauth.mock.ts for details
  });
});
```

**Key Takeaways**:
- ✅ Use `request.agent(app)` to persist cookies across requests
- ✅ Create test users with fixtures
- ✅ Cleanup test data in `afterAll()`
- ✅ Test both authenticated and unauthenticated scenarios

---

### Example 2: Sessions CRUD Integration Test

**File**: `backend/src/__tests__/integration/sessions.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '@/server';
import { sql } from '@/config/database';
import { createTestUser, authenticateTestUser } from '../fixtures/users.fixture';

describe('Sessions CRUD Integration', () => {
  let agent: any;
  let testUserId: string;
  let authCookie: string;

  beforeAll(async () => {
    await sql.connect();
  });

  afterAll(async () => {
    await sql.close();
  });

  beforeEach(async () => {
    // Create and authenticate test user
    testUserId = await createTestUser({
      email: 'sessions-test@example.com',
      display_name: 'Sessions Test User'
    });

    agent = request.agent(app);
    authCookie = await authenticateTestUser(agent, testUserId);
  });

  describe('POST /api/chat/sessions', () => {
    it('should create new session', async () => {
      // Arrange
      const sessionData = {
        goal: 'Test session goal'
      };

      // Act
      const response = await agent
        .post('/api/chat/sessions')
        .send(sessionData)
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title');
      expect(response.body.user_id).toBe(testUserId);
      expect(response.body.goal).toBe('Test session goal');
      expect(response.body.status).toBe('active');
      expect(response.body.is_active).toBe(true);

      // Verify in database
      const result = await sql.query(`
        SELECT * FROM sessions WHERE id = '${response.body.id}'
      `);
      expect(result.recordset).toHaveLength(1);
    });

    it('should create session with auto-generated title', async () => {
      // Act
      const response = await agent
        .post('/api/chat/sessions')
        .send({})  // No goal
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.title).toMatch(/Session \d+/);  // Auto-generated
    });

    it('should return 401 when not authenticated', async () => {
      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ goal: 'Test' });

      // Assert
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/chat/sessions/:sessionId', () => {
    it('should get session by ID', async () => {
      // Arrange - Create session first
      const createResponse = await agent
        .post('/api/chat/sessions')
        .send({ goal: 'Get session test' })
        .set('Cookie', authCookie);

      const sessionId = createResponse.body.id;

      // Act
      const response = await agent
        .get(`/api/chat/sessions/${sessionId}`)
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(sessionId);
      expect(response.body.goal).toBe('Get session test');
    });

    it('should return 404 for non-existent session', async () => {
      // Act
      const response = await agent
        .get('/api/chat/sessions/non-existent-id')
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 403 when accessing other user session', async () => {
      // Arrange - Create session with another user
      const otherUserId = await createTestUser({
        email: 'other@example.com'
      });

      const otherAgent = request.agent(app);
      const otherCookie = await authenticateTestUser(otherAgent, otherUserId);

      const createResponse = await otherAgent
        .post('/api/chat/sessions')
        .send({ goal: 'Other user session' })
        .set('Cookie', otherCookie);

      const sessionId = createResponse.body.id;

      // Act - Try to access with first user
      const response = await agent
        .get(`/api/chat/sessions/${sessionId}`)
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/chat/sessions/:sessionId', () => {
    it('should delete session and cascade to messages', async () => {
      // Arrange - Create session and messages
      const createResponse = await agent
        .post('/api/chat/sessions')
        .send({ goal: 'Delete test' })
        .set('Cookie', authCookie);

      const sessionId = createResponse.body.id;

      // Insert test messages
      await sql.query(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES
          (NEWID(), '${sessionId}', 'user', 'Hello', GETDATE()),
          (NEWID(), '${sessionId}', 'assistant', 'Hi', GETDATE())
      `);

      // Act
      const response = await agent
        .delete(`/api/chat/sessions/${sessionId}`)
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);

      // Verify session deleted
      const sessionResult = await sql.query(`
        SELECT * FROM sessions WHERE id = '${sessionId}'
      `);
      expect(sessionResult.recordset).toHaveLength(0);

      // Verify messages cascade deleted
      const messagesResult = await sql.query(`
        SELECT * FROM messages WHERE session_id = '${sessionId}'
      `);
      expect(messagesResult.recordset).toHaveLength(0);
    });
  });

  describe('GET /api/chat/sessions/:sessionId/messages', () => {
    it('should get messages with pagination', async () => {
      // Arrange - Create session with 10 messages
      const createResponse = await agent
        .post('/api/chat/sessions')
        .send({ goal: 'Pagination test' })
        .set('Cookie', authCookie);

      const sessionId = createResponse.body.id;

      for (let i = 0; i < 10; i++) {
        await sql.query(`
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (NEWID(), '${sessionId}', 'user', 'Message ${i}', GETDATE())
        `);
      }

      // Act - Get first 5 messages
      const response = await agent
        .get(`/api/chat/sessions/${sessionId}/messages?limit=5&offset=0`)
        .set('Cookie', authCookie);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(5);
      expect(response.body[0]).toHaveProperty('content');
    });
  });
});
```

**Key Takeaways**:
- ✅ Test all CRUD operations (Create, Read, Update, Delete)
- ✅ Test authorization (403 when accessing other user's data)
- ✅ Test cascade deletes (sessions → messages)
- ✅ Test pagination for list endpoints

---

### Example 3: Agent Execution Integration Test

**File**: `backend/src/__tests__/integration/agent.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, io } from '@/server';
import { sql } from '@/config/database';
import { createTestUser, authenticateTestUser } from '../fixtures/users.fixture';
import { Client as SocketClient } from 'socket.io-client';

// Mock Anthropic API
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'This is a mocked response from the agent.'
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 }
      })
    }
  }))
}));

describe('Agent Execution Integration', () => {
  let agent: any;
  let testUserId: string;
  let sessionId: string;
  let socketClient: SocketClient;

  beforeAll(async () => {
    await sql.connect();
  });

  afterAll(async () => {
    socketClient?.disconnect();
    await sql.close();
  });

  beforeEach(async () => {
    // Setup authenticated user and session
    testUserId = await createTestUser({ email: 'agent-test@example.com' });
    agent = request.agent(app);
    await authenticateTestUser(agent, testUserId);

    // Create session
    const sessionResponse = await agent.post('/api/chat/sessions').send({});
    sessionId = sessionResponse.body.id;

    // Connect socket client
    socketClient = new SocketClient('http://localhost:3999', {
      transports: ['websocket']
    });

    await new Promise((resolve) => {
      socketClient.on('connect', resolve);
    });
  });

  describe('Agent Query via WebSocket', () => {
    it('should execute query and stream response', async () => {
      // Arrange
      const messages: any[] = [];

      socketClient.on('agent:message_chunk', (chunk) => {
        messages.push(chunk);
      });

      socketClient.on('agent:response_complete', () => {
        // Query complete
      });

      // Act
      socketClient.emit('chat:message', {
        sessionId,
        content: 'What is Business Central?'
      });

      // Wait for response
      await new Promise((resolve) => {
        socketClient.on('agent:response_complete', resolve);
      });

      // Assert
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some(m => m.content.includes('mocked response'))).toBe(true);

      // Verify messages saved to DB
      const result = await sql.query(`
        SELECT * FROM messages WHERE session_id = '${sessionId}'
      `);
      expect(result.recordset.length).toBeGreaterThanOrEqual(2);  // User + Assistant
    });

    it('should handle agent error gracefully', async () => {
      // Arrange - Mock error
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      (Anthropic as any).mockImplementationOnce(() => ({
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API error'))
        }
      }));

      let errorReceived = false;
      socketClient.on('agent:error', () => {
        errorReceived = true;
      });

      // Act
      socketClient.emit('chat:message', {
        sessionId,
        content: 'Trigger error'
      });

      // Wait for error
      await new Promise((resolve) => {
        socketClient.on('agent:error', resolve);
      });

      // Assert
      expect(errorReceived).toBe(true);
    });
  });

  describe('Agent with Tool Use', () => {
    it('should execute MCP tool and return result', async () => {
      // Arrange
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      (Anthropic as any).mockImplementationOnce(() => ({
        messages: {
          create: vi.fn()
            .mockResolvedValueOnce({  // First call: tool use
              id: 'msg_tool',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'bc_list_all_entities',
                  input: {}
                }
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 50, output_tokens: 30 }
            })
            .mockResolvedValueOnce({  // Second call: tool result processed
              id: 'msg_result',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'Found 52 entities in Business Central.'
                }
              ],
              stop_reason: 'end_turn',
              usage: { input_tokens: 80, output_tokens: 40 }
            })
        }
      }));

      const toolUses: any[] = [];
      socketClient.on('agent:tool_use', (tool) => {
        toolUses.push(tool);
      });

      // Act
      socketClient.emit('chat:message', {
        sessionId,
        content: 'List all entities'
      });

      await new Promise((resolve) => {
        socketClient.on('agent:response_complete', resolve);
      });

      // Assert
      expect(toolUses.length).toBeGreaterThan(0);
      expect(toolUses[0].name).toBe('bc_list_all_entities');
    });
  });
});
```

**Key Takeaways**:
- ✅ Test WebSocket integration (real-time streaming)
- ✅ Mock Anthropic API for predictable responses
- ✅ Test agent error handling
- ✅ Test tool use flow (tool request → execution → result)

---

## Database Integration Tests

### Example 4: Transaction Handling

**File**: `backend/src/__tests__/integration/database.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/config/database';

describe('Database Integration', () => {
  beforeAll(async () => {
    await sql.connect();
  });

  afterAll(async () => {
    await sql.close();
  });

  describe('Connection Retry Logic', () => {
    it('should reconnect after connection loss', async () => {
      // Arrange - Verify connection
      const beforeResult = await sql.query('SELECT 1 as result');
      expect(beforeResult.recordset[0].result).toBe(1);

      // Act - Simulate connection loss (close connection)
      await sql.close();

      // Reconnect
      await sql.connect();

      // Assert - Query should work again
      const afterResult = await sql.query('SELECT 1 as result');
      expect(afterResult.recordset[0].result).toBe(1);
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback on error', async () => {
      // Arrange
      const transaction = await sql.transaction();

      try {
        await transaction.begin();

        // Insert user
        await transaction.request().query(`
          INSERT INTO users (id, email, display_name, role, created_at, updated_at)
          VALUES (NEWID(), 'rollback-test@example.com', 'Rollback Test', 'viewer', GETDATE(), GETDATE())
        `);

        // Simulate error (invalid SQL)
        await transaction.request().query('INVALID SQL STATEMENT');

        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
      }

      // Assert - User should NOT exist (rolled back)
      const result = await sql.query(`
        SELECT * FROM users WHERE email = 'rollback-test@example.com'
      `);
      expect(result.recordset).toHaveLength(0);
    });
  });

  describe('Cascade Delete Constraints', () => {
    it('should cascade delete messages when session deleted', async () => {
      // Arrange - Create user, session, messages
      const userResult = await sql.query(`
        INSERT INTO users (id, email, display_name, role, created_at, updated_at)
        OUTPUT INSERTED.id
        VALUES (NEWID(), 'cascade-test@example.com', 'Cascade Test', 'editor', GETDATE(), GETDATE())
      `);
      const userId = userResult.recordset[0].id;

      const sessionResult = await sql.query(`
        INSERT INTO sessions (id, user_id, title, status, is_active, created_at, updated_at)
        OUTPUT INSERTED.id
        VALUES (NEWID(), '${userId}', 'Test Session', 'active', 1, GETDATE(), GETDATE())
      `);
      const sessionId = sessionResult.recordset[0].id;

      await sql.query(`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES
          (NEWID(), '${sessionId}', 'user', 'Hello', GETDATE()),
          (NEWID(), '${sessionId}', 'assistant', 'Hi', GETDATE())
      `);

      // Act - Delete session
      await sql.query(`DELETE FROM sessions WHERE id = '${sessionId}'`);

      // Assert - Messages should be cascade deleted
      const messagesResult = await sql.query(`
        SELECT * FROM messages WHERE session_id = '${sessionId}'
      `);
      expect(messagesResult.recordset).toHaveLength(0);

      // Cleanup
      await sql.query(`DELETE FROM users WHERE id = '${userId}'`);
    });
  });
});
```

**Key Takeaways**:
- ✅ Test connection retry logic
- ✅ Test transaction rollback on error
- ✅ Test cascade delete constraints (FK)
- ✅ Cleanup test data after each test

---

## Best Practices

### 1. Test Isolation

Each test should be independent:

```typescript
beforeEach(async () => {
  // Create fresh test data
  testUserId = await createTestUser();
  sessionId = await createTestSession(testUserId);
});

afterEach(async () => {
  // Cleanup test data
  await cleanupTestSession(sessionId);
  await cleanupTestUser(testUserId);
});
```

---

### 2. Use Fixtures for Test Data

**File**: `backend/src/__tests__/fixtures/users.fixture.ts`

```typescript
import { sql } from '@/config/database';
import crypto from 'crypto';

export async function createTestUser(overrides = {}) {
  const defaultUser = {
    id: crypto.randomUUID(),
    email: `test-${Date.now()}@example.com`,
    display_name: 'Test User',
    role: 'editor',
    created_at: new Date(),
    updated_at: new Date()
  };

  const user = { ...defaultUser, ...overrides };

  await sql.query(`
    INSERT INTO users (id, email, display_name, role, created_at, updated_at)
    VALUES ('${user.id}', '${user.email}', '${user.display_name}', '${user.role}', GETDATE(), GETDATE())
  `);

  return user.id;
}

export async function cleanupTestUsers() {
  await sql.query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
}
```

---

### 3. Test Real Error Scenarios

```typescript
it('should handle database connection timeout', async () => {
  // Simulate timeout by closing connection
  await sql.close();

  // Attempt query (should retry and fail)
  await expect(
    sql.query('SELECT 1')
  ).rejects.toThrow(/connection/i);

  // Reconnect for other tests
  await sql.connect();
});
```

---

### 4. Verify Database State

```typescript
it('should save message to database', async () => {
  // Act
  await sendMessage(sessionId, 'Hello');

  // Assert - Verify in DB
  const result = await sql.query(`
    SELECT * FROM messages WHERE session_id = '${sessionId}' AND content = 'Hello'
  `);

  expect(result.recordset).toHaveLength(1);
  expect(result.recordset[0].role).toBe('user');
});
```

---

## Troubleshooting

### Issue 1: "Connection pool exhausted"

**Problem**: Too many concurrent database connections

**Solution**: Limit test parallelism:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    maxConcurrency: 5,  // Limit concurrent tests
    pool: 'forks'       // Use process pool
  }
});
```

---

### Issue 2: "Test data not cleaned up"

**Problem**: Tests fail due to leftover data

**Solution**: Add global cleanup:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: './src/__tests__/global-setup.ts'
  }
});

// global-setup.ts
export async function setup() {
  // Reset database before all tests
  await resetTestDatabase();
}

export async function teardown() {
  // Final cleanup
  await cleanupAllTestData();
}
```

---

### Issue 3: "Supertest request hangs"

**Problem**: Server not responding

**Solution**: Ensure server exports app separately:
```typescript
// server.ts
export const app = express();  // Export app
// ...
if (require.main === module) {
  app.listen(PORT);  // Only listen if run directly
}
```

---

## Next Steps

1. ✅ **Read this guide** - Understand integration testing
2. [ ] **Review E2E testing guide** (`03-e2e-testing-guide.md`)
3. [ ] **Setup test database** (Azure SQL test schema)
4. [ ] **Write first integration test** (auth.integration.test.ts)
5. [ ] **Run tests** (`npm run test:integration`)

---

**Document Version**: 1.0
**Related Documents**:
- `00-testing-strategy.md` - Overall strategy
- `01-unit-testing-guide.md` - Vitest unit tests
- `03-e2e-testing-guide.md` - Playwright E2E tests
- `04-edge-cases-catalog.md` - Edge cases to test
- `05-ci-cd-pipeline.md` - CI/CD automation
