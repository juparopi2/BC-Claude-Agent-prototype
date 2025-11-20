# Frontend Migration TODO

**Status**: 67% Complete (Phase 1 ✅ + Phase 1.5 ✅ + Phase 2 ✅)
**Last Updated**: 2025-11-20
**Related Document**: [Migration Plan](./migration-plan.md)

---

## Progress Summary

| Phase | Tasks | Completed | Percentage |
|-------|-------|-----------|------------|
| Phase 1: Core Infrastructure | 18 | 18 | 100% ✅ |
| **Phase 1.5: Cleanup Sprint** | **21** | **21** | **100% ✅** |
| **Phase 2: Pages & Layout** | **10** | **10** | **100% ✅** |
| Phase 3: Chat Interface | 8 | 0 | 0% |
| Phase 4: Approvals & Shared | 6 | 0 | 0% |
| Phase 5: Cleanup & Testing | 10 | 0 | 0% |
| **TOTAL** | **73** | **49** | **67%** |

---

## ✅ Phase 1: Core Infrastructure (COMPLETED)

**Completion Date**: 2025-11-19

### Configuration (4 tasks)
- [x] Fix `tsconfig.json` (`jsx: "preserve"`)
- [x] Install `axios@1.7.9` exact version
- [x] Verify shadcn/ui initialization (`components.json` exists)
- [x] Verify `.env.local` configuration (port 3002)

### Type System (3 files - 3 tasks)
- [x] Create `types/api.ts` (User, Session, Message, Approval, BCStatus, StopReason)
- [x] Create `types/events.ts` (AgentEvent discriminated union with 8 event types)
- [x] Create `types/ui.ts` (ChatState, ApprovalDialogState, UIState, AuthState, SessionState)

### API Infrastructure (3 files - 3 tasks)
- [x] Update `lib/utils.ts` (add formatDate, formatRelativeTime, truncate)
- [x] Create `lib/api-client.ts` (Axios client with interceptors, port 3002)
- [x] Create `lib/react-query.ts` (QueryClient config with defaults)

### React Query (5 files - 5 tasks)
- [x] Create `queries/keys.ts` (Query key factory with hierarchical keys)
- [x] Create `queries/auth.ts` (useAuth, useBCStatus)
- [x] Create `queries/sessions.ts` (useSessions, useSession, useMessages)
- [x] Create `mutations/sessions.ts` (useCreateSession, useUpdateSession, useDeleteSession)
- [x] Create `mutations/auth.ts` (useLogout)

### State Management (3 files - 3 tasks)
- [x] Create `stores/auth.ts` (Zustand with persist middleware)
- [x] Create `stores/session.ts` (Active session ID)
- [x] Create `stores/ui.ts` (Sidebar, theme with persist)

### WebSocket Infrastructure (3 files - 3 tasks)
- [x] Create `contexts/websocket.tsx` (Socket.IO provider, discriminated union pattern)
- [x] Create `hooks/useAgentEvents.ts` (Event handler with type discrimination)
- [x] Create `hooks/useSessionRoom.ts` (Auto join/leave session rooms)

---

## ✅ Phase 1.5: Cleanup Sprint (COMPLETED - 21/21)

**Purpose**: Migrate existing components and pages from deprecated imports to new Phase 1 architecture before building new features in Phase 2.

**Started**: 2025-11-20
**Completed**: 2025-11-20

### Sprint 1.1: Consolidate Stores (4 tasks) ✅
- [x] **Create `stores/approval.ts`** (migrated from `store/approvalStore.ts`)
  - Uses `ApprovalEventData` from `types/events.ts`
  - Zustand store with persist middleware
- [x] **Create `stores/todo.ts`** (migrated from `store/todoStore.ts`)
  - Uses `Todo` type from `types/api.ts`
  - Session filtering and computed getters
- [x] **Create `stores/index.ts`** (centralized exports)
  - Exports: useAuthStore, useSessionStore, useUIStore, useApprovalStore, useTodoStore
- [x] **Delete deprecated `store/` directory**
  - Deleted 4 files: approvalStore.ts, todoStore.ts, uiStore.ts, index.ts

**Test**: ✅ All stores imported successfully from `@/stores`

### Sprint 1.2: Migrate Critical Hooks (5 tasks) ✅
- [x] **Migrate `hooks/useApprovals.ts`**
  - Changed: `useSocket()` → `useWebSocket()`
  - Changed: Direct API calls → `usePendingApprovals()`, `useApproveApproval()`, `useRejectApproval()`
  - Pattern: React Query (server state) + Zustand (dialog state) + WebSocket (real-time)
- [x] **Migrate `hooks/useTodos.ts`**
  - Changed: `useTodoStore` from `@/store` → `@/stores`
  - Changed: `useSocket()` → `useWebSocket()`
  - WebSocket event handling for real-time updates
- [x] **Migrate `hooks/useAuth.ts`**
  - Changed: `authApi` from `@/lib/api` → `apiClient` from `@/lib/api-client`
  - Changed: Types from `@/lib/types` → `@/types/api`
  - Uses `queryKeys.auth.me()` for query keys
  - Added SDK types: `UseQueryResult<User | null, Error>`
- [x] **Migrate `hooks/useChat.ts`** (505 lines - most critical)
  - Changed: `useSocket()` → `useWebSocket()` from `@/contexts/websocket`
  - Changed: `chatApi` from `@/lib/api` → `apiClient` from `@/lib/api-client`
  - Changed: Types from `@/lib/types` → `@/types/api`
  - Created `JSONValue` type for type-safe JSON serialization
  - Created `ChatMessage` union type (Message | ToolUseMessage | ThinkingMessage)
  - Updated WebSocket event handlers to use `JSONValue` instead of `unknown`
- [x] **Delete `hooks/useSocket.ts`** (445 lines)
  - Replaced by `contexts/websocket.tsx`
  - Updated `hooks/index.ts` to remove export

**Test**: ✅ All hooks compile, React Query integration works

### Sprint 1.3: Migrate Chat Components (7 tasks) ✅

**Sprint 1.3.1: Layout Components (2 tasks) ✅**
- [x] **Migrate `components/layout/Sidebar.tsx`**
  - Changed: `useSocket()` → `useWebSocket()`
  - Changed: `chatApi.updateSessionTitle()` → `apiClient.sessions.update()`
- [x] **Migrate `components/chat/MessageList.tsx`**
  - Changed: Import `ChatMessage` type from `@/hooks/useChat`
  - Changed: Import type guards from `@/hooks/useChat`
  - Uses stop_reason pattern for message grouping

**Sprint 1.3.2: Chat Message Components (5 tasks) ✅**
- [x] **Migrate `components/chat/AgentProcessGroup.tsx`**
  - Changed: Import `ChatMessage` from `@/hooks/useChat`
  - Changed: Import type guards from `@/hooks/useChat`
  - Removed unused `hasCompletedTurn` variable
- [x] **Migrate `components/chat/Message.tsx`**
  - Changed: Import `ChatMessage` from `@/hooks/useChat`
  - Type guard for BaseMessage vs specialized messages
- [x] **Migrate `components/chat/CollapsibleThinkingMessage.tsx`**
  - Changed: Import `ThinkingMessage` from `@/hooks/useChat`
  - Duration formatting helper
- [x] **Migrate `components/chat/ToolUseMessage.tsx`**
  - Changed: Import `ToolUseMessage` + `JSONValue` from `@/hooks/useChat`
  - Created local `jsonToString` helper (replaces `@/lib/json-utils`)
  - **Fixed**: TypeScript error "unknown not assignable to ReactNode"
  - Solution: Changed `Record<string, unknown>` → `Record<string, JSONValue>`
- [x] **Migrate `app/(app)/layout.tsx`**
  - Changed: `SocketProvider` → `WebSocketProvider`
  - Updated comment to reference WebSocketProvider
- [x] **Migrate `app/(app)/new/page.tsx`** ⚠️ **INCOMPLETE** (completed in Sprint 1.6)
  - Changed: `useSocketContext` → `useWebSocket()`

**Test**: ✅ TypeScript: 0 errors, Build: successful (7/7 pages), Lint: 8 warnings in deprecated files

### Sprint 1.4: Remaining Components (2 tasks) ✅

- [x] **Migrate `components/todos/TodoList.tsx`**
  - Changed: imports from `@/lib/types` → `@/types/api`
  - No `useSocket()` usage (already using `useTodos()` hook)

- [x] **Migrate `components/todos/TodoItem.tsx`**
  - Changed: imports from `@/lib/types` → `@/types/api`
  - Verified todo type matches `Todo` from `types/api.ts`

**Note**: `components/approvals/*` files checked - no deprecated imports found ✅

**Test**: ✅ `grep` returned 0 matches for deprecated imports in components/

### Sprint 1.5: Final Cleanup (6 tasks) ✅

- [x] **Delete `lib/api.ts`** (deprecated, replaced by `lib/api-client.ts`)
- [x] **Delete `lib/socket.ts`** (deprecated, replaced by `contexts/websocket.tsx`)
- [x] **Delete `lib/types.ts`** (deprecated, replaced by `types/*`)
- [x] **Delete `lib/json-utils.ts`** (deprecated, not used in new architecture)
- [x] **Delete `providers/SocketProvider.tsx`** (deprecated, replaced by `contexts/websocket.tsx`)
- [x] **Validation**
  - ✅ `npm run type-check`: 0 errors
  - ✅ `npm run lint`: 0 errors, 4 warnings (unused vars, non-critical)
  - ✅ `npm run build`: Successful (7/7 pages)
  - ✅ `npm run test`: 19/19 tests passing

**Test**: ✅ No imports reference deleted files

### Sprint 1.6: SDK Types & joinSessionAndWait (8 tasks) ✅

**Purpose**: Install Anthropic SDK for type safety and implement joinSessionAndWait with retry logic

- [x] **Install `@anthropic-ai/sdk@0.68.0`** (devDependency, exact version)
  ```bash
  npm install --save-dev --save-exact @anthropic-ai/sdk@0.68.0
  ```

- [x] **Create `types/sdk.ts`** (re-export SDK types)
  - Re-exports: `StopReason`, `ContentBlock`, `TextBlock`, `ToolUseBlock`, `SDKMessage`, `MessageParam`, `Tool`
  - Type guards: `isTextBlock()`, `isToolUseBlock()`
  - Pattern mirrors `backend/src/types/sdk.ts` (gold standard)

- [x] **Update `types/api.ts`** (use SDK StopReason)
  - Replaced hardcoded `StopReason` union with `import type { StopReason } from './sdk'`
  - Added comment explaining `content: string` simplification for UI

- [x] **Update `types/events.ts`** (use SDK StopReason)
  - Changed: `import type { StopReason } from "./api"` → `from "./sdk"`

- [x] **Implement `joinSessionAndWait()` in `contexts/websocket.tsx`**
  - Promise-based with timeout (default: 2000ms)
  - Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
  - Listens for `session:joined` event from backend
  - Cleanup: removes event listeners after success/timeout

- [x] **Complete migration of `app/(app)/new/page.tsx`**
  - Removed: `import { socketChatApi } from '@/lib/socket'`
  - Added: `import { useAuth } from '@/hooks'`
  - Changed: `socketChatApi.joinSessionAndWait()` → `joinSessionAndWait()` from WebSocket context
  - Changed: `socketChatApi.sendMessage()` → `sendMessage(sessionId, content, user.id)` with userId
  - userId handling: `const userId = user?.id || 'guest'`

- [x] **Write tests for `contexts/websocket.tsx`** (12 tests)
  - `__tests__/contexts/websocket.test.tsx`
  - Tests: API surface, event emitters, listeners, joinSessionAndWait basics
  - All tests passing ✅

- [x] **Write tests for `app/(app)/new/page.tsx`** (4 tests)
  - `__tests__/app/new/page.test.tsx`
  - Tests: Rendering, suggestions, buttons, disabled states
  - All tests passing ✅

**Architectural Improvements**:
- ✅ SDK types prevent type drift between frontend/backend
- ✅ `joinSessionAndWait()` provides reliable WebSocket connection
- ✅ userId propagation from useAuth() (no more hardcoded 'default-user')
- ✅ Type-safe WebSocket API with retry logic

**Test Results**:
- ✅ TypeScript: 0 errors
- ✅ Tests: 19/19 passing (3 test files)
- ✅ Build: Successful (7/7 pages)
- ✅ Lint: 0 errors, 4 warnings (unused vars in api-client, mutations, stores)

**Files Modified (8)**:
1. `package.json` - Added @anthropic-ai/sdk
2. `types/sdk.ts` - NEW
3. `types/api.ts` - SDK StopReason
4. `types/events.ts` - SDK StopReason
5. `contexts/websocket.tsx` - joinSessionAndWait
6. `app/(app)/new/page.tsx` - Complete migration
7. `components/todos/TodoList.tsx` - Fixed import
8. `components/todos/TodoItem.tsx` - Fixed import

**Files Deleted (5)**:
1. `lib/api.ts`
2. `lib/socket.ts`
3. `lib/types.ts`
4. `lib/json-utils.ts`
5. `providers/SocketProvider.tsx`

**Files Created (2)**:
1. `__tests__/contexts/websocket.test.tsx`
2. `__tests__/app/new/page.test.tsx`

---

## ✅ Phase 2: Pages & Layout (COMPLETED - 10/10)

**Completion Date**: 2025-11-20
**Time Taken**: ~2 hours

### shadcn/ui Components (7 tasks) ✅
- [x] button ✅ (Already installed)
- [x] dialog ✅ (Already installed)
- [x] input ✅ (Already installed)
- [x] scroll-area ✅ (Already installed)
- [x] avatar ✅ (Already installed)
- [x] dropdown-menu ✅ (Already installed)
- [x] separator ✅ (Already installed)

**Additional components found**: 18 total (accordion, alert, badge, card, collapsible, progress, skeleton, sonner, tabs, textarea, tooltip)

**Test**: ✅ All components verified working

### Root Layout & Providers (1 task) ✅
- [x] **Validated `app/layout.tsx`** (Root layout with all providers)
  - [x] QueryClientProvider ✅
  - [x] ThemeProvider (next-themes) ✅ **ADDED**
  - [x] Toaster component ✅ **ADDED**
  - [x] Import `./globals.css` ✅
  - [x] ReactQueryDevtools (dev only) ✅

**Note**: WebSocketProvider is in `app/(app)/layout.tsx` (nested layout for authenticated routes)

**Test**: ✅ App starts without errors, all providers working

### Pages (3 tasks) ✅
- [x] **Validated `app/page.tsx`** (Landing page)
  - [x] Uses useAuth() hook ✅
  - [x] Redirects to /new if authenticated ✅
  - [x] Redirects to /login if not authenticated ✅
  - [x] Error handling added ✅ **IMPROVED**

**Test**: ✅ Unauthenticated redirect works, error handling works

- [x] **Validated `app/(auth)/login/page.tsx`** (Login redirect)
  - [x] Redirects to backend `/api/auth/login` ✅
  - [x] Shows Microsoft branded UI ✅
  - [x] Uses NEXT_PUBLIC_API_URL env var ✅

**Test**: ✅ Redirects to Microsoft OAuth correctly

- [x] **Validated `app/(app)/new/page.tsx`** (Create session page)
  - [x] Already migrated in Phase 1.6 ✅
  - [x] Uses useWebSocket() ✅
  - [x] Uses joinSessionAndWait() ✅
  - [x] 4/4 tests passing ✅

**Test**: ✅ Creates session and redirects to chat

### Layout Components (3 tasks) ✅
- [x] **Validated `components/layout/Sidebar.tsx`**
  - [x] Uses useChat() (React Query internally) ✅
  - [x] Uses useWebSocket() ✅
  - [x] 0 deprecated imports ✅
  - [x] Delete functionality working ✅
  - [x] Collapsible on mobile ✅

**Test**: ✅ Sidebar validated, 0 deprecated imports

- [x] **Validated `components/layout/Header.tsx`**
  - [x] Uses useAuth() ✅
  - [x] Dropdown menu with logout ✅
  - [x] 0 deprecated imports ✅

**Test**: ✅ Header validated, architecture correct

- [x] **Validated SessionList logic**
  - [x] Logic is inline in Sidebar.tsx ✅
  - [x] Sorts by last_activity_at ✅
  - [x] Highlights active session ✅
  - [x] Format timestamps with custom helper ✅

**Test**: ✅ SessionList logic working correctly

---

## 📊 Phase 2 Summary

**Findings**:
- Most components already existed from Phase 1.5 ✅
- Architecture already correct (React Query + WebSocket + Zustand) ✅
- **0 deprecated imports** found in entire codebase ✅

**Changes Made**:
1. **Added ThemeProvider** to `app/providers.tsx` (next-themes)
2. **Added Toaster** to `app/providers.tsx` (sonner for toast notifications)
3. **Added error handling** to landing page (`app/page.tsx`)

**Validation Results**:
- ✅ TypeScript: **0 errors**
- ✅ ESLint: **0 errors**, 6 warnings (unused vars, non-critical)
- ✅ Build: **Successful** (7/7 pages)
- ✅ Tests: **19/19 passing** (3 test files)
- ✅ No deprecated imports (lib/api, lib/socket, lib/types)

**Architecture Improvements**:
- ✅ Theme provider enables light/dark mode
- ✅ Toaster enables global toast notifications
- ✅ Error handling prevents infinite loading states
- ✅ All components use Phase 1 architecture

**Files Modified (2)**:
1. `app/providers.tsx` - Added ThemeProvider + Toaster
2. `app/page.tsx` - Added error handling

**Files Validated (18)**:
1. All shadcn/ui components (18 components)
2. `app/layout.tsx` - Root layout
3. `app/providers.tsx` - Providers
4. `app/page.tsx` - Landing page
5. `app/(auth)/login/page.tsx` - Login page
6. `app/(app)/new/page.tsx` - New session page
7. `app/(app)/layout.tsx` - App layout with WebSocketProvider
8. `components/layout/Sidebar.tsx` - Sidebar
9. `components/layout/Header.tsx` - Header

---

## 🔄 Phase 3: Chat Interface (PENDING - 0/8)

### Core Chat Components (4 tasks)

- [ ] **Create `components/chat/ChatContainer.tsx`**
  - [ ] Fetch messages with useMessages(sessionId)
  - [ ] Setup useAgentEvents hook
  - [ ] Manage accumulatedText state
  - [ ] Manage isThinking state
  - [ ] Manage canSend state (disabled during streaming)
  - [ ] Handle stopReason pattern (end_turn vs tool_use)
  - [ ] Render MessageList + ChatInput
  - [ ] Implement handleSend (useWebSocket().sendMessage)

**Test**: Container renders, state management works

- [ ] **Create `components/chat/MessageList.tsx`**
  - [ ] **FIX BUG**: Sort by sequenceNumber, NOT timestamp
  - [ ] Add sequenceNumber field to Message interface in types/api.ts
  - [ ] Use ScrollArea component
  - [ ] Auto-scroll to bottom on new messages
  - [ ] Show thinking indicator when isThinking=true
  - [ ] Show accumulated streaming text
  - [ ] Show active tool indicator

**Test**: Messages display in correct order, auto-scrolls

- [ ] **Create `components/chat/ChatMessage.tsx`**
  - [ ] User variant: right-aligned, blue bg
  - [ ] Assistant variant: left-aligned, gray bg
  - [ ] Use MarkdownRenderer for assistant messages
  - [ ] Plain text for user messages
  - [ ] Show streaming cursor when isStreaming=true

**Test**: Messages render correctly (user/assistant)

- [ ] **Create `components/chat/ChatInput.tsx`**
  - [ ] Auto-resize textarea (min 1 line, max 10 lines)
  - [ ] Send on Enter, new line on Shift+Enter
  - [ ] Disable when disabled prop is true
  - [ ] Clear value after sending
  - [ ] Show placeholder (dynamic based on state)

**Test**: Input works, auto-resizes, keyboard shortcuts

### Agent Process Visualization (3 tasks)

- [ ] **Create `components/chat/AgentProcessGroup.tsx`**
  - [ ] Use Collapsible component
  - [ ] Show thinking content (if provided)
  - [ ] List all tool executions
  - [ ] Render ToolExecutionCard for each tool
  - [ ] Show count in trigger: "Agent Process (N tools)"

**Test**: Collapsible works, tools display

- [ ] **Create `components/chat/ThinkingIndicator.tsx`**
  - [ ] Animated dots (3 dots with staggered bounce)
  - [ ] Show "Thinking..." text
  - [ ] Style: text-muted-foreground

**Test**: Animation smooth

- [ ] **Create `components/chat/ToolExecutionCard.tsx`**
  - [ ] Show tool name as title
  - [ ] Show success/error badge
  - [ ] Format tool args as JSON (pretty-printed)
  - [ ] Format tool result as JSON
  - [ ] Show error message if failed
  - [ ] Use Card component from shadcn

**Test**: Tool details display correctly

### Chat Page (1 task)

- [ ] **Update `app/chat/[sessionId]/page.tsx`**
  - [ ] Use React.use() to unwrap params Promise
  - [ ] Call useSessionRoom(sessionId) (auto join/leave)
  - [ ] Fetch session with useSession(sessionId)
  - [ ] Show loading state
  - [ ] Render Header + Sidebar + ChatContainer
  - [ ] Use flex layout (full height)

**Test**: Chat page loads, WebSocket joins room

---

## 🔄 Phase 4: Approvals & Shared Components (PENDING - 0/6)

### Approval Components (3 tasks)

- [ ] **Create `components/approval/ApprovalDialog.tsx`**
  - [ ] Listen to approval:requested event (useWebSocket)
  - [ ] Store approval state (useState)
  - [ ] Listen to approval:resolved (close dialog)
  - [ ] Use Dialog component
  - [ ] Render ApprovalTimer + ApprovalSummary
  - [ ] Approve button: respondToApproval(id, true, userId)
  - [ ] Reject button: respondToApproval(id, false, userId)

**Test**: Dialog opens on approval request, buttons work

- [ ] **Create `components/approval/ApprovalSummary.tsx`**
  - [ ] Show approval title
  - [ ] Show description
  - [ ] Show impact badge (high/medium/low)
  - [ ] Format changes as JSON (pretty-printed)

**Test**: Summary displays correctly

- [ ] **Create `components/approval/ApprovalTimer.tsx`**
  - [ ] Calculate time remaining (5 minutes)
  - [ ] Update every 100ms (setInterval)
  - [ ] Show MM:SS format
  - [ ] Show progress bar (100% → 0%)
  - [ ] Auto-close on timeout

**Test**: Countdown works, progress bar animates

### Shared Components (3 tasks)

- [ ] **Create `components/shared/ErrorBoundary.tsx`**
  - [ ] Extend React.Component
  - [ ] Implement getDerivedStateFromError
  - [ ] Implement componentDidCatch (log to console)
  - [ ] Render fallback UI with error message
  - [ ] Add "Try again" button (resets state)

**Test**: Catches errors, fallback displays

- [ ] **Create `components/shared/MarkdownRenderer.tsx`**
  - [ ] Use react-markdown
  - [ ] Use react-syntax-highlighter for code blocks
  - [ ] Detect language from code block class
  - [ ] Add copy button to code blocks
  - [ ] Show "Copied!" feedback (2 seconds)
  - [ ] Support tables, links, bold, italic

**Test**: Markdown renders, code highlighting works, copy button

- [ ] **Create `components/shared/Toaster.tsx`**
  - [ ] Use sonner library
  - [ ] Position: bottom-right
  - [ ] Enable rich colors
  - [ ] Export for use in layout.tsx

**Test**: Import toast from sonner, show success/error toasts

---

## 🔄 Phase 5: Cleanup & Testing (PENDING - 0/10)

### Delete Deprecated Files (4 tasks)

- [ ] **Delete `lib/api.ts`** (replaced by lib/api-client.ts)
  ```bash
  rm frontend/lib/api.ts
  ```

- [ ] **Delete `lib/socket.ts`** (replaced by contexts/websocket.tsx)
  ```bash
  rm frontend/lib/socket.ts
  ```

- [ ] **Delete `lib/types.ts`** (replaced by types/*)
  ```bash
  rm frontend/lib/types.ts
  ```

- [ ] **Delete `lib/json-utils.ts`** (not used in new architecture)
  ```bash
  rm frontend/lib/json-utils.ts
  ```

**Test**: Check no imports reference deleted files

### Fix Imports (3 tasks)

- [ ] **Fix imports: lib/api → lib/api-client**
  ```bash
  # Search and replace across all .ts/.tsx files
  find . -name "*.ts" -o -name "*.tsx" | xargs grep -l "from.*lib/api"
  # Manually update or use sed
  ```

- [ ] **Fix imports: lib/socket → contexts/websocket**
  ```bash
  find . -name "*.ts" -o -name "*.tsx" | xargs grep -l "from.*lib/socket"
  ```

- [ ] **Fix imports: lib/types → types/*  **
  ```bash
  find . -name "*.ts" -o -name "*.tsx" | xargs grep -l "from.*lib/types"
  ```

**Test**: `npm run type-check` passes

### Bug Fixes (1 task)

- [ ] **Fix sequenceNumber sorting bug**
  - [ ] Add `sequenceNumber: number` to Message interface in types/api.ts
  - [ ] Update queries/sessions.ts:43-46 to sort by sequenceNumber
    ```typescript
    // ✅ CORRECT
    return response.messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    ```

**Test**: Messages display in correct order (verify with backend)

### Testing (2 tasks)

- [ ] **Run automated tests**
  ```bash
  npm run type-check  # TypeScript errors
  npm run lint        # ESLint errors
  npm run test        # Vitest (when tests exist)
  ```

**All should pass** ✅

- [ ] **Manual testing checklist**
  - [ ] User can login with Microsoft
  - [ ] User redirected to /new after login
  - [ ] New session created, redirects to /chat/:id
  - [ ] Sidebar shows all sessions sorted by last_activity_at
  - [ ] Clicking session navigates to /chat/:id
  - [ ] WebSocket connects successfully (check console logs)
  - [ ] Sending message works
  - [ ] Message streams character-by-character
  - [ ] Messages appear in correct order (sequenceNumber)
  - [ ] Input re-enables when stopReason='end_turn'
  - [ ] Input stays disabled when stopReason='tool_use'
  - [ ] Approval dialog opens on tool approval request
  - [ ] Approval countdown works (5 minutes)
  - [ ] Approving/rejecting tool works
  - [ ] Error boundaries catch and display errors
  - [ ] Toast notifications work (success/error)
  - [ ] Markdown renders correctly
  - [ ] Code blocks have syntax highlighting
  - [ ] Code copy button works
  - [ ] Logout works, clears cache

**Performance**:
- [ ] Run Lighthouse audit (target: Performance ≥ 90)

**Accessibility**:
- [ ] Test keyboard navigation (Tab, Enter, Escape work)
- [ ] Test with screen reader (NVDA/JAWS/VoiceOver)
- [ ] Check color contrast (WCAG 2.1 AA: ≥ 4.5:1)

---

## 📚 Implementation Notes

### Critical Patterns to Remember

**1. Stop Reason Pattern** (see migration-plan.md:7.1)
```typescript
if (event.stopReason === 'end_turn') {
  setCanSend(true);  // Enable input
} else if (event.stopReason === 'tool_use') {
  setCanSend(false); // Wait for tool
}
```

**2. Message Accumulation** (see migration-plan.md:7.2)
```typescript
onMessageChunk: (event) => setAccumulatedText(prev => prev + event.content);
onMessage: (event) => setAccumulatedText(''); // Clear on final
```

**3. Sequence Number Sorting** (see migration-plan.md:7.3)
```typescript
// ✅ CORRECT
messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

// ❌ WRONG
messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
```

**4. Single WebSocket Event** (see migration-plan.md:7.4)
```typescript
// ✅ CORRECT
socket.on('agent:event', (event: AgentEvent) => {
  switch (event.type) { ... }
});

// ❌ WRONG
socket.on('agent:thinking', ...);  // Backend doesn't emit separate events
```

### Known Issues

**Issue #1: sequenceNumber field missing**
- **Location**: types/api.ts Message interface
- **Fix**: Add `sequenceNumber: number` field
- **Impact**: HIGH - Messages may appear out of order

**Issue #2: Old WebSocket client still exists**
- **Location**: lib/socket.ts
- **Fix**: Delete file in Phase 5
- **Impact**: MEDIUM - May cause confusion during development

### References

- **Detailed Technical Document**: [migration-plan.md](./migration-plan.md)
- **Frontend Documentation**: [docs/frontend/](../../frontend/)
- **Backend WebSocket Contract**: [docs/backend/websocket-contract.md](../../backend/websocket-contract.md)

---

## 🎯 Current Focus

**Current Phase**: Phase 3 - Chat Interface (0/8 tasks)

**Next Task**: Create/validate `components/chat/ChatContainer.tsx`

**After Phase 3**: Phase 4 - Approvals & Shared Components

**Overall Progress**: 67% complete (49/73 tasks)

---

## 📊 Detailed Statistics

**Phase 1.5 Cleanup Sprint Progress**:
- **Files Created**: 2 (stores/approval.ts, stores/todo.ts)
- **Files Migrated**: 11 (hooks + components + pages)
- **Files Deleted**: 5 (store/* + hooks/useSocket.ts)
- **Type System Enhancement**: Created `JSONValue` type for JSON serialization
- **TypeScript Errors Fixed**: 6+ errors (reduced to 0)
- **Build Status**: ✅ Successful (7/7 pages)
- **Linter Warnings**: 8 (all in deprecated files to be deleted)

**Architecture Improvements**:
- ✅ All WebSocket usage migrated to new context pattern
- ✅ All API calls migrated to new client pattern
- ✅ All types migrated to centralized type system
- ✅ React Query + Zustand + WebSocket pattern established
- ✅ Type-safe JSON handling with `JSONValue`

---

**Last Updated**: 2025-11-20
**Completed**: 49/73 tasks (67%)
**Next Milestone**: Phase 3 - Chat Interface (8 tasks)
