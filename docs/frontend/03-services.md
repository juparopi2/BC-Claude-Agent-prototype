# Services

## ApiClient

HTTP client for REST API communication with the backend.

### Usage

```typescript
import { getApiClient, ApiClient } from '@/lib/services';

// Get singleton instance
const api = getApiClient();

// Or create new instance with custom URL
const customApi = new ApiClient('https://custom.api.com');
```

### Authentication

```typescript
// Check auth status
const result = await api.checkAuth();
if (result.success && result.data.authenticated) {
  console.log('User:', result.data.user);
}

// Get current user
const user = await api.getCurrentUser();

// Login/logout URLs (for redirect)
window.location.href = api.getLoginUrl();
window.location.href = api.getLogoutUrl();
```

### Sessions

```typescript
// Get all sessions
const sessions = await api.getSessions();

// Get single session
const session = await api.getSession('session-id');

// Create session
const newSession = await api.createSession({ title: 'New Chat' });

// Update session
await api.updateSession('session-id', { title: 'Updated Title' });

// Delete session
await api.deleteSession('session-id');
```

### Messages

```typescript
// Get messages with pagination
const messages = await api.getMessages('session-id', {
  limit: 50,
  after: lastSequenceNumber,
});

// Get single message
const message = await api.getMessage('session-id', 'message-id');
```

### Token Usage

```typescript
// Get session token usage
const sessionUsage = await api.getSessionTokenUsage('session-id');

// Get user total usage
const userUsage = await api.getUserTokenUsage(3); // last 3 months
```

### Error Handling

All methods return `ApiResponse<T>`:

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorResponse };

// Usage
const result = await api.getSessions();

if (result.success) {
  // TypeScript knows: result.data is Session[]
  displaySessions(result.data);
} else {
  // TypeScript knows: result.error is ApiErrorResponse
  showError(result.error.message);

  // Handle specific error codes
  if (result.error.code === ErrorCode.SESSION_EXPIRED) {
    redirectToLogin();
  }
}
```

---

## SocketService

WebSocket client for real-time communication.

### Usage

```typescript
import { getSocketService, SocketService } from '@/lib/services';

// Get singleton with handlers
const socket = getSocketService({
  onAgentEvent: (event) => handleEvent(event),
  onAgentError: (error) => showError(error.error),
  onConnectionChange: (connected) => updateStatus(connected),
  onSessionReady: (data) => console.log('Ready:', data.sessionId),
});

// Connect
socket.connect();
```

### Session Management

```typescript
// Join a session room
socket.joinSession('session-id');

// Leave a session room
socket.leaveSession('session-id');

// Current session
console.log(socket.sessionId);
```

### Sending Messages

```typescript
// Simple message
socket.sendMessage({
  message: 'Hello!',
  sessionId: 'session-id',
  userId: 'user-id',
});

// With Extended Thinking
socket.sendMessage({
  message: 'Complex question...',
  sessionId: 'session-id',
  userId: 'user-id',
  thinking: {
    enableThinking: true,
    thinkingBudget: 15000,
  },
});
```

### Agent Control

```typescript
// Stop agent execution
socket.stopAgent({
  sessionId: 'session-id',
  userId: 'user-id',
});
```

### Approval Responses

```typescript
// Approve
socket.respondToApproval({
  approvalId: 'approval-id',
  approved: true,
  userId: 'user-id',
});

// Reject with reason
socket.respondToApproval({
  approvalId: 'approval-id',
  approved: false,
  userId: 'user-id',
  reason: 'Not approved by manager',
});
```

### Event Handlers

```typescript
interface SocketEventHandlers {
  onAgentEvent?: (event: AgentEvent) => void;
  onAgentError?: (error: AgentErrorData) => void;
  onSessionReady?: (data: SessionReadyEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
  onSessionJoined?: (data: { sessionId: string }) => void;
  onSessionLeft?: (data: { sessionId: string }) => void;
  onSessionError?: (error: { error: string; sessionId?: string }) => void;
}
```

### Connection Options

The socket automatically:
- Reconnects on disconnect (up to 5 attempts)
- Rejoins session after reconnection
- Uses both WebSocket and polling transports
- Sends credentials for session auth

```typescript
// Manual disconnect
socket.disconnect();

// Check connection status
if (socket.isConnected) {
  socket.sendMessage(...);
}
```
