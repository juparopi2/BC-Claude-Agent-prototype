/**
 * WebSocket Event Types
 *
 * Type-safe socket.io event definitions with enhanced contract.
 * All events follow multi-tenant architecture with explicit userId.
 *
 * Shared types are imported from @bc-agent/shared.
 *
 * @module types/websocket
 */

// ============================================
// Re-export ALL shared WebSocket types
// ============================================
export type {
  ExtendedThinkingConfig,
  ChatMessageData,
  StopAgentData,
  ApprovalResponseData,
  ApprovalRequestData,
  AgentErrorData,
  SessionReadyEvent,
  SessionJoinedEvent,
  WebSocketEvents,
  AgentEvent,
} from '@bc-agent/shared';
