/**
 * WebSocket Event Types
 *
 * Type-safe socket.io event definitions with enhanced contract.
 * All events follow multi-tenant architecture with explicit userId.
 *
 * @module types/websocket
 */

import type { AgentEvent } from './agent.types';

/**
 * Extended Thinking Configuration (Client → Server)
 *
 * Optional configuration for Claude's Extended Thinking feature.
 * When provided, enables Claude to show its internal reasoning process.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/extended-thinking
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
 * Chat Message Data (Client → Server)
 *
 * User sends a chat message to the agent.
 *
 * Multi-tenant: userId + sessionId uniquely identify the conversation.
 */
export interface ChatMessageData {
  /**
   * Message content from user
   */
  message: string;

  /**
   * Session ID (UUID)
   */
  sessionId: string;

  /**
   * User ID (from Microsoft OAuth)
   *
   * Required for multi-tenant audit trail.
   */
  userId: string;

  /**
   * Extended Thinking configuration (per-request)
   *
   * Allows frontend to enable/disable Extended Thinking for specific requests.
   * If not provided, falls back to server environment configuration.
   *
   * @example
   * ```typescript
   * // Enable extended thinking with custom budget
   * socket.emit('chat:message', {
   *   message: 'Complex reasoning task...',
   *   sessionId: 'uuid',
   *   userId: 'user-uuid',
   *   thinking: { enableThinking: true, thinkingBudget: 15000 }
   * });
   * ```
   */
  thinking?: ExtendedThinkingConfig;
}

/**
 * Stop Agent Data (Client → Server)
 *
 * User requests to stop ongoing agent execution.
 */
export interface StopAgentData {
  /**
   * Session ID to stop
   */
  sessionId: string;

  /**
   * User ID (authorization check)
   */
  userId: string;
}

/**
 * Approval Response Data (Client → Server)
 *
 * User responds to Human-in-the-Loop approval request.
 */
export interface ApprovalResponseData {
  /**
   * Approval request ID
   */
  approvalId: string;

  /**
   * True if approved, false if denied
   */
  approved: boolean;

  /**
   * User ID (authorization check)
   */
  userId: string;
}

/**
 * Approval Request Data (Server → Client)
 *
 * Server requests human approval for tool execution.
 */
export interface ApprovalRequestData {
  /**
   * Unique approval request ID
   */
  approvalId: string;

  /**
   * Tool name requiring approval
   */
  toolName: string;

  /**
   * Tool arguments (for display to user)
   */
  args: Record<string, unknown>;

  /**
   * Session ID context
   */
  sessionId: string;

  /**
   * Timestamp of request
   */
  timestamp: Date;
}

/**
 * Agent Error Data (Server → Client)
 *
 * Server sends error message to client.
 */
export interface AgentErrorData {
  /**
   * Error message (user-friendly)
   */
  error: string;

  /**
   * Optional session ID context
   */
  sessionId?: string;

  /**
   * Optional error code for categorization
   */
  code?: string;
}

/**
 * WebSocket Events Map
 *
 * Type-safe map of all socket.io events.
 * Use this interface for TypeScript autocomplete and type checking.
 *
 * Example:
 * ```typescript
 * socket.on('chat:message', (data: ChatMessageData) => {
 *   // data is typed automatically
 * });
 * ```
 */
export interface WebSocketEvents {
  // ========== Client → Server ==========

  /**
   * User sends chat message
   */
  'chat:message': (data: ChatMessageData) => void;

  /**
   * User stops ongoing agent execution
   */
  'chat:stop': (data: StopAgentData) => void;

  /**
   * User responds to approval request
   */
  'approval:respond': (data: ApprovalResponseData) => void;

  // ========== Server → Client ==========

  /**
   * Agent event (enhanced contract)
   *
   * Single event type for ALL agent events.
   * Discriminate by event.type for specific handling.
   *
   * This is the ONLY agent event type emitted to frontend.
   * Legacy events (agent:thinking, agent:message_chunk, etc.) are deprecated.
   *
   * F4-002: Approval events now use this unified contract:
   * - type: 'approval_requested' (replaces legacy 'approval:requested')
   * - type: 'approval_resolved' (replaces legacy 'approval:resolved')
   */
  'agent:event': (event: AgentEvent) => void;

  /**
   * Agent error occurred
   */
  'agent:error': (data: AgentErrorData) => void;

  /**
   * Approval requested (Human-in-the-Loop)
   *
   * @deprecated F4-002: Use agent:event with type 'approval_requested' instead.
   * This event is no longer emitted by the server.
   * Kept for backward compatibility with older frontends.
   */
  'approval:requested': (data: ApprovalRequestData) => void;
}

// Re-export AgentEvent for convenience
export type { AgentEvent };
