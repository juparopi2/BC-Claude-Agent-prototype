/**
 * Message Service
 *
 * Provides high-level API for message persistence using Event Sourcing pattern.
 * Combines EventStore (append-only log) with MessageQueue (async processing).
 *
 * Architecture:
 * 1. Event is appended to EventStore (synchronous, fast)
 * 2. Job is added to MessageQueue (asynchronous processing)
 * 3. Worker persists to messages table (eventual consistency)
 *
 * This architecture eliminates the 600ms delay by making persistence non-blocking.
 *
 * @module services/messages/MessageService
 */

import { getEventStore } from '../events/EventStore';
import { getMessageQueue } from '../queue/MessageQueue';
import { logger } from '@/utils/logger';
import { randomUUID } from 'crypto';
import { executeQuery, SqlParams } from '@/config/database';
import { ParsedMessage, MessageDbRecord, parseMessageMetadata } from '@/types/message.types';

/**
 * Message Service Class
 *
 * Repository pattern for message persistence.
 */
export class MessageService {
  private static instance: MessageService | null = null;
  private eventStore = getEventStore();
  private messageQueue = getMessageQueue();

  private constructor() {
    logger.info('MessageService initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  /**
   * Save User Message
   *
   * Immediately appends event to EventStore and queues for DB persistence.
   * Returns message ID synchronously without waiting for DB write.
   *
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param content - Message content
   * @returns Message ID (synchronous)
   */
  public async saveUserMessage(
    sessionId: string,
    userId: string,
    content: string
  ): Promise<string> {
    const messageId = randomUUID();

    try {
      // 1. Append event to EventStore (fast, synchronous)
      await this.eventStore.appendEvent(sessionId, 'user_message_sent', {
        message_id: messageId,
        content,
        user_id: userId,
      });

      // 2. Queue for DB persistence (async, non-blocking)
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId,
        role: 'user',
        messageType: 'text',
        content,
        metadata: { user_id: userId },
      });

      logger.debug('User message saved', { sessionId, messageId, userId });

      return messageId;
    } catch (error) {
      logger.error('Failed to save user message', {
        error,
        sessionId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Save Agent Message
   *
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   * @param content - Message content
   * @param stopReason - Optional stop reason from SDK
   * @returns Message ID
   */
  public async saveAgentMessage(
    sessionId: string,
    userId: string,
    content: string,
    stopReason?: string | null
  ): Promise<string> {
    const messageId = randomUUID();

    try {
      // 1. Append event
      await this.eventStore.appendEvent(sessionId, 'agent_message_sent', {
        message_id: messageId,
        content,
        stop_reason: stopReason,
        user_id: userId,  // ⭐ Audit trail
      });

      // 2. Queue for persistence
      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId,
        role: 'assistant',
        messageType: 'text',
        content,
        metadata: {
          stop_reason: stopReason,
          user_id: userId,  // ⭐ Audit trail
        },
      });

      logger.debug('Agent message saved', { sessionId, userId, messageId });

      return messageId;
    } catch (error) {
      logger.error('Failed to save agent message', { error, sessionId, userId });
      throw error;
    }
  }

  /**
   * Save Thinking Message
   *
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   * @param content - Thinking content
   * @returns Message ID
   */
  public async saveThinkingMessage(
    sessionId: string,
    userId: string,
    content: string
  ): Promise<string> {
    const messageId = randomUUID();

    try {
      await this.eventStore.appendEvent(sessionId, 'agent_thinking_started', {
        message_id: messageId,
        content,
        started_at: new Date().toISOString(),
        user_id: userId,  // ⭐ Audit trail
      });

      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId,
        role: 'assistant',
        messageType: 'thinking',
        content: '',
        metadata: {
          content,
          started_at: new Date().toISOString(),
          user_id: userId,  // ⭐ Audit trail
        },
      });

      logger.debug('Thinking message saved', { sessionId, userId, messageId });

      return messageId;
    } catch (error) {
      logger.error('Failed to save thinking message', { error, sessionId, userId });
      throw error;
    }
  }

  /**
   * Save Tool Use Message
   *
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   * @param toolUseId - Tool use ID (DB GUID)
   * @param toolName - Tool name
   * @param toolArgs - Tool arguments
   * @returns Message ID
   */
  public async saveToolUseMessage(
    sessionId: string,
    userId: string,
    toolUseId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<string> {
    const messageId = toolUseId; // Use toolUseId as messageId for consistency

    try {
      await this.eventStore.appendEvent(sessionId, 'tool_use_requested', {
        tool_use_id: toolUseId,
        tool_name: toolName,
        tool_args: toolArgs,
        user_id: userId,  // ⭐ Audit trail
      });

      await this.messageQueue.addMessagePersistence({
        sessionId,
        messageId,
        role: 'assistant',
        messageType: 'tool_use',
        content: '',
        metadata: {
          tool_name: toolName,
          tool_args: toolArgs,
          tool_use_id: toolUseId,
          status: 'pending',
          user_id: userId,  // ⭐ Audit trail
        },
      });

      logger.debug('Tool use message saved', { sessionId, userId, toolUseId, toolName });

      return messageId;
    } catch (error) {
      logger.error('Failed to save tool use message', {
        error,
        sessionId,
        userId,
        toolUseId,
        toolName,
      });
      throw error;
    }
  }

  /**
   * Update Tool Result
   *
   * Updates an existing tool use message with the result.
   *
   * @param sessionId - Session ID
   * @param userId - User ID (audit trail)
   * @param toolUseId - Tool use ID (DB GUID)
   * @param toolName - Tool name
   * @param toolArgs - Tool arguments (preserved)
   * @param result - Tool result
   * @param success - Whether execution was successful
   * @param error - Error message if failed
   */
  public async updateToolResult(
    sessionId: string,
    userId: string,
    toolUseId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: unknown,
    success: boolean,
    error?: string
  ): Promise<void> {
    try {
      // 1. Append event
      await this.eventStore.appendEvent(sessionId, 'tool_use_completed', {
        tool_use_id: toolUseId,
        tool_name: toolName,
        tool_result: result,
        success,
        error_message: error,
        user_id: userId,  // ⭐ Audit trail
      });

      // 2. Update DB directly (this is fast, no queue needed)
      const params: SqlParams = {
        id: toolUseId,
        session_id: sessionId,
        metadata: JSON.stringify({
          tool_name: toolName,
          tool_args: toolArgs,
          tool_result: result,
          tool_use_id: toolUseId,
          status: success ? 'success' : 'error',
          success,
          error_message: error || null,
          user_id: userId,  // ⭐ Audit trail
        }),
      };

      await executeQuery(
        `
        UPDATE messages
        SET metadata = @metadata
        WHERE id = @id AND session_id = @session_id
        `,
        params
      );

      logger.debug('Tool result updated', {
        sessionId,
        userId,
        toolUseId,
        toolName,
        success,
      });
    } catch (error) {
      logger.error('Failed to update tool result', {
        error,
        sessionId,
        userId,
        toolUseId,
        toolName,
      });
      throw error;
    }
  }

  /**
   * Get Messages for Session
   *
   * Retrieves all messages for a session, ordered by creation time.
   *
   * @param sessionId - Session ID
   * @param limit - Optional limit
   * @param offset - Optional offset for pagination
   * @returns Array of parsed messages
   */
  public async getMessagesBySession(
    sessionId: string,
    limit?: number,
    offset?: number
  ): Promise<ParsedMessage[]> {
    try {
      let query = `
        SELECT id, session_id, role, message_type, content, metadata, created_at
        FROM messages
        WHERE session_id = @session_id
        ORDER BY created_at ASC
      `;

      const params: SqlParams = { session_id: sessionId };

      if (limit !== undefined) {
        query += ` OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        params.offset = offset || 0;
        params.limit = limit;
      }

      const result = await executeQuery<MessageDbRecord>(query, params);

      return result.recordset.map((row) => parseMessageMetadata(row));
    } catch (error) {
      logger.error('Failed to get messages by session', { error, sessionId });
      throw error;
    }
  }

  /**
   * Get Message by ID
   *
   * @param messageId - Message ID
   * @returns Parsed message or null if not found
   */
  public async getMessageById(messageId: string): Promise<ParsedMessage | null> {
    try {
      const result = await executeQuery<MessageDbRecord>(
        `
        SELECT id, session_id, role, message_type, content, metadata, created_at
        FROM messages
        WHERE id = @id
        `,
        { id: messageId }
      );

      if (result.recordset.length === 0) {
        return null;
      }

      // Safe to use non-null assertion since we checked length above
      return parseMessageMetadata(result.recordset[0]!);
    } catch (error) {
      logger.error('Failed to get message by ID', { error, messageId });
      throw error;
    }
  }

  /**
   * Delete Messages for Session
   *
   * Deletes all messages for a session (cleanup).
   *
   * @param sessionId - Session ID
   * @returns Number of messages deleted
   */
  public async deleteMessagesBySession(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery(
        `
        DELETE FROM messages
        WHERE session_id = @session_id
        `,
        { session_id: sessionId }
      );

      const deletedCount = result.rowsAffected?.[0] ?? 0;

      logger.info('Messages deleted for session', { sessionId, deletedCount });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to delete messages', { error, sessionId });
      throw error;
    }
  }

  /**
   * Get Message Count for Session
   *
   * @param sessionId - Session ID
   * @returns Total number of messages
   */
  public async getMessageCount(sessionId: string): Promise<number> {
    try {
      const result = await executeQuery<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE session_id = @session_id
        `,
        { session_id: sessionId }
      );

      return result.recordset[0]?.count ?? 0;
    } catch (error) {
      logger.error('Failed to get message count', { error, sessionId });
      return 0;
    }
  }

  /**
   * Check if First User Message
   *
   * Determines if there is only one user message in the session.
   * Used for automatic title generation on first message.
   *
   * @param sessionId - Session ID
   * @returns True if this is the first user message, false otherwise
   */
  public async isFirstUserMessage(sessionId: string): Promise<boolean> {
    try {
      const result = await executeQuery<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE session_id = @session_id AND role = 'user'
        `,
        { session_id: sessionId }
      );

      const userMessageCount = result.recordset[0]?.count ?? 0;
      return userMessageCount === 1;
    } catch (error) {
      logger.error('Failed to check if first user message', { error, sessionId });
      return false; // Default to false on error
    }
  }

  /**
   * Replay Messages from EventStore
   *
   * Reconstructs message state by replaying events.
   * Useful for recovery or debugging.
   *
   * @param sessionId - Session ID
   */
  public async replayMessages(sessionId: string): Promise<void> {
    logger.info('Replaying messages from EventStore', { sessionId });

    await this.eventStore.replayEvents(sessionId, async (event) => {
      // Process each event and reconstruct messages
      logger.debug('Replaying event', {
        eventType: event.event_type,
        sequenceNumber: event.sequence_number,
      });

      // TODO: Implement event replay logic
      // This would reconstruct the messages table from events
    });

    logger.info('Message replay completed', { sessionId });
  }
}

/**
 * Get MessageService singleton instance
 */
export function getMessageService(): MessageService {
  return MessageService.getInstance();
}
