/**
 * Agent System Type Definitions
 *
 * Shared types for Claude Agent events, used by both frontend and backend.
 * This is the single source of truth for WebSocket event contracts.
 *
 * @module @bc-agent/shared/types/agent
 */

import type { SourceType, FetchStrategy } from './source.types';
import type { ChatAttachmentSummary } from './chat-attachments.types';
import type { AgentIdentity } from './agent-identity.types';

/**
 * Handoff Type (PRD-040)
 * Indicates how an agent transition occurred.
 *
 * - 'supervisor_routing': Supervisor LLM decided which agent to use
 * - 'agent_handoff': One agent delegated to another mid-execution via Command pattern
 * - 'user_selection': User explicitly selected an agent from the UI
 */
export type HandoffType = 'supervisor_routing' | 'agent_handoff' | 'user_selection';

/**
 * Provider-agnostic stop reason.
 * Covers all possible reasons why an LLM stopped generating.
 *
 * Mappings:
 * - Anthropic: end_turn, max_tokens, tool_use, stop_sequence, pause_turn, refusal
 * - OpenAI: stop, length, tool_calls, content_filter
 */
export type StopReason =
  // Natural completions
  | 'end_turn'       // Anthropic: finished naturally
  | 'stop'           // OpenAI: finished naturally
  // Token limits
  | 'max_tokens'     // Anthropic: hit token limit
  | 'length'         // OpenAI: hit token limit
  // Tool usage
  | 'tool_use'       // Anthropic: wants to use tool
  | 'tool_calls'     // OpenAI: wants to use tool
  // Content control
  | 'stop_sequence'  // Hit custom stop sequence
  | 'content_filter' // OpenAI: content filtered
  | 'refusal'        // Anthropic: policy violation
  // Agentic
  | 'pause_turn';    // Anthropic: long turn paused

/**
 * Agent Event Types
 * Event types emitted during synchronous agent execution.
 * Note: Streaming chunk types (thinking_chunk, message_chunk, message_partial) have been removed
 * as the architecture now uses synchronous execution with complete messages.
 */
export type AgentEventType =
  | 'session_start'
  | 'thinking'
  | 'thinking_complete'
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'session_end'
  | 'complete'
  | 'approval_requested'
  | 'approval_resolved'
  | 'user_message_confirmed'
  | 'turn_paused'
  | 'content_refused'
  | 'agent_changed';

/**
 * Persistence State
 *
 * Indicates database persistence status for real-time frontend updates.
 * Transitions: pending -> persisted | failed
 *
 * - 'pending': Event emitted during streaming, not yet persisted to database
 * - 'queued': Event queued for async persistence (legacy state)
 * - 'persisted': Event successfully written to database with sequence number
 * - 'failed': Persistence operation failed
 * - 'transient': Temporary event not intended for persistence (e.g., thinking chunks)
 */
export type PersistenceState = 'pending' | 'queued' | 'persisted' | 'failed' | 'transient';

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
  /** Event timestamp (ISO 8601 string) */
  timestamp: string;

  // Enhanced Event Sourcing Fields (Multi-Tenant Architecture)
  /** Unique event ID (UUID) for tracing and correlation */
  eventId: string;
  /** Sequence number for guaranteed ordering (atomic via Redis INCR). Optional for transient events */
  sequenceNumber?: number;
  /**
   * Local event index for ordering during streaming.
   * Used as fallback when sequence numbers are not available (transient events).
   * Incremented for each event emitted in a session.
   */
  eventIndex?: number;
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
 * Thinking Complete Event
 * Emitted when the thinking block is complete (before text content starts)
 *
 * This signals the frontend to collapse/finalize the thinking block,
 * ensuring it appears at the beginning of the response rather than the end.
 */
export interface ThinkingCompleteEvent extends BaseAgentEvent {
  type: 'thinking_complete';
  /** Full thinking content */
  content: string;
  /** Index of the thinking content block */
  blockIndex?: number;
  /** Message ID to link to specific message */
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
 * Citation from Anthropic API
 * Used when Claude references documents in RAG responses
 * See: https://docs.anthropic.com/en/docs/build-with-claude/citations
 */
export interface Citation {
  /** Citation type */
  type: 'char_location' | 'page_location' | 'content_block_location';
  /** The text that was cited */
  cited_text?: string;
  /** Index of the document being cited */
  document_index?: number;
  /** Title of the cited document */
  document_title?: string;
  /** Start character index in the document */
  start_char_index?: number;
  /** End character index in the document */
  end_char_index?: number;
  /** Page number (for PDF documents) */
  page_number?: number;
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
 * Cited File
 * Represents a file that was used/cited during agent execution.
 * Extended with source metadata for rich frontend rendering.
 */
export interface CitedFile {
  /** File name for display */
  fileName: string;
  /** File ID for lookup/preview (null for tombstone/deleted files) */
  fileId: string | null;
  /** Source type for routing fetch requests */
  sourceType: SourceType;
  /** MIME type for icon/preview rendering */
  mimeType: string;
  /** Relevance score from search (0-1) */
  relevanceScore: number;
  /** Whether this is an image file */
  isImage: boolean;
  /** How to fetch content (internal API, OAuth proxy, or external URL) */
  fetchStrategy: FetchStrategy;
}

/**
 * Complete Event
 * Emitted when agent execution completes (terminal event)
 */
export interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  /** Completion reason (normalized, provider-agnostic) */
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
  /**
   * Original provider-specific stop reason (e.g., 'end_turn', 'max_tokens' for Anthropic).
   * Used for debugging and provider-specific handling.
   */
  stopReason?: string;
  /**
   * Files that were used/cited during agent execution.
   * Frontend uses this to enable clickable citations after streaming completes.
   * Undefined when no files were used.
   */
  citedFiles?: CitedFile[];
  /**
   * Message ID of the assistant message to associate citations with.
   * Frontend uses this to link citedFiles to specific messages for per-message rendering.
   */
  messageId?: string;
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
  /** Expiration time (ISO 8601 string) */
  expiresAt?: string;
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
  /**
   * Chat attachment IDs associated with this message.
   * These are the IDs that were linked to the message in the junction table.
   * Frontend can use these to fetch attachment summaries from the store.
   */
  chatAttachmentIds?: string[];
  /**
   * Full chat attachment summaries for immediate rendering.
   * Contains complete metadata (name, size, mimeType) so frontend
   * doesn't need to fetch separately or display placeholders.
   */
  chatAttachments?: ChatAttachmentSummary[];
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
 * Agent Changed Event (PRD-020)
 * Emitted when the active agent changes during multi-agent orchestration.
 * Frontend uses this to display agent badges and transition indicators.
 */
export interface AgentChangedEvent extends BaseAgentEvent {
  type: 'agent_changed';
  /** Identity of the previous agent */
  previousAgent: AgentIdentity;
  /** Identity of the new active agent */
  currentAgent: AgentIdentity;
  /** How the agent transition occurred (PRD-040) */
  handoffType?: HandoffType;
  /** Reason for the handoff (e.g., "User needs document analysis") */
  reason?: string;
}

/**
 * Agent Event
 * Discriminated union of all 14 agent event types (sync architecture - no chunks)
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
  | ThinkingCompleteEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ErrorEvent
  | SessionEndEvent
  | CompleteEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UserMessageConfirmedEvent
  | TurnPausedEvent
  | ContentRefusedEvent
  | AgentChangedEvent;

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

// ============================================
// Transient Event Utilities (Sync Architecture)
// ============================================

/**
 * Event types that are transient (not persisted to database)
 *
 * In the synchronous architecture, transient events are control signals
 * that exist only during real-time communication:
 * - session_start: Signals a new turn to the frontend
 * - complete: Signals agent execution finished
 * - error: Signals an error occurred (may still be logged)
 *
 * Persisted events have sequenceNumber from EventStore.
 */
export const TRANSIENT_EVENT_TYPES = [
  'session_start',
  'complete',
  'error',
] as const;

/**
 * Type for transient event types
 */
export type TransientEventType = (typeof TRANSIENT_EVENT_TYPES)[number];

/**
 * Check if an event type is transient (not persisted)
 *
 * @param type - The event type string to check
 * @returns true if the event type is transient
 *
 * @example
 * ```typescript
 * if (isTransientEventType(event.type)) {
 *   // This event won't have a sequenceNumber
 * }
 * ```
 */
export function isTransientEventType(type: string): type is TransientEventType {
  return TRANSIENT_EVENT_TYPES.includes(type as TransientEventType);
}
