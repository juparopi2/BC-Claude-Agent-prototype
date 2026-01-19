/**
 * Auth Constants
 *
 * Re-export auth constants from shared package for frontend use.
 *
 * @module domains/auth/constants
 */

// Re-export from shared for convenience
export {
  AUTH_SESSION_STATUS,
  AUTH_TIME_MS,
  AUTH_WS_EVENTS,
  AUTH_ERROR_CODES,
  type AuthSessionStatus,
  type AuthWsEventType,
  type AuthErrorCode,
} from '@bc-agent/shared';
