# Testing

## Overview

The frontend uses Vitest with MSW (Mock Service Worker) for comprehensive testing of services and state management.

## Test Stack

| Tool | Purpose |
|------|---------|
| Vitest | Test runner with TypeScript support |
| MSW | API mocking at the network level |
| @testing-library/react | React component testing |
| happy-dom | DOM environment for tests |

## Directory Structure

```
__tests__/
├── mocks/
│   ├── handlers.ts       # MSW request handlers
│   └── server.ts         # MSW server setup
├── services/
│   ├── api.test.ts       # ApiClient tests
│   └── socket.test.ts    # SocketService tests
├── stores/
│   ├── authStore.test.ts
│   ├── sessionStore.test.ts
│   └── chatStore.test.ts
└── setup.ts              # Global test setup
```

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# Run specific file
npm test -- api.test.ts
```

---

## MSW Handlers

MSW intercepts network requests for deterministic testing.

### Setup

```typescript
// __tests__/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

### Handler Examples

```typescript
// __tests__/mocks/handlers.ts
import { http, HttpResponse } from 'msw';
import type { Session, UserProfile } from '@bc-agent/shared';

const API_URL = 'http://localhost:3002';

// Mock data
export const mockUser: UserProfile = {
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
};

export const mockSessions: Session[] = [
  {
    id: 'session-1',
    user_id: 'user-123',
    title: 'Test Session',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_active: true,
    metadata: {},
  },
];

// Request handlers
export const handlers = [
  // Auth
  http.get(`${API_URL}/api/auth/check`, () => {
    return HttpResponse.json({
      authenticated: true,
      user: mockUser,
    });
  }),

  // Sessions
  http.get(`${API_URL}/api/sessions`, () => {
    return HttpResponse.json(mockSessions);
  }),

  http.post(`${API_URL}/api/sessions`, async ({ request }) => {
    const body = await request.json() as { title?: string };
    return HttpResponse.json({
      id: 'new-session-123',
      user_id: 'user-123',
      title: body.title || 'New Session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
      metadata: {},
    });
  }),

  // Error simulation
  http.get(`${API_URL}/api/error-endpoint`, () => {
    return HttpResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }),
];
```

### Dynamic Handlers

Override handlers for specific tests:

```typescript
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

it('handles unauthorized error', async () => {
  // Override for this test only
  server.use(
    http.get(`${API_URL}/api/auth/check`, () => {
      return HttpResponse.json(
        {
          error: 'Unauthorized',
          message: 'Session expired',
          code: 'SESSION_EXPIRED',
        },
        { status: 401 }
      );
    })
  );

  const result = await api.checkAuth();
  expect(result.success).toBe(false);
});
```

---

## Service Tests

### ApiClient Tests

```typescript
// __tests__/services/api.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { server } from '../mocks/server';
import { ApiClient } from '@/lib/services';

describe('ApiClient', () => {
  let api: ApiClient;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
    api = new ApiClient('http://localhost:3002');
  });

  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  describe('checkAuth', () => {
    it('returns authenticated user when logged in', async () => {
      const result = await api.checkAuth();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authenticated).toBe(true);
        expect(result.data.user?.email).toBe('test@example.com');
      }
    });
  });

  describe('sessions', () => {
    it('fetches all sessions', async () => {
      const result = await api.getSessions();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].title).toBe('Test Session');
      }
    });

    it('creates a new session', async () => {
      const result = await api.createSession({ title: 'My Chat' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('My Chat');
        expect(result.data.id).toBeDefined();
      }
    });
  });
});
```

### SocketService Tests

```typescript
// __tests__/services/socket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketService } from '@/lib/services';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

describe('SocketService', () => {
  let service: SocketService;
  let mockSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SocketService('http://localhost:3002', {});
    mockSocket = (service as any).socket;
  });

  it('emits chat:message with correct payload', () => {
    service.sendMessage({
      message: 'Hello',
      sessionId: 'session-123',
      userId: 'user-123',
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', {
      message: 'Hello',
      sessionId: 'session-123',
      userId: 'user-123',
    });
  });

  it('emits agent:stop when stopping agent', () => {
    service.stopAgent({
      sessionId: 'session-123',
      userId: 'user-123',
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('agent:stop', {
      sessionId: 'session-123',
      userId: 'user-123',
    });
  });
});
```

---

## Store Tests

### ChatStore Tests

```typescript
// __tests__/stores/chatStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '@/lib/stores';
import type { AgentEvent, Message } from '@bc-agent/shared';

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      streaming: { content: '', thinking: '', isStreaming: false },
      pendingApprovals: new Map(),
      toolExecutions: new Map(),
      isLoading: false,
      isAgentBusy: false,
      error: null,
      currentSessionId: null,
    });
  });

  describe('handleAgentEvent', () => {
    it('handles session_start event', () => {
      const event: AgentEvent = {
        type: 'session_start',
        sessionId: 'session-123',
        timestamp: Date.now(),
      };

      useChatStore.getState().handleAgentEvent(event);

      const state = useChatStore.getState();
      expect(state.isAgentBusy).toBe(true);
      expect(state.currentSessionId).toBe('session-123');
    });

    it('handles message_chunk event (streaming)', () => {
      const event: AgentEvent = {
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: Date.now(),
        content: 'Hello',
        delta: 'Hello',
      };

      useChatStore.getState().handleAgentEvent(event);

      const state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.content).toBe('Hello');
    });

    it('accumulates message_chunk deltas', () => {
      const { handleAgentEvent } = useChatStore.getState();

      handleAgentEvent({
        type: 'message_chunk',
        sessionId: 's1',
        timestamp: Date.now(),
        content: 'Hello',
        delta: 'Hello',
      });

      handleAgentEvent({
        type: 'message_chunk',
        sessionId: 's1',
        timestamp: Date.now(),
        content: 'Hello World',
        delta: ' World',
      });

      expect(useChatStore.getState().streaming.content).toBe('Hello World');
    });

    it('handles approval_requested event', () => {
      const event: AgentEvent = {
        type: 'approval_requested',
        sessionId: 'session-123',
        timestamp: Date.now(),
        approvalId: 'approval-1',
        toolName: 'createCustomer',
        changeSummary: 'Create customer: Acme Inc',
        input: { name: 'Acme Inc' },
        priority: 'high',
      };

      useChatStore.getState().handleAgentEvent(event);

      const approvals = useChatStore.getState().pendingApprovals;
      expect(approvals.has('approval-1')).toBe(true);
      expect(approvals.get('approval-1')?.toolName).toBe('createCustomer');
    });

    it('handles complete event', () => {
      // Set up streaming state first
      useChatStore.setState({
        streaming: { content: 'Response', thinking: '', isStreaming: true },
        isAgentBusy: true,
      });

      const event: AgentEvent = {
        type: 'complete',
        sessionId: 'session-123',
        timestamp: Date.now(),
        stopReason: 'end_turn',
      };

      useChatStore.getState().handleAgentEvent(event);

      const state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.isAgentBusy).toBe(false);
    });
  });

  describe('optimistic updates', () => {
    it('adds optimistic message', () => {
      const message: Message = {
        id: 'temp-123',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 1,
        created_at: new Date().toISOString(),
        metadata: {},
      };

      useChatStore.getState().addOptimisticMessage('temp-123', message);

      const state = useChatStore.getState();
      expect(state.optimisticMessages.has('temp-123')).toBe(true);
      expect(state.messages).toContainEqual(message);
    });

    it('confirms optimistic message with real data', () => {
      const tempMessage: Message = {
        id: 'temp-123',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 1,
        created_at: new Date().toISOString(),
        metadata: {},
      };

      const confirmedMessage: Message = {
        ...tempMessage,
        id: 'real-456',
        sequence_number: 42,
      };

      useChatStore.getState().addOptimisticMessage('temp-123', tempMessage);
      useChatStore.getState().confirmOptimisticMessage('temp-123', confirmedMessage);

      const state = useChatStore.getState();
      expect(state.optimisticMessages.has('temp-123')).toBe(false);
      expect(state.messages.find(m => m.id === 'real-456')).toBeDefined();
      expect(state.messages.find(m => m.id === 'temp-123')).toBeUndefined();
    });
  });
});
```

### AuthStore Tests

```typescript
// __tests__/stores/authStore.test.ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { server } from '../mocks/server';
import { useAuthStore } from '@/lib/stores';

describe('authStore', () => {
  beforeAll(() => server.listen());
  afterAll(() => server.close());

  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      lastChecked: null,
    });
    server.resetHandlers();
  });

  it('checkAuth updates state on success', async () => {
    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.email).toBe('test@example.com');
    expect(state.lastChecked).toBeDefined();
  });
});
```

---

## Test Setup

### Global Setup

```typescript
// __tests__/setup.ts
import '@testing-library/jest-dom/vitest';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
```

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.ts', 'lib/**/*.tsx'],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@bc-agent/shared': path.resolve(__dirname, '../packages/shared/src'),
    },
  },
});
```

---

## Testing Best Practices

### 1. Reset State Between Tests

```typescript
beforeEach(() => {
  // Reset Zustand stores
  useChatStore.setState(initialState);

  // Reset MSW handlers
  server.resetHandlers();
});
```

### 2. Test Event Sequences

```typescript
it('handles full message flow', () => {
  const { handleAgentEvent } = useChatStore.getState();

  // Simulate complete flow
  handleAgentEvent({ type: 'session_start', ... });
  handleAgentEvent({ type: 'thinking', content: 'Processing...' });
  handleAgentEvent({ type: 'message_chunk', delta: 'Hello' });
  handleAgentEvent({ type: 'message_chunk', delta: ' World' });
  handleAgentEvent({ type: 'message', content: 'Hello World' });
  handleAgentEvent({ type: 'complete', stopReason: 'end_turn' });

  // Verify final state
  const state = useChatStore.getState();
  expect(state.messages).toHaveLength(1);
  expect(state.isAgentBusy).toBe(false);
});
```

### 3. Test Error Handling

```typescript
it('handles network errors gracefully', async () => {
  server.use(
    http.get(`${API_URL}/api/sessions`, () => {
      return HttpResponse.error();
    })
  );

  const result = await api.getSessions();

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe('NETWORK_ERROR');
  }
});
```

### 4. Use Type-Safe Mocks

```typescript
// Leverage shared types for mock data
import type { AgentEvent, Session } from '@bc-agent/shared';

const mockEvent: AgentEvent = {
  type: 'message',
  // TypeScript enforces all required fields
};
```

---

## Coverage Requirements

Current thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 70% |
| Branches | 70% |
| Functions | 70% |
| Lines | 70% |

Run coverage report:

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory.
