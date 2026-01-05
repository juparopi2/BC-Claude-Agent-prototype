/**
 * Normalized Agent Event Types
 *
 * Canonical normalized event types for multi-provider agent execution.
 * These types represent the OUTPUT of normalization, independent of provider.
 *
 * Design Principles:
 * 1. Provider-agnostic: Works with Anthropic, OpenAI, Google, etc.
 * 2. Persistence-aware: Each event knows its persistence strategy
 * 3. Complete: Contains all information needed for emission AND persistence
 * 4. Ordered: originalIndex guarantees processing order
 *
 * @module @bc-agent/shared/types/normalized-events
 */

/**
 * Provider identifier for normalized events.
 */
export type NormalizedProvider = 'anthropic' | 'openai' | 'azure-openai' | 'google';

/**
 * Normalized event types for batch (synchronous) agent execution.
 * Maps to frontend AgentEventType but represents normalized output.
 */
export type NormalizedAgentEventType =
  | 'session_start'      // Lifecycle: execution begins
  | 'user_message'       // User input persisted
  | 'thinking'           // Extended thinking content (Claude 3.5+)
  | 'tool_request'       // Tool call requested
  | 'tool_response'      // Tool call completed
  | 'assistant_message'  // Final assistant response
  | 'error'              // Error occurred
  | 'complete';          // Lifecycle: execution finished

/**
 * Persistence strategy for normalized events.
 * Determines how the event should be persisted.
 *
 * - transient: Not persisted (session_start, complete, error)
 * - sync_required: Must be persisted synchronously before emission (user_message, assistant_message, thinking)
 * - async_allowed: Can be persisted asynchronously (tool_request, tool_response)
 */
export type NormalizedPersistenceStrategy =
  | 'transient'
  | 'sync_required'
  | 'async_allowed';

/**
 * Canonical stop reason, provider-agnostic.
 *
 * Mapping from providers:
 * - Anthropic: end_turn -> end_turn, tool_use -> tool_use, max_tokens -> max_tokens
 * - OpenAI: stop -> end_turn, tool_calls -> tool_use, length -> max_tokens
 */
export type NormalizedStopReason =
  | 'end_turn'     // Natural completion (Anthropic: end_turn, OpenAI: stop)
  | 'tool_use'     // Paused for tool execution (Anthropic: tool_use, OpenAI: tool_calls)
  | 'max_tokens'   // Hit token limit
  | 'error'        // Error occurred
  | 'cancelled';   // User cancelled

/**
 * Token usage from provider response.
 */
export interface NormalizedTokenUsage {
  /** Input/prompt tokens */
  inputTokens: number;
  /** Output/completion tokens */
  outputTokens: number;
  /** Thinking tokens (Claude extended thinking) */
  thinkingTokens?: number;
  /** Cached tokens (prompt caching) */
  cachedTokens?: number;
}

/**
 * Base interface for all normalized events.
 * Contains common fields required for emission and persistence.
 */
export interface BaseNormalizedEvent {
  /** Event type discriminator */
  type: NormalizedAgentEventType;

  /** Unique event ID (UUID) for tracing */
  eventId: string;

  /** Session ID for room-based emission */
  sessionId: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /**
   * Original index from normalization.
   * Used to maintain order when events are processed in parallel.
   */
  originalIndex: number;

  /** How this event should be persisted */
  persistenceStrategy: NormalizedPersistenceStrategy;

  /** Provider that generated this event (for debugging) */
  provider?: NormalizedProvider;
}

// ============================================================================
// Event-Specific Interfaces
// ============================================================================

/**
 * Session start event - emitted when execution begins.
 */
export interface NormalizedSessionStartEvent extends BaseNormalizedEvent {
  type: 'session_start';
  persistenceStrategy: 'transient';
  userId: string;
}

/**
 * User message confirmed event.
 */
export interface NormalizedUserMessageEvent extends BaseNormalizedEvent {
  type: 'user_message';
  persistenceStrategy: 'sync_required';
  messageId: string;
  content: string;
  userId: string;
  /** Assigned after persistence */
  sequenceNumber?: number;
}

/**
 * Extended thinking event.
 */
export interface NormalizedThinkingEvent extends BaseNormalizedEvent {
  type: 'thinking';
  persistenceStrategy: 'sync_required';
  /** Linked message ID */
  messageId: string;
  /** Full thinking content */
  content: string;
  /** Token usage for thinking content (consistent with assistant_message) */
  tokenUsage?: NormalizedTokenUsage;
}

/**
 * Tool request event (tool_use in Anthropic terminology).
 */
export interface NormalizedToolRequestEvent extends BaseNormalizedEvent {
  type: 'tool_request';
  persistenceStrategy: 'async_allowed';
  /** Anthropic tool_use ID (toolu_...) */
  toolUseId: string;
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
}

/**
 * Tool response event (tool_result).
 */
export interface NormalizedToolResponseEvent extends BaseNormalizedEvent {
  type: 'tool_response';
  persistenceStrategy: 'async_allowed';
  /** Correlation ID to tool_request */
  toolUseId: string;
  /** Tool name */
  toolName: string;
  /** Whether tool succeeded */
  success: boolean;
  /** Result data (if success) */
  result?: string;
  /** Error message (if failed) */
  error?: string;
  /** Execution duration in ms */
  durationMs?: number;
}

/**
 * Assistant message event (final response).
 */
export interface NormalizedAssistantMessageEvent extends BaseNormalizedEvent {
  type: 'assistant_message';
  persistenceStrategy: 'sync_required';
  messageId: string;
  /** Full content */
  content: string;
  /** Stop reason from provider */
  stopReason: NormalizedStopReason;
  /** Model used */
  model: string;
  /** Token usage */
  tokenUsage: NormalizedTokenUsage;
}

/**
 * Error event.
 */
export interface NormalizedErrorEvent extends BaseNormalizedEvent {
  type: 'error';
  persistenceStrategy: 'transient';
  error: string;
  code: string;
  /** Stack trace (dev only) */
  stack?: string;
}

/**
 * Complete event - terminal lifecycle event.
 */
export interface NormalizedCompleteEvent extends BaseNormalizedEvent {
  type: 'complete';
  persistenceStrategy: 'transient';
  /**
   * Normalized completion reason for UI.
   * Maps from NormalizedStopReason:
   * - end_turn, tool_use → 'success'
   * - max_tokens → 'max_turns' (token limit reached)
   * - error → 'error'
   * - cancelled → 'user_cancelled'
   */
  reason: 'success' | 'error' | 'max_turns' | 'user_cancelled';
  /** Original provider stop reason */
  stopReason?: NormalizedStopReason;
  /**
   * Model used for this execution (for billing traceability).
   * Set from AgentState.usedModel when available.
   */
  usedModel?: string;
}

/**
 * Discriminated union of all normalized events.
 */
export type NormalizedAgentEvent =
  | NormalizedSessionStartEvent
  | NormalizedUserMessageEvent
  | NormalizedThinkingEvent
  | NormalizedToolRequestEvent
  | NormalizedToolResponseEvent
  | NormalizedAssistantMessageEvent
  | NormalizedErrorEvent
  | NormalizedCompleteEvent;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for events requiring synchronous persistence.
 */
export function requiresSyncPersistence(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'sync_required';
}

/**
 * Type guard for transient events.
 */
export function isTransientNormalizedEvent(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'transient';
}

/**
 * Type guard for async-allowed events.
 */
export function allowsAsyncPersistence(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'async_allowed';
}

/**
 * Type guard for thinking events.
 */
export function isNormalizedThinkingEvent(
  event: NormalizedAgentEvent
): event is NormalizedThinkingEvent {
  return event.type === 'thinking';
}

/**
 * Type guard for tool request events.
 */
export function isNormalizedToolRequestEvent(
  event: NormalizedAgentEvent
): event is NormalizedToolRequestEvent {
  return event.type === 'tool_request';
}

/**
 * Type guard for tool response events.
 */
export function isNormalizedToolResponseEvent(
  event: NormalizedAgentEvent
): event is NormalizedToolResponseEvent {
  return event.type === 'tool_response';
}

/**
 * Type guard for assistant message events.
 */
export function isNormalizedAssistantMessageEvent(
  event: NormalizedAgentEvent
): event is NormalizedAssistantMessageEvent {
  return event.type === 'assistant_message';
}

/**
 * Type guard for complete events.
 */
export function isNormalizedCompleteEvent(
  event: NormalizedAgentEvent
): event is NormalizedCompleteEvent {
  return event.type === 'complete';
}
