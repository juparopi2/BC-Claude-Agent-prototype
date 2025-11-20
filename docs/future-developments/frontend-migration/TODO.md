# Frontend Migration TODO

**Status**: 35% Complete (Phase 1 ✅)
**Last Updated**: 2025-11-20
**Related Document**: [Migration Plan](./migration-plan.md)

---

## Progress Summary

| Phase | Tasks | Completed | Percentage |
|-------|-------|-----------|------------|
| Phase 1: Core Infrastructure | 18 | 18 | 100% ✅ |
| Phase 2: Pages & Layout | 10 | 0 | 0% |
| Phase 3: Chat Interface | 8 | 0 | 0% |
| Phase 4: Approvals & Shared | 6 | 0 | 0% |
| Phase 5: Cleanup & Testing | 10 | 0 | 0% |
| **TOTAL** | **52** | **18** | **35%** |

---

## ✅ Phase 1: Core Infrastructure (COMPLETED)

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

## 🔄 Phase 2: Pages & Layout (IN PROGRESS - 0/10)

### shadcn/ui Components (7 tasks)
- [ ] Install button: `npx shadcn@latest add button`
- [ ] Install dialog: `npx shadcn@latest add dialog`
- [ ] Install input: `npx shadcn@latest add input`
- [ ] Install scroll-area: `npx shadcn@latest add scroll-area`
- [ ] Install avatar: `npx shadcn@latest add avatar`
- [ ] Install dropdown-menu: `npx shadcn@latest add dropdown-menu`
- [ ] Install separator: `npx shadcn@latest add separator`

**Test**: Verify imports work: `import { Button } from '@/components/ui/button'`

### Root Layout & Providers (1 task)
- [ ] **Create `app/layout.tsx`** (Root layout with all providers)
  - [ ] Add QueryClientProvider
  - [ ] Add WebSocketProvider
  - [ ] Add ThemeProvider (next-themes)
  - [ ] Add Toaster component
  - [ ] Import `./globals.css`
  - [ ] Add ReactQueryDevtools (dev only)

**Test**: App starts without errors

### Pages (3 tasks)
- [ ] **Create `app/page.tsx`** (Landing page)
  - [ ] Check if user authenticated (useAuth)
  - [ ] If authenticated: redirect to /new
  - [ ] If not: show "Login with Microsoft" button

**Test**: Unauthenticated user sees landing page

- [ ] **Create `app/login/page.tsx`** (Login redirect)
  - [ ] Redirect to `/api/auth/login` on mount
  - [ ] Show "Redirecting..." message

**Test**: Redirects to Microsoft OAuth

- [ ] **Create `app/new/page.tsx`** (Create session page)
  - [ ] Call useCreateSession() on mount
  - [ ] Mutation auto-redirects to /chat/:id on success
  - [ ] Show "Creating session..." message

**Test**: Creates session and redirects to chat

### Layout Components (3 tasks)
- [ ] **Create `components/layout/Sidebar.tsx`**
  - [ ] Fetch sessions with useSessions()
  - [ ] Render SessionList component
  - [ ] Add "New Session" button (links to /new)
  - [ ] Add delete functionality (useDeleteSession)
  - [ ] Make collapsible on mobile

**Test**: Sidebar shows all sessions, can delete

- [ ] **Create `components/layout/Header.tsx`**
  - [ ] Show user avatar + name (useAuth)
  - [ ] Show BC status badge (useBCStatus)
  - [ ] Add dropdown menu with "Logout" (useLogout)
  - [ ] Add theme toggle (optional)

**Test**: Header shows user info, logout works

- [ ] **Create `components/layout/SessionList.tsx`**
  - [ ] Map over sessions prop
  - [ ] Sort by last_activity_at (descending)
  - [ ] Highlight active session
  - [ ] Format timestamp with formatRelativeTime()
  - [ ] Show delete button on hover
  - [ ] Navigate to /chat/:id on click

**Test**: Sessions render, navigation works

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

**Next Task**: Phase 2 - Install shadcn/ui components

**Command**:
```bash
cd frontend
npx shadcn@latest add button dialog input scroll-area avatar dropdown-menu separator
```

**After Installation**: Create `app/layout.tsx` with all providers

---

**Last Updated**: 2025-11-20
**Completed**: 18/52 tasks (35%)
**Next Milestone**: Phase 2 Complete (10 tasks)
