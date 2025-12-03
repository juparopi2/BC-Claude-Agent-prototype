/**
 * Message Types - SINGLE SOURCE OF TRUTH
 *
 * These types define the contract between Backend API and Frontend.
 * Both backend/src/routes/sessions.ts and frontend/lib/services/api.ts
 * MUST use these types.
 *
 * CRITICAL RULES:
 * 1. `type` field is the discriminator (NOT `message_type`)
 * 2. Token fields MUST be nested in `token_usage`
 * 3. All messages MUST have `role` field
 *
 * @module @bc-agent/shared/types/message
 */

/**
 * Base fields shared by all message types.
 *
 * These fields are guaranteed to exist on every message regardless of type.
 */
export interface BaseMessage {
  /** Unique message ID (Anthropic msg_01... or UUID) */
  id: string;

  /** Session this message belongs to */
  session_id: string;

  /**
   * Event sourcing sequence number (atomic via Redis INCR).
   * Used for guaranteed ordering of messages within a session.
   */
  sequence_number: number;

  /** ISO 8601 timestamp when message was created */
  created_at: string;

  /** Event ID from EventStore (for correlation with message_events table) */
  event_id?: string;
}

/**
 * Token usage - ALWAYS nested structure.
 *
 * Backend MUST return this as a nested object, NOT flat fields.
 * Frontend expects: message.token_usage.input_tokens
 * NOT: message.input_tokens
 */
export interface TokenUsage {
  /** Number of input tokens consumed */
  input_tokens: number;

  /**
   * Number of output tokens generated.
   * NOTE: Per Anthropic API, this includes thinking tokens when extended thinking is enabled.
   */
  output_tokens: number;
}

/**
 * Standard text message (user or assistant).
 *
 * This is the most common message type for regular conversation exchanges.
 */
export interface StandardMessage extends BaseMessage {
  /**
   * Discriminator - ALWAYS 'standard' for text messages.
   * Backend MUST set this field (not message_type).
   */
  type: 'standard';

  /** Message sender - 'user' for user messages, 'assistant' for Claude responses */
  role: 'user' | 'assistant';

  /**
   * Message content from DB `content` column.
   * For user messages: the user's input.
   * For assistant messages: Claude's response text.
   */
  content: string;

  /**
   * Token usage (nested structure).
   * Only present on assistant messages, may be undefined for user messages.
   */
  token_usage?: TokenUsage;

  /** Claude stop reason: 'end_turn', 'tool_use', 'max_tokens', etc. */
  stop_reason?: string;

  /** Claude model name, e.g., 'claude-sonnet-4-5-20250929' */
  model?: string;
}

/**
 * Extended thinking message.
 *
 * Contains Claude's internal reasoning process when extended thinking is enabled.
 * Content is stored in DB `content` column, NOT in metadata.
 */
export interface ThinkingMessage extends BaseMessage {
  /** Discriminator - ALWAYS 'thinking' for extended thinking content */
  type: 'thinking';

  /** Always 'assistant' for thinking messages */
  role: 'assistant';

  /**
   * Thinking content from DB `content` column.
   * NOT from metadata.content - that's a bug if used.
   */
  content: string;

  /** Duration of thinking in milliseconds */
  duration_ms?: number;

  /** Model used for thinking */
  model?: string;

  /** Token usage for this thinking block */
  token_usage?: TokenUsage;
}

/**
 * Tool execution message.
 *
 * Represents a tool call requested by Claude and its result.
 */
export interface ToolUseMessage extends BaseMessage {
  /** Discriminator - ALWAYS 'tool_use' for tool execution */
  type: 'tool_use';

  /** Always 'assistant' - Claude requests tool execution */
  role: 'assistant';

  /** Tool name (from metadata.tool_name), e.g., 'listCustomers' */
  tool_name: string;

  /** Tool arguments (from metadata.tool_args) */
  tool_args: Record<string, unknown>;

  /** Execution status */
  status: 'pending' | 'success' | 'error';

  /** Tool result (if status is 'success') */
  result?: unknown;

  /** Error message (if status is 'error') */
  error_message?: string;

  /** Anthropic tool_use_id for correlation */
  tool_use_id?: string;
}

/**
 * Union type for all message types.
 *
 * Use type guards (isStandardMessage, isThinkingMessage, isToolUseMessage)
 * to narrow the type safely.
 */
export type Message = StandardMessage | ThinkingMessage | ToolUseMessage;

/**
 * Type guard for standard messages.
 *
 * @example
 * if (isStandardMessage(msg)) {
 *   console.log(msg.content); // Safe access to content
 *   console.log(msg.role);    // Safe access to role
 * }
 */
export function isStandardMessage(msg: Message): msg is StandardMessage {
  return msg.type === 'standard';
}

/**
 * Type guard for thinking messages.
 *
 * @example
 * if (isThinkingMessage(msg)) {
 *   console.log(msg.content); // Thinking content
 *   // msg.role is always 'assistant' for thinking
 * }
 */
export function isThinkingMessage(msg: Message): msg is ThinkingMessage {
  return msg.type === 'thinking';
}

/**
 * Type guard for tool use messages.
 *
 * @example
 * if (isToolUseMessage(msg)) {
 *   console.log(msg.tool_name); // Safe access to tool_name
 *   console.log(msg.status);    // 'pending' | 'success' | 'error'
 * }
 */
export function isToolUseMessage(msg: Message): msg is ToolUseMessage {
  return msg.type === 'tool_use';
}
