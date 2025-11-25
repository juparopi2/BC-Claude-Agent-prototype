/**
 * Message Types
 *
 * Types for message persistence and event handling.
 *
 * @module types/message
 */

/**
 * Message Role
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message Type
 */
export type MessageType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error';

/**
 * Message Database Record (Enhanced with Event Sourcing)
 *
 * Represents a message as stored in the database with Event Sourcing support.
 * Links to message_events table for complete event history.
 *
 * Enhanced Fields:
 * - sequence_number: Replaces timestamp-based ordering (prevents race conditions)
 * - event_id: Links to message_events for full event sourcing replay
 *
 * ⭐ UPDATED 2025-11-24: Added Phase 1A token tracking columns
 */
export interface MessageDbRecord {
  id: string;
  session_id: string;
  role: MessageRole;
  message_type: MessageType;
  content: string;
  metadata: string; // JSON string
  token_count: number | null;
  stop_reason: string | null;
  created_at: Date;

  // Event Sourcing Fields (Multi-Tenant Architecture)
  /** Sequence number for guaranteed ordering (atomic via Redis INCR) */
  sequence_number: number | null;
  /** Event ID linking to message_events table for replay */
  event_id: string | null;
  /** Anthropic SDK tool_use block ID (e.g., toolu_01ABC123) for correlating tool_use and tool_result */
  tool_use_id: string | null;

  // ⭐ Phase 1A: Token Tracking Columns
  /** Claude model that generated the response (e.g., "claude-sonnet-4-5-20250929") */
  model: string | null;
  /** Input tokens from Anthropic API */
  input_tokens: number | null;
  /** Output tokens from Anthropic API */
  output_tokens: number | null;
  // Note: total_tokens is a computed column in DB (input_tokens + output_tokens)
}

/**
 * Message Metadata for Thinking
 */
export interface ThinkingMetadata {
  content: string;
  started_at: string;
}

/**
 * Message Metadata for Tool Use
 */
export interface ToolUseMetadata {
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_use_id: string;
  status: 'pending' | 'success' | 'error';
  tool_result?: unknown;
  success?: boolean;
  error_message?: string | null;
}

/**
 * Base fields common to all parsed message types
 * ⭐ UPDATED 2025-11-24: Added Phase 1A token tracking fields
 */
interface ParsedMessageBase {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  token_count: number | null;
  stop_reason: string | null;
  created_at: Date;
  sequence_number: number | null;
  event_id: string | null;
  tool_use_id: string | null;
  // ⭐ Phase 1A: Token Tracking
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

/**
 * Parsed Message (Discriminated Union)
 *
 * Type-safe message representation with parsed metadata.
 * Includes Event Sourcing fields for guaranteed ordering and replay.
 *
 * Frontend Rendering:
 * - Use sequence_number for ordering (NOT created_at)
 * - event_id available for event sourcing replay/debugging
 * - Discriminated by message_type for type-safe access
 *
 * ⭐ UPDATED 2025-11-24: Added token tracking fields to all variants
 */
export type ParsedMessage =
  | (ParsedMessageBase & {
      message_type: 'text';
    })
  | (ParsedMessageBase & {
      message_type: 'thinking';
      metadata: ThinkingMetadata;
    })
  | (ParsedMessageBase & {
      message_type: 'tool_use' | 'tool_result';
      metadata: ToolUseMetadata;
    })
  | (ParsedMessageBase & {
      message_type: 'error';
      metadata?: { error: string };
    });

/**
 * Parse message metadata based on message type
 *
 * ⭐ UPDATED 2025-11-24: Added token tracking fields to base object
 *
 * @param message - Database message record
 * @returns Parsed message with typed metadata
 */
export function parseMessageMetadata(message: MessageDbRecord): ParsedMessage {
  // Base fields common to all message types
  // ⭐ Now includes Phase 1A token tracking fields
  const base: ParsedMessageBase = {
    id: message.id,
    session_id: message.session_id,
    role: message.role,
    content: message.content,
    token_count: message.token_count,
    stop_reason: message.stop_reason,
    created_at: message.created_at,
    sequence_number: message.sequence_number,
    event_id: message.event_id,
    tool_use_id: message.tool_use_id,
    // ⭐ Phase 1A: Token Tracking
    model: message.model,
    input_tokens: message.input_tokens,
    output_tokens: message.output_tokens,
  };

  if (message.message_type === 'thinking') {
    const metadata = JSON.parse(message.metadata) as ThinkingMetadata;
    return {
      ...base,
      message_type: 'thinking',
      metadata,
    };
  }

  if (message.message_type === 'tool_use' || message.message_type === 'tool_result') {
    const metadata = JSON.parse(message.metadata) as ToolUseMetadata;
    return {
      ...base,
      message_type: message.message_type,
      metadata,
    };
  }

  if (message.message_type === 'error') {
    try {
      const metadata = JSON.parse(message.metadata) as { error: string };
      return {
        ...base,
        message_type: 'error',
        metadata,
      };
    } catch {
      return {
        ...base,
        message_type: 'error',
      };
    }
  }

  // Default case: text message
  return {
    ...base,
    message_type: 'text',
  };
}

/**
 * Message Insert Result
 * Result from inserting a message into database
 */
export interface MessageInsertResult {
  id: string;
  created_at: Date;
}
