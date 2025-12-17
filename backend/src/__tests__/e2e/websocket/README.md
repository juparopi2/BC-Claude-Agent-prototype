# WebSocket E2E Tests

This directory contains comprehensive end-to-end tests for the WebSocket/Socket.IO integration.

## Test Files

### 1. connection.ws.test.ts
Tests WebSocket connection lifecycle:
- ✅ Connect with valid session cookie
- ✅ Reject connection without session cookie
- ✅ Reject connection with invalid session cookie
- ✅ Clean disconnection
- ✅ Handle disconnect when not connected
- ✅ Allow reconnection after disconnect

### 2. session-rooms.ws.test.ts
Tests session room management:
- ✅ Join session room and receive ready signal
- ✅ Reject joining non-existent session
- ✅ Reject joining session owned by another user
- ✅ Allow joining multiple sessions sequentially
- ✅ Leave session room
- ✅ Handle leaving session not joined
- ✅ Session room isolation (no cross-session event leaking)

### 3. events.ws.test.ts
Tests agent:event types using FakeAnthropicClient:
- ✅ Receive user_message_confirmed before agent events
- ✅ Include sequence number and message ID
- ✅ Receive streaming message_chunk events
- ✅ Accumulate chunks into coherent text
- ✅ Receive complete event at the end
- ✅ Complete is the last event in sequence
- ✅ Events arrive in correct order
- ✅ Receive thinking events when extended thinking is used

### 4. error-handling.ws.test.ts
Tests error scenarios and edge cases:
- ✅ Handle joining non-existent session
- ✅ Handle joining with invalid UUID format
- ✅ Remain connected after join failure
- ✅ Handle malformed chat:message events
- ✅ Handle malformed session:join/leave events
- ✅ Handle invalid approval responses
- ✅ Handle rapid connect/disconnect cycles
- ✅ Handle sending message after disconnect
- ✅ Handle joining session after disconnect
- ✅ Handle empty message
- ✅ Handle very long message
- ✅ Handle special characters in message
- ✅ Timeout if session:ready not received

## Running Tests

```bash
# Run all WebSocket E2E tests
npm run test:e2e -- websocket

# Run specific test file
npm run test:e2e -- websocket/connection.ws.test.ts

# Run with UI
npm run test:e2e:ui

# Run in watch mode (not recommended for E2E)
npm run test:e2e -- --watch
```

## Test Infrastructure

### E2ETestClient
Unified HTTP + WebSocket client that simulates frontend behavior:
- HTTP methods (GET, POST, PUT, DELETE)
- WebSocket connection management
- Session authentication
- Event collection and waiting utilities

### TestSessionFactory
Creates test users and sessions with automatic cleanup:
- Creates users with Microsoft OAuth sessions
- Creates chat sessions
- Generates session cookies
- Tracks all created resources for cleanup

### GoldenResponses
Pre-configured FakeAnthropicClient responses for 5 golden flows:
1. Simple text response
2. Extended thinking
3. Tool use (read)
4. Approval flow (write)
5. Error handling

## API Mode

Tests can run in two modes controlled by `E2E_USE_REAL_API` environment variable:

### Mock Mode (default)
```bash
# Uses FakeAnthropicClient - fast, free, deterministic
npm run test:e2e
```

### Real API Mode
```bash
# Uses real Claude API - expensive, slow, requires ANTHROPIC_API_KEY
E2E_USE_REAL_API=true npm run test:e2e
```

## Important Notes

1. **Always cleanup**: Use `beforeAll`, `afterAll`, `beforeEach`, `afterEach` properly
2. **Clear events**: Call `client.clearEvents()` before sending messages to avoid stale events
3. **Connect/Disconnect**: Always connect in `beforeEach` and disconnect in `afterEach`
4. **Session cookies**: Create sessions via HTTP first, then join via WebSocket
5. **Timeouts**: Use appropriate timeouts for async operations (default: 30s)
6. **Type safety**: Always type HTTP responses: `httpClient.post<{ id: string }>(...)`

## Architecture

```
User Test Code
    ↓
E2ETestClient
    ↓
┌─────────────────────┬─────────────────────┐
│   HTTP (fetch)      │   WebSocket (io)     │
└─────────────────────┴─────────────────────┘
            ↓
    Real Backend Server
            ↓
    ┌──────────────────────┐
    │  FakeAnthropicClient │  (Mock Mode)
    │         OR           │
    │   Real Claude API    │  (Real Mode)
    └──────────────────────┘
```

## Coverage

These tests provide comprehensive coverage of:
- ✅ Connection authentication
- ✅ Session room management
- ✅ Agent event streaming
- ✅ Error handling
- ✅ Edge cases
- ✅ Connection resilience

See individual test files for detailed test cases.
