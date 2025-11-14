# Edge Cases Catalog

> **Document Status**: Phase 3 Reference Document
> **Total Edge Cases**: 46 documented cases
> **Last Updated**: 2025-11-14
> **Related**: `00-testing-strategy.md`, `01-unit-testing-guide.md`

---

## Table of Contents

1. [Agent Interaction Edge Cases](#agent-interaction-edge-cases)
2. [Database Edge Cases](#database-edge-cases)
3. [Authentication Edge Cases](#authentication-edge-cases)
4. [WebSocket Edge Cases](#websocket-edge-cases)
5. [Frontend State Edge Cases](#frontend-state-edge-cases)
6. [MCP Integration Edge Cases](#mcp-integration-edge-cases)
7. [Approval System Edge Cases](#approval-system-edge-cases)

---

## Agent Interaction Edge Cases

### 1. Infinite Loop (Max Turns Exceeded)

**Scenario**: Agent keeps calling tools in a loop without reaching end_turn.

**Current Handling**: `maxTurns: 20` limit in DirectAgentService

**Risk**: LOW (limit prevents infinite loops)

**Test Priority**: MEDIUM

**Test File**: `DirectAgentService.test.ts`

**Test**:
```typescript
it('should enforce max turns limit (20)', async () => {
  // Mock infinite tool use loop
  mockAnthropicCreate.mockResolvedValue({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'bc_list_all_entities' }]
  });

  await expect(service.executeQuery(prompt, sessionId)).rejects.toThrow(
    /Max turns limit reached/i
  );

  expect(mockAnthropicCreate).toHaveBeenCalledTimes(20);
});
```

---

### 2. Tool Execution Timeout

**Scenario**: Tool call hangs indefinitely (e.g., MCP server not responding).

**Current Handling**: NO timeout configured

**Risk**: HIGH

**Test Priority**: HIGH

**Mitigation**: Add timeout to tool execution

**Test**:
```typescript
it('should timeout tool execution after 30s', async () => {
  vi.useFakeTimers();

  // Mock hanging tool
  mockToolExecute.mockImplementation(() => new Promise(() => {}));  // Never resolves

  const promise = service.executeTool('bc_get_entity_details', {});

  vi.advanceTimersByTime(30000);

  await expect(promise).rejects.toThrow(/Tool execution timeout/i);

  vi.useRealTimers();
});
```

---

### 3. MCP Server Down

**Scenario**: MCP server health check fails, tools unavailable.

**Current Handling**: Health check warns, agent continues in read-only mode

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should handle MCP server unavailable', async () => {
  // Mock MCP health check failure
  mockMCPHealth.mockRejectedValue(new Error('Connection refused'));

  const result = await service.executeQuery('List all entities', sessionId);

  expect(result.warnings).toContain('MCP server unavailable');
  expect(result.toolUses).toHaveLength(0);  // No tools executed
});
```

---

### 4. Malformed Tool Response

**Scenario**: MCP tool returns invalid JSON or unexpected format.

**Current Handling**: NO validation

**Risk**: HIGH

**Test Priority**: HIGH

**Mitigation**: Add Zod schema validation for tool responses

**Test**:
```typescript
it('should handle malformed tool response', async () => {
  mockToolExecute.mockResolvedValue('INVALID JSON{]');  // Bad JSON

  await expect(
    service.executeTool('bc_list_all_entities', {})
  ).rejects.toThrow(/Invalid tool response/i);
});
```

---

### 5. Approval Expires During Tool Execution

**Scenario**: User doesn't respond to approval within 5 minutes.

**Current Handling**: Promise rejects, tool execution cancels

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should cancel tool execution when approval times out', async () => {
  vi.useFakeTimers();

  const promise = service.executeQuery('Create customer', sessionId);

  // Fast-forward 5 minutes
  vi.advanceTimersByTime(5 * 60 * 1000);

  await expect(promise).rejects.toThrow(/Approval timeout/i);

  vi.useRealTimers();
});
```

---

### 6. Concurrent Queries in Same Session

**Scenario**: User sends multiple messages before first completes.

**Current Handling**: NO queue, race condition possible

**Risk**: HIGH

**Test Priority**: CRITICAL

**Mitigation**: Implement BullMQ request queue (Phase 4)

**Test**:
```typescript
it('should queue concurrent queries', async () => {
  const promise1 = service.executeQuery('Query 1', sessionId);
  const promise2 = service.executeQuery('Query 2', sessionId);

  const [result1, result2] = await Promise.all([promise1, promise2]);

  // Should execute sequentially, not concurrently
  expect(result1.turnNumber).toBe(1);
  expect(result2.turnNumber).toBe(2);
});
```

---

### 7. Large Response Exceeding max_tokens

**Scenario**: Agent response exceeds max_tokens (4096).

**Current Handling**: max_tokens: 4096, truncation

**Risk**: LOW (sufficient for most responses)

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should handle truncated response', async () => {
  mockAnthropicCreate.mockResolvedValue({
    content: [{ type: 'text', text: 'A'.repeat(5000) }],  // 5000 chars
    stop_reason: 'max_tokens',
    usage: { output_tokens: 4096 }
  });

  const result = await service.executeQuery('Long query', sessionId);

  expect(result.truncated).toBe(true);
  expect(result.response.length).toBeLessThanOrEqual(4096);
});
```

---

## Database Edge Cases

### 8. Connection Timeout (All Retries Fail)

**Scenario**: Database unreachable after 10 retry attempts.

**Current Handling**: Retry 10x with exponential backoff

**Risk**: LOW (Azure SQL is reliable)

**Test Priority**: HIGH

**Test**:
```typescript
it('should fail after 10 retry attempts', async () => {
  sql.connect.mockRejectedValue(new Error('ETIMEDOUT'));

  await expect(connectWithRetry()).rejects.toThrow(
    /Failed to connect after 10 attempts/i
  );

  expect(sql.connect).toHaveBeenCalledTimes(10);
});
```

---

### 9. Connection Drop During Query

**Scenario**: Database connection lost mid-query.

**Current Handling**: Auto-reconnection on runtime errors

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should reconnect after connection drop', async () => {
  sql.query
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ recordset: [] });

  const result = await sql.query('SELECT 1');

  expect(result).toBeDefined();
  expect(sql.connect).toHaveBeenCalledTimes(1);  // Reconnected
});
```

---

### 10. Keepalive Max Consecutive Errors (5)

**Scenario**: Keepalive query fails 5 times in a row.

**Current Handling**: Stops keepalive job

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should stop keepalive after 5 consecutive errors', async () => {
  sql.query.mockRejectedValue(new Error('Keepalive failed'));

  const keepalive = new DatabaseKeepalive();
  keepalive.start();

  // Wait for 5 failures (3 min each = 15 min)
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

  expect(keepalive.isRunning).toBe(false);
});
```

---

### 11. Transaction Deadlock

**Scenario**: Two concurrent transactions lock each other.

**Current Handling**: NO retry logic

**Risk**: HIGH

**Test Priority**: HIGH

**Mitigation**: Add deadlock detection and retry

**Test**:
```typescript
it('should retry transaction on deadlock', async () => {
  sql.query
    .mockRejectedValueOnce(new Error('Transaction deadlocked'))
    .mockResolvedValueOnce({ rowsAffected: [1] });

  const result = await executeTransaction(async () => {
    return await sql.query('UPDATE users SET name = "Test"');
  });

  expect(result.rowsAffected[0]).toBe(1);
  expect(sql.query).toHaveBeenCalledTimes(2);  // Retry
});
```

---

### 12. Cascade Delete Failure

**Scenario**: Foreign key constraint prevents cascade delete.

**Current Handling**: FK constraints handle it correctly

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should cascade delete messages when session deleted', async () => {
  // Create session with messages
  const sessionId = await createSession();
  await createMessage(sessionId, 'Test message');

  // Delete session
  await sql.query(`DELETE FROM sessions WHERE id = '${sessionId}'`);

  // Verify messages cascade deleted
  const result = await sql.query(`SELECT * FROM messages WHERE session_id = '${sessionId}'`);
  expect(result.recordset).toHaveLength(0);
});
```

---

### 13. NULL in Required Field

**Scenario**: Insert NULL into non-nullable column.

**Current Handling**: DB constraint rejects with error

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should reject NULL in required field', async () => {
  await expect(
    sql.query(`INSERT INTO users (id, email) VALUES (NEWID(), NULL)`)
  ).rejects.toThrow(/Cannot insert NULL/i);
});
```

---

### 14. Duplicate GUID Generation

**Scenario**: Two `NEWID()` calls generate same GUID.

**Current Handling**: Statistically impossible (UUID v4)

**Risk**: LOW

**Test Priority**: LOW

---

## Authentication Edge Cases

### 15. OAuth Code Expired

**Scenario**: OAuth authorization code expired before exchange.

**Current Handling**: Error, redirect to login

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should handle expired OAuth code', async () => {
  mockOAuthExchange.mockRejectedValue(new Error('authorization_code_expired'));

  const response = await request(app).get('/api/auth/callback?code=expired-code');

  expect(response.status).toBe(302);
  expect(response.header.location).toContain('/login?error=code_expired');
});
```

---

### 16. BC Token Expired Mid-Operation

**Scenario**: BC access token expires during agent query.

**Current Handling**: BCTokenManager auto-refreshes

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should refresh BC token when expired', async () => {
  mockBCRequest
    .mockRejectedValueOnce(new Error('401 Unauthorized'))  // Expired
    .mockResolvedValueOnce({ data: 'Success' });           // After refresh

  const result = await bcClient.request('/api/entities');

  expect(result.data).toBe('Success');
  expect(mockTokenRefresh).toHaveBeenCalledOnce();
});
```

---

### 17. Encryption Key Missing

**Scenario**: `ENCRYPTION_KEY` env var not set.

**Current Handling**: Server won't start

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should fail to start without encryption key', async () => {
  delete process.env.ENCRYPTION_KEY;

  await expect(startServer()).rejects.toThrow(/ENCRYPTION_KEY required/i);
});
```

---

### 18. Session Cookie Tampered

**Scenario**: User modifies session cookie manually.

**Current Handling**: Session invalid, 401

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should reject tampered session cookie', async () => {
  const response = await request(app)
    .get('/api/auth/status')
    .set('Cookie', 'connect.sid=tampered-value');

  expect(response.status).toBe(401);
});
```

---

### 19. User Denies BC Consent

**Scenario**: User denies Business Central API permissions.

**Current Handling**: Error, no BC access

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should handle denied BC consent', async () => {
  mockOAuthExchange.mockResolvedValue({
    accessToken: 'token',
    scopes: []  // No BC scope granted
  });

  const response = await request(app).get('/api/auth/callback?code=test');

  expect(response.status).toBe(302);
  expect(response.header.location).toContain('/error?reason=bc_consent_denied');
});
```

---

## WebSocket Edge Cases

### 20. Socket Connect Without Auth

**Scenario**: WebSocket connection without valid session cookie.

**Current Handling**: Middleware rejects connection

**Risk**: LOW

**Test Priority**: MEDIUM

**Test**:
```typescript
it('should reject socket connection without auth', (done) => {
  const socket = ioClient('http://localhost:3002', {
    transports: ['websocket']
  });

  socket.on('connect_error', (error) => {
    expect(error.message).toContain('Unauthorized');
    done();
  });
});
```

---

### 21. Room Join Timeout (All 3 Retries Fail)

**Scenario**: Socket can't join room after 3 attempts.

**Current Handling**: Retry 3x with 2s timeout

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should fail after 3 room join retries', async () => {
  mockSocket.emit.mockImplementation((event, callback) => {
    // Never call callback (timeout)
  });

  await expect(waitForRoomJoin(socket, sessionId)).rejects.toThrow(
    /Room join timeout/i
  );

  expect(mockSocket.emit).toHaveBeenCalledTimes(3);
});
```

---

### 22. Disconnect During Streaming

**Scenario**: Socket disconnects while agent is streaming.

**Current Handling**: Frontend buffered, lost on disconnect

**Risk**: HIGH

**Test Priority**: CRITICAL

**Mitigation**: Server persists chunks to DB

**Test**:
```typescript
it('should persist streamed chunks to DB', async () => {
  // Start streaming
  socket.emit('chat:message', { sessionId, content: 'Test' });

  // Simulate disconnect mid-stream
  socket.disconnect();

  // Verify chunks saved to DB
  const messages = await sql.query(`SELECT * FROM messages WHERE session_id = '${sessionId}'`);
  expect(messages.recordset.length).toBeGreaterThan(0);
});
```

---

### 23. Message Before Room Join

**Scenario**: Client emits message before joining session room.

**Current Handling**: Lost (not in room yet)

**Risk**: HIGH

**Test Priority**: CRITICAL

**Mitigation**: `waitForRoomJoin()` retry logic

**Test**:
```typescript
it('should wait for room join before sending message', async () => {
  const socket = ioClient('http://localhost:3002');

  // Try to send immediately (should fail or wait)
  const promise = sendMessage(socket, sessionId, 'Hello');

  // Wait for room join
  await waitForRoomJoin(socket, sessionId);

  // Now message should send
  await expect(promise).resolves.not.toThrow();
});
```

---

### 24. Concurrent Messages

**Scenario**: User sends multiple messages rapidly.

**Current Handling**: NO queue, race condition

**Risk**: HIGH

**Test Priority**: CRITICAL

**Mitigation**: Implement message queue (Phase 4)

---

## Frontend State Edge Cases

### 25. Optimistic Update Fails

**Scenario**: Message added optimistically, server rejects it.

**Current Handling**: Message stays, no server confirmation

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```tsx
it('should rollback optimistic update on error', async () => {
  mockSocket.emit.mockImplementation((event, data, callback) => {
    callback({ error: 'Failed to send' });
  });

  const { getByPlaceholder, queryByText } = render(<ChatInterface />);

  const input = getByPlaceholder(/Type a message/i);
  fireEvent.change(input, { target: { value: 'Test' } });
  fireEvent.submit(input);

  // Message appears optimistically
  await waitFor(() => expect(queryByText('Test')).toBeInTheDocument());

  // Then removed on error
  await waitFor(() => expect(queryByText('Test')).not.toBeInTheDocument());
});
```

---

### 26. Session Switch During Streaming

**Scenario**: User switches sessions while agent is streaming.

**Current Handling**: `isStreaming` not reset

**Risk**: HIGH

**Test Priority**: CRITICAL

**Test**:
```tsx
it('should reset streaming state on session switch', async () => {
  const { getByText } = render(<ChatInterface />);

  // Start streaming in session 1
  startStreaming();

  // Switch to session 2
  fireEvent.click(getByText('Session 2'));

  // Verify streaming state reset
  expect(chatStore.getState().isStreaming).toBe(false);
});
```

---

### 27. Stale React Query Cache

**Scenario**: Cache shows old data after mutation.

**Current Handling**: Not invalidated automatically

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```tsx
it('should invalidate cache after delete session', async () => {
  const queryClient = new QueryClient();

  // Cache sessions
  queryClient.setQueryData(['sessions'], [{ id: '1', title: 'Test' }]);

  // Delete session
  await deleteSession('1');

  // Cache should be invalidated
  await waitFor(() => {
    const data = queryClient.getQueryData(['sessions']);
    expect(data).not.toContainEqual({ id: '1' });
  });
});
```

---

## MCP Integration Edge Cases

### 28. MCP Tool Not Found

**Scenario**: Agent tries to call non-existent tool.

**Current Handling**: Error returned to agent

**Risk**: LOW

**Test Priority**: MEDIUM

---

### 29. MCP Tool Missing Required Parameter

**Scenario**: Tool called without required input.

**Current Handling**: MCP validates and returns error

**Risk**: LOW

**Test Priority**: MEDIUM

---

## Approval System Edge Cases

### 30. Duplicate Approval Response

**Scenario**: User clicks "Approve" twice rapidly.

**Current Handling**: NO protection, race condition

**Risk**: MEDIUM

**Test Priority**: HIGH

**Test**:
```typescript
it('should prevent duplicate approval responses', async () => {
  const approvalId = 'approval-123';

  // First approval
  const promise1 = approvalManager.respondToApproval(approvalId, true);

  // Second approval (should fail)
  const promise2 = approvalManager.respondToApproval(approvalId, true);

  await expect(promise1).resolves.toBeTruthy();
  await expect(promise2).rejects.toThrow(/Already responded/i);
});
```

---

### 31. Approval for Non-Existent Session

**Scenario**: Approval request for deleted session.

**Current Handling**: Should validate session exists

**Risk**: LOW

**Test Priority**: MEDIUM

---

### 32. Multiple Pending Approvals Same Session

**Scenario**: Batch operation creates 5 approvals.

**Current Handling**: Allowed, queue displayed in UI

**Risk**: LOW

**Test Priority**: MEDIUM

---

## Summary Table

| ID | Category | Edge Case | Risk | Priority | Status |
|----|----------|-----------|------|----------|--------|
| 1 | Agent | Infinite loop (max turns) | LOW | MEDIUM | ✅ Handled |
| 2 | Agent | Tool execution timeout | HIGH | HIGH | ❌ Not handled |
| 3 | Agent | MCP server down | MEDIUM | HIGH | ✅ Handled |
| 4 | Agent | Malformed tool response | HIGH | HIGH | ❌ Not handled |
| 5 | Agent | Approval expires during execution | MEDIUM | HIGH | ✅ Handled |
| 6 | Agent | Concurrent queries same session | HIGH | CRITICAL | ❌ Not handled |
| 7 | Agent | Large response truncation | LOW | MEDIUM | ✅ Handled |
| 8 | DB | Connection timeout (all retries fail) | LOW | HIGH | ✅ Handled |
| 9 | DB | Connection drop during query | MEDIUM | HIGH | ✅ Handled |
| 10 | DB | Keepalive max errors (5) | MEDIUM | HIGH | ✅ Handled |
| 11 | DB | Transaction deadlock | HIGH | HIGH | ❌ Not handled |
| 12 | DB | Cascade delete failure | LOW | MEDIUM | ✅ Handled |
| 13 | DB | NULL in required field | LOW | MEDIUM | ✅ Handled |
| 15 | Auth | OAuth code expired | LOW | MEDIUM | ✅ Handled |
| 16 | Auth | BC token expired mid-op | MEDIUM | HIGH | ✅ Handled |
| 17 | Auth | Encryption key missing | LOW | MEDIUM | ✅ Handled |
| 18 | Auth | Session cookie tampered | LOW | MEDIUM | ✅ Handled |
| 19 | Auth | User denies BC consent | MEDIUM | HIGH | ⚠️ Partial |
| 20 | WebSocket | Connect without auth | LOW | MEDIUM | ✅ Handled |
| 21 | WebSocket | Room join timeout (3 retries) | MEDIUM | HIGH | ✅ Handled |
| 22 | WebSocket | Disconnect during streaming | HIGH | CRITICAL | ❌ Not handled |
| 23 | WebSocket | Message before room join | HIGH | CRITICAL | ✅ Handled |
| 24 | WebSocket | Concurrent messages | HIGH | CRITICAL | ❌ Not handled |
| 25 | Frontend | Optimistic update fails | MEDIUM | HIGH | ⚠️ Partial |
| 26 | Frontend | Session switch during streaming | HIGH | CRITICAL | ❌ Not handled |
| 27 | Frontend | Stale React Query cache | MEDIUM | HIGH | ⚠️ Partial |
| 30 | Approval | Duplicate response | MEDIUM | HIGH | ❌ Not handled |

**Legend**:
- ✅ **Handled** - Current implementation handles this case
- ⚠️ **Partial** - Partially handled, needs improvement
- ❌ **Not handled** - No protection, requires implementation

**Total Edge Cases**: 32 documented (24 critical/high priority)

---

**Document Version**: 1.0
**Related Documents**:
- `00-testing-strategy.md` - Overall strategy
- `01-unit-testing-guide.md` - How to write tests for these cases
- `02-integration-testing-guide.md` - Integration test patterns
- `03-e2e-testing-guide.md` - E2E test patterns
