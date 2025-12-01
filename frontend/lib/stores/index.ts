/**
 * Frontend Stores
 *
 * Barrel export for all Zustand stores and middleware.
 *
 * @module lib/stores
 */

// Chat store
export {
  useChatStore,
  selectAllMessages,
  selectPendingApprovals,
  selectToolExecutions,
  type ChatState,
  type ChatActions,
  type ChatStore,
  type StreamingState,
  type PendingApproval,
  type ToolExecution,
} from './chatStore';

// Session store
export {
  useSessionStore,
  selectSortedSessions,
  selectActiveSessions,
  type SessionState,
  type SessionActions,
  type SessionStore,
} from './sessionStore';

// Auth store
export {
  useAuthStore,
  selectUserDisplayName,
  selectUserInitials,
  type AuthState,
  type AuthActions,
  type AuthStore,
} from './authStore';

// Socket middleware
export {
  useSocket,
  type UseSocketOptions,
  type UseSocketReturn,
} from './socketMiddleware';
