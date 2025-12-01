# State Management

The frontend uses Zustand for state management with three main stores:
- `authStore` - Authentication state
- `sessionStore` - Session management
- `chatStore` - Chat messages and real-time state

## authStore

Manages user authentication state with persistence.

### State

```typescript
interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  lastChecked: number | null;
}
```

### Actions

```typescript
const { checkAuth, setUser, logout } = useAuthStore();

// Check authentication on mount
await checkAuth();

// Manual user set
setUser(userProfile);

// Logout (redirects to backend)
logout();
```

### Selectors

```typescript
import { selectUserDisplayName, selectUserInitials } from '@/lib/stores';

// In component
const displayName = useAuthStore(selectUserDisplayName);
const initials = useAuthStore(selectUserInitials);
```

### Persistence

Auth state is persisted to localStorage:
- Only `user` and `isAuthenticated` are persisted
- Automatically rehydrates on page load
- Should verify with `checkAuth()` on mount

---

## sessionStore

Manages the list of sessions and current selection.

### State

```typescript
interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
}
```

### Actions

```typescript
const {
  fetchSessions,
  createSession,
  updateSession,
  deleteSession,
  selectSession,
} = useSessionStore();

// Fetch all sessions
await fetchSessions();

// Create new session
const session = await createSession('New Chat');

// Update title
await updateSession('session-id', 'New Title');

// Delete
await deleteSession('session-id');

// Select (fetches if not cached)
await selectSession('session-id');
```

### Selectors

```typescript
import { selectSortedSessions, selectActiveSessions } from '@/lib/stores';

// Sorted by updated_at (newest first)
const sorted = useSessionStore(selectSortedSessions);

// Only active sessions
const active = useSessionStore(selectActiveSessions);
```

---

## chatStore

Manages chat messages, streaming state, approvals, and tool executions.

### State

```typescript
interface ChatState {
  // Messages
  messages: Message[];
  optimisticMessages: Map<string, Message>;

  // Streaming
  streaming: {
    content: string;
    thinking: string;
    isStreaming: boolean;
    messageId?: string;
  };

  // Approvals
  pendingApprovals: Map<string, PendingApproval>;

  // Tools
  toolExecutions: Map<string, ToolExecution>;

  // Status
  isLoading: boolean;
  isAgentBusy: boolean;
  error: string | null;
  currentSessionId: string | null;
}
```

### Message Management

```typescript
const { setMessages, addMessage, clearChat } = useChatStore();

// Load messages from API
const result = await api.getMessages(sessionId);
if (result.success) {
  setMessages(result.data);
}

// Clear chat (keeps sessionId)
clearChat();
```

### Optimistic Updates

```typescript
const { addOptimisticMessage, confirmOptimisticMessage } = useChatStore();

// Add optimistic message before server confirms
addOptimisticMessage('temp-123', {
  id: 'temp-123',
  role: 'user',
  content: 'Hello!',
  sequence_number: Date.now(),
  // ...
});

// When server confirms (via user_message_confirmed event)
confirmOptimisticMessage('temp-123', confirmedMessage);
```

### Streaming State

```typescript
const { streaming } = useChatStore();

// In UI
{streaming.isStreaming && (
  <div>
    {streaming.thinking && <ThinkingIndicator content={streaming.thinking} />}
    <StreamingMessage content={streaming.content} />
  </div>
)}
```

### Approvals

```typescript
const approvals = useChatStore(selectPendingApprovals);

// Display pending approvals
{approvals.map(approval => (
  <ApprovalCard
    key={approval.id}
    toolName={approval.toolName}
    changeSummary={approval.changeSummary}
    priority={approval.priority}
    onApprove={() => respondToApproval(approval.id, true)}
    onReject={() => respondToApproval(approval.id, false)}
  />
))}
```

### Tool Executions

```typescript
const tools = useChatStore(selectToolExecutions);

// Display tool status
{tools.map(tool => (
  <ToolStatus
    key={tool.id}
    name={tool.toolName}
    status={tool.status}
    duration={tool.durationMs}
  />
))}
```

### Event Handling

The `handleAgentEvent` action processes all WebSocket events:

```typescript
const { handleAgentEvent } = useChatStore();

// Called automatically by socketMiddleware
socket.on('agent:event', (event) => {
  handleAgentEvent(event);
});
```

---

## useSocket Hook

Integrates WebSocket with Zustand stores.

### Usage

```typescript
import { useSocket } from '@/lib/stores';

function ChatPage({ sessionId }: { sessionId: string }) {
  const {
    connect,
    disconnect,
    sendMessage,
    stopAgent,
    respondToApproval,
    isConnected,
  } = useSocket({
    sessionId,
    autoConnect: true,
    onConnectionChange: (connected) => {
      console.log('Connection:', connected);
    },
  });

  const handleSend = (message: string) => {
    sendMessage(message, {
      enableThinking: true,
      thinkingBudget: 10000,
    });
  };

  return (
    <ChatInterface
      onSend={handleSend}
      onStop={stopAgent}
      disabled={!isConnected}
    />
  );
}
```

### Options

```typescript
interface UseSocketOptions {
  autoConnect?: boolean;      // Default: true
  sessionId?: string;         // Join on connect
  onAgentEvent?: (event: AgentEvent) => void;
  onError?: (error: AgentErrorData) => void;
  onSessionReady?: (data: SessionReadyEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}
```

### Return Value

```typescript
interface UseSocketReturn {
  connect: () => void;
  disconnect: () => void;
  joinSession: (sessionId: string) => void;
  leaveSession: (sessionId: string) => void;
  sendMessage: (message: string, options?: ThinkingOptions) => void;
  stopAgent: () => void;
  respondToApproval: (approvalId: string, approved: boolean, reason?: string) => void;
  isConnected: boolean;
}
```
