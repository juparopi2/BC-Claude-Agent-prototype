/**
 * Frontend Stores
 *
 * Barrel export for remaining Zustand stores and middleware.
 * Note: authStore, sessionStore, and uiPreferencesStore have been migrated to domains/.
 *
 * @module lib/stores
 */

// Chat store (to be migrated to domains/chat in future sprint)
export {
  useChatStore,
  selectAllMessages,
  selectPendingApprovals,
  type ChatState,
  type ChatActions,
  type ChatStore,
  type StreamingState,
  type PendingApproval,
} from './chatStore';

// Socket middleware (to be migrated to infrastructure/socket in future sprint)
export {
  useSocket,
  type UseSocketOptions,
  type UseSocketReturn,
} from './socketMiddleware';
