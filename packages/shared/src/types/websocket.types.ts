/**
 * WebSocket Event Types
 *
 * Type-safe socket.io event definitions with enhanced contract.
 * All events follow multi-tenant architecture with explicit userId.
 *
 * @module @bc-agent/shared/types/websocket
 */

import type { AgentEvent } from './agent.types';

/**
 * Extended Thinking Configuration (Client -> Server)
 *
 * Optional configuration for Claude's Extended Thinking feature.
 * When provided, enables Claude to show its internal reasoning process.
 */
export interface ExtendedThinkingConfig {
  /**
   * Enable Extended Thinking mode for this request
   * @default false (uses server env.ENABLE_EXTENDED_THINKING as fallback)
   */
  enableThinking?: boolean;

  /**
   * Budget tokens for extended thinking (minimum 1024)
   * Only used when enableThinking is true.
   * @default 10000
   */
  thinkingBudget?: number;
}

/**
 * Chat Message Data (Client -> Server)
 *
 * User sends a chat message to the agent.
 * Multi-tenant: userId + sessionId uniquely identify the conversation.
 */
export interface ChatMessageData {
  /** Message content from user */
  message: string;

  /** Session ID (UUID) */
  sessionId: string;

  /**
   * User ID (from Microsoft OAuth)
   * Required for multi-tenant audit trail.
   */
  userId: string;

  /**
   * Extended Thinking configuration (per-request)
   * Allows frontend to enable/disable Extended Thinking for specific requests.
   */
  thinking?: ExtendedThinkingConfig;

  /**
   * List of file IDs to attach to the message
   * Array of UUIDs corresponding to uploaded files.
   */
  attachments?: string[];

  /**
   * Enable automatic semantic search for user's files when no attachments provided.
   * When true, the system will search user's uploaded files for relevant context.
   * @default false
   */
  enableAutoSemanticSearch?: boolean;
}

/**
 * Stop Agent Data (Client -> Server)
 *
 * User requests to stop ongoing agent execution.
 */
export interface StopAgentData {
  /** Session ID to stop */
  sessionId: string;

  /** User ID (authorization check) */
  userId: string;
}

/**
 * Approval Response Data (Client -> Server)
 *
 * User responds to Human-in-the-Loop approval request.
 */
export interface ApprovalResponseData {
  /** Approval request ID */
  approvalId: string;

  /** User's decision - must be 'approved' or 'rejected' */
  decision: 'approved' | 'rejected';

  /** User ID (authorization check) */
  userId: string;

  /** Optional reason for the decision */
  reason?: string;
}

/**
 * Approval Request Data (Server -> Client)
 *
 * Server requests human approval for tool execution.
 * @deprecated Use ApprovalRequestedEvent from agent.types instead
 */
export interface ApprovalRequestData {
  /** Unique approval request ID */
  approvalId: string;

  /** Tool name requiring approval */
  toolName: string;

  /** Tool arguments (for display to user) */
  args: Record<string, unknown>;

  /** Session ID context */
  sessionId: string;

  /** Timestamp of request */
  timestamp: Date;
}

/**
 * Agent Error Data (Server -> Client)
 *
 * Server sends error message to client.
 */
export interface AgentErrorData {
  /** Error message (user-friendly) */
  error: string;

  /** Optional session ID context */
  sessionId?: string;

  /** Optional error code for categorization */
  code?: string;
}

/**
 * Session Ready Data (Server -> Client)
 *
 * Server confirms socket is fully joined to session room.
 * Clients should wait for this before sending messages.
 */
export interface SessionReadyEvent {
  sessionId: string;
  timestamp: string;
}

/**
 * Session Joined Data (Server -> Client)
 *
 * Intermediate confirmation that socket has joined the room.
 */
export interface SessionJoinedEvent {
  sessionId: string;
}

/**
 * WebSocket Events Map
 *
 * Type-safe map of all socket.io events.
 * Use this interface for TypeScript autocomplete and type checking.
 */
export interface WebSocketEvents {
  // ========== Client -> Server ==========

  /** User sends chat message */
  'chat:message': (data: ChatMessageData) => void;

  /** User stops ongoing agent execution */
  'chat:stop': (data: StopAgentData) => void;

  /** User responds to approval request */
  'approval:response': (data: ApprovalResponseData) => void;

  /** User joins a session room */
  'session:join': (data: { sessionId: string }) => void;

  /** User leaves a session room */
  'session:leave': (data: { sessionId: string }) => void;

  // ========== Server -> Client ==========

  /**
   * Agent event (enhanced contract)
   *
   * Single event type for ALL agent events.
   * Discriminate by event.type for specific handling.
   *
   * This is the ONLY agent event type emitted to frontend.
   */
  'agent:event': (event: AgentEvent) => void;

  /** Agent error occurred */
  'agent:error': (data: AgentErrorData) => void;

  /** Session joined confirmation (intermediate) */
  'session:joined': (data: SessionJoinedEvent) => void;

  /**
   * Session ready (Server confirmation)
   *
   * Emitted after socket has fully joined the session room.
   * Clients should wait for this before sending messages.
   */
  'session:ready': (data: SessionReadyEvent) => void;

  /** Session left confirmation */
  'session:left': (data: { sessionId: string }) => void;

  /** Session error */
  'session:error': (data: { error: string; sessionId?: string }) => void;
}

// Re-export AgentEvent for convenience
export type { AgentEvent };
