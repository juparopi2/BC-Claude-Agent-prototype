# Frontend Technical Architecture

**Version**: 1.0.0
**Date**: 2025-11-19
**Prerequisites**: Read `frontend-rebuild-prd.md` first

---

## Table of Contents

1. [Technology Stack](#1-technology-stack)
2. [Project Structure](#2-project-structure)
3. [State Management Architecture](#3-state-management-architecture)
4. [WebSocket Architecture](#4-websocket-architecture)
5. [Component Patterns](#5-component-patterns)
6. [Data Fetching Patterns](#6-data-fetching-patterns)
7. [Error Handling Patterns](#7-error-handling-patterns)
8. [Performance Optimization](#8-performance-optimization)
9. [Code Examples](#9-code-examples)

---

## 1. Technology Stack

### 1.1 Core Dependencies

```json
{
  "dependencies": {
    "next": "16.0.1",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "typescript": "5.7.3",

    "@tanstack/react-query": "5.70.0",
    "zustand": "5.0.3",
    "socket.io-client": "4.8.1",

    "tailwindcss": "4.1.17",
    "@radix-ui/react-dialog": "1.1.4",
    "@radix-ui/react-dropdown-menu": "2.1.4",
    "@radix-ui/react-toast": "1.2.4",

    "react-markdown": "9.0.3",
    "react-syntax-highlighter": "15.6.1",

    "axios": "1.7.9",
    "sonner": "1.7.1",
    "clsx": "2.1.1",
    "tailwind-merge": "2.7.0"
  },
  "devDependencies": {
    "@types/react": "19.0.8",
    "@types/node": "22.13.6",
    "eslint": "9.19.0",
    "eslint-config-next": "16.0.1"
  }
}
```

**Important**: All versions are **exact** (no `^` or `~`). See `CLAUDE.md` for NPM dependency conventions.

---

### 1.2 Folder Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (providers)
│   ├── page.tsx                  # Landing page
│   ├── login/
│   │   └── page.tsx              # Login redirect page
│   ├── new/
│   │   └── page.tsx              # Create session + redirect
│   ├── chat/
│   │   └── [sessionId]/
│   │       └── page.tsx          # Chat interface
│   └── settings/
│       └── page.tsx              # User settings
│
├── components/                   # React components
│   ├── ui/                       # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   └── ...
│   ├── chat/                     # Chat-specific components
│   │   ├── ChatContainer.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── MessageList.tsx
│   │   ├── AgentProcessGroup.tsx
│   │   ├── ThinkingIndicator.tsx
│   │   └── ToolExecutionCard.tsx
│   ├── layout/                   # Layout components
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── SessionList.tsx
│   ├── approval/                 # Approval components
│   │   ├── ApprovalDialog.tsx
│   │   ├── ApprovalSummary.tsx
│   │   └── ApprovalTimer.tsx
│   └── shared/                   # Shared components
│       ├── ErrorBoundary.tsx
│       ├── MarkdownRenderer.tsx
│       └── Toaster.tsx
│
├── contexts/                     # React contexts
│   └── websocket.tsx             # WebSocket context + provider
│
├── hooks/                        # Custom React hooks
│   ├── useAgentEvents.ts         # WebSocket event handler
│   ├── useOptimistic.ts          # Optimistic UI helper
│   └── useSessionRoom.ts         # Session room management
│
├── lib/                          # Utilities
│   ├── api-client.ts             # Axios instance
│   ├── react-query.ts            # QueryClient config
│   └── utils.ts                  # Helper functions
│
├── queries/                      # React Query hooks
│   ├── keys.ts                   # Query key factory
│   ├── auth.ts                   # useAuth, useBCStatus
│   └── sessions.ts               # useSessions, useMessages
│
├── mutations/                    # React Query mutations
│   ├── sessions.ts               # Create, update, delete session
│   └── auth.ts                   # BC consent, logout
│
├── stores/                       # Zustand stores
│   ├── auth.ts                   # useAuthStore
│   ├── session.ts                # useSessionStore
│   └── ui.ts                     # useUIStore
│
├── types/                        # TypeScript types
│   ├── api.ts                    # REST API types
│   ├── events.ts                 # WebSocket event types
│   └── ui.ts                     # UI state types
│
└── styles/
    └── globals.css               # Tailwind imports
```

---

## 2. Project Structure Rationale

### 2.1 Why App Router over Pages Router?

- **Server Components**: Better performance, smaller bundle
- **Layouts**: Shared layouts with persistent state
- **Loading States**: Built-in loading.tsx support
- **Error Handling**: Built-in error.tsx boundaries
- **Streaming**: RSC streaming for faster TTFB

### 2.2 Why Separate `queries/` and `mutations/`?

- **Clear Intent**: Queries fetch, mutations change
- **Reusability**: Easy to find and reuse hooks
- **Testing**: Easy to mock and test separately
- **Code Organization**: Follows React Query best practices

### 2.3 Why `contexts/` for WebSocket Only?

- **Single Responsibility**: WebSocket is infrastructure-level
- **Provider Hell Avoidance**: Don't overuse Context API
- **Performance**: Context changes trigger re-renders
- **Use Zustand for App State**: More granular control

---

## 3. State Management Architecture

### 3.1 State Ownership Matrix

| State Type | Owner | Why | Example |
|------------|-------|-----|---------|
| **Server State** | React Query | Caching, deduplication, sync | Sessions, messages, user info |
| **Auth State** | Zustand (authStore) | Persistent, global | user, bcStatus |
| **UI State** | Zustand (uiStore) | Persistent, global | sidebarOpen, theme |
| **Session State** | Zustand (sessionStore) | Transient, global | activeSessionId |
| **WebSocket State** | Context | Infrastructure-level | socket, isConnected |
| **Component State** | useState | Local, ephemeral | inputValue, isHovered |
| **Form State** | useState | Local, ephemeral | formData, errors |

---

### 3.2 React Query Configuration

**File**: `lib/react-query.ts`

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutes (data considered fresh)
      cacheTime: 1000 * 60 * 30,       // 30 minutes (keep in cache)
      retry: 3,                        // Retry failed requests 3 times
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,     // Don't refetch on window focus
      refetchOnReconnect: true,        // Refetch on reconnect
      refetchOnMount: false,           // Don't refetch on mount if fresh
    },
    mutations: {
      retry: 1,                        // Retry mutations once
      retryDelay: 1000,
    },
  },
});
```

**Why these settings?**
- `staleTime: 5 minutes` - Sessions/messages don't change frequently
- `cacheTime: 30 minutes` - Keep data in cache for back navigation
- `retry: 3` - Network issues are transient
- `refetchOnWindowFocus: false` - Avoid unnecessary refetches

---

### 3.3 Query Keys Convention

**File**: `queries/keys.ts`

```typescript
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
    bcStatus: ['auth', 'bc-status'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: (limit: number, offset: number) =>
      ['sessions', 'list', { limit, offset }] as const,
    detail: (sessionId: string) =>
      ['sessions', 'detail', sessionId] as const,
  },
  messages: {
    list: (sessionId: string, limit: number, offset: number) =>
      ['messages', 'list', sessionId, { limit, offset }] as const,
  },
} as const;
```

**Convention**: `[domain, operation, ...params]`

**Why factories?**
- Type-safe query keys
- Easy invalidation
- No string typos
- Autocomplete support

---

### 3.4 Zustand Store Patterns

**File**: `stores/auth.ts`

```typescript
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

interface BCStatus {
  hasAccess: boolean;
  tokenExpiresAt: string | null;
  isExpired: boolean;
}

interface AuthStore {
  user: User | null;
  bcStatus: BCStatus | null;
  setUser: (user: User | null) => void;
  setBCStatus: (status: BCStatus | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        bcStatus: null,
        setUser: (user) => set({ user }),
        setBCStatus: (bcStatus) => set({ bcStatus }),
        clearAuth: () => set({ user: null, bcStatus: null }),
      }),
      {
        name: 'auth-storage',
        partialize: (state) => ({ user: state.user }), // Only persist user
      }
    ),
    { name: 'AuthStore' }
  )
);
```

**Why persist user but not bcStatus?**
- User info is stable (doesn't change often)
- BC status expires and needs refetch

---

## 4. WebSocket Architecture

### 4.1 Connection Management

**File**: `contexts/websocket.tsx`

```typescript
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentEvent } from '@/types/events';

interface WebSocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  sendMessage: (sessionId: string, message: string) => void;
  respondToApproval: (approvalId: string, approved: boolean) => void;
  joinSession: (sessionId: string) => void;
  leaveSession: (sessionId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io(
      process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002',
      {
        transports: ['websocket'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      }
    );

    socketInstance.on('connect', () => {
      console.log('[WebSocket] Connected:', socketInstance.id);
      setIsConnected(true);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error);
      if (error.message === 'Unauthorized') {
        window.location.href = '/login';
      }
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const sendMessage = useCallback((sessionId: string, message: string) => {
    if (!socket) return;
    socket.emit('chat:message', { sessionId, message });
  }, [socket]);

  const respondToApproval = useCallback((approvalId: string, approved: boolean) => {
    if (!socket) return;
    socket.emit('approval:respond', { approvalId, approved });
  }, [socket]);

  const joinSession = useCallback((sessionId: string) => {
    if (!socket) return;
    socket.emit('session:join', { sessionId });
    console.log('[WebSocket] Joined session:', sessionId);
  }, [socket]);

  const leaveSession = useCallback((sessionId: string) => {
    if (!socket) return;
    socket.emit('session:leave', { sessionId });
    console.log('[WebSocket] Left session:', sessionId);
  }, [socket]);

  return (
    <WebSocketContext.Provider
      value={{
        socket,
        isConnected,
        sendMessage,
        respondToApproval,
        joinSession,
        leaveSession,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
};
```

---

### 4.2 Event Handler Pattern

**File**: `hooks/useAgentEvents.ts`

```typescript
import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/websocket';
import { AgentEvent } from '@/types/events';

interface UseAgentEventsOptions {
  onThinking?: (event: ThinkingEvent) => void;
  onMessageChunk?: (event: MessageChunkEvent) => void;
  onMessage?: (event: MessageEvent) => void;
  onToolUse?: (event: ToolUseEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onApprovalRequested?: (event: ApprovalRequestedEvent) => void;
}

export const useAgentEvents = (options: UseAgentEventsOptions) => {
  const { socket } = useWebSocket();

  const handleEvent = useCallback((event: AgentEvent) => {
    console.log(`[Event] ${event.type} (seq: ${event.sequenceNumber})`);

    switch (event.type) {
      case 'thinking':
        options.onThinking?.(event);
        break;
      case 'message_chunk':
        options.onMessageChunk?.(event);
        break;
      case 'message':
        options.onMessage?.(event);
        break;
      case 'tool_use':
        options.onToolUse?.(event);
        break;
      case 'tool_result':
        options.onToolResult?.(event);
        break;
      case 'complete':
        options.onComplete?.(event);
        break;
      case 'error':
        options.onError?.(event);
        break;
      case 'approval_requested':
        options.onApprovalRequested?.(event);
        break;
    }
  }, [options]);

  useEffect(() => {
    if (!socket) return;

    socket.on('agent:event', handleEvent);
    socket.on('approval:requested', (data) => {
      if (options.onApprovalRequested) {
        options.onApprovalRequested(data as ApprovalRequestedEvent);
      }
    });

    return () => {
      socket.off('agent:event', handleEvent);
      socket.off('approval:requested');
    };
  }, [socket, handleEvent, options.onApprovalRequested]);
};
```

**Why separate approval:requested event?**
- Backend emits it on separate channel
- Needs special UI handling (modal)
- Different from agent:event stream

---

### 4.3 Session Room Management

**File**: `hooks/useSessionRoom.ts`

```typescript
import { useEffect } from 'react';
import { useWebSocket } from '@/contexts/websocket';

export const useSessionRoom = (sessionId: string | null) => {
  const { joinSession, leaveSession } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

    joinSession(sessionId);

    return () => {
      leaveSession(sessionId);
    };
  }, [sessionId, joinSession, leaveSession]);
};
```

**Usage in Chat Page**:
```typescript
'use client';

export default function ChatPage({ params }: { params: { sessionId: string } }) {
  useSessionRoom(params.sessionId); // Auto join/leave

  return <ChatContainer sessionId={params.sessionId} />;
}
```

---

## 5. Component Patterns

### 5.1 Server vs Client Components

**Rule of Thumb**:
- Use **Server Components** by default
- Use **Client Components** only when needed:
  - Event handlers (onClick, onChange)
  - Hooks (useState, useEffect, useQuery)
  - Browser APIs (window, localStorage)
  - Real-time updates (WebSocket)

**Example**: Layout (Server Component)
```typescript
// app/layout.tsx (Server Component - NO 'use client')
import { QueryClientProvider } from '@/components/providers/QueryClientProvider';
import { WebSocketProvider } from '@/contexts/websocket';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryClientProvider>
          <WebSocketProvider>
            {children}
          </WebSocketProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

**Example**: Chat Page (Client Component)
```typescript
// app/chat/[sessionId]/page.tsx (Client Component - needs 'use client')
'use client';

import { ChatContainer } from '@/components/chat/ChatContainer';
import { useSessionRoom } from '@/hooks/useSessionRoom';

export default function ChatPage({ params }: { params: { sessionId: string } }) {
  useSessionRoom(params.sessionId); // Hook requires 'use client'

  return <ChatContainer sessionId={params.sessionId} />;
}
```

---

### 5.2 Component Composition Pattern

**Principle**: Compose small, focused components instead of large monoliths.

**Bad** (Monolithic Component):
```typescript
// ❌ DON'T: 500-line ChatContainer with everything
export const ChatContainer = () => {
  // 500 lines of code...
  return (
    <div>
      {/* Message list rendering */}
      {/* Chat input rendering */}
      {/* Approval dialog rendering */}
      {/* Tool execution rendering */}
    </div>
  );
};
```

**Good** (Composed Components):
```typescript
// ✅ DO: Compose small components
export const ChatContainer = ({ sessionId }: { sessionId: string }) => {
  return (
    <div className="chat-container">
      <MessageList sessionId={sessionId} />
      <ChatInput sessionId={sessionId} />
      <ApprovalDialog sessionId={sessionId} />
    </div>
  );
};
```

---

### 5.3 Compound Component Pattern

**Use Case**: Complex components with shared state (e.g., AgentProcessGroup)

**Example**:
```typescript
// components/chat/AgentProcessGroup.tsx
import * as Collapsible from '@radix-ui/react-collapsible';

interface AgentProcessGroupProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const AgentProcessGroup = ({ children, defaultOpen = false }: AgentProcessGroupProps) => {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <div className="agent-process-group">
        {children}
      </div>
    </Collapsible.Root>
  );
};

AgentProcessGroup.Trigger = ({ children }: { children: React.ReactNode }) => {
  return (
    <Collapsible.Trigger asChild>
      <button className="process-group-trigger">{children}</button>
    </Collapsible.Trigger>
  );
};

AgentProcessGroup.Content = ({ children }: { children: React.ReactNode }) => {
  return (
    <Collapsible.Content className="process-group-content">
      {children}
    </Collapsible.Content>
  );
};
```

**Usage**:
```typescript
<AgentProcessGroup>
  <AgentProcessGroup.Trigger>
    Agent Process Details ▼
  </AgentProcessGroup.Trigger>
  <AgentProcessGroup.Content>
    <ThinkingIndicator />
    <ToolExecutionCard />
  </AgentProcessGroup.Content>
</AgentProcessGroup>
```

---

## 6. Data Fetching Patterns

### 6.1 Queries with Pagination

**File**: `queries/sessions.ts`

```typescript
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from './keys';
import { apiClient } from '@/lib/api-client';

// Simple list query
export const useSessions = (limit = 50, offset = 0) => {
  return useQuery({
    queryKey: queryKeys.sessions.list(limit, offset),
    queryFn: async () => {
      const res = await apiClient.get('/api/chat/sessions', {
        params: { limit, offset },
      });
      return res.data.sessions;
    },
  });
};

// Infinite scroll query
export const useInfiniteSessions = () => {
  return useInfiniteQuery({
    queryKey: queryKeys.sessions.all,
    queryFn: async ({ pageParam = 0 }) => {
      const res = await apiClient.get('/api/chat/sessions', {
        params: { limit: 50, offset: pageParam },
      });
      return res.data.sessions;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 50) return undefined; // No more pages
      return allPages.length * 50; // Next offset
    },
  });
};
```

---

### 6.2 Mutations with Optimistic Updates

**File**: `mutations/sessions.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { queryKeys } from '@/queries/keys';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

export const useUpdateSession = (sessionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (title: string) => {
      const res = await apiClient.patch(
        `/api/chat/sessions/${sessionId}`,
        { title }
      );
      return res.data.session;
    },

    // Optimistic update
    onMutate: async (title) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.sessions.detail(sessionId)
      });

      // Snapshot previous value
      const previousSession = queryClient.getQueryData(
        queryKeys.sessions.detail(sessionId)
      );

      // Optimistically update
      queryClient.setQueryData(
        queryKeys.sessions.detail(sessionId),
        (old: any) => ({ ...old, title })
      );

      return { previousSession }; // Return context for rollback
    },

    // Rollback on error
    onError: (error, _, context) => {
      queryClient.setQueryData(
        queryKeys.sessions.detail(sessionId),
        context?.previousSession
      );
      toast.error('Failed to update session title');
    },

    // Refetch to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.detail(sessionId)
      });
    },

    // Success toast
    onSuccess: () => {
      toast.success('Session title updated');
    },
  });
};
```

**Why this pattern?**
1. **onMutate**: Update immediately (optimistic)
2. **onError**: Rollback if server fails
3. **onSettled**: Refetch to sync with server
4. **onSuccess**: Show success feedback

---

## 7. Error Handling Patterns

### 7.1 Error Boundary

**File**: `components/shared/ErrorBoundary.tsx`

```typescript
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    // TODO: Send to error reporting service (Sentry, etc.)
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.reset);
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
          <p className="text-gray-600 mb-6">{this.state.error?.message}</p>
          <Button onClick={this.reset}>Try again</Button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

### 7.2 Toast Notifications

**Library**: `sonner` (minimal, beautiful)

**File**: `components/shared/Toaster.tsx`

```typescript
'use client';

import { Toaster as SonnerToaster } from 'sonner';

export const Toaster = () => {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={5000}
    />
  );
};
```

**Usage**:
```typescript
import { toast } from 'sonner';

// Success
toast.success('Session created successfully');

// Error with action
toast.error('Failed to send message', {
  description: error.message,
  action: {
    label: 'Retry',
    onClick: () => handleRetry(),
  },
});

// Loading
const toastId = toast.loading('Creating session...');
// Later...
toast.success('Session created!', { id: toastId });
```

---

### 7.3 API Error Interceptor

**File**: `lib/api-client.ts`

```typescript
import axios from 'axios';
import { toast } from 'sonner';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Unauthorized - redirect to login
    if (error.response?.status === 401) {
      toast.error('Session expired. Please login again.');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Forbidden - likely BC access required
    if (error.response?.status === 403) {
      toast.error('Business Central access required', {
        description: 'Please grant BC permissions in settings.',
        action: {
          label: 'Grant Access',
          onClick: () => window.location.href = '/settings',
        },
      });
      return Promise.reject(error);
    }

    // Rate limit
    if (error.response?.status === 429) {
      toast.error('Rate limit exceeded. Please wait a moment.');
      return Promise.reject(error);
    }

    // Server error
    if (error.response?.status >= 500) {
      toast.error('Server error. Please try again later.');
      return Promise.reject(error);
    }

    // Network error
    if (!error.response) {
      toast.error('Network error. Check your connection.');
      return Promise.reject(error);
    }

    // Default error
    toast.error('An error occurred', {
      description: error.response?.data?.message || error.message,
    });

    return Promise.reject(error);
  }
);
```

---

## 8. Performance Optimization

### 8.1 Code Splitting

**Dynamic Imports for Heavy Components**:
```typescript
import dynamic from 'next/dynamic';

// Lazy load approval dialog (not needed until approval requested)
const ApprovalDialog = dynamic(
  () => import('@/components/approval/ApprovalDialog'),
  {
    loading: () => <ApprovalDialogSkeleton />,
    ssr: false, // Client-side only
  }
);

// Lazy load markdown renderer (heavy dependency)
const MarkdownRenderer = dynamic(
  () => import('@/components/shared/MarkdownRenderer'),
  {
    loading: () => <div>Loading...</div>,
    ssr: false,
  }
);
```

---

### 8.2 Virtual Scrolling

**Use Case**: Message list with 1000+ messages

**Library**: `@tanstack/react-virtual`

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export const MessageList = ({ messages }: { messages: Message[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Average message height
    overscan: 5, // Render 5 extra items above/below
  });

  return (
    <div
      ref={parentRef}
      style={{ height: '100%', overflow: 'auto' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <ChatMessage message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

### 8.3 React Query Optimizations

**Prefetching**:
```typescript
// Prefetch next page on hover
const { prefetchQuery } = useQueryClient();

const handleMouseEnter = (sessionId: string) => {
  prefetchQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: () => apiClient.get(`/api/chat/sessions/${sessionId}`),
  });
};
```

**Placeholder Data**:
```typescript
// Show cached session while fetching latest
const { data: session } = useSession(sessionId, {
  placeholderData: (previousData) => previousData, // Show stale data while refetching
});
```

---

## 9. Code Examples

### 9.1 Complete Chat Container

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useWebSocket } from '@/contexts/websocket';
import { useSessionRoom } from '@/hooks/useSessionRoom';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { toast } from 'sonner';

interface ChatContainerProps {
  sessionId: string;
}

export const ChatContainer = ({ sessionId }: ChatContainerProps) => {
  const { sendMessage } = useWebSocket();
  const [accumulatedText, setAccumulatedText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isInputEnabled, setIsInputEnabled] = useState(true);

  // Auto join/leave session room
  useSessionRoom(sessionId);

  // Handle agent events
  useAgentEvents({
    onThinking: () => {
      setIsThinking(true);
      setAccumulatedText('');
    },
    onMessageChunk: (event) => {
      setAccumulatedText((prev) => prev + event.content);
    },
    onMessage: (event) => {
      setIsThinking(false);
      setAccumulatedText('');

      // Check stop_reason
      if (event.stopReason === 'end_turn') {
        setIsInputEnabled(true);
      } else if (event.stopReason === 'tool_use') {
        setIsInputEnabled(false);
      } else if (event.stopReason === 'max_tokens') {
        toast.warning('Response truncated due to token limit');
      }
    },
    onToolUse: (event) => {
      console.log('Tool executing:', event.toolName);
    },
    onToolResult: (event) => {
      if (!event.success) {
        toast.error(`Tool ${event.toolName} failed: ${event.error}`);
      }
    },
    onComplete: (event) => {
      console.log('Execution complete:', event.reason);
      setIsInputEnabled(true);
    },
    onError: (event) => {
      console.error('Agent error:', event.error);
      toast.error(event.error);
      setIsInputEnabled(true);
    },
  });

  const handleSend = useCallback((message: string) => {
    setIsInputEnabled(false);
    sendMessage(sessionId, message);
  }, [sessionId, sendMessage]);

  return (
    <div className="chat-container flex flex-col h-full">
      <MessageList sessionId={sessionId} />
      {isThinking && <ThinkingIndicator />}
      {accumulatedText && (
        <div className="streaming-message">
          {accumulatedText}
        </div>
      )}
      <ChatInput onSend={handleSend} disabled={!isInputEnabled} />
    </div>
  );
};
```

---

### 9.2 Optimistic Session Creation

```typescript
'use client';

import { useCreateSession } from '@/mutations/sessions';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export const NewChatButton = () => {
  const createSession = useCreateSession();

  const handleClick = () => {
    const toastId = toast.loading('Creating new chat...');

    createSession.mutate(undefined, {
      onSuccess: () => {
        toast.success('Chat created!', { id: toastId });
      },
      onError: (error) => {
        toast.error('Failed to create chat', {
          id: toastId,
          description: error.message,
        });
      },
    });
  };

  return (
    <Button
      onClick={handleClick}
      disabled={createSession.isPending}
      className="w-full"
    >
      {createSession.isPending ? 'Creating...' : '+ New Chat'}
    </Button>
  );
};
```

---

## Conclusion

This technical architecture provides a solid foundation for building a performant, maintainable Next.js frontend that integrates seamlessly with the BC Claude Agent backend.

**Key Takeaways**:
1. **React Query** for server state (sessions, messages)
2. **Zustand** for client state (auth, UI, activeSession)
3. **WebSocket Context** for real-time events
4. **Optimistic UI** with rollback on error
5. **Error Boundaries + Toasts** for error handling
6. **Code Splitting + Virtual Scrolling** for performance

**Next Steps**:
1. Read `implementation-phases.md` for step-by-step implementation guide
2. Read `component-specs.md` for detailed component specifications
3. Read `websocket-integration.md` for WebSocket integration patterns

---

**Document Version**: 1.0.0
**Last Updated**: 2025-11-19
**Status**: Ready for Implementation
