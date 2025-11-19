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
 * Message Database Record
 * Represents a message as stored in the database
 */
export interface MessageDbRecord {
  id: string;
  session_id: string;
  role: MessageRole;
  message_type: MessageType;
  content: string;
  metadata: string; // JSON string
  created_at: Date;
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
 * Parsed Message
 * Message with parsed metadata
 */
export type ParsedMessage =
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'text';
      content: string;
      created_at: Date;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'thinking';
      content: string;
      metadata: ThinkingMetadata;
      created_at: Date;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'tool_use' | 'tool_result';
      content: string;
      metadata: ToolUseMetadata;
      created_at: Date;
    }
  | {
      id: string;
      session_id: string;
      role: MessageRole;
      message_type: 'error';
      content: string;
      metadata?: { error: string };
      created_at: Date;
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
    created_at: message.created_at,
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
