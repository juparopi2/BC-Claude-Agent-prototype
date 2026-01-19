/**
 * Auth WebSocket Module
 *
 * Exports for the auth WebSocket functionality.
 *
 * @module domains/auth/websocket
 */

export {
  createSocketAuthMiddleware,
  type AuthenticatedSocket,
  type SocketAuthDependencies,
} from './socket-auth.middleware';
