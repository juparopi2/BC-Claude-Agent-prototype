# Frontend Rebuild - Product Requirements Document (PRD)

**Version**: 1.0.0
**Date**: 2025-11-19
**Status**: Draft
**Author**: Claude Code Analysis

---

## 🎯 Executive Summary

This document specifies the complete rebuild of the BC Claude Agent frontend, based on an exhaustive analysis of the backend architecture, tests, and capabilities. The backend has **379/380 passing tests (99.7% coverage)**, providing a stable, production-ready contract for frontend development.

**Key Objectives**:
- Build a real-time streaming chat interface for Business Central operations
- Implement event sourcing-based message rendering with guaranteed ordering
- Provide human-in-the-loop approvals for write operations
- Support multi-tenant authentication via Microsoft OAuth 2.0
- Enable optimistic UI updates with Markdown rendering

**Technology Stack**:
- **Framework**: Next.js 16.0.1 + React 19.2.0 + TypeScript
- **State Management**: React Query + Zustand
- **UI Library**: shadcn/ui + Tailwind CSS 4.1.17
- **WebSocket**: Socket.IO Client 4.8.1
- **Error Handling**: React Error Boundaries + Toast notifications

---

## 📚 Table of Contents

1. [Backend Contract Analysis](#1-backend-contract-analysis)
2. [User Stories & Features](#2-user-stories--features)
3. [Architecture Overview](#3-architecture-overview)
4. [Component Hierarchy](#4-component-hierarchy)
5. [State Management Specification](#5-state-management-specification)
6. [WebSocket Integration](#6-websocket-integration)
7. [REST API Integration](#7-rest-api-integration)
8. [Type Definitions](#8-type-definitions)
9. [Event Flow Diagrams](#9-event-flow-diagrams)
10. [UI/UX Specifications](#10-uiux-specifications)
11. [Error Handling Strategy](#11-error-handling-strategy)
12. [Performance Requirements](#12-performance-requirements)
13. [Accessibility Requirements](#13-accessibility-requirements)
14. [Testing Strategy](#14-testing-strategy)
15. [Implementation Phases](#15-implementation-phases)

---

## 1. Backend Contract Analysis

### 1.1 REST API Endpoints

| Endpoint | Method | Auth | Purpose | Frontend Usage |
|----------|--------|------|---------|----------------|
| `/api/auth/login` | POST | ❌ | Initiate Microsoft OAuth | Login button |
| `/api/auth/callback` | GET | ❌ | OAuth callback handler | Automatic redirect |
| `/api/auth/logout` | POST | ✅ | End session | Logout button |
| `/api/auth/me` | GET | ✅ | Get current user | Auth state initialization |
| `/api/auth/bc-status` | GET | ✅ | Check BC access | BC consent banner |
| `/api/auth/bc-consent` | POST | ✅ | Request BC consent | BC consent button |
| `/api/chat/sessions` | GET | ✅ | List all sessions | Sidebar session list |
| `/api/chat/sessions` | POST | ✅ | Create new session | "New Chat" button |
| `/api/chat/sessions/:id` | GET | ✅ | Get session details | Session page load |
| `/api/chat/sessions/:id/messages` | GET | ✅ | Load chat history | Message history load |
| `/api/chat/sessions/:id` | PATCH | ✅ | Update session title | Rename session |
| `/api/chat/sessions/:id` | DELETE | ✅ | Delete session | Delete button |
| `/health` | GET | ❌ | Health check | Status page |

**Source**: `backend/src/__tests__/routes/sessions.routes.test.ts:642 lines`

---

### 1.2 WebSocket Events (Discriminated Union)

**⚠️ CRITICAL**: Backend emits a **single event type** (`agent:event`) with discriminated union.

```typescript
socket.on('agent:event', (event: AgentEvent) => {
  switch (event.type) {
    case 'session_start': // Agent execution begins
    case 'thinking': // Agent reasoning (show indicator)
    case 'message_chunk': // Streaming text (accumulate)
    case 'message': // Complete message with stop_reason
    case 'tool_use': // Tool execution started
    case 'tool_result': // Tool execution completed
    case 'complete': // Execution summary
    case 'error': // Error occurred
    // ... handle each event type
  }
});
```

**Event Catalog** (12 event types):

| Event Type | Persisted? | Frontend Action | Stop Reason Check |
|------------|------------|-----------------|-------------------|
| `session_start` | ❌ | Log start | N/A |
| `thinking` | ✅ | Show "Thinking..." | N/A |
| `message_partial` | ❌ | (Deprecated) | N/A |
| `message_chunk` | ❌ | Accumulate + render real-time | N/A |
| `message` | ✅ | Display complete message | ⭐ Check `stopReason` |
| `tool_use` | ✅ | Show "Executing tool..." | N/A |
| `tool_result` | ✅ | Hide indicator, show result | N/A |
| `session_end` | ❌ | Log end | N/A |
| `complete` | ❌ | Show execution summary | N/A |
| `approval_requested` | ❌ | Show approval dialog | N/A |
| `approval_resolved` | ❌ | Hide dialog | N/A |
| `error` | ❌ | Show error toast | N/A |

**Source**: `backend/src/__tests__/handlers/ChatMessageHandler.test.ts:1223 lines`

---

### 1.3 Stop Reason Pattern (CRITICAL)

The `stop_reason` field in `message` events controls the agentic loop flow:

```typescript
type StopReason =
  | 'end_turn'       // ⭐ FINAL message - enable input field
  | 'tool_use'       // ⭐ INTERMEDIATE message - expect tool_use event
  | 'max_tokens'     // Response truncated - show warning
  | 'stop_sequence'  // Custom stop sequence
  | 'pause_turn'     // Long turn paused (future)
  | 'refusal';       // Request refused

// Frontend logic:
if (event.type === 'message') {
  if (event.stopReason === 'end_turn') {
    enableInputField();  // Ready for next user message
  } else if (event.stopReason === 'tool_use') {
    // Continue waiting for tool_use event
  } else if (event.stopReason === 'max_tokens') {
    showWarning('Response truncated. Consider increasing token limit.');
  }
}
```

**Source**: `backend/src/__tests__/services/DirectAgentService.test.ts:453 lines`

---

### 1.4 Event Ordering (Sequence Numbers)

**✅ DO:**
```typescript
// Sort by sequenceNumber (atomic, guaranteed ordering)
messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
```

**❌ DON'T:**
```typescript
// Sort by timestamp (race conditions possible)
messages.sort((a, b) => a.timestamp - b.timestamp);
```

**Why?**
- `sequenceNumber` is generated by Redis `INCR` (atomic, monotonic)
- `timestamp` can have race conditions in distributed systems
- Backend tests explicitly verify ordering via `sequenceNumber`

**Source**: `backend/src/__tests__/handlers/ChatMessageHandler.test.ts` (Message Ordering tests)

---

### 1.5 Authentication Flow

```
1. User clicks "Login with Microsoft"
   → GET /api/auth/login

2. Backend redirects to Microsoft login page
   → Microsoft Entra ID OAuth 2.0

3. User authenticates and consents permissions:
   - openid, profile, email
   - User.Read (Microsoft Graph)
   - offline_access (refresh token)
   - https://api.businesscentral.dynamics.com/Financials.ReadWrite.All

4. Microsoft redirects to callback
   → GET /api/auth/callback?code=xxx&state=yyy

5. Backend exchanges code for tokens
   → Stores session in Redis (24-hour expiry)
   → Sets httpOnly cookie: connect.sid

6. Backend redirects to frontend
   → http://localhost:3000/new
```

**Session Cookie**:
- **Name**: `connect.sid`
- **Attributes**: `httpOnly=true`, `secure=true` (production), `sameSite='lax'`
- **Expiration**: 24 hours (configurable)

**Source**: `docs/backend/authentication.md`

---

### 1.6 Business Central Consent (Separate Flow)

**Why?** Microsoft Graph tokens ≠ BC API tokens. Need separate delegated permissions.

```
1. User clicks "Grant BC Access"
   → POST /api/auth/bc-consent

2. Backend requests BC token using refresh token
   → POST to Microsoft token endpoint
   → Scope: https://api.businesscentral.dynamics.com/Financials.ReadWrite.All

3. If user hasn't consented:
   → Backend returns { consentUrl: '...' }
   → Frontend redirects to consent URL

4. User grants BC permission
   → Redirects back to frontend

5. User retries BC consent
   → POST /api/auth/bc-consent
   → Now succeeds

6. Backend stores encrypted BC token
   → AES-256-GCM encryption
   → Stored in users.bc_access_token_encrypted
```

**Check BC Access**:
```bash
GET /api/auth/bc-status

Response:
{
  "hasAccess": true,
  "tokenExpiresAt": "2025-11-20T10:00:00Z",
  "isExpired": false
}
```

**Source**: `docs/backend/authentication.md`

---

## 2. User Stories & Features

### 2.1 Epic: Authentication & Onboarding

**US-001: Microsoft Login**
- **As a** user
- **I want to** login with my Microsoft account
- **So that** I can access my Business Central data securely

**Acceptance Criteria**:
- [x] "Login with Microsoft" button redirects to Microsoft OAuth
- [x] Callback URL handles OAuth response and sets session cookie
- [x] User is redirected to `/new` after successful login
- [x] Session persists for 24 hours
- [x] Logout button clears session

**US-002: Business Central Consent**
- **As a** user
- **I want to** grant permission to access my BC environment
- **So that** the agent can read and write BC data on my behalf

**Acceptance Criteria**:
- [x] BC consent banner shown if access not granted
- [x] "Grant BC Access" button redirects to Microsoft consent page
- [x] BC token stored encrypted in database
- [x] BC token auto-refreshes before expiry
- [x] BC access status shown in user menu

**Backend Validation**:
- `backend/src/__tests__/services/MicrosoftOAuthService.test.ts` (OAuth flow)
- `backend/src/__tests__/services/BCTokenManager.test.ts` (Token encryption)

---

### 2.2 Epic: Session Management

**US-003: Create New Chat**
- **As a** user
- **I want to** create a new chat session
- **So that** I can start a fresh conversation with the agent

**Acceptance Criteria**:
- [x] "New Chat" button creates session via `POST /api/chat/sessions`
- [x] New session has default title "New Chat"
- [x] User is redirected to `/chat/:sessionId`
- [x] Session appears in sidebar immediately (optimistic update)

**US-004: View Session List**
- **As a** user
- **I want to** see all my previous chat sessions
- **So that** I can resume conversations

**Acceptance Criteria**:
- [x] Sidebar shows all sessions sorted by `last_activity_at`
- [x] Each session shows title and last activity timestamp
- [x] Active session is highlighted
- [x] Pagination for > 50 sessions

**US-005: Rename Session**
- **As a** user
- **I want to** rename a session
- **So that** I can organize my conversations

**Acceptance Criteria**:
- [x] Inline edit input on session title click
- [x] Save on Enter or blur
- [x] Cancel on Escape
- [x] Optimistic update with rollback on error

**US-006: Auto-Generate Session Titles**
- **As a** user
- **I want** session titles to be auto-generated from my first message
- **So that** I don't have to name every session manually

**Acceptance Criteria**:
- [x] First user message triggers title generation in background
- [x] Title generation uses parallel worker (non-blocking)
- [x] Title updates in sidebar when generation completes
- [x] Fallback to "New Chat" if generation fails

**Backend Validation**:
- `backend/src/__tests__/services/SessionTitleGenerator.test.ts` (Title generation)
- `backend/src/__tests__/routes/sessions.routes.test.ts` (CRUD operations)

---

### 2.3 Epic: Chat Interface

**US-007: Send Message**
- **As a** user
- **I want to** send a message to the agent
- **So that** I can interact with Business Central

**Acceptance Criteria**:
- [x] Input field with auto-resize (min 1 line, max 10 lines)
- [x] Send button enabled only when input has text
- [x] Send on Enter (Shift+Enter for new line)
- [x] Message sent via WebSocket `chat:message` event
- [x] Optimistic rendering of user message

**US-008: View Streaming Response**
- **As a** user
- **I want to** see the agent's response in real-time
- **So that** I know the system is working

**Acceptance Criteria**:
- [x] "Thinking..." indicator appears on `thinking` event
- [x] Text streams character-by-character from `message_chunk` events
- [x] Thinking indicator hides when `message` event received
- [x] Input field re-enables when `stopReason='end_turn'`

**US-009: View Agent Process Details**
- **As a** user
- **I want to** see what the agent is doing (thinking, tools, etc.)
- **So that** I can understand how it's working

**Acceptance Criteria**:
- [x] Collapsible `<AgentProcessGroup>` for `stopReason='tool_use'` messages
- [x] Thinking content shown in collapsible section
- [x] Tool execution cards show tool name, args, result/error
- [x] Execution summary shows tokens used and duration
- [x] Default state: collapsed (expand on click)

**US-010: Render Markdown Responses**
- **As a** user
- **I want** agent responses to render as Markdown
- **So that** formatted text, lists, and code blocks are readable

**Acceptance Criteria**:
- [x] Markdown renderer (e.g., `react-markdown`)
- [x] Syntax highlighting for code blocks (e.g., `react-syntax-highlighter`)
- [x] Support for tables, lists, headings
- [x] Code copy button on code blocks

**Backend Validation**:
- `backend/src/__tests__/handlers/ChatMessageHandler.test.ts` (Event handling)
- `backend/src/__tests__/services/DirectAgentService.test.ts` (Streaming flow)

---

### 2.4 Epic: Human-in-the-Loop Approvals

**US-011: Receive Approval Request**
- **As a** user
- **I want** to be prompted for approval before write operations
- **So that** I can review changes before they're applied

**Acceptance Criteria**:
- [x] Approval dialog appears on `approval:requested` event
- [x] Dialog shows change summary with key-value pairs
- [x] Dialog shows operation priority (high/medium/low)
- [x] Dialog shows countdown timer (5 minutes)
- [x] Dialog blocks input field until resolved

**US-012: Approve/Reject Changes**
- **As a** user
- **I want to** approve or reject proposed changes
- **So that** I have control over BC modifications

**Acceptance Criteria**:
- [x] "Approve" button sends `approval:respond` with `approved: true`
- [x] "Reject" button sends `approval:respond` with `approved: false`
- [x] Dialog closes immediately on response
- [x] Agent resumes execution after response
- [x] Auto-reject if 5-minute timeout expires

**US-013: View Approval History**
- **As a** user
- **I want to** see past approval decisions
- **So that** I can audit what changes were made

**Acceptance Criteria**:
- [x] Approval badge in agent process group shows decision
- [x] Approved changes show green checkmark
- [x] Rejected changes show red X
- [x] Timestamp shown for each decision

**Backend Validation**:
- `backend/src/__tests__/services/ApprovalManager.test.ts` (Approval flow)

---

### 2.5 Epic: Error Handling & Recovery

**US-014: Handle API Errors**
- **As a** user
- **I want** to see clear error messages when things fail
- **So that** I know what went wrong and how to fix it

**Acceptance Criteria**:
- [x] Toast notifications for transient errors (network, rate limit)
- [x] Error messages show in chat for agent errors
- [x] Retry button for recoverable errors (`isRecoverable: true`)
- [x] Automatic retry for network disconnects
- [x] Error boundaries catch React crashes

**US-015: WebSocket Reconnection**
- **As a** user
- **I want** the app to reconnect automatically when disconnected
- **So that** I don't lose my session

**Acceptance Criteria**:
- [x] Auto-reconnect on disconnect (5 attempts, 1s delay)
- [x] Reconnection banner shows "Reconnecting..."
- [x] Auto-rejoin session room on reconnect
- [x] Load missed events after reconnection
- [x] Manual reconnect button if auto-reconnect fails

---

### 2.6 Epic: Performance & UX Polish

**US-016: Optimistic UI Updates**
- **As a** user
- **I want** immediate feedback when I perform actions
- **So that** the app feels fast and responsive

**Acceptance Criteria**:
- [x] User messages appear immediately (before server confirmation)
- [x] Session creates appear in sidebar immediately
- [x] Session renames update immediately
- [x] Rollback optimistic updates on error
- [x] Show loading indicator for slow operations (> 2s)

**US-017: Infinite Scroll for Messages**
- **As a** user
- **I want** to load older messages as I scroll up
- **So that** I can see full conversation history

**Acceptance Criteria**:
- [x] Load 50 messages initially
- [x] Load next 50 on scroll to top
- [x] Show "Loading more..." indicator
- [x] Stop loading when all messages fetched
- [x] Maintain scroll position after load

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NEXT.JS APP ROUTER                   │
├─────────────────────────────────────────────────────────┤
│  /                   Landing page (unauthenticated)     │
│  /login              Login page (redirect to OAuth)     │
│  /new                New session (create + redirect)    │
│  /chat/[sessionId]   Chat interface (main UI)           │
│  /settings           User settings                      │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│              STATE MANAGEMENT LAYER                      │
├─────────────────────────────────────────────────────────┤
│  React Query (Server State)                             │
│  - /api/chat/sessions (queries)                         │
│  - /api/chat/sessions/:id/messages (queries)            │
│  - /api/auth/me (queries)                               │
│  - Session mutations (create, update, delete)           │
│                                                          │
│  Zustand (Client State)                                 │
│  - authStore: { user, bcStatus }                        │
│  - sessionStore: { activeSessi onId }                   │
│  - uiStore: { sidebar, theme, etc. }                    │
│                                                          │
│  WebSocket Context (Event Stream)                       │
│  - Socket connection management                         │
│  - Event dispatch to handlers                           │
│  - Reconnection logic                                   │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│              COMPONENT LAYER                             │
├─────────────────────────────────────────────────────────┤
│  Layout Components                                       │
│  - <AppShell>: Root layout with sidebar + main          │
│  - <Sidebar>: Session list navigation                   │
│  - <Header>: User menu, BC status, settings             │
│                                                          │
│  Chat Components                                         │
│  - <ChatContainer>: Main chat interface                 │
│  - <MessageList>: Scrollable message container          │
│  - <ChatMessage>: User/assistant message bubble         │
│  - <AgentProcessGroup>: Collapsible tool/thinking       │
│  - <ChatInput>: Auto-resize textarea + send button      │
│                                                          │
│  Approval Components                                     │
│  - <ApprovalDialog>: Modal for approval requests        │
│  - <ApprovalSummary>: Change summary display            │
│  - <ApprovalTimer>: Countdown timer (5 min)             │
│                                                          │
│  Utility Components                                      │
│  - <MarkdownRenderer>: Render markdown + code           │
│  - <ErrorBoundary>: Catch React crashes                 │
│  - <Toast>: Notification system                         │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│              BACKEND INTEGRATION                         │
├─────────────────────────────────────────────────────────┤
│  REST API (http://localhost:3002)                       │
│  - Authentication endpoints                             │
│  - Session CRUD endpoints                               │
│  - Health check                                         │
│                                                          │
│  WebSocket (ws://localhost:3002)                        │
│  - agent:event (discriminated union)                    │
│  - chat:message (send user message)                     │
│  - approval:respond (approve/reject)                    │
└─────────────────────────────────────────────────────────┘
```

---

### 3.2 Data Flow Diagram

```
┌──────────────┐
│ User Action  │ (e.g., send message)
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Component        │ (e.g., <ChatInput>)
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Event Handler    │ (e.g., handleSendMessage)
└──────┬───────────┘
       │
       ├─────────────────────┐
       │                     │
       ▼                     ▼
┌──────────────┐      ┌──────────────┐
│ Optimistic   │      │ WebSocket    │
│ Update (UI)  │      │ Emit Event   │
└──────┬───────┘      └──────┬───────┘
       │                     │
       │                     ▼
       │              ┌──────────────┐
       │              │ Backend      │
       │              │ Processing   │
       │              └──────┬───────┘
       │                     │
       │                     ▼
       │              ┌──────────────┐
       │              │ WebSocket    │
       │              │ Event Stream │
       │              └──────┬───────┘
       │                     │
       │                     ▼
       │              ┌──────────────┐
       │              │ Event Handler│
       │              └──────┬───────┘
       │                     │
       │                     ▼
       │              ┌──────────────┐
       │              │ State Update │
       │              │ (Zustand/RQ) │
       │              └──────┬───────┘
       │                     │
       └─────────────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ UI Re-render │
                      └──────────────┘
```

---

## 4. Component Hierarchy

### 4.1 Page Structure

```
app/
├── layout.tsx                 # Root layout (providers)
├── page.tsx                   # Landing page
├── login/
│   └── page.tsx               # Login page (redirect)
├── new/
│   └── page.tsx               # New session (create + redirect)
├── chat/
│   └── [sessionId]/
│       └── page.tsx           # Chat interface
└── settings/
    └── page.tsx               # User settings
```

---

### 4.2 Component Tree

```
<RootLayout>
  <Providers>
    <QueryClientProvider>
    <WebSocketProvider>
    <ErrorBoundary>
    <Toaster>

  <AppShell>
    <Sidebar>
      <SessionList>
        <SessionItem>
          <SessionTitle editable />
          <SessionTimestamp />
        </SessionItem>
      </SessionList>
      <NewChatButton />
    </Sidebar>

    <Header>
      <BCStatusBadge />
      <UserMenu>
        <UserAvatar />
        <UserMenuDropdown>
          <BCConsentButton />
          <SettingsLink />
          <LogoutButton />
        </UserMenuDropdown>
      </UserMenu>
    </Header>

    <Main>
      {/* Chat Page */}
      <ChatContainer>
        <MessageList>
          <ChatMessage role="user" />
          <AgentProcessGroup collapsible>
            <ThinkingIndicator />
            <ToolExecutionCard />
            <ChatMessage role="assistant" stopReason="tool_use" />
          </AgentProcessGroup>
          <ChatMessage role="assistant" stopReason="end_turn" />
        </MessageList>

        <ChatInput>
          <AutoResizeTextarea />
          <SendButton />
        </ChatInput>
      </ChatContainer>

      {/* Approval Dialog */}
      <ApprovalDialog>
        <ApprovalSummary />
        <ApprovalTimer />
        <ApprovalActions>
          <ApproveButton />
          <RejectButton />
        </ApprovalActions>
      </ApprovalDialog>
    </Main>
  </AppShell>
```

---

## 5. State Management Specification

### 5.1 React Query Configuration

**Setup** (`lib/react-query.ts`):
```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});
```

---

### 5.2 Query Keys

**Convention**: `[domain, operation, ...params]`

```typescript
// queries/keys.ts
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

---

### 5.3 Query Hooks

**Auth Queries** (`queries/auth.ts`):
```typescript
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './keys';
import { apiClient } from '@/lib/api-client';

export const useAuth = () => {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => {
      const res = await apiClient.get('/api/auth/me');
      return res.data;
    },
    staleTime: Infinity, // Auth state rarely changes
  });
};

export const useBCStatus = () => {
  return useQuery({
    queryKey: queryKeys.auth.bcStatus,
    queryFn: async () => {
      const res = await apiClient.get('/api/auth/bc-status');
      return res.data;
    },
    refetchInterval: 1000 * 60 * 5, // Check every 5 minutes
  });
};
```

**Session Queries** (`queries/sessions.ts`):
```typescript
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

export const useSession = (sessionId: string) => {
  return useQuery({
    queryKey: queryKeys.sessions.detail(sessionId),
    queryFn: async () => {
      const res = await apiClient.get(`/api/chat/sessions/${sessionId}`);
      return res.data.session;
    },
    enabled: !!sessionId, // Only fetch if sessionId exists
  });
};

export const useMessages = (sessionId: string, limit = 50, offset = 0) => {
  return useQuery({
    queryKey: queryKeys.messages.list(sessionId, limit, offset),
    queryFn: async () => {
      const res = await apiClient.get(
        `/api/chat/sessions/${sessionId}/messages`,
        { params: { limit, offset } }
      );
      return res.data.messages;
    },
    enabled: !!sessionId,
  });
};
```

---

### 5.4 Mutation Hooks

**Session Mutations** (`mutations/sessions.ts`):
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { queryKeys } from '@/queries/keys';
import { apiClient } from '@/lib/api-client';

export const useCreateSession = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (title?: string) => {
      const res = await apiClient.post('/api/chat/sessions', { title });
      return res.data.session;
    },
    onMutate: async (title) => {
      // Optimistic update
      const tempSession = {
        id: `temp-${Date.now()}`,
        title: title || 'New Chat',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData(
        queryKeys.sessions.all,
        (old: any[]) => [tempSession, ...old]
      );

      return { tempSession };
    },
    onSuccess: (session, _, context) => {
      // Replace temp session with real session
      queryClient.setQueryData(
        queryKeys.sessions.all,
        (old: any[]) => old.map((s) =>
          s.id === context.tempSession.id ? session : s
        )
      );

      // Navigate to new session
      router.push(`/chat/${session.id}`);
    },
    onError: (_, __, context) => {
      // Rollback optimistic update
      queryClient.setQueryData(
        queryKeys.sessions.all,
        (old: any[]) => old.filter((s) => s.id !== context?.tempSession.id)
      );
    },
  });
};

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
    onMutate: async (title) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.sessions.detail(sessionId)
      });

      // Snapshot previous value
      const previousSession = queryClient.getQueryData(
        queryKeys.sessions.detail(sessionId)
      );

      // Optimistic update
      queryClient.setQueryData(
        queryKeys.sessions.detail(sessionId),
        (old: any) => ({ ...old, title })
      );

      return { previousSession };
    },
    onError: (_, __, context) => {
      // Rollback on error
      queryClient.setQueryData(
        queryKeys.sessions.detail(sessionId),
        context?.previousSession
      );
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.detail(sessionId)
      });
    },
  });
};

export const useDeleteSession = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      await apiClient.delete(`/api/chat/sessions/${sessionId}`);
    },
    onSuccess: (_, sessionId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: queryKeys.sessions.detail(sessionId)
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.all
      });

      // Navigate to new session
      router.push('/new');
    },
  });
};
```

---

### 5.5 Zustand Stores

**Auth Store** (`stores/auth.ts`):
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
    )
  )
);
```

**Session Store** (`stores/session.ts`):
```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SessionStore {
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
}

export const useSessionStore = create<SessionStore>()(
  devtools((set) => ({
    activeSessionId: null,
    setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  }))
);
```

**UI Store** (`stores/ui.ts`):
```typescript
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface UIStore {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        theme: 'light',
        toggleSidebar: () => set((state) => ({
          sidebarOpen: !state.sidebarOpen
        })),
        setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
        setTheme: (theme) => set({ theme }),
      }),
      {
        name: 'ui-storage',
      }
    )
  )
);
```

---

## 6. WebSocket Integration

### 6.1 Socket.IO Client Setup

**WebSocket Context** (`contexts/websocket.tsx`):
```typescript
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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
    const socketInstance = io('http://localhost:3002', {
      transports: ['websocket'],
      withCredentials: true,
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

  const sendMessage = (sessionId: string, message: string) => {
    if (!socket) return;
    socket.emit('chat:message', { sessionId, message });
  };

  const respondToApproval = (approvalId: string, approved: boolean) => {
    if (!socket) return;
    socket.emit('approval:respond', { approvalId, approved });
  };

  const joinSession = (sessionId: string) => {
    if (!socket) return;
    socket.emit('session:join', { sessionId });
    console.log('[WebSocket] Joined session:', sessionId);
  };

  const leaveSession = (sessionId: string) => {
    if (!socket) return;
    socket.emit('session:leave', { sessionId });
    console.log('[WebSocket] Left session:', sessionId);
  };

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

### 6.2 Event Handler Hook

**Hook** (`hooks/useAgentEvents.ts`):
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
}

export const useAgentEvents = (options: UseAgentEventsOptions) => {
  const { socket } = useWebSocket();

  const handleEvent = useCallback((event: AgentEvent) => {
    // Update persistence indicator
    console.log(`[Event] ${event.type} (seq: ${event.sequenceNumber})`);

    // Dispatch to handlers
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
    }
  }, [options]);

  useEffect(() => {
    if (!socket) return;

    socket.on('agent:event', handleEvent);

    return () => {
      socket.off('agent:event', handleEvent);
    };
  }, [socket, handleEvent]);
};
```

---

### 6.3 Chat Component Integration

**Example Usage** (`components/ChatContainer.tsx`):
```typescript
'use client';

import { useState, useCallback } from 'react';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useWebSocket } from '@/contexts/websocket';

export const ChatContainer = ({ sessionId }: { sessionId: string }) => {
  const { sendMessage, joinSession, leaveSession } = useWebSocket();
  const [accumulatedText, setAccumulatedText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isInputEnabled, setIsInputEnabled] = useState(true);

  // Join session on mount
  useEffect(() => {
    joinSession(sessionId);
    return () => leaveSession(sessionId);
  }, [sessionId, joinSession, leaveSession]);

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
      setAccumulatedText(''); // Clear accumulator

      // Check stop_reason
      if (event.stopReason === 'end_turn') {
        setIsInputEnabled(true); // Ready for next message
      } else if (event.stopReason === 'tool_use') {
        setIsInputEnabled(false); // Wait for tool execution
      }
    },
    onToolUse: (event) => {
      console.log('Tool executing:', event.toolName);
    },
    onToolResult: (event) => {
      console.log('Tool result:', event.success);
    },
    onComplete: (event) => {
      console.log('Execution complete:', event.reason);
      setIsInputEnabled(true);
    },
    onError: (event) => {
      console.error('Agent error:', event.error);
      toast.error(event.error);
    },
  });

  const handleSend = (message: string) => {
    setIsInputEnabled(false);
    sendMessage(sessionId, message);
  };

  return (
    <div className="chat-container">
      {isThinking && <ThinkingIndicator />}
      {accumulatedText && (
        <StreamingText content={accumulatedText} />
      )}
      <ChatInput onSend={handleSend} disabled={!isInputEnabled} />
    </div>
  );
};
```

---

## 7. REST API Integration

### 7.1 API Client Setup

**Axios Client** (`lib/api-client.ts`):
```typescript
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002',
  withCredentials: true, // Include session cookie
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

---

### 7.2 API Response Types

**Session Response** (`types/api.ts`):
```typescript
export interface SessionResponse {
  id: string;
  user_id: string;
  title: string;
  status: 'active' | 'completed' | 'cancelled';
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  sessions: SessionResponse[];
}

export interface MessageResponse {
  id: string;
  role: 'user' | 'assistant' | 'system';
  message_type: 'standard';
  content: string;
  stop_reason: StopReason | null;
  created_at: string;
}

export interface MessageListResponse {
  messages: MessageResponse[];
}
```

---

## 8. Type Definitions

### 8.1 AgentEvent Types

**Complete Type Definitions** (`types/events.ts`):

See full implementation in the backend analysis report (Appendix A).

**Key Discriminators**:
- `event.type` - Event type (12 types)
- `event.stopReason` - For `message` events only
- `event.sequenceNumber` - Atomic ordering

---

### 8.2 Frontend-Specific Types

**UI State Types** (`types/ui.ts`):
```typescript
export interface ChatState {
  accumulatedText: string;
  isThinking: boolean;
  isInputEnabled: boolean;
  activeToolExecution: string | null;
}

export interface ApprovalDialogState {
  isOpen: boolean;
  approvalId: string | null;
  toolName: string;
  summary: {
    title: string;
    description: string;
    changes: Record<string, string>;
  };
  priority: 'low' | 'medium' | 'high';
  expiresAt: Date;
}

export interface StreamingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming: boolean;
  stopReason?: StopReason | null;
  timestamp: Date;
  sequenceNumber: number;
}
```

---

## 9. Event Flow Diagrams

### 9.1 Message Sending Flow

```
User types message → Send button clicked
                           ↓
                    Optimistic Update
                    (show user message immediately)
                           ↓
                    WebSocket Emit
                    socket.emit('chat:message', {...})
                           ↓
                    Disable input field
                           ↓
                    Backend processes
                           ↓
              ┌──────────────────────────┐
              │  Event Stream Begins     │
              └──────────┬───────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    'thinking'    'message_chunk'   'message'
         │               │           (stopReason)
         │               │               │
         ▼               ▼               ▼
  Show indicator   Accumulate text   Check stop_reason
                                          │
                         ┌────────────────┼────────────┐
                         │                │            │
                         ▼                ▼            ▼
                    'end_turn'      'tool_use'   'max_tokens'
                         │                │            │
                         ▼                ▼            ▼
                  Enable input    Wait for tool   Show warning
                                     execution
```

---

### 9.2 Approval Flow

```
Agent detects write operation
            ↓
   'tool_use' event emitted
   (tool name + args)
            ↓
Backend creates approval request
            ↓
'approval:requested' event emitted
            ↓
Frontend shows approval dialog
  ┌─────────────────────┐
  │ - Change summary    │
  │ - Countdown timer   │
  │ - Approve/Reject    │
  └──────┬─────┬────────┘
         │     │
    [Approve][Reject]
         │     │
         └─────┴──────────────┐
                              ↓
               socket.emit('approval:respond', {...})
                              ↓
              Backend resolves promise
                              ↓
               ┌──────────────┴───────────────┐
               │                              │
          (approved)                      (rejected)
               │                              │
               ▼                              ▼
      Execute tool                  Skip tool execution
               │                              │
               ▼                              ▼
    'tool_result' event           Continue with denial message
```

---

## 10. UI/UX Specifications

### 10.1 Chat Message Bubble

**User Message**:
- Right-aligned
- Blue background (`bg-blue-600`)
- White text
- Avatar (user initials)
- Timestamp on hover

**Assistant Message (Final)**:
- Left-aligned
- Gray background (`bg-gray-100`)
- Black text
- Claude avatar icon
- Markdown rendering enabled
- Copy button for code blocks

**Assistant Message (Intermediate)**:
- Grouped in collapsible `<AgentProcessGroup>`
- Muted styling (smaller font, gray text)
- Shows tool name + status badge

---

### 10.2 Thinking Indicator

**Visual Design**:
- Animated ellipsis ("Thinking...")
- Optional: Show thinking content in collapsible section
- Icon: Brain or sparkle icon
- Position: Below last message

**States**:
- `loading` - Waiting for `thinking` event
- `active` - Showing thinking content
- `hidden` - After `message` event received

---

### 10.3 Tool Execution Card

**Layout**:
```
┌─────────────────────────────────────┐
│ 🔧 bc_list_all_entities             │
│ Status: ✅ Success                   │
│                                     │
│ Arguments:                          │
│ {                                   │
│   "entity_type": "customers"        │
│ }                                   │
│                                     │
│ Result: [Expand ▼]                  │
│ ┌─────────────────────────────────┐ │
│ │ [                               │ │
│ │   { "id": "1", "name": "..." }  │ │
│ │ ]                               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Status Badges**:
- `pending` - Orange badge ("Executing...")
- `success` - Green badge ("Success")
- `error` - Red badge ("Failed")

---

### 10.4 Approval Dialog

**Layout**:
```
┌──────────────────────────────────────┐
│  🚨 Approval Required                │
│                                      │
│  Create New Customer                 │
│  ────────────────────────────────    │
│  Priority: 🔴 HIGH                   │
│  Time Remaining: 4:32                │
│                                      │
│  The agent wants to create a new     │
│  customer in Business Central:       │
│                                      │
│  Customer Name: Acme Corp            │
│  Email: info@acme.com                │
│  Phone: +1-555-0100                  │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ Approve  │  │  Reject  │         │
│  └──────────┘  └──────────┘         │
└──────────────────────────────────────┘
```

**Countdown Timer**:
- Visual: Circular progress ring (5 minutes)
- Warning: Turn orange at 1 minute remaining
- Expiry: Auto-close and reject

---

### 10.5 Sidebar Session List

**Layout**:
```
┌───────────────────────────┐
│ [+ New Chat]              │
├───────────────────────────┤
│ 📝 Customer Analysis      │
│    2 hours ago            │
├───────────────────────────┤
│ ⚙️  Sales Order Creation  │
│    Yesterday              │
├───────────────────────────┤
│ 📊 Revenue Report         │
│    3 days ago             │
└───────────────────────────┘
```

**Interaction**:
- Click: Navigate to session
- Hover: Show rename + delete buttons
- Active: Highlight with blue left border

---

## 11. Error Handling Strategy

### 11.1 Error Boundary

**Implementation** (`components/ErrorBoundary.tsx`):
```typescript
'use client';

import React from 'react';

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
    console.error('[ErrorBoundary]', error, errorInfo);
    // Send to error reporting service (e.g., Sentry)
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
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

### 11.2 Toast Notifications

**Library**: `sonner` (minimal, beautiful toasts)

**Setup** (`components/Toaster.tsx`):
```typescript
'use client';

import { Toaster as SonnerToaster } from 'sonner';

export const Toaster = () => {
  return <SonnerToaster position="top-right" richColors />;
};
```

**Usage**:
```typescript
import { toast } from 'sonner';

// Success
toast.success('Session created!');

// Error
toast.error('Failed to send message', {
  description: error.message,
  action: {
    label: 'Retry',
    onClick: () => retrySendMessage(),
  },
});

// Loading
const toastId = toast.loading('Creating session...');
// Later...
toast.success('Session created!', { id: toastId });
```

---

### 11.3 Error Recovery

**WebSocket Reconnection**:
```typescript
socket.on('disconnect', () => {
  toast.error('Connection lost. Reconnecting...');
});

socket.on('connect', () => {
  toast.success('Reconnected!');
  // Rejoin active session
  if (activeSessionId) {
    joinSession(activeSessionId);
  }
});
```

**API Error Handling**:
```typescript
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      toast.error('Rate limit exceeded. Please wait a moment.');
    } else if (error.response?.status === 500) {
      toast.error('Server error. Please try again later.');
    } else if (!error.response) {
      toast.error('Network error. Check your connection.');
    }
    return Promise.reject(error);
  }
);
```

---

## 12. Performance Requirements

### 12.1 Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Time to First Byte (TTFB)** | < 200ms | Lighthouse |
| **First Contentful Paint (FCP)** | < 1.5s | Lighthouse |
| **Largest Contentful Paint (LCP)** | < 2.5s | Lighthouse |
| **Cumulative Layout Shift (CLS)** | < 0.1 | Lighthouse |
| **Time to Interactive (TTI)** | < 3s | Lighthouse |
| **WebSocket Latency** | < 100ms | Custom metrics |
| **Message Render Time** | < 16ms (60fps) | Performance API |

---

### 12.2 Optimization Strategies

**Code Splitting**:
```typescript
// Lazy load heavy components
const ApprovalDialog = dynamic(() => import('@/components/ApprovalDialog'), {
  loading: () => <ApprovalDialogSkeleton />,
});

const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), {
  ssr: false, // Client-side only
});
```

**Virtual Scrolling**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export const MessageList = ({ messages }: { messages: Message[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Average message height
    overscan: 5, // Render 5 extra items above/below viewport
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
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

**Image Optimization**:
- Use Next.js `<Image>` component for avatars
- Lazy load images below fold
- Use WebP format with fallback

---

## 13. Accessibility Requirements

### 13.1 WCAG 2.1 Level AA Compliance

**Keyboard Navigation**:
- [x] All interactive elements focusable
- [x] Focus visible (outline on focus)
- [x] Tab order logical
- [x] Escape key closes dialogs

**Screen Reader Support**:
- [x] ARIA labels on all buttons
- [x] ARIA live regions for streaming text
- [x] ARIA busy state during loading
- [x] Alt text on images

**Color Contrast**:
- [x] Text contrast ≥ 4.5:1 (normal text)
- [x] Text contrast ≥ 3:1 (large text)
- [x] Don't rely on color alone for meaning

**Focus Management**:
- [x] Trap focus in modals
- [x] Return focus on modal close
- [x] Skip links for navigation

---

### 13.2 ARIA Annotations

**Example**: Approval Dialog
```tsx
<div
  role="dialog"
  aria-labelledby="approval-title"
  aria-describedby="approval-description"
  aria-modal="true"
>
  <h2 id="approval-title">Approval Required</h2>
  <p id="approval-description">
    The agent wants to create a new customer...
  </p>
  <button
    onClick={handleApprove}
    aria-label="Approve customer creation"
  >
    Approve
  </button>
</div>
```

**Example**: Streaming Message
```tsx
<div
  role="log"
  aria-live="polite"
  aria-atomic="false"
>
  {accumulatedText}
</div>
```

---

## 14. Testing Strategy

### 14.1 Unit Tests

**Test Coverage Requirements**:
- Components: > 80%
- Hooks: > 90%
- Utils: > 95%

**Example**: Chat Input Component
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '@/components/ChatInput';

describe('ChatInput', () => {
  it('sends message on Enter key', () => {
    const handleSend = jest.fn();
    render(<ChatInput onSend={handleSend} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleSend).toHaveBeenCalledWith('Hello');
    expect(input).toHaveValue(''); // Clears after send
  });

  it('does not send on Shift+Enter', () => {
    const handleSend = jest.fn();
    render(<ChatInput onSend={handleSend} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Line 1' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(handleSend).not.toHaveBeenCalled();
    expect(input).toHaveValue('Line 1\n'); // Adds new line
  });

  it('disables input when disabled prop is true', () => {
    render(<ChatInput onSend={jest.fn()} disabled />);

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});
```

---

### 14.2 Integration Tests

**Test Coverage**:
- WebSocket event handling
- API query/mutation flows
- Optimistic updates + rollback

**Example**: Session Creation Flow
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCreateSession } from '@/mutations/sessions';

describe('useCreateSession', () => {
  it('creates session optimistically', async () => {
    const { result } = renderHook(() => useCreateSession(), {
      wrapper: QueryClientProvider,
    });

    result.current.mutate('Test Session');

    // Optimistic update
    expect(result.current.data).toMatchObject({
      id: expect.stringMatching(/^temp-/),
      title: 'Test Session',
    });

    // Wait for server response
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Real session replaces temp
    expect(result.current.data.id).not.toMatch(/^temp-/);
  });

  it('rolls back on error', async () => {
    // Mock API failure
    apiClient.post.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCreateSession());

    result.current.mutate('Test Session');

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Optimistic update removed
    expect(result.current.data).toBeUndefined();
  });
});
```

---

### 14.3 E2E Tests

**Tool**: Playwright

**Critical Flows**:
1. Login → Create Session → Send Message → Receive Response
2. Approval Request → Approve → Tool Execution → Result
3. Session Rename → Optimistic Update → Server Confirmation
4. WebSocket Disconnect → Reconnect → Resume Session

**Example**: E2E Login Flow
```typescript
import { test, expect } from '@playwright/test';

test('user can login and create session', async ({ page }) => {
  // Navigate to app
  await page.goto('http://localhost:3000');

  // Click login button
  await page.click('text=Login with Microsoft');

  // Mock Microsoft OAuth (or use test account)
  await page.waitForURL('http://localhost:3000/new');

  // Click "New Chat"
  await page.click('text=New Chat');

  // Wait for session page
  await page.waitForURL(/\/chat\/.+/);

  // Verify session created
  const sessionTitle = page.locator('[data-testid="session-title"]');
  await expect(sessionTitle).toHaveText('New Chat');
});
```

---

## 15. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goals**:
- Authentication working end-to-end
- Session list rendering
- Basic navigation

**Tasks**:
1. Setup Next.js app structure
2. Install dependencies (React Query, Zustand, Socket.IO, shadcn/ui)
3. Create providers (QueryClient, WebSocket, Theme)
4. Implement authentication pages (login, callback)
5. Create AppShell layout (Sidebar, Header, Main)
6. Implement session list (sidebar)
7. Implement "New Chat" button
8. Wire up REST API queries

**Deliverables**:
- User can login with Microsoft
- User can create new session
- User can see session list
- User can navigate to session page

---

### Phase 2: Chat Interface + Streaming (Week 2)

**Goals**:
- Real-time streaming working
- Message rendering complete
- Event ordering correct

**Tasks**:
1. Setup WebSocket context
2. Implement event handler hooks
3. Create ChatContainer component
4. Create ChatMessage component
5. Implement streaming text accumulation
6. Handle stop_reason logic
7. Create ThinkingIndicator component
8. Create ToolExecutionCard component
9. Implement message ordering (sequenceNumber)
10. Wire up WebSocket events

**Deliverables**:
- User can send messages
- User sees streaming responses
- User sees thinking indicators
- User sees tool executions
- Messages ordered correctly

---

### Phase 3: Approvals + Agent Process Visualization (Week 3)

**Goals**:
- Approval dialog working
- Agent process details visible
- Collapsible UI implemented

**Tasks**:
1. Create ApprovalDialog component
2. Implement approval countdown timer
3. Handle approval:requested event
4. Handle approval:respond emission
5. Create AgentProcessGroup component (collapsible)
6. Render thinking content
7. Render tool use + result
8. Show execution summary
9. Implement status badges

**Deliverables**:
- User receives approval requests
- User can approve/reject
- User sees agent process details
- Collapsible UI works

---

### Phase 4: Optimistic UI + Polish (Week 4)

**Goals**:
- Optimistic updates working
- Markdown rendering complete
- Error handling robust
- Performance optimized

**Tasks**:
1. Implement optimistic session creation
2. Implement optimistic session rename
3. Implement rollback on error
4. Add Markdown renderer
5. Add syntax highlighting
6. Add code copy button
7. Implement Error Boundary
8. Add Toast notifications
9. Implement virtual scrolling (if needed)
10. Add infinite scroll for messages
11. Performance audit (Lighthouse)
12. Accessibility audit (axe DevTools)
13. Cross-browser testing

**Deliverables**:
- Optimistic UI working
- Markdown rendering beautiful
- Errors handled gracefully
- Performance ≥ 90 Lighthouse score
- Accessibility WCAG 2.1 AA compliant

---

## 16. Out of Scope (Future Phases)

### Not Included in MVP

❌ **File Uploads** - Backend doesn't support yet
❌ **Export Chat History** - Not implemented
❌ **Keyboard Shortcuts** - Phase 5
❌ **Dark Mode** - Phase 5
❌ **Mobile Responsive** - Phase 5
❌ **Multi-language Support** - Phase 6
❌ **Voice Input** - Phase 6
❌ **Collaborative Sessions** - Phase 7

---

## Conclusion

This PRD provides a complete specification for rebuilding the BC Claude Agent frontend from scratch. All requirements are backed by **379/380 passing backend tests**, ensuring a stable contract.

**Next Steps**:
1. Review and approve this PRD
2. Read Technical Architecture document (next)
3. Begin Phase 1 implementation

**Key Success Criteria**:
- ✅ Real-time streaming with < 1s latency
- ✅ Event ordering guaranteed via `sequenceNumber`
- ✅ Approval flow with countdown timer
- ✅ Optimistic UI with rollback
- ✅ Markdown rendering with syntax highlighting
- ✅ WCAG 2.1 AA accessible
- ✅ Lighthouse score ≥ 90

---

**Document Version**: 1.0.0
**Last Updated**: 2025-11-19
**Status**: Ready for Review
