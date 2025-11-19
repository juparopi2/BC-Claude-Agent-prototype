# PRD 06: Edge Cases Implementation - 24 Critical Scenarios

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Implementation Time**: 12 hours

---

## Format Per Edge Case

Each edge case includes:
1. **Description** - What the edge case is
2. **Current Handling** - ✅ Implemented | ⚠️ Partial | ❌ Not implemented
3. **Test Code** - Complete test (30-50 lines)
4. **Assertions** - Key validations
5. **Known Issues** - If applicable

---

## Agent Edge Cases (6 tests, 6 hours)

### Edge Case 1: Concurrent Queries to Same Session

**Description**: Two users send messages simultaneously to same sessionId, causing race conditions.

**Current Handling**: ⚠️ Partial - Redis INCR is atomic, but agent state has no locking

**Test Code**:
```typescript
it('should handle concurrent queries without race conditions', async () => {
  const sessionId = 'session-concurrent';

  // Mock Redis INCR (atomic)
  let counter = 0;
  vi.spyOn(redis, 'incr').mockImplementation(async () => ++counter);

  // Act: Send 5 messages concurrently
  const promises = Array.from({ length: 5 }, (_, i) =>
    directAgentService.processMessage(sessionId, `Query ${i + 1}`)
  );

  await Promise.all(promises);

  // Assert: All messages processed
  const events = await eventStore.getEvents(sessionId);
  expect(events.length).toBeGreaterThanOrEqual(10); // 5 user + 5 assistant

  // Assert: Sequence numbers unique
  const sequences = events.map(e => e.sequenceNumber);
  expect(new Set(sequences).size).toBe(sequences.length);
});
```

**Known Issue**: BullMQ should serialize jobs per sessionId (TODO: Phase 3)

---

### Edge Case 2: Tool Execution Timeout (>30s)

**Description**: Tool call takes >30s, causing timeout.

**Current Handling**: ⚠️ No timeout configured

**Test Code**:
```typescript
it('should timeout tool execution after 30 seconds', async () => {
  // Mock slow tool
  mcpServerMock.post('/mcp', async () => {
    await new Promise(resolve => setTimeout(resolve, 35000)); // 35s
    return HttpResponse.json({ result: [] });
  });

  // Act & Assert
  await expect(
    directAgentService.executeMCPTool('list_all_entities', {})
  ).rejects.toThrow(/timeout/i);
});
```

**Known Issue**: Implement timeout in Phase 3

---

### Edge Case 3: Malformed Tool Response from MCP

**Description**: MCP server returns invalid JSON or unexpected schema.

**Current Handling**: ⚠️ Partial - Basic error handling

**Test Code**:
```typescript
it('should handle malformed MCP responses gracefully', async () => {
  // Mock malformed JSON
  mcpServerMock.post('/mcp', () => {
    return new HttpResponse('Invalid JSON{', { status: 200 });
  });

  // Act & Assert
  await expect(
    directAgentService.executeMCPTool('list_all_entities', {})
  ).rejects.toThrow(/Invalid JSON response/);

  // Assert: Error logged
  expect(logger.error).toHaveBeenCalled();
});
```

---

### Edge Case 4: Max Turns Exceeded (20+)

**Description**: Agent loop exceeds 20 turns (infinite loop protection).

**Current Handling**: ✅ Implemented

**Test Code**:
```typescript
it('should stop after 20 turns', async () => {
  // Mock SDK to always return tool_use
  anthropicMock.messages.create.mockResolvedValue({
    content: [{ type: 'tool_use', name: 'list_all_entities', input: {} }],
    stop_reason: 'tool_use'
  });

  approvalManagerMock.request.mockResolvedValue(true);

  // Act & Assert
  await expect(
    directAgentService.processMessage('session-loop', 'Test')
  ).rejects.toThrow(/Max turns limit/);

  expect(anthropicMock.messages.create).toHaveBeenCalledTimes(20);
});
```

---

### Edge Case 5: Context Window Exceeded (>100K tokens)

**Description**: Conversation history exceeds 100K token limit.

**Current Handling**: ✅ Implemented (truncation)

**Test Code**:
```typescript
it('should truncate history when exceeding 100K tokens', async () => {
  // Create large history
  const largeHistory = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'A'.repeat(2000) // ~2000 tokens each
  }));

  vi.spyOn(directAgentService, 'countTokens').mockReturnValue(120000);

  // Act
  const truncated = await directAgentService.prepareHistory({
    conversationHistory: largeHistory
  });

  // Assert: Truncated to fit 100K
  const tokens = directAgentService.countTokens(JSON.stringify(truncated));
  expect(tokens).toBeLessThanOrEqual(100000);
});
```

---

### Edge Case 6: Stop Reason = max_tokens

**Description**: Response truncated due to max_tokens limit.

**Current Handling**: ✅ Implemented

**Test Code**:
```typescript
it('should handle max_tokens stop reason', async () => {
  anthropicMock.messages.create.mockResolvedValue({
    content: [{ type: 'text', text: 'Truncated response...' }],
    stop_reason: 'max_tokens'
  });

  // Act
  await directAgentService.processMessage('session-truncated', 'Long query');

  // Assert: Warning emitted
  expect(socket.emit).toHaveBeenCalledWith('agent:event', expect.objectContaining({
    type: 'warning',
    message: expect.stringContaining('max_tokens')
  }));
});
```

---

## Auth & WebSocket Edge Cases (6 tests, 6 hours)

### Edge Case 7: BC Token Expiry Mid-Operation

**Description**: BC token expires during tool execution.

**Current Handling**: ✅ Auto-refresh middleware

**Test Code**:
```typescript
it('should refresh BC token mid-operation', async () => {
  const user = await createTestUser(db, {
    bcTokenExpiresAt: new Date(Date.now() + 2000) // Expires in 2s
  });

  // Mock refresh
  oauthService.refreshAccessToken.mockResolvedValue({
    accessToken: 'new-token',
    expiresIn: 3600
  });

  // Act: Start long operation
  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for expiry

  // Call API
  await request(app)
    .get('/api/sessions')
    .set('Cookie', await createSessionCookie(user.id))
    .expect(200);

  // Assert: Token refreshed
  expect(oauthService.refreshAccessToken).toHaveBeenCalled();
});
```

---

### Edge Case 8: User Denies BC Consent

**Description**: User clicks "Deny" on BC consent screen.

**Current Handling**: ✅ Error handling exists

**Test Code**:
```typescript
it('should handle BC consent denial', async () => {
  oauthService.acquireBCToken.mockRejectedValue({
    code: 'CONSENT_REQUIRED',
    message: 'User denied consent'
  });

  // Act
  const response = await request(app)
    .post('/api/auth/bc-consent')
    .set('Cookie', sessionCookie)
    .expect(403);

  // Assert: User-friendly error
  expect(response.body.error).toContain('consent');
  expect(response.body.retryable).toBe(false);
});
```

---

### Edge Case 9: Disconnect During Streaming

**Description**: WebSocket disconnects while agent is streaming.

**Current Handling**: ⚠️ Server persists, client may lose events

**Test Code**:
```typescript
it('should persist events even if client disconnects', async () => {
  const session = await createTestSession(db);
  const socket = io('http://localhost:3002', { auth: { sessionId: session.id } });

  await waitForEvent(socket, 'connect');

  // Start streaming
  const messagePromise = directAgentService.processMessage(session.id, 'Test');

  // Disconnect mid-stream
  setTimeout(() => socket.disconnect(), 100);

  await messagePromise;

  // Assert: Events persisted in DB
  const events = await db.all(
    'SELECT * FROM message_events WHERE session_id = ?',
    [session.id]
  );
  expect(events.length).toBeGreaterThan(0);
});
```

**Known Issue**: Client needs replay mechanism on reconnect

---

### Edge Case 10: Message Before Room Join

**Description**: Client sends message before joining room.

**Current Handling**: ⚠️ May be lost

**Test Code**:
```typescript
it('should queue messages sent before room join', async () => {
  const socket = io('http://localhost:3002');

  // Send message immediately (before join)
  socket.emit('message', { content: 'Early message' });

  // Join room after delay
  setTimeout(() => {
    socket.emit('join', { sessionId: 'session-123' });
  }, 100);

  await new Promise(resolve => setTimeout(resolve, 200));

  // Assert: Message queued and processed after join
  const messages = await db.all(
    'SELECT * FROM messages WHERE session_id = ?',
    ['session-123']
  );
  expect(messages.length).toBeGreaterThanOrEqual(1);
});
```

**Known Issue**: Implement message queue on server side

---

## Additional Edge Cases (12 tests, summary only)

### Database Edge Cases
- **Edge Case 11**: Transaction deadlock
- **Edge Case 12**: Connection pool exhausted
- **Edge Case 13**: Query timeout (>30s)

### Approval Edge Cases
- **Edge Case 14**: Approval timeout (5 minutes)
- **Edge Case 15**: Concurrent approval requests
- **Edge Case 16**: Approval response after expiry

### Rate Limiting Edge Cases
- **Edge Case 17**: 101st job in hour (rate limit)
- **Edge Case 18**: Burst of 50 jobs in 1 second
- **Edge Case 19**: Rate limit reset edge (exactly 1 hour)

### Session Edge Cases
- **Edge Case 20**: Session switch during streaming
- **Edge Case 21**: Session deleted mid-operation
- **Edge Case 22**: Stale React Query cache

### MCP Server Edge Cases
- **Edge Case 23**: MCP server down (ECONNREFUSED)
- **Edge Case 24**: MCP server returns 500 error

---

## Implementation Strategy

### Priority Levels

**P0 - Implement Now** (Tests 1, 4, 5, 6, 7, 8, 10)
- Already have code to test ✅
- Critical for system stability

**P1 - Implement in Phase 3** (Tests 2, 3, 9, 11-16)
- Require additional code changes
- Document as known issues

**P2 - Future Enhancement** (Tests 17-24)
- Lower probability
- Document as TODOs

---

## Implementation Checklist

- [ ] Agent edge cases (6 tests, 6 hours)
- [ ] Auth & WebSocket edge cases (6 tests, 6 hours)
- [ ] Document known issues for P1/P2
- [ ] Create GitHub Issues for future work
- [ ] Update TODO.md

---

**End of PRD 06: Edge Cases**
