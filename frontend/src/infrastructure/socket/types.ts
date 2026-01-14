/**
 * Socket Infrastructure Types
 *
 * Type definitions for the WebSocket client infrastructure layer.
 *
 * @module infrastructure/socket/types
 */

import type { ChatMessageData as ChatMessageDataType } from '@bc-agent/shared';

// Re-export shared types for convenience
export type {
  AgentEvent,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  AgentErrorData,
  SessionReadyEvent,
  ExtendedThinkingConfig,
  TransientEventType,
  // File processing WebSocket events (D25)
  FileWebSocketEvent,
  FileReadinessChangedEvent,
  FilePermanentlyFailedEvent,
  FileProcessingProgressEvent,
  FileProcessingCompletedEvent,
  FileProcessingFailedEvent,
} from '@bc-agent/shared';

// Re-export transient event utilities from shared (single source of truth)
export { TRANSIENT_EVENT_TYPES, isTransientEventType } from '@bc-agent/shared';

// Re-export file WebSocket constants (D25)
export { FILE_WS_CHANNELS, FILE_WS_EVENTS } from '@bc-agent/shared';

/**
 * Socket connection options
 */
export interface SocketConnectOptions {
  /** WebSocket server URL */
  url: string;
  /** Transport methods to use */
  transports?: ('websocket' | 'polling')[];
  /** Enable automatic reconnection */
  reconnection?: boolean;
  /** Maximum reconnection attempts */
  reconnectionAttempts?: number;
  /** Initial reconnection delay in ms */
  reconnectionDelay?: number;
  /** Maximum reconnection delay in ms */
  reconnectionDelayMax?: number;
}

/**
 * Connection state information
 */
export interface ConnectionState {
  /** Whether socket is currently connected */
  isConnected: boolean;
  /** Whether socket is attempting to reconnect */
  isReconnecting: boolean;
  /** Number of reconnection attempts made */
  reconnectAttempts: number;
}

/**
 * Session join options
 */
export interface JoinSessionOptions {
  /** Timeout in ms for session:ready event (default: 5000) */
  timeout?: number;
}

/**
 * Pending message queued when socket is not connected
 */
export interface PendingMessage {
  data: ChatMessageDataType;
  resolve: () => void;
  reject: (err: Error) => void;
  timestamp: number;
}
