# Frontend Implementation Guide

**Version**: 1.0.0
**Date**: 2025-11-19
**Prerequisites**: Read `frontend-rebuild-prd.md` and `technical-architecture.md` first

---

## Table of Contents

1. [Implementation Roadmap](#1-implementation-roadmap)
2. [Migration Strategy](#2-migration-strategy)
3. [Component Specifications](#3-component-specifications)
4. [WebSocket Integration Patterns](#4-websocket-integration-patterns)
5. [Testing Checklist](#5-testing-checklist)
6. [Deployment Checklist](#6-deployment-checklist)

---

## 1. Implementation Roadmap

### Phase 1: Foundation (Week 1 - 5 days)

**Goal**: Authentication + Session Management

#### Day 1-2: Project Setup
- [ ] Initialize Next.js 16.0.1 project (if starting fresh)
- [ ] Install dependencies (exact versions from `technical-architecture.md`)
- [ ] Setup Tailwind CSS 4.1.17
- [ ] Install shadcn/ui components (`npx shadcn@latest init`)
- [ ] Create folder structure (see `technical-architecture.md` section 1.2)
- [ ] Setup environment variables (`.env.local`)

**Files to Create**:
```
frontend/
├── .env.local
├── lib/
│   ├── api-client.ts
│   ├── react-query.ts
│   └── utils.ts
├── types/
│   ├── api.ts
│   └── events.ts
└── app/
    └── layout.tsx (root providers)
```

#### Day 3-4: Authentication Flow
- [ ] Create `app/login/page.tsx` (redirect to `/api/auth/login`)
- [ ] Create `queries/auth.ts` (`useAuth`, `useBCStatus`)
- [ ] Create `stores/auth.ts` (Zustand authStore)
- [ ] Create `components/layout/Header.tsx` (user menu)
- [ ] Wire up login/logout flow

**Test Checklist**:
- [ ] User can click "Login with Microsoft"
- [ ] User redirects to Microsoft OAuth page
- [ ] User redirects back to `/new` after successful login
- [ ] User info displays in header
- [ ] Logout button clears session

#### Day 5: Session List
- [ ] Create `queries/sessions.ts` (`useSessions`)
- [ ] Create `components/layout/Sidebar.tsx`
- [ ] Create `components/layout/SessionList.tsx`
- [ ] Create `components/layout/SessionItem.tsx`
- [ ] Wire up session navigation

**Test Checklist**:
- [ ] Sidebar shows all user sessions
- [ ] Sessions sorted by `last_activity_at`
- [ ] Active session highlighted
- [ ] Clicking session navigates to `/chat/:sessionId`

---

### Phase 2: Chat Interface + Streaming (Week 2 - 5 days)

**Goal**: Real-time streaming working end-to-end

#### Day 1-2: WebSocket Setup
- [ ] Create `contexts/websocket.tsx` (Socket.IO client)
- [ ] Create `hooks/useAgentEvents.ts` (event handler)
- [ ] Create `hooks/useSessionRoom.ts` (join/leave rooms)
- [ ] Wire up WebSocket connection in root layout
- [ ] Test connection (check browser console logs)

**Test Checklist**:
- [ ] WebSocket connects on app load
- [ ] Console shows "Connected: <socket-id>"
- [ ] Disconnecting WiFi triggers reconnection attempts
- [ ] Reconnection successful after 5 attempts

#### Day 3-4: Chat UI Components
- [ ] Create `components/chat/ChatContainer.tsx`
- [ ] Create `components/chat/MessageList.tsx`
- [ ] Create `components/chat/ChatMessage.tsx` (user + assistant variants)
- [ ] Create `components/chat/ChatInput.tsx` (auto-resize textarea)
- [ ] Create `app/chat/[sessionId]/page.tsx`

**Component Hierarchy**:
```tsx
<ChatContainer>
  <MessageList>
    <ChatMessage role="user" />
    <ChatMessage role="assistant" stopReason="end_turn" />
  </MessageList>
  <ChatInput onSend={handleSend} />
</ChatContainer>
```

**Test Checklist**:
- [ ] Message list displays messages from API
- [ ] User messages right-aligned (blue bubble)
- [ ] Assistant messages left-aligned (gray bubble)
- [ ] Input field auto-resizes (min 1 line, max 10 lines)
- [ ] Send on Enter, new line on Shift+Enter

#### Day 5: Streaming Implementation
- [ ] Implement `accumulatedText` state in ChatContainer
- [ ] Handle `message_chunk` events (accumulate text)
- [ ] Handle `message` events (clear accumulator, check `stopReason`)
- [ ] Handle `thinking` events (show indicator)
- [ ] Test streaming end-to-end

**Test Checklist**:
- [ ] Sending message disables input field
- [ ] "Thinking..." indicator appears
- [ ] Text streams character-by-character (real-time)
- [ ] Input re-enables when `stopReason='end_turn'`
- [ ] Multiple messages don't interfere with each other

---

### Phase 3: Approvals + Agent Process Visualization (Week 3 - 5 days)

**Goal**: Approval dialog + collapsible agent process details

#### Day 1-2: Approval Dialog
- [ ] Create `components/approval/ApprovalDialog.tsx`
- [ ] Create `components/approval/ApprovalSummary.tsx`
- [ ] Create `components/approval/ApprovalTimer.tsx` (countdown)
- [ ] Handle `approval:requested` event
- [ ] Handle `approval:respond` emission
- [ ] Wire up approve/reject buttons

**Test Checklist**:
- [ ] Dialog opens on `approval:requested` event
- [ ] Change summary displays correctly
- [ ] Countdown timer counts down from 5:00
- [ ] Approve button sends `approved: true`
- [ ] Reject button sends `approved: false`
- [ ] Dialog closes after response

#### Day 3-4: Agent Process Group
- [ ] Create `components/chat/AgentProcessGroup.tsx` (collapsible)
- [ ] Create `components/chat/ThinkingIndicator.tsx`
- [ ] Create `components/chat/ToolExecutionCard.tsx`
- [ ] Group messages with `stopReason='tool_use'` inside AgentProcessGroup
- [ ] Display thinking content in collapsible section
- [ ] Display tool use + result

**Component Structure**:
```tsx
<AgentProcessGroup defaultOpen={false}>
  <AgentProcessGroup.Trigger>
    Agent Process Details ▼
  </AgentProcessGroup.Trigger>
  <AgentProcessGroup.Content>
    <ThinkingIndicator content="Analyzing customer data..." />
    <ToolExecutionCard
      toolName="bc_list_all_entities"
      args={{ entity_type: "customers" }}
      result={[...]}
      status="success"
    />
    <ChatMessage role="assistant" stopReason="tool_use" />
  </AgentProcessGroup.Content>
</AgentProcessGroup>
```

**Test Checklist**:
- [ ] Agent process group renders for `stopReason='tool_use'` messages
- [ ] Collapsible works (expand/collapse)
- [ ] Thinking content displays
- [ ] Tool execution card shows tool name, args, result
- [ ] Status badges show correct color (pending=orange, success=green, error=red)

#### Day 5: Polish
- [ ] Add execution summary (tokens used, duration)
- [ ] Add copy button for tool results
- [ ] Add timestamps on hover
- [ ] Test edge cases (errors, timeouts, max_tokens)

---

### Phase 4: Optimistic UI + Polish (Week 4 - 5 days)

**Goal**: Optimistic updates + Markdown rendering + performance

#### Day 1-2: Optimistic Updates
- [ ] Implement optimistic session creation (`mutations/sessions.ts`)
- [ ] Implement optimistic session rename
- [ ] Implement rollback on error
- [ ] Test optimistic updates with network throttling

**Test Checklist**:
- [ ] New session appears in sidebar immediately
- [ ] Session rename updates immediately
- [ ] Optimistic update rolls back on error
- [ ] Toast notification shows on error

#### Day 3-4: Markdown Rendering
- [ ] Install `react-markdown` + `react-syntax-highlighter`
- [ ] Create `components/shared/MarkdownRenderer.tsx`
- [ ] Add code copy button
- [ ] Style markdown elements (headings, lists, tables)
- [ ] Test with various markdown inputs

**Test Checklist**:
- [ ] Code blocks render with syntax highlighting
- [ ] Copy button copies code to clipboard
- [ ] Tables render correctly
- [ ] Lists render correctly
- [ ] Inline code renders with monospace font

#### Day 5: Performance & Accessibility
- [ ] Run Lighthouse audit (target: score ≥ 90)
- [ ] Run axe DevTools audit (WCAG 2.1 AA)
- [ ] Implement virtual scrolling if needed (> 100 messages)
- [ ] Add infinite scroll for message history
- [ ] Test keyboard navigation
- [ ] Test screen reader support

**Performance Checklist**:
- [ ] TTFB < 200ms
- [ ] FCP < 1.5s
- [ ] LCP < 2.5s
- [ ] CLS < 0.1
- [ ] Lighthouse score ≥ 90

**Accessibility Checklist**:
- [ ] All buttons keyboard accessible
- [ ] Focus visible on all interactive elements
- [ ] ARIA labels on icon buttons
- [ ] ARIA live regions for streaming text
- [ ] Color contrast ≥ 4.5:1

---

## 2. Migration Strategy

### 2.1 Current Frontend Analysis

**What to Review** (frontend directory):
- [ ] Read `frontend/app/` structure
- [ ] Identify components to rescue vs. rebuild
- [ ] List third-party dependencies to keep vs. replace
- [ ] Document custom hooks worth keeping

**Rescue Candidates** (potentially reusable):
- [ ] Tailwind config (if properly configured)
- [ ] UI components from shadcn/ui (if already installed)
- [ ] Utility functions (`lib/utils.ts`)
- [ ] Type definitions (if matching backend contract)

**Rebuild from Scratch** (too risky to migrate):
- [ ] WebSocket integration (likely incompatible)
- [ ] State management (if not React Query + Zustand)
- [ ] Message rendering logic (stop_reason handling)
- [ ] Event ordering logic (sequenceNumber vs timestamp)

---

### 2.2 Migration Approach

**Option A: Incremental Migration** (Recommended if current frontend partially works)
1. Create new routes alongside old routes (`/v2/chat/:sessionId`)
2. Implement new architecture in parallel
3. A/B test with feature flag
4. Gradually migrate users
5. Remove old routes after successful migration

**Option B: Full Rebuild** (Recommended based on requirements)
1. Archive current frontend (`git branch archive/old-frontend`)
2. Delete `frontend/` directory
3. Create new Next.js 16.0.1 project from scratch
4. Follow implementation roadmap (Phase 1-4)
5. Test against backend (379/380 passing tests guarantee compatibility)

**Recommendation**: **Option B (Full Rebuild)** based on:
- Backend contract is stable (99.7% test coverage)
- Current frontend has "bastantes errores" (per user)
- Clean slate avoids technical debt
- Faster than debugging existing issues

---

### 2.3 Migration Checklist

#### Pre-Migration
- [ ] Backup current frontend (`git branch backup/frontend-v1`)
- [ ] Document current features that work
- [ ] List known bugs in current implementation
- [ ] Communicate downtime plan to users (if applicable)

#### During Migration
- [ ] Follow Phase 1-4 roadmap strictly
- [ ] Test each phase before moving to next
- [ ] Keep backend running (no changes needed)
- [ ] Document deviations from plan

#### Post-Migration
- [ ] Run full E2E test suite
- [ ] Performance audit (Lighthouse)
- [ ] Accessibility audit (axe DevTools)
- [ ] User acceptance testing (UAT)
- [ ] Deploy to production

---

## 3. Component Specifications

### 3.1 ChatMessage Component

**File**: `components/chat/ChatMessage.tsx`

**Props**:
```typescript
interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    stopReason?: StopReason | null;
    created_at: string;
  };
}
```

**Variants**:
1. **User Message**: Right-aligned, blue background, white text
2. **Assistant Message (Final)**: Left-aligned, gray background, markdown rendering, `stopReason='end_turn'`
3. **Assistant Message (Intermediate)**: Grouped in `<AgentProcessGroup>`, muted styling, `stopReason='tool_use'`

**Implementation**:
```typescript
'use client';

import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { cn } from '@/lib/utils';

export const ChatMessage = ({ message }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const isFinal = message.stopReason === 'end_turn';

  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && <Avatar>AI</Avatar>}

      <div
        className={cn(
          'max-w-[70%] rounded-lg p-3',
          isUser
            ? 'bg-blue-600 text-white'
            : isFinal
            ? 'bg-gray-100 text-black'
            : 'bg-gray-50 text-gray-600 text-sm' // Intermediate message
        )}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>

      {isUser && <Avatar>U</Avatar>}
    </div>
  );
};
```

---

### 3.2 ChatInput Component

**File**: `components/chat/ChatInput.tsx`

**Props**:
```typescript
interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}
```

**Features**:
- Auto-resize textarea (min 1 line, max 10 lines)
- Send on Enter, new line on Shift+Enter
- Disabled state while processing
- Clear input after send

**Implementation**:
```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const ChatInput = ({ onSend, disabled, placeholder }: ChatInputProps) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend(value.trim());
        setValue('');
      }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        10 * 24 // Max 10 lines (24px per line)
      )}px`;
    }
  }, [value]);

  return (
    <div className="flex gap-2 p-4 border-t">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Send a message...'}
        disabled={disabled}
        className="resize-none min-h-[24px]"
        rows={1}
      />
      <Button
        onClick={() => {
          if (value.trim()) {
            onSend(value.trim());
            setValue('');
          }
        }}
        disabled={!value.trim() || disabled}
      >
        Send
      </Button>
    </div>
  );
};
```

---

### 3.3 ApprovalDialog Component

**File**: `components/approval/ApprovalDialog.tsx`

**Props**:
```typescript
interface ApprovalDialogProps {
  approval: {
    approvalId: string;
    toolName: string;
    summary: {
      title: string;
      description: string;
      changes: Record<string, string>;
    };
    priority: 'low' | 'medium' | 'high';
    expiresAt: Date;
  } | null;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}
```

**Implementation**:
```typescript
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ApprovalTimer } from './ApprovalTimer';

export const ApprovalDialog = ({ approval, onApprove, onReject }: ApprovalDialogProps) => {
  if (!approval) return null;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-orange-600';
      case 'low':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <Dialog open={!!approval}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>🚨</span>
            {approval.summary.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className={`font-medium ${getPriorityColor(approval.priority)}`}>
              Priority: {approval.priority.toUpperCase()}
            </span>
            <ApprovalTimer expiresAt={approval.expiresAt} />
          </div>

          <p className="text-gray-700">{approval.summary.description}</p>

          <div className="border rounded-lg p-3 bg-gray-50">
            {Object.entries(approval.summary.changes).map(([key, value]) => (
              <div key={key} className="flex justify-between py-1">
                <span className="font-medium">{key}:</span>
                <span className="text-gray-700">{value}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => onApprove(approval.approvalId)}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              Approve
            </Button>
            <Button
              onClick={() => onReject(approval.approvalId)}
              variant="outline"
              className="flex-1"
            >
              Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

---

### 3.4 AgentProcessGroup Component

**File**: `components/chat/AgentProcessGroup.tsx`

**Implementation** (Compound Component Pattern):
```typescript
'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';

interface AgentProcessGroupProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const AgentProcessGroup = ({ children, defaultOpen = false }: AgentProcessGroupProps) => {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="border rounded-lg p-3 my-2 bg-gray-50">
      {children}
    </Collapsible.Root>
  );
};

AgentProcessGroup.Trigger = ({ children }: { children: React.ReactNode }) => {
  return (
    <Collapsible.Trigger asChild>
      <button className="flex items-center justify-between w-full text-left font-medium hover:underline">
        {children}
        <ChevronDown className="w-4 h-4" />
      </button>
    </Collapsible.Trigger>
  );
};

AgentProcessGroup.Content = ({ children }: { children: React.ReactNode }) => {
  return (
    <Collapsible.Content className="mt-3 space-y-2">
      {children}
    </Collapsible.Content>
  );
};
```

**Usage**:
```tsx
<AgentProcessGroup>
  <AgentProcessGroup.Trigger>
    Agent Process Details ▼
  </AgentProcessGroup.Trigger>
  <AgentProcessGroup.Content>
    <ThinkingIndicator content="Analyzing..." />
    <ToolExecutionCard {...toolData} />
  </AgentProcessGroup.Content>
</AgentProcessGroup>
```

---

## 4. WebSocket Integration Patterns

### 4.1 Event Discrimination Pattern

**File**: `hooks/useAgentEvents.ts`

**Pattern**: Single event type (`agent:event`) with discriminated union

```typescript
import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/websocket';
import { AgentEvent } from '@/types/events';

export const useAgentEvents = (handlers: {
  onThinking?: (event: ThinkingEvent) => void;
  onMessageChunk?: (event: MessageChunkEvent) => void;
  onMessage?: (event: MessageEvent) => void;
  onToolUse?: (event: ToolUseEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
  onError?: (event: ErrorEvent) => void;
}) => {
  const { socket } = useWebSocket();

  const handleEvent = useCallback((event: AgentEvent) => {
    // Log for debugging
    console.log(`[Event] ${event.type} (seq: ${event.sequenceNumber})`);

    // Discriminate by event.type
    switch (event.type) {
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
    if (!socket) return;

    socket.on('agent:event', handleEvent);

    return () => {
      socket.off('agent:event', handleEvent);
    };
  }, [socket, handleEvent]);
};
```

---

### 4.2 Message Accumulation Pattern

**Use Case**: Stream text character-by-character as `message_chunk` events arrive

**Implementation in ChatContainer**:
```typescript
const [accumulatedText, setAccumulatedText] = useState('');

useAgentEvents({
  onThinking: () => {
    setAccumulatedText(''); // Clear accumulator
  },
  onMessageChunk: (event) => {
    setAccumulatedText((prev) => prev + event.content); // Accumulate
  },
  onMessage: (event) => {
    setAccumulatedText(''); // Clear after final message
  },
});
```

**Render accumulated text**:
```tsx
{accumulatedText && (
  <div className="streaming-message">
    {accumulatedText}
  </div>
)}
```

---

### 4.3 Session Room Pattern

**Use Case**: Auto join/leave session room on mount/unmount

**File**: `hooks/useSessionRoom.ts`

```typescript
import { useEffect } from 'react';
import { useWebSocket } from '@/contexts/websocket';

export const useSessionRoom = (sessionId: string | null) => {
  const { joinSession, leaveSession } = useWebSocket();

  useEffect(() => {
    if (!sessionId) return;

    // Join room on mount
    joinSession(sessionId);

    // Leave room on unmount
    return () => {
      leaveSession(sessionId);
    };
  }, [sessionId, joinSession, leaveSession]);
};
```

**Usage in page**:
```typescript
'use client';

export default function ChatPage({ params }: { params: { sessionId: string } }) {
  useSessionRoom(params.sessionId); // Auto join/leave

  return <ChatContainer sessionId={params.sessionId} />;
}
```

---

### 4.4 Reconnection Pattern

**Built into WebSocket Context**:
```typescript
const socketInstance = io(url, {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socketInstance.on('disconnect', (reason) => {
  toast.error('Connection lost. Reconnecting...');
});

socketInstance.on('connect', () => {
  toast.success('Reconnected!');

  // Rejoin active session
  if (activeSessionId) {
    joinSession(activeSessionId);
  }
});
```

---

### 4.5 Stop Reason Pattern (CRITICAL)

**Rule**: Check `event.stopReason` on `message` events to control UI state

**Implementation**:
```typescript
useAgentEvents({
  onMessage: (event) => {
    if (event.stopReason === 'end_turn') {
      // Final message - enable input
      setIsInputEnabled(true);
    } else if (event.stopReason === 'tool_use') {
      // Intermediate message - wait for tool execution
      setIsInputEnabled(false);
    } else if (event.stopReason === 'max_tokens') {
      // Response truncated - show warning
      toast.warning('Response truncated due to token limit');
      setIsInputEnabled(true);
    }
  },
});
```

**Why Critical?**
- `stop_reason='tool_use'` = intermediate message, agentic loop continues
- `stop_reason='end_turn'` = final message, user can send next message
- Enabling input too early breaks UX (user sends message while agent still processing)

---

## 5. Testing Checklist

### 5.1 Unit Tests

**Components to Test**:
- [ ] `<ChatInput>` - Send on Enter, new line on Shift+Enter, disabled state
- [ ] `<ChatMessage>` - Render user/assistant variants, markdown rendering
- [ ] `<ApprovalDialog>` - Countdown timer, approve/reject buttons
- [ ] `<AgentProcessGroup>` - Collapsible behavior
- [ ] `<MarkdownRenderer>` - Code blocks, syntax highlighting, copy button

**Hooks to Test**:
- [ ] `useAgentEvents` - Event discrimination, callback invocation
- [ ] `useSessionRoom` - Join/leave on mount/unmount
- [ ] `useOptimistic` - Optimistic update, rollback on error

**Utilities to Test**:
- [ ] `apiClient` - Error interceptor, retry logic
- [ ] `queryKeys` - Type safety, autocomplete

---

### 5.2 Integration Tests

**Flows to Test**:
- [ ] WebSocket connection → Join session → Send message → Receive response
- [ ] Optimistic session creation → Server confirmation → Rollback on error
- [ ] Approval request → Approve → Tool execution → Result

**React Query Tests**:
- [ ] Query invalidation after mutation
- [ ] Cache persistence across page navigation
- [ ] Retry on network error

---

### 5.3 E2E Tests (Playwright)

**Critical User Flows**:
- [ ] Login → Create session → Send message → Receive response
- [ ] Send message → Approval request → Approve → Tool executes → Result shown
- [ ] Rename session → Optimistic update → Server confirms
- [ ] WebSocket disconnect → Reconnect → Resume session
- [ ] Multiple tabs → Same session → Events sync across tabs

**Example E2E Test**:
```typescript
import { test, expect } from '@playwright/test';

test('user can send message and receive response', async ({ page }) => {
  // Login
  await page.goto('http://localhost:3000/login');
  // ... OAuth flow ...

  // Create session
  await page.click('text=New Chat');
  await page.waitForURL(/\/chat\/.+/);

  // Send message
  await page.fill('textarea', 'List all customers');
  await page.press('textarea', 'Enter');

  // Wait for thinking indicator
  await expect(page.locator('text=Thinking...')).toBeVisible();

  // Wait for response
  await expect(page.locator('.assistant-message')).toBeVisible({ timeout: 30000 });

  // Verify input re-enabled
  await expect(page.locator('textarea')).toBeEnabled();
});
```

---

## 6. Deployment Checklist

### 6.1 Pre-Deployment

- [ ] Run Lighthouse audit (score ≥ 90)
- [ ] Run axe DevTools audit (WCAG 2.1 AA)
- [ ] Test on Chrome, Firefox, Safari, Edge
- [ ] Test on mobile (iOS Safari, Android Chrome)
- [ ] Review environment variables (`.env.production`)
- [ ] Build Next.js app (`npm run build`)
- [ ] Test production build locally (`npm run start`)

### 6.2 Environment Variables

**Production** (`.env.production`):
```bash
NEXT_PUBLIC_API_URL=https://api.bcagent.example.com
NEXT_PUBLIC_WS_URL=wss://api.bcagent.example.com
NODE_ENV=production
```

**Ensure backend variables are set** (see `docs/backend/README.md`):
- Microsoft OAuth redirect URI updated to production domain
- CORS origins updated to allow production frontend domain
- SESSION_SECRET rotated for production

### 6.3 Deployment Steps

**Option A: Vercel** (Recommended for Next.js)
```bash
npm install -g vercel
vercel --prod
```

**Option B: Docker + Azure Container Apps**
```bash
# Build Docker image
docker build -t bc-agent-frontend:latest .

# Push to Azure Container Registry
az acr build --registry <registry> --image bc-agent-frontend:latest .

# Deploy to Azure Container Apps
az containerapp update \
  --name app-bcagent-frontend-prod \
  --resource-group rg-BCAgentPrototype-app-prod \
  --image <registry>.azurecr.io/bc-agent-frontend:latest
```

### 6.4 Post-Deployment

- [ ] Verify frontend loads (https://bcagent.example.com)
- [ ] Verify API connection (check Network tab)
- [ ] Verify WebSocket connection (check Console logs)
- [ ] Test full flow (login → create session → send message)
- [ ] Monitor error logs (Sentry, LogRocket, etc.)
- [ ] Set up uptime monitoring (Pingdom, UptimeRobot)

---

## Conclusion

This implementation guide provides a step-by-step roadmap, migration strategy, component specifications, WebSocket patterns, and testing/deployment checklists for rebuilding the BC Claude Agent frontend from scratch.

**Key Success Factors**:
1. **Follow roadmap strictly** - Don't skip phases
2. **Test each phase thoroughly** - Catch issues early
3. **Use backend tests as validation** - 379/380 passing tests guarantee compatibility
4. **Implement stop_reason pattern correctly** - Critical for UX
5. **Use sequenceNumber for ordering** - Never use timestamps

**Next Steps**:
1. Archive current frontend (`git branch backup/frontend-v1`)
2. Start Phase 1: Foundation (Week 1)
3. Test thoroughly after each phase
4. Deploy to production after Phase 4

---

**Document Version**: 1.0.0
**Last Updated**: 2025-11-19
**Status**: Ready for Implementation
