# Frontend Migration Plan

**Version**: 1.0.0
**Date**: 2025-11-20
**Status**: Phase 1 Complete (35%)
**Author**: Technical Migration Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Critical Architecture Changes](#3-critical-architecture-changes)
4. [Work Completed (Phase 1)](#4-work-completed-phase-1)
5. [Work Remaining (Phases 2-5)](#5-work-remaining-phases-2-5)
6. [Implementation Guide](#6-implementation-guide)
7. [Critical Patterns & Code Examples](#7-critical-patterns--code-examples)
8. [Testing & Validation](#8-testing--validation)
9. [Rollback Plan](#9-rollback-plan)

---

## 1. Executive Summary

### 1.1 Migration Overview

The BC Claude Agent frontend is undergoing a **complete architectural rebuild** to align with the backend's production-ready contract (379/380 passing tests, 99.7% coverage). This migration addresses critical architectural issues and implements industry best practices.

**Current Progress**: 35% Complete (Phase 1 ✅)

### 1.2 Current State

The frontend currently exists in a **hybrid architecture**:

- **✅ NEW Infrastructure** (17 files): Modern, well-architected foundation
  - Type system with discriminated unions
  - Axios-based API client with interceptors
  - React Query for server state
  - Zustand for client state
  - Socket.IO with discriminated union pattern

- **⚠️ OLD Implementation** (61 files): Pre-existing components with known issues
  - Legacy WebSocket client (separate events pattern)
  - Fetch-based API client (port 3001)
  - Monolithic type definitions
  - Components using outdated patterns

### 1.3 Key Architectural Changes

| Aspect | OLD | NEW | Impact |
|--------|-----|-----|--------|
| **WebSocket Events** | Separate events (`agent:thinking`, `agent:message_complete`) | Single `agent:event` discriminated union | HIGH - Breaking change |
| **API Client** | Fetch-based, manual error handling | Axios with interceptors | MEDIUM |
| **Port** | 3001 | 3002 | LOW - Config only |
| **Types** | Single `lib/types.ts` file | Modular (`types/api.ts`, `types/events.ts`, `types/ui.ts`) | MEDIUM |
| **Message Ordering** | Timestamp-based (race conditions) | sequenceNumber-based (atomic) | HIGH - Bug fix |

### 1.4 Timeline

- **Phase 1** (Week 1): Core Infrastructure ✅ **COMPLETE**
- **Phase 2** (Week 2): Pages & Layout (10 tasks)
- **Phase 3** (Week 3): Chat Interface (8 tasks)
- **Phase 4** (Week 4): Approvals & Shared Components (6 tasks)
- **Phase 5** (Week 5): Cleanup & Testing (10 tasks)

**Estimated Completion**: 4 weeks from Phase 2 start

---

## 2. Current State Analysis

### 2.1 Complete File Inventory

#### NEW Files Created (Phase 1 - 17 files) ✅

```
frontend/
├── types/                          # Type definitions (3 files)
│   ├── api.ts                      # REST API types (User, Session, Message, Approval)
│   ├── events.ts                   # WebSocket discriminated union (8 event types)
│   └── ui.ts                       # UI state types (ChatState, ApprovalDialogState)
│
├── lib/                            # Core utilities (3 files)
│   ├── utils.ts                    # ✅ UPDATED: Added formatDate, formatRelativeTime, truncate
│   ├── api-client.ts               # ✅ NEW: Axios client (port 3002)
│   └── react-query.ts              # ✅ NEW: QueryClient config
│
├── queries/                        # React Query hooks (3 files)
│   ├── keys.ts                     # Query key factory
│   ├── auth.ts                     # useAuth, useBCStatus
│   └── sessions.ts                 # useSessions, useSession, useMessages
│
├── mutations/                      # React Query mutations (2 files)
│   ├── sessions.ts                 # useCreateSession, useUpdateSession, useDeleteSession
│   └── auth.ts                     # useLogout
│
├── stores/                         # Zustand stores (3 files)
│   ├── auth.ts                     # Auth store with persist
│   ├── session.ts                  # Active session ID
│   └── ui.ts                       # Sidebar, theme
│
├── contexts/                       # React contexts (1 file)
│   └── websocket.tsx               # ✅ NEW: Socket.IO provider (discriminated union)
│
└── hooks/                          # Custom hooks (2 files)
    ├── useAgentEvents.ts           # Event handler with type discrimination
    └── useSessionRoom.ts           # Join/leave session lifecycle
```

#### OLD Files (Need Review/Deletion - Selected Examples)

```
frontend/
├── lib/                            # ⚠️ Contains deprecated files
│   ├── api.ts                      # ❌ DELETE: Replaced by api-client.ts
│   ├── socket.ts                   # ❌ DELETE: Replaced by contexts/websocket.tsx
│   ├── types.ts                    # ❌ DELETE: Replaced by types/*
│   └── json-utils.ts               # ❌ DELETE: Not used in new architecture
│
├── app/                            # ⚠️ Needs complete rebuild
│   ├── (app)/                      # Route group (needs review)
│   │   ├── chat/[sessionId]/page.tsx  # ❌ REWRITE: Uses old WebSocket
│   │   ├── layout.tsx              # ❌ REWRITE: Outdated providers
│   │   └── new/page.tsx            # ⚠️ REVIEW: May need updates
│   ├── (auth)/                     # Route group (needs review)
│   │   ├── login/page.tsx          # ⚠️ REVIEW
│   │   └── layout.tsx              # ⚠️ REVIEW
│   ├── layout.tsx                  # ❌ MISSING: Needs creation
│   ├── page.tsx                    # ❌ MISSING: Needs creation
│   └── providers.tsx               # ❌ REVIEW: May be deprecated
│
└── components/                     # ⚠️ Mixed state (some OK, some need rewrite)
    ├── chat/                       # ⚠️ Uses old lib/socket.ts
    │   ├── ChatInterface.tsx       # ❌ REWRITE
    │   ├── Message.tsx             # ❌ REWRITE
    │   ├── MessageList.tsx         # ❌ REWRITE
    │   └── StreamingText.tsx       # ⚠️ REVIEW
    ├── layout/                     # ⚠️ Uses old patterns
    │   ├── Sidebar.tsx             # ❌ REWRITE
    │   └── Header.tsx              # ❌ REWRITE
    └── ui/                         # ✅ shadcn/ui components (keep)
        ├── button.tsx
        ├── dialog.tsx
        └── ...
```

### 2.2 Configuration Files Status

| File | Status | Notes |
|------|--------|-------|
| `tsconfig.json` | ✅ FIXED | Changed `jsx: "react-jsx"` → `"preserve"` |
| `.env.local` | ✅ VERIFIED | Already has correct port 3002 |
| `package.json` | ✅ UPDATED | axios@1.7.9 installed |
| `app/globals.css` | ✅ EXISTS | shadcn theme already configured |
| `tailwind.config.ts` | ✅ EXISTS | Proper configuration |
| `components.json` | ✅ EXISTS | shadcn/ui initialized |

### 2.3 Dependencies Status

**Required Dependencies** (per documentation):

| Package | Documented | Installed | Status |
|---------|-----------|-----------|--------|
| `axios` | 1.7.9 | 1.7.9 | ✅ |
| `next` | 16.0.1 | 16.0.1 | ✅ |
| `react` | 19.2.0 | 19.2.0 | ✅ |
| `@tanstack/react-query` | 5.70.0 | 5.90.7 | ⚠️ Newer (OK) |
| `zustand` | 5.0.3 | 5.0.8 | ⚠️ Newer (OK) |
| `socket.io-client` | 4.8.1 | 4.8.1 | ✅ |
| `react-markdown` | 9.0.3 | 10.1.0 | ⚠️ Major bump |
| `react-syntax-highlighter` | 15.6.1 | 16.1.0 | ⚠️ Major bump |

**Verdict**: Dependencies are acceptable. Minor version differences are not breaking.

---

## 3. Critical Architecture Changes

### 3.1 WebSocket Event Pattern (CRITICAL)

This is the **most critical architectural change** in the migration.

#### OLD Pattern (lib/socket.ts)

```typescript
// ❌ DEPRECATED: Separate events with agent: prefix
export enum SocketEvent {
  MESSAGE_COMPLETE = 'agent:message_complete',
  THINKING = 'agent:thinking',
  TOOL_USE = 'agent:tool_use',
  MESSAGE_CHUNK = 'agent:message_chunk',
  COMPLETE = 'agent:complete',
}

// Multiple separate event listeners
socket.on('agent:thinking', (data) => { ... });
socket.on('agent:message_chunk', (data) => { ... });
socket.on('agent:message_complete', (data) => { ... });
socket.on('agent:tool_use', (data) => { ... });
```

**Problems**:
- Not aligned with backend contract (backend emits single `agent:event`)
- Type safety issues (data is `unknown`)
- Event name mismatch (`agent:message_complete` vs backend's `message` type)

#### NEW Pattern (contexts/websocket.tsx)

```typescript
// ✅ CORRECT: Single discriminated union event
socket.on('agent:event', (event: AgentEvent) => {
  switch (event.type) {
    case 'session_start':
      // TypeScript knows event is SessionStartEvent
      break;
    case 'thinking':
      // TypeScript knows event is ThinkingEvent
      break;
    case 'message_chunk':
      // TypeScript knows event is MessageChunkEvent
      break;
    case 'message':
      // TypeScript knows event is MessageEvent
      // Check event.stopReason
      break;
    case 'tool_use':
      // TypeScript knows event is ToolUseEvent
      break;
    case 'tool_result':
      // TypeScript knows event is ToolResultEvent
      break;
    case 'complete':
      // TypeScript knows event is CompleteEvent
      break;
    case 'error':
      // TypeScript knows event is ErrorEvent
      break;
  }
});
```

**Benefits**:
- ✅ Aligned with backend contract (docs/backend/websocket-contract.md)
- ✅ Full TypeScript type safety (discriminated union)
- ✅ Single source of truth for event types
- ✅ Easier to maintain and extend

#### Migration Impact

**HIGH IMPACT** - All components using WebSocket must be updated:

1. **Replace imports**:
   ```typescript
   // ❌ OLD
   import { socketChatApi } from '@/lib/socket';

   // ✅ NEW
   import { useWebSocket } from '@/contexts/websocket';
   import { useAgentEvents } from '@/hooks/useAgentEvents';
   ```

2. **Replace event listeners**:
   ```typescript
   // ❌ OLD
   socketChatApi.onMessageChunk((data) => { ... });
   socketChatApi.onThinking((data) => { ... });

   // ✅ NEW
   useAgentEvents({
     onMessageChunk: (event) => { ... },
     onThinking: (event) => { ... },
   });
   ```

3. **Update event data structures**:
   ```typescript
   // ❌ OLD (lib/socket.ts types)
   interface MessageEventData {
     content: string;
     role: string;
   }

   // ✅ NEW (types/events.ts)
   interface MessageEvent extends BaseAgentEvent {
     type: 'message';
     content: string;
     stopReason?: StopReason;  // CRITICAL: new field
     tokenCount?: number;
   }
   ```

### 3.2 API Client Architecture

#### OLD Pattern (lib/api.ts)

```typescript
// ❌ DEPRECATED: Fetch-based with manual error handling
const API_BASE_URL = 'http://localhost:3001';  // Wrong port

async function request<T>(method, endpoint, data) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: data ? JSON.stringify(data) : undefined,
  });

  const responseData = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = '/login';  // Manual redirect
    }
    throw new ApiError(responseData?.message, response.status);
  }

  return responseData;
}
```

#### NEW Pattern (lib/api-client.ts)

```typescript
// ✅ CORRECT: Axios with interceptors
const API_BASE_URL = 'http://localhost:3002';  // Correct port

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
    });

    // Interceptor for automatic 401 handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Typed methods
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }
  // ... other methods
}

export const apiClient = new ApiClient();
```

**Benefits**:
- ✅ Correct port (3002)
- ✅ Automatic error handling via interceptors
- ✅ Better TypeScript support
- ✅ Organized API methods (apiClient.auth.me(), apiClient.sessions.list())

### 3.3 Message Ordering Bug (CRITICAL FIX)

#### Bug Location

**File**: `queries/sessions.ts:43-46`

```typescript
// ❌ BUG: Sorts by timestamp (race conditions possible)
export function useMessages(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.messages.list(sessionId),
    queryFn: async () => {
      const response = await apiClient.messages.list(sessionId);
      return response.messages.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()  // ❌ WRONG
      );
    },
  });
}
```

**Why this is a bug**:
- Timestamps are not atomic (can have same millisecond value)
- Race conditions in concurrent message creation
- Backend documentation explicitly states: "Always sort by sequenceNumber, NEVER by timestamp"

#### Correct Implementation

```typescript
// ✅ CORRECT: Sorts by atomic sequenceNumber
return response.messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
```

**Impact**: HIGH - Messages may appear out of order without this fix

**Fix Required**: Phase 2 (when refactoring chat components)

### 3.4 Type Organization

#### OLD Pattern

```typescript
// ❌ lib/types.ts - Single monolithic file (195 lines)
export interface User { ... }
export interface Session { ... }
export interface Message { ... }
export interface AgentEvent { ... }  // Mixed concerns
export interface ChatState { ... }   // Mixed concerns
```

#### NEW Pattern

```typescript
// ✅ types/api.ts - REST API types only
export interface User { ... }
export interface Session { ... }
export interface Message { ... }

// ✅ types/events.ts - WebSocket events only
export type AgentEvent = SessionStartEvent | ThinkingEvent | ...;

// ✅ types/ui.ts - UI state only
export interface ChatState { ... }
export interface ApprovalDialogState { ... }
```

**Benefits**:
- ✅ Clear separation of concerns
- ✅ Easier to find types
- ✅ Better for code splitting
- ✅ Follows documentation structure

### 3.5 Port Configuration

| Environment | OLD Port | NEW Port | Status |
|-------------|----------|----------|--------|
| Backend API | 3001 | 3002 | ✅ `.env.local` updated |
| WebSocket | 3001 | 3002 | ✅ `.env.local` updated |

**Impact**: LOW - Configuration only, no code changes needed

---

## 4. Work Completed (Phase 1)

### 4.1 Type System (types/)

#### types/api.ts

**Purpose**: Type definitions for REST API responses

**Key Exports**:
```typescript
// Core types
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | ...;
export interface User { id, email, name, role, created_at }
export interface BCStatus { hasConsent, tokenExpiry, environment }
export interface Session { id, user_id, title, status, ... }
export interface Message { id, session_id, role, content, stop_reason, ... }
export interface Approval { id, session_id, user_id, action_type, ... }
export interface HealthStatus { status, services }

// Response wrappers
export interface SessionsResponse { sessions: Session[] }
export interface SessionResponse { session: Session }
export interface MessagesResponse { messages: Message[] }
export interface ApprovalsResponse { approvals: Approval[] }
```

**Usage Example**:
```typescript
import type { User, Session } from '@/types/api';

function useAuth(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.auth.me(),
  });
}
```

#### types/events.ts

**Purpose**: WebSocket event discriminated union

**Key Structure**:
```typescript
// Base event (all events extend this)
export interface BaseAgentEvent {
  eventId: string;              // UUID for tracing
  sequenceNumber: number;        // Atomic ordering (CRITICAL)
  persistenceState: 'queued' | 'persisted' | 'failed';
  timestamp: Date;
  correlationId?: string;
  parentEventId?: string;
}

// 8 event types
export interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  content?: string;
}

export interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  content: string;  // Incremental chunk
}

export interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  content: string;           // Full content
  stopReason?: StopReason;   // CRITICAL for UX
  tokenCount?: number;
}

export interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  toolName: string;
  toolArgs: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
}

export interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  reason: string;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  error: string;
  code?: string;
  recoverable: boolean;
}

// Discriminated union
export type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | MessageChunkEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | CompleteEvent
  | ErrorEvent;
```

**Usage Example**:
```typescript
import type { AgentEvent } from '@/types/events';

useAgentEvents({
  onMessage: (event) => {
    // TypeScript knows event is MessageEvent
    console.log(event.content);
    if (event.stopReason === 'end_turn') {
      enableInputField();
    }
  },
});
```

#### types/ui.ts

**Purpose**: Client-side UI state types

**Key Exports**:
```typescript
export interface StreamingMessage {
  content: string;
  isStreaming: boolean;
}

export interface ChatState {
  accumulatedText: string;
  isThinking: boolean;
  isStreaming: boolean;
  activeTool?: string;
}

export interface ApprovalDialogState {
  isOpen: boolean;
  approvalId?: string;
  toolName?: string;
  summary?: { title, description, changes, impact };
  expiresAt?: string;
  timeRemaining?: number;
}

export type Theme = 'light' | 'dark' | 'system';

export interface UIState {
  sidebarOpen: boolean;
  theme: Theme;
}

export interface AuthState {
  user: { id, email, name, role } | null;
  bcStatus: { hasConsent, tokenExpiry, environment } | null;
}

export interface SessionState {
  activeSessionId: string | null;
}
```

### 4.2 API Infrastructure (lib/)

#### lib/utils.ts (Updated)

**Purpose**: Utility functions

**Added Functions**:
```typescript
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date): string {
  const diffMins = Math.floor((now - then) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  // ... more logic
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}
```

#### lib/api-client.ts (New)

**Purpose**: Axios HTTP client for REST API

**Architecture**:
```typescript
class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'http://localhost:3002',  // ✅ Correct port
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
    });

    // Auto-redirect on 401
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Typed HTTP methods
  async get<T>(url: string): Promise<T> { ... }
  async post<T>(url: string, data?: unknown): Promise<T> { ... }
  async put<T>(url: string, data?: unknown): Promise<T> { ... }
  async patch<T>(url: string, data?: unknown): Promise<T> { ... }
  async delete<T>(url: string): Promise<T> { ... }

  // Organized API namespaces
  auth = {
    me: () => this.get<User>('/api/auth/me'),
    bcStatus: () => this.get<BCStatus>('/api/auth/bc-status'),
    logout: () => this.post<void>('/api/auth/logout'),
  };

  sessions = {
    list: () => this.get<SessionsResponse>('/api/chat/sessions'),
    get: (id) => this.get<SessionResponse>(`/api/chat/sessions/${id}`),
    create: (title?) => this.post<SessionResponse>('/api/chat/sessions', { title }),
    update: (id, title) => this.patch<SessionResponse>(`/api/chat/sessions/${id}`, { title }),
    delete: (id) => this.delete<void>(`/api/chat/sessions/${id}`),
  };

  messages = {
    list: (sessionId) => this.get<MessagesResponse>(`/api/chat/sessions/${sessionId}/messages`),
    send: (sessionId, content) => this.post(`/api/chat/sessions/${sessionId}/messages`, { content }),
  };

  approvals = {
    list: () => this.get<ApprovalsResponse>('/api/approvals/pending'),
    approve: (id) => this.post<void>(`/api/approvals/${id}/approve`),
    reject: (id, reason?) => this.post<void>(`/api/approvals/${id}/reject`, { reason }),
  };

  health = {
    check: () => this.get<HealthStatus>('/health'),
  };
}

export const apiClient = new ApiClient();
```

**Usage Example**:
```typescript
import { apiClient } from '@/lib/api-client';

// Typed, autocomplete-friendly
const user = await apiClient.auth.me();  // Returns User
const sessions = await apiClient.sessions.list();  // Returns SessionsResponse
```

#### lib/react-query.ts (New)

**Purpose**: QueryClient configuration

**Configuration**:
```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,  // 5 minutes
      gcTime: 1000 * 60 * 10,     // 10 minutes (renamed from cacheTime)
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});
```

### 4.3 React Query (queries/, mutations/)

#### queries/keys.ts

**Purpose**: Centralized query key factory

**Pattern** (hierarchical keys):
```typescript
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
    bcStatus: () => [...queryKeys.auth.all, 'bc-status'] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    lists: () => [...queryKeys.sessions.all, 'list'] as const,
    list: (filters?) => [...queryKeys.sessions.lists(), filters] as const,
    details: () => [...queryKeys.sessions.all, 'detail'] as const,
    detail: (sessionId) => [...queryKeys.sessions.details(), sessionId] as const,
  },
  messages: {
    all: ['messages'] as const,
    lists: () => [...queryKeys.messages.all, 'list'] as const,
    list: (sessionId) => [...queryKeys.messages.lists(), sessionId] as const,
  },
  // ... more
};
```

**Benefits**:
- ✅ Type-safe query keys
- ✅ Easy invalidation (queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all }))
- ✅ Hierarchical structure for granular cache control

#### queries/auth.ts

```typescript
export function useAuth(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: apiClient.auth.me,
    staleTime: 1000 * 60 * 5,
    retry: false,  // Don't retry 401s
  });
}

export function useBCStatus(): UseQueryResult<BCStatus, Error> {
  return useQuery({
    queryKey: queryKeys.auth.bcStatus(),
    queryFn: apiClient.auth.bcStatus,
    staleTime: 1000 * 60 * 5,
  });
}
```

#### queries/sessions.ts

```typescript
export function useSessions(): UseQueryResult<Session[], Error> {
  return useQuery({
    queryKey: queryKeys.sessions.list(),
    queryFn: async () => {
      const response = await apiClient.sessions.list();
      return response.sessions;
    },
    staleTime: 1000 * 30,
  });
}

export function useSession(sessionId: string): UseQueryResult<Session, Error> {
  return useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: async () => {
      const response = await apiClient.sessions.get(sessionId);
      return response.session;
    },
    enabled: !!sessionId,
  });
}

export function useMessages(sessionId: string): UseQueryResult<Message[], Error> {
  return useQuery({
    queryKey: queryKeys.messages.list(sessionId),
    queryFn: async () => {
      const response = await apiClient.messages.list(sessionId);
      // ⚠️ BUG: Should sort by sequenceNumber, not timestamp
      return response.messages.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    },
    enabled: !!sessionId,
    refetchInterval: false,
  });
}
```

#### mutations/sessions.ts

```typescript
export function useCreateSession() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ title }: { title?: string }) => {
      const response = await apiClient.sessions.create(title);
      return response.session;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      router.push(`/chat/${session.id}`);
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, title }) => {
      const response = await apiClient.sessions.update(sessionId, title);
      return response.session;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(session.id) });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ sessionId }) => {
      await apiClient.sessions.delete(sessionId);
    },
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.removeQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
      router.push('/');
    },
  });
}
```

#### mutations/auth.ts

```typescript
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: apiClient.auth.logout,
    onSuccess: () => {
      queryClient.clear();  // Clear all caches
      router.push('/login');
    },
  });
}
```

### 4.4 State Management (stores/)

#### stores/auth.ts

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthStore extends AuthState {
  setUser: (user: AuthState['user']) => void;
  setBCStatus: (bcStatus: AuthState['bcStatus']) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      bcStatus: null,
      setUser: (user) => set({ user }),
      setBCStatus: (bcStatus) => set({ bcStatus }),
      clearAuth: () => set({ user: null, bcStatus: null }),
    }),
    {
      name: 'auth-storage',  // localStorage key
    }
  )
);
```

**Usage**:
```typescript
const { user, setUser } = useAuthStore();
```

#### stores/session.ts

```typescript
export const useSessionStore = create<SessionStore>((set) => ({
  activeSessionId: null,
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
}));
```

#### stores/ui.ts

```typescript
export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      theme: 'system',
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'ui-storage',
    }
  )
);
```

### 4.5 WebSocket Infrastructure

#### contexts/websocket.tsx

**Purpose**: Socket.IO client provider with discriminated union pattern

**Key Implementation**:
```typescript
'use client';

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io('http://localhost:3002', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketInstance.on('connect', () => {
      console.log('[WebSocket] Connected:', socketInstance.id);
      setIsConnected(true);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
    });

    socketInstance.on('error', (error: { message: string }) => {
      if (error.message === 'Unauthorized') {
        window.location.href = '/login';
      }
    });

    setSocket(socketInstance);

    return () => socketInstance.disconnect();
  }, []);

  const joinSession = useCallback((sessionId: string) => {
    if (!socket) return;
    socket.emit('session:join', { sessionId });
  }, [socket]);

  const sendMessage = useCallback((sessionId: string, content: string, userId: string) => {
    if (!socket) return;
    socket.emit('chat:message', { message: content, sessionId, userId });
  }, [socket]);

  const respondToApproval = useCallback((approvalId: string, approved: boolean, userId: string) => {
    if (!socket) return;
    socket.emit('approval:respond', { approvalId, approved, userId });
  }, [socket]);

  // ✅ CRITICAL: Single event listener for discriminated union
  const onAgentEvent = useCallback((handler: EventHandler<AgentEvent>) => {
    if (!socket) return () => {};
    socket.on('agent:event', handler);
    return () => socket.off('agent:event', handler);
  }, [socket]);

  // ... more methods

  return (
    <WebSocketContext.Provider value={{ socket, isConnected, joinSession, sendMessage, onAgentEvent, ... }}>
      {children}
    </WebSocketContext.Provider>
  );
}
```

#### hooks/useAgentEvents.ts

**Purpose**: Type-safe event handler hook

**Implementation**:
```typescript
export interface AgentEventHandlers {
  onSessionStart?: (event: Extract<AgentEvent, { type: 'session_start' }>) => void;
  onThinking?: (event: Extract<AgentEvent, { type: 'thinking' }>) => void;
  onMessageChunk?: (event: Extract<AgentEvent, { type: 'message_chunk' }>) => void;
  onMessage?: (event: Extract<AgentEvent, { type: 'message' }>) => void;
  onToolUse?: (event: Extract<AgentEvent, { type: 'tool_use' }>) => void;
  onToolResult?: (event: Extract<AgentEvent, { type: 'tool_result' }>) => void;
  onComplete?: (event: Extract<AgentEvent, { type: 'complete' }>) => void;
  onError?: (event: Extract<AgentEvent, { type: 'error' }>) => void;
}

export function useAgentEvents(handlers: AgentEventHandlers) {
  const { onAgentEvent } = useWebSocket();

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'session_start':
        handlers.onSessionStart?.(event);
        break;
      case 'thinking':
        handlers.onThinking?.(event);
        break;
      case 'message_chunk':
        handlers.onMessageChunk?.(event);
        break;
      case 'message':
        handlers.onMessage?.(event);
        break;
      case 'tool_use':
        handlers.onToolUse?.(event);
        break;
      case 'tool_result':
        handlers.onToolResult?.(event);
        break;
      case 'complete':
        handlers.onComplete?.(event);
        break;
      case 'error':
        handlers.onError?.(event);
        break;
    }
  }, [handlers]);

  useEffect(() => {
    const cleanup = onAgentEvent(handleEvent);
    return cleanup;
  }, [onAgentEvent, handleEvent]);
}
```

**Usage Example**:
```typescript
function ChatContainer() {
  const [accumulatedText, setAccumulatedText] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  useAgentEvents({
    onThinking: (event) => {
      setIsThinking(true);
    },
    onMessageChunk: (event) => {
      setAccumulatedText((prev) => prev + event.content);
    },
    onMessage: (event) => {
      setAccumulatedText('');
      setIsThinking(false);
      if (event.stopReason === 'end_turn') {
        // Enable input field
      }
    },
  });

  return <div>...</div>;
}
```

#### hooks/useSessionRoom.ts

**Purpose**: Automatic session room join/leave

**Implementation**:
```typescript
export function useSessionRoom(sessionId: string | null) {
  const { joinSession, leaveSession } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

    console.log('[useSessionRoom] Joining:', sessionId);
    joinSession(sessionId);

    return () => {
      console.log('[useSessionRoom] Leaving:', sessionId);
      leaveSession(sessionId);
    };
  }, [sessionId, joinSession, leaveSession]);
}
```

**Usage Example**:
```typescript
function ChatPage({ params }: { params: { sessionId: string } }) {
  useSessionRoom(params.sessionId);  // Auto join/leave

  return <ChatContainer sessionId={params.sessionId} />;
}
```

---

## 5. Work Remaining (Phases 2-5)

### 5.1 Phase 2: Pages & Layout (10 tasks)

#### 5.1.1 Install shadcn/ui Components

**Required Components**:
```bash
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add input
npx shadcn@latest add scroll-area
npx shadcn@latest add avatar
npx shadcn@latest add dropdown-menu
npx shadcn@latest add separator
npx shadcn@latest add badge
npx shadcn@latest add progress
npx shadcn@latest add toast
```

**Verification**:
- Check `components/ui/` has all components
- Verify imports work: `import { Button } from '@/components/ui/button'`

#### 5.1.2 Create app/layout.tsx

**Purpose**: Root layout with all providers

**Structure**:
```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { WebSocketProvider } from '@/contexts/websocket';
import { Toaster } from '@/components/shared/Toaster';
import { queryClient } from '@/lib/react-query';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <WebSocketProvider>
              {children}
              <Toaster />
            </WebSocketProvider>
          </ThemeProvider>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

**Key Features**:
- ✅ QueryClientProvider wraps entire app
- ✅ WebSocketProvider establishes connection
- ✅ ThemeProvider enables dark mode
- ✅ Toaster for notifications
- ✅ ReactQueryDevtools in development

#### 5.1.3 Create app/page.tsx

**Purpose**: Landing page (redirect to /new if authenticated)

**Logic**:
```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/queries/auth';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  const { data: user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.push('/new');
    }
  }, [user, router]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">BC Claude Agent</h1>
        <p className="text-muted-foreground mb-8">
          AI-powered assistant for Microsoft Business Central
        </p>
        <Button asChild>
          <a href="/login">Login with Microsoft</a>
        </Button>
      </div>
    </div>
  );
}
```

#### 5.1.4 Create app/login/page.tsx

**Purpose**: Redirect to Microsoft OAuth

**Implementation**:
```typescript
'use client';

import { useEffect } from 'react';

export default function LoginPage() {
  useEffect(() => {
    window.location.href = '/api/auth/login';
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p>Redirecting to Microsoft login...</p>
      </div>
    </div>
  );
}
```

#### 5.1.5 Create app/new/page.tsx

**Purpose**: Create new session and redirect

**Implementation**:
```typescript
'use client';

import { useEffect } from 'react';
import { useCreateSession } from '@/mutations/sessions';

export default function NewSessionPage() {
  const { mutate: createSession } = useCreateSession();

  useEffect(() => {
    createSession({ title: undefined });  // Auto-redirect on success
  }, [createSession]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p>Creating new session...</p>
      </div>
    </div>
  );
}
```

#### 5.1.6 Create components/layout/Sidebar.tsx

**Purpose**: Session list sidebar

**Key Features**:
- Show all sessions (sorted by last_activity_at)
- Highlight active session
- Create new session button
- Delete session functionality
- Collapsible on mobile

**Props**:
```typescript
interface SidebarProps {
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
}
```

**Structure**:
```typescript
import { useSessions } from '@/queries/sessions';
import { useDeleteSession } from '@/mutations/sessions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { SessionList } from './SessionList';

export function Sidebar({ activeSessionId, onSelectSession }: SidebarProps) {
  const { data: sessions, isLoading } = useSessions();
  const { mutate: deleteSession } = useDeleteSession();

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4">
        <Button asChild className="w-full">
          <a href="/new">New Session</a>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <SessionList
          sessions={sessions || []}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onDelete={(id) => deleteSession({ sessionId: id })}
        />
      </ScrollArea>
    </div>
  );
}
```

#### 5.1.7 Create components/layout/Header.tsx

**Purpose**: Top navigation bar

**Key Features**:
- User avatar + name
- BC status indicator
- Logout button
- Theme toggle

**Structure**:
```typescript
import { useAuth, useBCStatus } from '@/queries/auth';
import { useLogout } from '@/mutations/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

export function Header() {
  const { data: user } = useAuth();
  const { data: bcStatus } = useBCStatus();
  const { mutate: logout } = useLogout();

  return (
    <header className="border-b px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">BC Claude Agent</h1>
        {bcStatus?.hasConsent && (
          <Badge variant="success">BC Connected</Badge>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Avatar>
            <AvatarFallback>{user?.name.charAt(0)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => logout()}>
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

#### 5.1.8 Create components/layout/SessionList.tsx

**Purpose**: List of sessions with sorting

**Implementation**:
```typescript
import { formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

export function SessionList({ sessions, activeSessionId, onSelect, onDelete }: SessionListProps) {
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
  );

  return (
    <div className="space-y-2 p-2">
      {sortedSessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            'p-3 rounded-lg cursor-pointer hover:bg-accent',
            session.id === activeSessionId && 'bg-accent'
          )}
          onClick={() => onSelect(session.id)}
        >
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {session.title || 'Untitled Session'}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatRelativeTime(session.last_activity_at)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 5.2 Phase 3: Chat Interface (8 tasks)

#### 5.2.1 Create components/chat/ChatContainer.tsx

**Purpose**: Main chat component orchestrator

**Key Responsibilities**:
- Setup useAgentEvents hook
- Manage message accumulation state
- Handle stop_reason pattern
- Render MessageList + ChatInput

**Structure**:
```typescript
'use client';

import { useState } from 'react';
import { useMessages } from '@/queries/sessions';
import { useWebSocket } from '@/contexts/websocket';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useAuthStore } from '@/stores/auth';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const { data: messages = [] } = useMessages(sessionId);
  const { sendMessage } = useWebSocket();
  const { user } = useAuthStore();

  const [accumulatedText, setAccumulatedText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [canSend, setCanSend] = useState(true);
  const [activeTool, setActiveTool] = useState<string | undefined>();

  useAgentEvents({
    onThinking: (event) => {
      setIsThinking(true);
      setCanSend(false);
    },
    onMessageChunk: (event) => {
      setAccumulatedText((prev) => prev + event.content);
    },
    onMessage: (event) => {
      setAccumulatedText('');
      setIsThinking(false);

      // CRITICAL: Stop reason pattern
      if (event.stopReason === 'end_turn') {
        setCanSend(true);  // Final message, enable input
        setActiveTool(undefined);
      } else if (event.stopReason === 'tool_use') {
        setCanSend(false);  // Wait for tool execution
      }
    },
    onToolUse: (event) => {
      setActiveTool(event.toolName);
      setCanSend(false);
    },
    onToolResult: (event) => {
      setActiveTool(undefined);
    },
    onComplete: (event) => {
      setCanSend(true);
      setIsThinking(false);
      setAccumulatedText('');
    },
    onError: (event) => {
      setCanSend(true);
      setIsThinking(false);
      setAccumulatedText('');
      // Show error toast
    },
  });

  const handleSend = (content: string) => {
    if (!user?.id) return;
    sendMessage(sessionId, content, user.id);
    setCanSend(false);
  };

  return (
    <div className="flex flex-col h-full">
      <MessageList
        messages={messages}
        accumulatedText={accumulatedText}
        isThinking={isThinking}
        activeTool={activeTool}
      />
      <ChatInput
        onSend={handleSend}
        disabled={!canSend}
        placeholder={
          activeTool ? `Executing ${activeTool}...` : 'Type a message...'
        }
      />
    </div>
  );
}
```

**Critical Patterns**:
1. ✅ Message accumulation (accumulatedText state)
2. ✅ Stop reason pattern (end_turn vs tool_use)
3. ✅ Disable input during streaming/tool execution
4. ✅ Clear accumulated text on final message

#### 5.2.2 Create components/chat/MessageList.tsx

**Purpose**: Scrollable message list with streaming support

**Key Responsibilities**:
- Sort messages by sequenceNumber (FIX BUG!)
- Virtual scrolling for performance
- Auto-scroll to bottom on new messages
- Show accumulated streaming text

**Structure**:
```typescript
import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { Message } from '@/types/api';

interface MessageListProps {
  messages: Message[];
  accumulatedText: string;
  isThinking: boolean;
  activeTool?: string;
}

export function MessageList({ messages, accumulatedText, isThinking, activeTool }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ✅ CRITICAL: Sort by sequenceNumber (fix bug)
  const sortedMessages = [...messages].sort((a, b) => {
    // Assuming messages have sequenceNumber field (need to add to types/api.ts)
    return (a as any).sequenceNumber - (b as any).sequenceNumber;
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, accumulatedText]);

  return (
    <ScrollArea ref={scrollRef} className="flex-1 p-4">
      <div className="space-y-4">
        {sortedMessages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isThinking && <ThinkingIndicator />}

        {accumulatedText && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: accumulatedText,
              session_id: '',
              created_at: new Date().toISOString(),
            }}
            isStreaming
          />
        )}

        {activeTool && (
          <div className="text-sm text-muted-foreground">
            Executing tool: {activeTool}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
```

**Bug Fix Required**:
- Add `sequenceNumber` field to Message interface in `types/api.ts`
- Sort by sequenceNumber, not created_at

#### 5.2.3 Create components/chat/ChatMessage.tsx

**Purpose**: Single message display (user/assistant variants)

**Key Features**:
- User messages: right-aligned, blue
- Assistant messages: left-aligned, gray
- Markdown rendering support
- Show thinking indicator for tool_use stop_reason

**Structure**:
```typescript
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import type { Message } from '@/types/api';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
        )}
      </div>
    </div>
  );
}
```

#### 5.2.4 Create components/chat/ChatInput.tsx

**Purpose**: Auto-resize textarea input

**Key Features**:
- Auto-resize (min 1 line, max 10 lines)
- Send on Enter, new line on Shift+Enter
- Disable while streaming or waiting for tool
- Character count (optional)

**Structure**:
```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Type a message...'}
          disabled={disabled}
          className="flex-1 resize-none rounded-md border px-3 py-2 min-h-[40px] max-h-[200px]"
          rows={1}
        />
        <Button onClick={handleSubmit} disabled={disabled || !value.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

#### 5.2.5 Create components/chat/AgentProcessGroup.tsx

**Purpose**: Collapsible agent process details

**Structure**:
```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { ToolExecutionCard } from './ToolExecutionCard';

interface AgentProcessGroupProps {
  tools: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    success?: boolean;
    error?: string;
  }>;
  thinkingContent?: string;
}

export function AgentProcessGroup({ tools, thinkingContent }: AgentProcessGroupProps) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-4 w-4" />
        Agent Process ({tools.length} tools)
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 mt-2">
        {thinkingContent && (
          <div className="text-sm text-muted-foreground p-2 bg-muted rounded">
            {thinkingContent}
          </div>
        )}
        {tools.map((tool, idx) => (
          <ToolExecutionCard key={idx} tool={tool} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

#### 5.2.6 Create components/chat/ThinkingIndicator.tsx

**Purpose**: Animated thinking indicator

**Structure**:
```typescript
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm">Thinking...</span>
    </div>
  );
}
```

#### 5.2.7 Create components/chat/ToolExecutionCard.tsx

**Purpose**: Display tool execution details

**Structure**:
```typescript
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle } from 'lucide-react';

interface ToolExecutionCardProps {
  tool: {
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    success?: boolean;
    error?: string;
  };
}

export function ToolExecutionCard({ tool }: ToolExecutionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{tool.toolName}</CardTitle>
          {tool.success !== undefined && (
            <Badge variant={tool.success ? 'success' : 'destructive'}>
              {tool.success ? (
                <CheckCircle className="h-3 w-3 mr-1" />
              ) : (
                <XCircle className="h-3 w-3 mr-1" />
              )}
              {tool.success ? 'Success' : 'Failed'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <div>
          <p className="font-medium mb-1">Arguments:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(tool.args, null, 2)}
          </pre>
        </div>
        {tool.result && (
          <div>
            <p className="font-medium mb-1">Result:</p>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(tool.result, null, 2)}
            </pre>
          </div>
        )}
        {tool.error && (
          <div>
            <p className="font-medium text-destructive mb-1">Error:</p>
            <p className="text-xs text-destructive">{tool.error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

#### 5.2.8 Update app/chat/[sessionId]/page.tsx

**Purpose**: Chat page with new architecture

**Structure**:
```typescript
'use client';

import { use } from 'react';
import { useSessionRoom } from '@/hooks/useSessionRoom';
import { useSession } from '@/queries/sessions';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export default function ChatPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const { data: session, isLoading } = useSession(sessionId);

  // ✅ Auto join/leave session room
  useSessionRoom(sessionId);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeSessionId={sessionId} onSelectSession={(id) => window.location.href = `/chat/${id}`} />
        <main className="flex-1">
          <ChatContainer sessionId={sessionId} />
        </main>
      </div>
    </div>
  );
}
```

### 5.3 Phase 4: Approvals & Shared Components (6 tasks)

#### 5.3.1 Create components/approval/ApprovalDialog.tsx

**Purpose**: Modal dialog for approval requests

**Key Features**:
- Listen to `approval:requested` event
- Show modal with tool details
- Approve/Reject buttons
- Close on `approval:resolved`

**Structure**:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { useWebSocket } from '@/contexts/websocket';
import { useAuthStore } from '@/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ApprovalSummary } from './ApprovalSummary';
import { ApprovalTimer } from './ApprovalTimer';
import type { ApprovalRequestedEvent } from '@/types/events';

export function ApprovalDialog() {
  const { onApprovalRequested, onApprovalResolved, respondToApproval } = useWebSocket();
  const { user } = useAuthStore();
  const [approval, setApproval] = useState<ApprovalRequestedEvent | null>(null);

  useEffect(() => {
    const cleanupRequested = onApprovalRequested((event) => {
      setApproval(event);
    });

    const cleanupResolved = onApprovalResolved(() => {
      setApproval(null);
    });

    return () => {
      cleanupRequested();
      cleanupResolved();
    };
  }, [onApprovalRequested, onApprovalResolved]);

  const handleApprove = () => {
    if (!approval || !user) return;
    respondToApproval(approval.approvalId, true, user.id);
  };

  const handleReject = () => {
    if (!approval || !user) return;
    respondToApproval(approval.approvalId, false, user.id);
  };

  return (
    <Dialog open={!!approval} onOpenChange={() => setApproval(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Approval Required: {approval?.toolName}</DialogTitle>
        </DialogHeader>
        {approval && (
          <>
            <ApprovalTimer expiresAt={approval.expiresAt} />
            <ApprovalSummary summary={approval.summary} changes={approval.changes} />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleReject}>
            Reject
          </Button>
          <Button onClick={handleApprove}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### 5.3.2 Create components/approval/ApprovalSummary.tsx

**Purpose**: Display approval details

**Structure**:
```typescript
import { Badge } from '@/components/ui/badge';

interface ApprovalSummaryProps {
  summary: {
    title: string;
    description: string;
    changes: Record<string, unknown>;
    impact: 'high' | 'medium' | 'low';
  };
  changes: Record<string, unknown>;
}

export function ApprovalSummary({ summary, changes }: ApprovalSummaryProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-medium">{summary.title}</h3>
          <Badge variant={summary.impact === 'high' ? 'destructive' : 'default'}>
            {summary.impact} impact
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{summary.description}</p>
      </div>
      <div>
        <h4 className="font-medium mb-2">Changes:</h4>
        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
          {JSON.stringify(changes, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

#### 5.3.3 Create components/approval/ApprovalTimer.tsx

**Purpose**: 5-minute countdown timer

**Structure**:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { Progress } from '@/components/ui/progress';

interface ApprovalTimerProps {
  expiresAt: string;
}

export function ApprovalTimer({ expiresAt }: ApprovalTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expiry = new Date(expiresAt).getTime();
      const remaining = Math.max(0, expiry - now);
      const total = 5 * 60 * 1000; // 5 minutes

      setTimeRemaining(remaining);
      setProgress((remaining / total) * 100);

      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Time remaining:</span>
        <span className="font-mono">
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>
      <Progress value={progress} />
    </div>
  );
}
```

#### 5.3.4 Create components/shared/ErrorBoundary.tsx

**Purpose**: Catch React errors gracefully

**Structure**:
```typescript
'use client';

import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button onClick={() => this.setState({ hasError: false })}>
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

#### 5.3.5 Create components/shared/MarkdownRenderer.tsx

**Purpose**: Render markdown with syntax highlighting

**Structure**:
```typescript
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ReactMarkdown
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');

          if (!inline && match) {
            return (
              <div className="relative">
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 h-6 w-6"
                  onClick={() => handleCopy(code)}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  {...props}
                >
                  {code}
                </SyntaxHighlighter>
              </div>
            );
          }

          return (
            <code className="bg-muted px-1 py-0.5 rounded text-sm" {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

#### 5.3.6 Create components/shared/Toaster.tsx

**Purpose**: Toast notifications (sonner)

**Structure**:
```typescript
'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return <SonnerToaster position="bottom-right" richColors />;
}
```

**Usage**:
```typescript
import { toast } from 'sonner';

toast.success('Session created!');
toast.error('Failed to send message');
toast.info('Approval required');
```

### 5.4 Phase 5: Cleanup & Testing (10 tasks)

#### 5.4.1 Delete Deprecated Files

```bash
# Delete old API client
rm frontend/lib/api.ts

# Delete old WebSocket client
rm frontend/lib/socket.ts

# Delete old types
rm frontend/lib/types.ts

# Delete json-utils (not used)
rm frontend/lib/json-utils.ts
```

#### 5.4.2 Fix Imports

Search and replace across all files:

```bash
# Replace lib/api → lib/api-client
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/from "\.\.\/lib\/api"/from "\.\.\/lib\/api-client"/g'

# Replace lib/socket → contexts/websocket
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/from "\.\.\/lib\/socket"/from "\.\.\/contexts\/websocket"/g'

# Replace lib/types → types/*
find . -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/from "\.\.\/lib\/types"/from "\.\.\/types\/api"/g'
```

#### 5.4.3 Fix sequenceNumber Bug

**File**: `queries/sessions.ts:43-46`

```typescript
// ❌ BEFORE (BUG)
return response.messages.sort(
  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
);

// ✅ AFTER (FIXED)
return response.messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
```

**Also update** `types/api.ts`:
```typescript
export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sequenceNumber: number;  // ✅ ADD THIS FIELD
  stop_reason?: StopReason | null;
  thinking_tokens?: number;
  is_thinking?: boolean;
  created_at: string;
}
```

#### 5.4.4 Testing Checklist

**Type Check**:
```bash
npm run type-check
```

**Lint**:
```bash
npm run lint
```

**Manual Testing**:
1. [ ] User can login with Microsoft
2. [ ] User redirected to /new after login
3. [ ] New session created and redirects to /chat/:id
4. [ ] Sidebar shows all sessions
5. [ ] Clicking session navigates to /chat/:id
6. [ ] WebSocket connects successfully
7. [ ] Sending message works
8. [ ] Message streams character-by-character
9. [ ] Messages appear in correct order (sequenceNumber)
10. [ ] Input re-enables when stopReason='end_turn'
11. [ ] Input stays disabled when stopReason='tool_use'
12. [ ] Approval dialog opens on tool approval request
13. [ ] Approval countdown works (5 minutes)
14. [ ] Approving/rejecting tool works
15. [ ] Error boundaries catch errors
16. [ ] Toast notifications work
17. [ ] Markdown renders correctly
18. [ ] Code blocks have copy button
19. [ ] Syntax highlighting works
20. [ ] Logout works

**Performance**:
- Run Lighthouse audit (target: ≥ 90 score)

**Accessibility**:
- Test with keyboard navigation
- Test with screen reader
- Check color contrast

---

## 7. Critical Patterns & Code Examples

### 7.1 Stop Reason Pattern

**Documentation Reference**: `docs/frontend/README.md:128-135`

```typescript
// ✅ CRITICAL: Implement in ChatContainer
useAgentEvents({
  onMessage: (event) => {
    if (event.stopReason === 'end_turn') {
      // Agent finished normally - enable input field
      setCanSend(true);
      setActiveTool(undefined);
    } else if (event.stopReason === 'tool_use') {
      // Agent wants to execute a tool - wait for tool execution
      setCanSend(false);
      // Don't enable input yet!
    } else if (event.stopReason === 'max_tokens') {
      // Hit token limit - show warning
      toast.warning('Message truncated due to token limit');
      setCanSend(true);
    }
  },
});
```

**Why This Matters**:
- `end_turn` = Final message, user can respond
- `tool_use` = Intermediate message, wait for tool execution
- If you enable input on `tool_use`, user experience will be confusing

### 7.2 Message Accumulation Pattern

**Documentation Reference**: `docs/frontend/README.md:147-157`

```typescript
// ✅ CRITICAL: Accumulate chunks, clear on final message
const [accumulatedText, setAccumulatedText] = useState('');

useAgentEvents({
  onMessageChunk: (event) => {
    // Accumulate each chunk
    setAccumulatedText((prev) => prev + event.content);
  },
  onMessage: (event) => {
    // Clear accumulator on final message
    setAccumulatedText('');
  },
});

// Render accumulated text
<ChatMessage
  message={{ content: accumulatedText, role: 'assistant', ... }}
  isStreaming
/>
```

**Why This Matters**:
- Backend sends many `message_chunk` events during streaming
- You must accumulate them into a single string
- Clear accumulator when final `message` event arrives

### 7.3 Sequence Number Sorting

**Documentation Reference**: `docs/frontend/README.md:137-145`

```typescript
// ✅ CORRECT: Sort by atomic sequenceNumber
const sortedMessages = [...messages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

// ❌ WRONG: Sort by timestamp (race conditions!)
const sortedMessages = [...messages].sort((a, b) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
);
```

**Why This Matters**:
- Timestamps can have same millisecond value
- Race conditions in concurrent message creation
- sequenceNumber is atomic (Redis INCR)
- Backend documentation explicitly states: "Always sort by sequenceNumber"

### 7.4 Single WebSocket Event Pattern

**Documentation Reference**: `docs/backend/websocket-contract.md:187-206`

```typescript
// ✅ CORRECT: Single event with discriminated union
socket.on('agent:event', (event: AgentEvent) => {
  switch (event.type) {
    case 'thinking':
      setIsThinking(true);
      break;
    case 'message_chunk':
      setAccumulatedText(prev => prev + event.content);
      break;
    case 'message':
      setAccumulatedText('');
      if (event.stopReason === 'end_turn') {
        setCanSend(true);
      }
      break;
    case 'tool_use':
      setActiveTool(event.toolName);
      break;
    case 'tool_result':
      setActiveTool(undefined);
      break;
    case 'complete':
      setCanSend(true);
      break;
    case 'error':
      toast.error(event.error);
      break;
  }
});

// ❌ WRONG: Separate events (don't exist!)
socket.on('agent:thinking', ...);  // Backend doesn't emit this
socket.on('agent:message_chunk', ...);  // Backend doesn't emit this
```

**Why This Matters**:
- Backend emits single `agent:event` with `type` field
- Discriminated union provides TypeScript type safety
- Old pattern (separate events) does not match backend contract

### 7.5 useAgentEvents Hook Pattern

```typescript
// ✅ BEST PRACTICE: Use hook for type safety
import { useAgentEvents } from '@/hooks/useAgentEvents';

function ChatContainer() {
  useAgentEvents({
    onThinking: (event) => {
      // TypeScript knows event is ThinkingEvent
      console.log('Thinking:', event.content);
    },
    onMessageChunk: (event) => {
      // TypeScript knows event is MessageChunkEvent
      console.log('Chunk:', event.content);
    },
    onMessage: (event) => {
      // TypeScript knows event is MessageEvent
      console.log('Message:', event.content, event.stopReason);
    },
  });
}
```

### 7.6 Session Room Management

```typescript
// ✅ AUTOMATIC: Use hook for lifecycle
import { useSessionRoom } from '@/hooks/useSessionRoom';

function ChatPage({ sessionId }: { sessionId: string }) {
  // Automatically joins on mount, leaves on unmount
  useSessionRoom(sessionId);

  return <ChatContainer sessionId={sessionId} />;
}
```

---

## 8. Testing & Validation

### 8.1 Unit Tests

**Test Coverage Requirements**:
- [ ] All hooks (useAgentEvents, useSessionRoom)
- [ ] All stores (auth, session, ui)
- [ ] All query/mutation hooks
- [ ] Utility functions (formatDate, formatRelativeTime, truncate)

**Example Test**:
```typescript
// hooks/useAgentEvents.test.ts
import { renderHook } from '@testing-library/react';
import { useAgentEvents } from './useAgentEvents';

describe('useAgentEvents', () => {
  it('handles message event correctly', () => {
    const onMessage = jest.fn();
    renderHook(() => useAgentEvents({ onMessage }));

    // Simulate WebSocket event
    mockWebSocket.emit('agent:event', {
      type: 'message',
      content: 'Hello',
      stopReason: 'end_turn',
      eventId: '123',
      sequenceNumber: 1,
      persistenceState: 'persisted',
      timestamp: new Date(),
    });

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: 'Hello',
      stopReason: 'end_turn',
    }));
  });
});
```

### 8.2 Integration Tests

**Test Scenarios**:
- [ ] WebSocket connection established
- [ ] Session creation flow (create → redirect → join room)
- [ ] Message sending flow (send → stream → display)
- [ ] Approval flow (request → approve → continue)
- [ ] Error handling (connection loss, API errors)

### 8.3 E2E Tests

**Critical User Flows**:
1. **Login Flow**:
   - User clicks "Login with Microsoft"
   - Redirects to Microsoft OAuth
   - Redirects back to /new
   - New session created
   - Redirects to /chat/:id

2. **Chat Flow**:
   - User sends message
   - WebSocket shows "Thinking..."
   - Message streams character-by-character
   - Message completes (stopReason='end_turn')
   - Input re-enables

3. **Tool Approval Flow**:
   - Agent wants to use tool
   - Approval dialog opens
   - User approves
   - Tool executes
   - Result displayed
   - Chat continues

### 8.4 Performance Tests

**Metrics to Track**:
- [ ] WebSocket connection time < 2s
- [ ] First message render < 500ms
- [ ] Streaming latency < 100ms per chunk
- [ ] Message list scroll performance (60fps)
- [ ] Lighthouse Performance score ≥ 90

**Tools**:
- Chrome DevTools Performance panel
- Lighthouse
- React DevTools Profiler

### 8.5 Accessibility Tests

**WCAG 2.1 AA Requirements**:
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader announcements correct
- [ ] Color contrast ratio ≥ 4.5:1
- [ ] Focus indicators visible
- [ ] ARIA attributes correct
- [ ] Form labels present

**Tools**:
- axe DevTools
- WAVE browser extension
- Screen reader testing (NVDA, JAWS, VoiceOver)

---

## 9. Rollback Plan

### 9.1 Git Revert Strategy

**If migration fails**, revert in reverse order:

```bash
# 1. Identify commits to revert
git log --oneline --since="2025-11-20"

# 2. Revert specific commits
git revert <commit-hash> --no-commit

# 3. Restore deleted files
git checkout HEAD~N -- frontend/lib/api.ts
git checkout HEAD~N -- frontend/lib/socket.ts
git checkout HEAD~N -- frontend/lib/types.ts

# 4. Commit rollback
git commit -m "Rollback: Revert frontend migration (Phase 1-X)"
```

### 9.2 File Restoration

**Files to Restore** (if needed):

```bash
# Restore old API client
git checkout <pre-migration-commit> -- frontend/lib/api.ts

# Restore old WebSocket client
git checkout <pre-migration-commit> -- frontend/lib/socket.ts

# Restore old types
git checkout <pre-migration-commit> -- frontend/lib/types.ts

# Restore old components (if deleted)
git checkout <pre-migration-commit> -- frontend/components/
```

### 9.3 Dependency Rollback

**If axios causes issues**, revert to fetch:

```bash
npm uninstall axios
```

**If Socket.IO issues**, check version:

```bash
npm list socket.io-client
# Ensure 4.8.1
```

### 9.4 Configuration Rollback

**Revert tsconfig.json**:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx"  // Restore old value
  }
}
```

**Revert .env.local**:
```
NEXT_PUBLIC_API_URL=http://localhost:3001  # Restore old port
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

### 9.5 Validation Post-Rollback

**After rollback, verify**:
- [ ] Frontend starts: `npm run dev`
- [ ] No TypeScript errors: `npm run type-check`
- [ ] No linter errors: `npm run lint`
- [ ] Login flow works
- [ ] WebSocket connects
- [ ] Messages send/receive

---

## 10. References

### 10.1 Documentation Links

- [Frontend README](../../frontend/README.md)
- [Frontend Rebuild PRD](../README.md)
- [Implementation Guide](../implementation-guide.md)
- [Technical Architecture](../technical-architecture.md)
- [Backend WebSocket Contract](../../backend/websocket-contract.md)
- [Backend Architecture Deep Dive](../../backend/architecture-deep-dive.md)

### 10.2 Related TODO

- [Frontend Migration TODO](./TODO.md) - Executable checklist with checkboxes

### 10.3 External Resources

- [React Query Docs](https://tanstack.com/query/latest)
- [Zustand Docs](https://zustand-demo.pmnd.rs/)
- [Socket.IO Client Docs](https://socket.io/docs/v4/client-api/)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Next.js App Router](https://nextjs.org/docs/app)

---

**End of Migration Plan**

This document will be updated as migration progresses. Last updated: 2025-11-20
