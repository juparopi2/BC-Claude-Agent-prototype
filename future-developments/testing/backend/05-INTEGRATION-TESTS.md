# PRD 05: Integration Tests - End-to-End Flows

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Author**: Claude Code (Anthropic)
**Status**: Active
**Implementation Time**: 20 hours

---

## Executive Summary

Integration tests validate complete flows across multiple services. Unlike unit tests (mock dependencies), integration tests use real services with minimal mocking.

**3 Critical Flows**:
1. Auth Flow (Login → Session → BC Consent) - 6 hours
2. Agent Execution (Message → Tool → Response) - 8 hours
3. WebSocket (Connection → Streaming → Disconnect) - 6 hours

**Total**: 20 tests, 20 hours

---

## Test Infrastructure Setup

### Database Setup (In-Memory SQLite)

```typescript
// __tests__/integration/setup/database.ts
import Database from 'better-sqlite3';

export function setupTestDatabase() {
  const db = new Database(':memory:');

  // Run migrations
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      bc_access_token_encrypted TEXT,
      bc_refresh_token_encrypted TEXT,
      bc_token_expires_at DATETIME
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      stop_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- Additional tables...
  `);

  return db;
}
```

### Redis Setup (Real Redis via Docker)

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  redis-test:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    command: redis-server --maxmemory 256mb
```

```typescript
// __tests__/integration/setup/redis.ts
import { Redis } from 'ioredis';

export function setupTestRedis() {
  return new Redis({
    host: 'localhost',
    port: 6380,
    db: 1 // Use separate DB for tests
  });
}
```

---

## Part 1: Auth Flow Integration (6 hours)

### Test 1: Complete Login Flow

```typescript
it('should complete full login flow: login → oauth → session', async () => {
  // Arrange: Mock Microsoft OAuth endpoints
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      });
    }),
    http.get('https://graph.microsoft.com/v1.0/me', () => {
      return HttpResponse.json({
        id: 'user-123',
        displayName: 'John Doe',
        mail: 'john.doe@contoso.com'
      });
    })
  );

  // Act: Step 1 - Get auth URL
  const response1 = await request(app)
    .get('/api/auth/login')
    .expect(302);

  const authUrl = response1.headers.location;
  expect(authUrl).toContain('login.microsoftonline.com');

  // Act: Step 2 - OAuth callback with code
  const response2 = await request(app)
    .get('/api/auth/callback?code=auth-code-123&state=test-state')
    .expect(302);

  // Assert: Redirected to frontend with session
  expect(response2.headers.location).toBe('http://localhost:3000');
  expect(response2.headers['set-cookie']).toBeDefined();

  // Assert: Session created in Redis
  const sessionCookie = response2.headers['set-cookie'][0];
  const sessionId = sessionCookie.match(/connect\.sid=([^;]+)/)[1];

  const redisSession = await redis.get(`sess:${sessionId}`);
  expect(redisSession).toBeTruthy();

  // Assert: User created in database
  const user = await db.get('SELECT * FROM users WHERE email = ?',
    ['john.doe@contoso.com']);
  expect(user).toBeDefined();
  expect(user.display_name).toBe('John Doe');
});
```

### Test 2: BC Consent Flow

```typescript
it('should handle BC consent flow and acquire BC token', async () => {
  // Arrange: User already logged in
  const user = await createTestUser(db, {
    email: 'user@test.com',
    refreshToken: 'refresh-token-123'
  });

  // Mock BC token endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token',
      async ({ request }) => {
        const body = await request.text();
        if (body.includes('https://api.businesscentral.dynamics.com')) {
          return HttpResponse.json({
            access_token: 'bc-token-abc',
            expires_in: 3600
          });
        }
      })
  );

  // Act: Request BC consent
  const response = await request(app)
    .post('/api/auth/bc-consent')
    .set('Cookie', await createSessionCookie(user.id))
    .expect(200);

  // Assert: BC token acquired and encrypted
  const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  expect(updatedUser.bc_access_token_encrypted).toBeTruthy();
  expect(updatedUser.bc_token_expires_at).toBeTruthy();

  // Assert: Token can be decrypted
  const decrypted = bcTokenManager.decrypt(updatedUser.bc_access_token_encrypted);
  expect(decrypted).toBe('bc-token-abc');
});
```

### Test 3: Token Refresh End-to-End

```typescript
it('should auto-refresh expired token during API call', async () => {
  // Arrange: User with expired token
  const user = await createTestUser(db, {
    email: 'user@test.com',
    bcAccessToken: 'expired-token',
    bcTokenExpiresAt: new Date(Date.now() - 1000) // Already expired
  });

  // Mock refresh endpoint
  server.use(
    http.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => {
      return HttpResponse.json({
        access_token: 'new-bc-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600
      });
    })
  );

  // Act: Make API call that requires BC token
  const response = await request(app)
    .get('/api/sessions')
    .set('Cookie', await createSessionCookie(user.id))
    .expect(200);

  // Assert: Token refreshed automatically
  const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  const decrypted = bcTokenManager.decrypt(updatedUser.bc_access_token_encrypted);
  expect(decrypted).toBe('new-bc-token');

  // Assert: Request succeeded (not 401)
  expect(response.status).toBe(200);
});
```

### Test 4: Logout and Session Cleanup

```typescript
it('should logout and cleanup session from Redis', async () => {
  // Arrange: User logged in
  const user = await createTestUser(db);
  const sessionCookie = await createSessionCookie(user.id);
  const sessionId = extractSessionId(sessionCookie);

  // Verify session exists
  const session = await redis.get(`sess:${sessionId}`);
  expect(session).toBeTruthy();

  // Act: Logout
  await request(app)
    .post('/api/auth/logout')
    .set('Cookie', sessionCookie)
    .expect(200);

  // Assert: Session removed from Redis
  const deletedSession = await redis.get(`sess:${sessionId}`);
  expect(deletedSession).toBeNull();

  // Assert: Cookie cleared
  const response = await request(app)
    .get('/api/sessions')
    .set('Cookie', sessionCookie)
    .expect(401);

  expect(response.body.error).toContain('Unauthorized');
});
```

**Auth Flow Summary**: 4 tests, 6 hours

---

## Part 2: Agent Execution Integration (8 hours)

### Test 5: User Message → Agent → Tool → Response

```typescript
it('should process user message through full agent pipeline', async () => {
  // Arrange: User and session
  const user = await createTestUser(db);
  const session = await createTestSession(db, user.id);

  // Mock Anthropic SDK
  anthropicMock.messages.create.mockResolvedValueOnce({
    id: 'msg-1',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tool-1', name: 'list_all_entities',
      input: { entityType: 'customer' } }],
    stop_reason: 'tool_use'
  }).mockResolvedValueOnce({
    id: 'msg-2',
    role: 'assistant',
    content: [{ type: 'text', text: 'Found 10 customers: ...' }],
    stop_reason: 'end_turn'
  });

  // Mock MCP server
  server.use(
    http.post('http://localhost:3003/mcp', () => {
      return HttpResponse.json({
        result: [
          { name: 'Customer 1', id: 'cust-1' },
          { name: 'Customer 2', id: 'cust-2' }
        ]
      });
    })
  );

  // Act: Send user message
  const response = await request(app)
    .post(`/api/sessions/${session.id}/messages`)
    .set('Cookie', await createSessionCookie(user.id))
    .send({ content: 'List all customers' })
    .expect(200);

  // Assert: Message created
  expect(response.body.message.role).toBe('user');
  expect(response.body.message.content).toBe('List all customers');

  // Wait for agent processing (async via BullMQ)
  await waitForJobCompletion(messageQueue, 'message-persistence');

  // Assert: Assistant response persisted
  const messages = await db.all(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at',
    [session.id]
  );

  expect(messages).toHaveLength(3); // User + Tool use + Final response
  expect(messages[0].role).toBe('user');
  expect(messages[1].role).toBe('assistant');
  expect(messages[1].stop_reason).toBe('tool_use');
  expect(messages[2].role).toBe('assistant');
  expect(messages[2].stop_reason).toBe('end_turn');
  expect(messages[2].content).toContain('Found 10 customers');
});
```

### Test 6: Approval Flow End-to-End

```typescript
it('should handle approval flow: request → user approve → tool execute', async () => {
  // Arrange
  const user = await createTestUser(db);
  const session = await createTestSession(db, user.id);

  // Mock write operation (requires approval)
  anthropicMock.messages.create.mockResolvedValue({
    id: 'msg-write',
    role: 'assistant',
    content: [{
      type: 'tool_use',
      id: 'tool-write',
      name: 'build_knowledge_base_workflow',
      input: { entityType: 'customer', operation: 'CREATE' }
    }],
    stop_reason: 'tool_use'
  });

  let approvalRequestEmitted = null;

  // Setup WebSocket listener
  const socket = io('http://localhost:3002', {
    auth: { sessionId: session.id }
  });

  socket.on('approval:requested', (data) => {
    approvalRequestEmitted = data;
  });

  // Act: Send message that triggers write operation
  await request(app)
    .post(`/api/sessions/${session.id}/messages`)
    .set('Cookie', await createSessionCookie(user.id))
    .send({ content: 'Create customer workflow' })
    .expect(200);

  // Wait for approval request
  await waitFor(() => approvalRequestEmitted !== null);

  // Assert: Approval request created
  expect(approvalRequestEmitted).toBeDefined();
  expect(approvalRequestEmitted.toolName).toBe('build_knowledge_base_workflow');

  const approval = await db.get(
    'SELECT * FROM approvals WHERE id = ?',
    [approvalRequestEmitted.approvalId]
  );
  expect(approval.status).toBe('pending');

  // Act: User approves
  await request(app)
    .post(`/api/approvals/${approval.id}/respond`)
    .set('Cookie', await createSessionCookie(user.id))
    .send({ approved: true })
    .expect(200);

  // Wait for tool execution
  await waitForJobCompletion(messageQueue, 'tool-execution');

  // Assert: Approval marked as approved
  const updatedApproval = await db.get('SELECT * FROM approvals WHERE id = ?',
    [approval.id]);
  expect(updatedApproval.status).toBe('approved');

  // Assert: Tool executed (check tool_calls table or logs)
  socket.disconnect();
});
```

### Test 7: Event Sourcing (Message → Events → BullMQ → DB)

```typescript
it('should persist events through event sourcing pipeline', async () => {
  // Arrange
  const user = await createTestUser(db);
  const session = await createTestSession(db, user.id);

  // Act: Send message
  await request(app)
    .post(`/api/sessions/${session.id}/messages`)
    .set('Cookie', await createSessionCookie(user.id))
    .send({ content: 'Test message' })
    .expect(200);

  // Wait for event store append
  await new Promise(resolve => setTimeout(resolve, 100));

  // Assert: Event appended to message_events
  const events = await db.all(
    'SELECT * FROM message_events WHERE session_id = ? ORDER BY sequence_number',
    [session.id]
  );

  expect(events.length).toBeGreaterThan(0);

  // Assert: Sequence numbers are consecutive
  events.forEach((event, index) => {
    expect(event.sequence_number).toBe(index + 1);
  });

  // Assert: Events can be replayed
  const replayedState = await eventStore.replay(session.id);
  expect(replayedState.events).toHaveLength(events.length);
});
```

**Agent Execution Summary**: 3 tests (more detailed tests available), 8 hours

---

## Part 3: WebSocket Integration (6 hours)

### Test 8: Connection → Room Join → Streaming

```typescript
it('should connect, join room, and stream agent events', async (done) => {
  // Arrange
  const user = await createTestUser(db);
  const session = await createTestSession(db, user.id);

  const receivedEvents: any[] = [];

  // Act: Connect to WebSocket
  const socket = io('http://localhost:3002', {
    auth: { sessionId: session.id }
  });

  socket.on('connect', () => {
    expect(socket.connected).toBe(true);

    // Join room
    socket.emit('join', { sessionId: session.id });
  });

  socket.on('agent:event', (event) => {
    receivedEvents.push(event);
  });

  // Trigger agent message (should stream events)
  await request(app)
    .post(`/api/sessions/${session.id}/messages`)
    .set('Cookie', await createSessionCookie(user.id))
    .send({ content: 'Test streaming' })
    .expect(200);

  // Wait for streaming to complete
  setTimeout(() => {
    // Assert: Multiple events received
    expect(receivedEvents.length).toBeGreaterThan(0);

    // Assert: Events in order
    receivedEvents.forEach((event, index) => {
      expect(event.sequenceNumber).toBe(index + 1);
    });

    // Assert: Event types correct
    const eventTypes = receivedEvents.map(e => e.type);
    expect(eventTypes).toContain('thinking');
    expect(eventTypes).toContain('message_chunk');
    expect(eventTypes).toContain('complete');

    socket.disconnect();
    done();
  }, 2000);
});
```

### Test 9: Disconnect → Reconnect → Resume

```typescript
it('should handle disconnect and resume streaming on reconnect', async () => {
  const session = await createTestSession(db);

  // Connect
  let socket = io('http://localhost:3002', {
    auth: { sessionId: session.id }
  });

  await waitForEvent(socket, 'connect');

  // Disconnect
  socket.disconnect();
  expect(socket.connected).toBe(false);

  // Wait 1 second
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Reconnect
  socket = io('http://localhost:3002', {
    auth: { sessionId: session.id }
  });

  await waitForEvent(socket, 'connect');

  // Assert: Reconnected successfully
  expect(socket.connected).toBe(true);

  // Assert: Can send/receive events
  const events: any[] = [];
  socket.on('agent:event', (event) => events.push(event));

  // Trigger event
  await directAgentService.processMessage(session.id, 'Test');

  await waitFor(() => events.length > 0);
  expect(events.length).toBeGreaterThan(0);

  socket.disconnect();
});
```

### Test 10: Event Ordering Preserved

```typescript
it('should preserve event ordering via sequenceNumber', async () => {
  const session = await createTestSession(db);
  const socket = io('http://localhost:3002', {
    auth: { sessionId: session.id }
  });

  await waitForEvent(socket, 'connect');

  const receivedEvents: any[] = [];
  socket.on('agent:event', (event) => receivedEvents.push(event));

  // Act: Send message that generates 20+ events
  await directAgentService.processMessage(session.id, 'Complex query');

  // Wait for all events
  await waitFor(() => receivedEvents.length >= 10);

  // Assert: Events ordered by sequenceNumber
  for (let i = 0; i < receivedEvents.length - 1; i++) {
    expect(receivedEvents[i].sequenceNumber).toBeLessThan(
      receivedEvents[i + 1].sequenceNumber
    );
  }

  // Assert: No gaps in sequence numbers
  receivedEvents.forEach((event, index) => {
    expect(event.sequenceNumber).toBe(index + 1);
  });

  socket.disconnect();
});
```

**WebSocket Summary**: 3 tests, 6 hours

---

## Implementation Checklist

### Setup (2 hours)
- [ ] Docker Compose for Redis test instance
- [ ] In-memory SQLite setup with migrations
- [ ] MSW server for external APIs
- [ ] Helper functions (createTestUser, createSession, etc.)

### Auth Flow Tests (6 hours)
- [ ] Test 1: Login flow (1.5 hours)
- [ ] Test 2: BC consent (1.5 hours)
- [ ] Test 3: Token refresh (1.5 hours)
- [ ] Test 4: Logout (1.5 hours)

### Agent Execution Tests (8 hours)
- [ ] Test 5: Full agent pipeline (3 hours)
- [ ] Test 6: Approval flow (3 hours)
- [ ] Test 7: Event sourcing (2 hours)

### WebSocket Tests (6 hours)
- [ ] Test 8: Connection + streaming (2 hours)
- [ ] Test 9: Disconnect/reconnect (2 hours)
- [ ] Test 10: Event ordering (2 hours)

---

**End of PRD 05: Integration Tests**
