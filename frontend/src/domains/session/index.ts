/**
 * Session Domain
 *
 * Exports for session management.
 *
 * @module domains/session
 */

// Stores
export {
  useSessionStore,
  resetSessionStore,
  selectSortedSessions,
  selectActiveSessions,
  type SessionState,
  type SessionActions,
  type SessionStore,
} from './stores/sessionStore';

// Re-export Session type from infrastructure
export type { Session } from '@/src/infrastructure/api';
