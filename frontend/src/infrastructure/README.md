# Infrastructure

Infrastructure modules contain low-level utilities for external integrations (WebSocket, HTTP, etc.).

## Structure

```
infrastructure/
├── socket/            # Socket.IO client and event routing
│   ├── SocketClient.ts    # WebSocket connection management
│   ├── eventRouter.ts     # Routes socket events to handlers
│   ├── types.ts           # Socket-related type definitions
│   └── index.ts           # Barrel exports
└── README.md              # This file
```

## Socket Module (`socket/`)

### SocketClient

Manages the Socket.IO connection lifecycle:

```typescript
import { SocketClient, getSocketClient } from '@/src/infrastructure/socket';

// Get singleton instance
const client = getSocketClient();

// Connect with auth
await client.connect({ token: 'user-token' });

// Join a session room
client.joinSession(sessionId);

// Send a message
client.sendMessage({
  sessionId,
  message: 'Hello',
  options: { enableThinking: true }
});

// Disconnect when done
client.disconnect();
```

### EventRouter

Routes incoming socket events to the appropriate domain handlers:

```typescript
import { createEventRouter } from '@/src/infrastructure/socket';
import { processAgentEvent } from '@/src/domains/chat';

// Create router with handlers
const router = createEventRouter({
  onAgentEvent: (event) => {
    processAgentEvent(event, callbacks);
  },
  onError: (error) => {
    console.error('Socket error:', error);
  },
  onSessionJoined: (data) => {
    console.log('Joined session:', data.sessionId);
  },
});

// Register with socket
socket.on('agent:event', router.handleAgentEvent);
socket.on('session:joined', router.handleSessionJoined);
socket.on('error', router.handleError);
```

### Event Types

The socket handles these event channels:

| Event | Direction | Description |
|-------|-----------|-------------|
| `session:join` | Client → Server | Join a session room |
| `session:joined` | Server → Client | Confirmation of join |
| `session:leave` | Client → Server | Leave a session room |
| `chat:message` | Client → Server | Send user message |
| `agent:event` | Server → Client | Agent events (streaming, tools, etc.) |
| `error` | Server → Client | Error notifications |

### Agent Event Types

Events received on `agent:event` channel include:

- `session_start` - Session began processing
- `thinking` - Legacy thinking block (backwards compat)
- `thinking_chunk` - Streaming thinking content
- `thinking_complete` - Thinking block finalized
- `message_chunk` - Streaming message content
- `message` - Final message with metadata
- `user_message_confirmed` - Optimistic message confirmed
- `tool_use` - Tool execution started
- `tool_result` - Tool execution completed
- `approval_requested` - Human approval needed
- `approval_resolved` - Approval resolved
- `turn_paused` - Agent paused (Gap #7)
- `complete` - Turn complete
- `session_end` - Session ended
- `error` - Error occurred
- `content_refused` - Content policy violation

## Design Principles

### 1. Singleton Pattern
Infrastructure modules use singletons for shared resources:
```typescript
let client: SocketClient | null = null;

export function getSocketClient(): SocketClient {
  if (!client) {
    client = new SocketClient(config);
  }
  return client;
}
```

### 2. Event-Driven Architecture
Socket communication uses event emitters:
```typescript
// Emit events
socket.emit('chat:message', payload);

// Listen for events
socket.on('agent:event', handler);
```

### 3. Reconnection Handling
The client handles disconnects gracefully:
```typescript
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // Server initiated - manual reconnect needed
    socket.connect();
  }
  // Otherwise, auto-reconnect is handled by Socket.IO
});
```

### 4. Session Room Pattern
Messages are scoped to session rooms:
```typescript
// Join room to receive session-specific events
socket.emit('session:join', { sessionId });

// Wait for confirmation before sending messages
socket.once('session:joined', () => {
  socket.emit('chat:message', { sessionId, message });
});
```

## Testing

Infrastructure tests verify connection behavior:
```typescript
// __tests__/unit/hooks/useSocket.test.ts
describe('SocketClient', () => {
  it('should connect with credentials', async () => {
    // ...
  });

  it('should handle disconnection gracefully', async () => {
    // ...
  });
});
```

## Configuration

Socket configuration from environment:
```typescript
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002';
```

## Related

- `@bc-agent/shared` - Event type definitions
- `domains/chat/services/streamProcessor.ts` - Processes routed events
- `e2e/frontend/session-ready.spec.ts` - E2E tests for session flow (Gap #11)
