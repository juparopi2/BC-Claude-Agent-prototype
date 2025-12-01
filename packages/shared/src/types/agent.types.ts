/**
 * Agent System Type Definitions
 *
 * Shared types for Claude Agent events, used by both frontend and backend.
 * This is the single source of truth for WebSocket event contracts.
 *
 * @module @bc-agent/shared/types/agent
 */

// Import native SDK types (source of truth)
import type { StopReason } from '@anthropic-ai/sdk/resources/messages';

// Re-export for consumers
export type { StopReason };

/**
 * Agent Event Types
 * All 16 event types emitted during agent execution
 */
export type AgentEventType =
  | 'session_start'
  | 'thinking'
  | 'thinking_chunk'
  | 'message_partial'
  | 'message'
  | 'message_chunk'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'session_end'
  | 'complete'
  | 'approval_requested'
  | 'approval_resolved'
  | 'user_message_confirmed'
  | 'turn_paused'
  | 'content_refused';

/**
 * Persistence State
 *
 * Indicates database persistence status for real-time frontend updates.
 * Transitions: queued -> persisted | failed
 */
export type PersistenceState = 'queued' | 'persisted' | 'failed' | 'transient';

/**
 * Base Agent Event (Enhanced Contract - Multi-Tenant)
 *
 * Base structure for all agent events with Event Sourcing support.
 * Provides maximum information for flexible frontend rendering.
 *
 * Architecture:
 * - eventId: Unique identifier for tracing and debugging
 * - sequenceNumber: Guaranteed ordering (replaces timestamp-based sorting)
 * - persistenceState: Real-time persistence status for optimistic UI
 * - correlationId: Links related events (e.g., tool_use -> tool_result)
 * - parentEventId: Hierarchical event relationships
 */
export interface BaseAgentEvent {
  /** Event type discriminator */
  type: AgentEventType;
  /** Session ID */
  sessionId?: string;
  /** Event timestamp */
  timestamp: Date;

  // Enhanced Event Sourcing Fields (Multi-Tenant Architecture)
  /** Unique event ID (UUID) for tracing and correlation */
  eventId: string;
  /** Sequence number for guaranteed ordering (atomic via Redis INCR). Optional for transient events */
  sequenceNumber?: number;
  /** Database persistence state for optimistic UI updates */
  persistenceState: PersistenceState;
  /** Correlation ID for linking related events (e.g., tool_use -> tool_result) */
  correlationId?: string;
  /** Parent event ID for hierarchical relationships */
  parentEventId?: string;
}

/**
 * Session Start Event
 * Emitted when an agent session begins
 */
export interface SessionStartEvent extends BaseAgentEvent {
  type: 'session_start';
  sessionId: string;
  userId: string;
}

/**
 * Thinking Event
 * Emitted when the agent completes a thinking block (reasoning internally)
 */
export interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  /** Thinking content (may be redacted) */
  content?: string;
  /** Token count for thinking */
  tokenCount?: number;
}

/**
 * Thinking Chunk Event (Phase 1F: Extended Thinking)
 * Emitted during streaming for incremental thinking content
 *
 * Extended Thinking provides real-time visibility into Claude's reasoning process.
 * Chunks arrive as Claude thinks, providing immediate feedback to users.
 */
export interface ThinkingChunkEvent extends BaseAgentEvent {
  type: 'thinking_chunk';
  /** Chunk of thinking content */
  content: string;
  /** Index of the thinking content block (for multi-block responses) */
  blockIndex?: number;
}

/**
 * Message Partial Event
 * Emitted during streaming for partial message content
 */
export interface MessagePartialEvent extends BaseAgentEvent {
  type: 'message_partial';
  /** Partial message content */
  content: string;
  /** Message ID */
  messageId?: string;
}

/**
 * Message Event
 * Emitted when a complete message is available
 *
 * Contains complete message data including token usage for billing.
 */
export interface MessageEvent extends BaseAgentEvent {
  type: 'message';
  /** Complete message content */
  content: string;
  /**
   * Message ID - uses Anthropic's native message ID format
   * @example "msg_01QR8X3Z9KM2NP4JL6H5VYWT7S"
   */
  messageId: string;
  /** Role (user or assistant) */
  role: 'user' | 'assistant';
  /**
   * Native SDK stop_reason indicating message completion state
   * - 'end_turn': Natural completion - final message
   * - 'tool_use': Model wants to use a tool - intermediate message
   * - 'max_tokens': Truncated due to token limit
   * - 'stop_sequence': Hit custom stop sequence
   * - 'pause_turn': Long turn paused
   * - 'refusal': Policy violation
   */
  stopReason?: StopReason | null;
  /**
   * Token usage for this message
   * Used for billing and admin visibility
   */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
  /**
   * Claude model that generated this response
   * @example "claude-sonnet-4-5-20250929"
   */
  model?: string;
}

/**
 * Message Chunk Event
 * Emitted during streaming for incremental message content
 */
export interface MessageChunkEvent extends BaseAgentEvent {
  type: 'message_chunk';
  /** Chunk of message content */
  content: string;
}

/**
 * Tool Use Event
 * Emitted when the agent uses a tool
 */
export interface ToolUseEvent extends BaseAgentEvent {
  type: 'tool_use';
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Tool use ID for correlation with tool_result */
  toolUseId?: string;
}

/**
 * Tool Result Event
 * Emitted when a tool execution completes
 */
export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  /** Tool name */
  toolName: string;
  /** Tool arguments (preserved from original tool_use) */
  args?: Record<string, unknown>;
  /** Tool result */
  result: unknown;
  /** Whether tool succeeded */
  success: boolean;
  /** Error if tool failed */
  error?: string;
  /** Tool use ID for correlation with tool_use */
  toolUseId?: string;
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Error Event
 * Emitted when an error occurs during agent execution
 */
export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  /** Error message */
  error: string;
  /** Error code */
  code?: string;
  /** Stack trace (in development only) */
  stack?: string;
}

/**
 * Session End Event
 * Emitted when an agent session ends
 */
export interface SessionEndEvent extends BaseAgentEvent {
  type: 'session_end';
  sessionId: string;
  /** Reason for ending */
  reason?: 'completed' | 'error' | 'timeout' | 'user_cancelled';
}

/**
 * Complete Event
 * Emitted when agent execution completes (terminal event)
 */
export interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  /** Completion reason */
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
}

/**
 * Approval Requested Event
 * Emitted when agent needs user approval for an action (Human-in-the-Loop)
 */
export interface ApprovalRequestedEvent extends BaseAgentEvent {
  type: 'approval_requested';
  /** Approval request ID */
  approvalId: string;
  /** Tool that requires approval */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Human-readable summary of the change */
  changeSummary: string;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** Expiration time */
  expiresAt?: Date;
}

/**
 * Approval Resolved Event
 * Emitted when user responds to approval request
 */
export interface ApprovalResolvedEvent extends BaseAgentEvent {
  type: 'approval_resolved';
  /** Approval request ID */
  approvalId: string;
  /** User's decision */
  decision: 'approved' | 'rejected';
  /** Optional reason for decision */
  reason?: string;
}

/**
 * User Message Confirmed Event
 * Emitted after user message is successfully persisted with sequence_number.
 * Frontend uses this to update optimistic message with correct sequence_number.
 */
export interface UserMessageConfirmedEvent extends BaseAgentEvent {
  type: 'user_message_confirmed';
  /** Message ID from database */
  messageId: string;
  /** User ID who sent the message */
  userId: string;
  /** Message content */
  content: string;
  /** Sequence number from EventStore (atomic via Redis INCR) */
  sequenceNumber: number;
  /** Event ID from EventStore for tracing */
  eventId: string;
}

/**
 * Turn Paused Event (SDK 0.71+)
 * Emitted when Claude pauses a long-running agentic turn.
 * Frontend should inform the user that processing is paused.
 */
export interface TurnPausedEvent extends BaseAgentEvent {
  type: 'turn_paused';
  /** Partial content generated before pause */
  content?: string;
  /** Message ID from Anthropic */
  messageId: string;
  /** Reason for pause (if available from SDK) */
  reason?: string;
}

/**
 * Content Refused Event (SDK 0.71+)
 * Emitted when Claude refuses to generate content due to policy violation.
 * Frontend should display appropriate message to user.
 */
export interface ContentRefusedEvent extends BaseAgentEvent {
  type: 'content_refused';
  /** Message ID from Anthropic */
  messageId: string;
  /** Explanation of why content was refused (if available) */
  reason?: string;
  /** Partial content before refusal (may be empty) */
  content?: string;
}

/**
 * Agent Event
 * Discriminated union of all 16 agent event types
 *
 * Frontend should use switch statement on event.type for type narrowing:
 * @example
 * ```typescript
 * function handleEvent(event: AgentEvent) {
 *   switch (event.type) {
 *     case 'message':
 *       console.log(event.content); // TypeScript knows this is MessageEvent
 *       break;
 *     case 'tool_use':
 *       console.log(event.toolName); // TypeScript knows this is ToolUseEvent
 *       break;
 *   }
 * }
 * ```
 */
export type AgentEvent =
  | SessionStartEvent
  | ThinkingEvent
  | ThinkingChunkEvent
  | MessagePartialEvent
  | MessageEvent
  | MessageChunkEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | SessionEndEvent
  | CompleteEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UserMessageConfirmedEvent
  | TurnPausedEvent
  | ContentRefusedEvent;

/**
 * Agent Execution Result
 * Final result of agent execution
 */
export interface AgentExecutionResult {
  /** Session ID */
  sessionId?: string;
  /** Final response text */
  response: string;
  /** Message ID */
  messageId?: string;
  /** Token usage */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
    totalTokens: number;
  };
  /** Input tokens (flat structure) */
  inputTokens?: number;
  /** Output tokens (flat structure) */
  outputTokens?: number;
  /** Tools used during execution */
  toolsUsed: string[];
  /** Duration in milliseconds */
  durationMs?: number;
  /** Duration (flat structure) */
  duration?: number;
  /** Whether execution was successful */
  success: boolean;
  /** Error if execution failed */
  error?: string;
}
