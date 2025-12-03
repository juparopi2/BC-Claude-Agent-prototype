/**
 * Log message constants for SocketService
 *
 * Using constants for log messages ensures:
 * 1. Consistency across codebase
 * 2. Tests don't break on message changes
 * 3. Easier future internationalization (i18n)
 * 4. Single source of truth for messages
 */

export const SOCKET_LOG_PREFIX = '[SocketService]';

export const SocketLogMessages = {
  // Connection
  CONNECTING: `${SOCKET_LOG_PREFIX} Connecting...`,
  CONNECTED: `${SOCKET_LOG_PREFIX} Connected`,
  DISCONNECTED: `${SOCKET_LOG_PREFIX} Disconnected`,
  CONNECTION_ERROR: `${SOCKET_LOG_PREFIX} Connection error`,

  // Session
  JOIN_SESSION_NOT_CONNECTED: `${SOCKET_LOG_PREFIX} Cannot join session: not connected, queuing`,
  SESSION_JOINED: `${SOCKET_LOG_PREFIX} Joined session`,
  SESSION_LEFT: `${SOCKET_LOG_PREFIX} Left session`,

  // Messaging
  SEND_MESSAGE_NOT_CONNECTED: `${SOCKET_LOG_PREFIX} Cannot send message: not connected, queuing`,
  MESSAGE_SENT: `${SOCKET_LOG_PREFIX} Message sent`,
  STOP_AGENT_NOT_CONNECTED: `${SOCKET_LOG_PREFIX} Cannot stop agent: not connected`,

  // Approval
  APPROVAL_RESPONSE_NOT_CONNECTED: `${SOCKET_LOG_PREFIX} Cannot respond to approval: not connected`,
} as const;

export type SocketLogMessage = typeof SocketLogMessages[keyof typeof SocketLogMessages];
