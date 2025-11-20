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
 * Parsed Message (Discriminated Union)
 *
 * Type-safe message representation with parsed metadata.
 * Includes Event Sourcing fields for guaranteed ordering and replay.
 *
 * Frontend Rendering:
 * - Use sequence_number for ordering (NOT created_at)
 * - event_id available for event sourcing replay/debugging
 * - Discriminated by message_type for type-safe access
 */
export type ParsedMessage =
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'text';
      content: string;
      token_count: number | null;
      stop_reason: string | null;
      created_at: Date;
      sequence_number: number | null;
      event_id: string | null;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'thinking';
      content: string;
      metadata: ThinkingMetadata;
      token_count: number | null;
      stop_reason: string | null;
      created_at: Date;
      sequence_number: number | null;
      event_id: string | null;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'tool_use' | 'tool_result';
      content: string;
      metadata: ToolUseMetadata;
      token_count: number | null;
      stop_reason: string | null;
      created_at: Date;
      sequence_number: number | null;
      event_id: string | null;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'error';
      content: string;
      metadata?: { error: string };
      token_count: number | null;
      stop_reason: string | null;
      created_at: Date;
      sequence_number: number | null;
      event_id: string | null;
    };

/**
 * Parse message metadata based on message type
 *
 * @param message - Database message record
 * @returns Parsed message with typed metadata
 */
export function parseMessageMetadata(message: MessageDbRecord): ParsedMessage {
  const base = {
    id: message.id,
    session_id: message.session_id,
    role: message.role,
    message_type: message.message_type,
    content: message.content,
    token_count: message.token_count,
    stop_reason: message.stop_reason,
    created_at: message.created_at,
    sequence_number: message.sequence_number,
    event_id: message.event_id,
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
