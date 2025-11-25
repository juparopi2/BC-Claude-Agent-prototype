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
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';
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
  private logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'MessageService' });
    this.logger.info('MessageService initialized');
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
   * Returns message ID, sequence number, and event ID synchronously without waiting for DB write.
   *
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param content - Message content
   * @returns Object with message ID, sequence number, and event ID
   */
  public async saveUserMessage(
    sessionId: string,
    userId: string,
    content: string
  ): Promise<{ messageId: string; sequenceNumber: number; eventId: string }> {
    const messageId = randomUUID();

    try {
      this.logger.info('📝 saveUserMessage START', { sessionId, messageId, userId });

      // 1. Append event to EventStore (fast, synchronous)
      this.logger.info('📝 Appending event to EventStore...', { sessionId, messageId });
      const eventStart = Date.now();
      const event = await this.eventStore.appendEvent(sessionId, 'user_message_sent', {
        message_id: messageId,
        content,
        user_id: userId,
      });
      // ⭐ DIAGNOSTIC: Log the sequence number from EventStore
      this.logger.info('✅ Event appended to EventStore', {
        sessionId,
        messageId,
        eventId: event.id,
        sequenceNumber: event.sequence_number, // ⭐ CRITICAL: This is the sequence number
        duration: Date.now() - eventStart,
      });

      // 2. Queue for DB persistence (async, non-blocking)
      this.logger.info('📝 Adding to message queue...', { sessionId, messageId });
      const queueStart = Date.now();

      try {
        await this.messageQueue.addMessagePersistence({
          sessionId,
          messageId,
          role: 'user',
          messageType: 'text',
          content,
          metadata: { user_id: userId },
          // ⭐ CRITICAL: Pass sequenceNumber and eventId from EventStore
          sequenceNumber: event.sequence_number,
          eventId: event.id,
        });
        this.logger.info('✅ Added to queue with sequence', {
          sessionId,
          messageId,
          sequenceNumber: event.sequence_number,
          eventId: event.id,
          duration: Date.now() - queueStart,
        });
      } catch (queueError) {
        // ⭐ FALLBACK: If MessageQueue fails, write directly to database
        this.logger.error('❌ MessageQueue failed, falling back to direct DB write', {
          error: queueError,
          sessionId,
          messageId,
        });

        try {
          const params: SqlParams = {
            id: messageId,
            session_id: sessionId,
            role: 'user',
            message_type: 'text',
            content,
            metadata: JSON.stringify({ user_id: userId }),
            token_count: null,
            stop_reason: null,
            // ⭐ CRITICAL: Include sequence_number and event_id from EventStore
            sequence_number: event.sequence_number,
            event_id: event.id,
            created_at: new Date(),
            // ⭐ Token tracking columns (null for user messages, populated for assistant)
            model: null,
            input_tokens: null,
            output_tokens: null,
          };

          await executeQuery(
            `
            INSERT INTO messages (id, session_id, role, message_type, content, metadata, token_count, stop_reason, sequence_number, event_id, created_at, model, input_tokens, output_tokens)
            VALUES (@id, @session_id, @role, @message_type, @content, @metadata, @token_count, @stop_reason, @sequence_number, @event_id, @created_at, @model, @input_tokens, @output_tokens)
            `,
            params
          );

          this.logger.warn('⚠️  Message persisted via fallback (direct DB write)', {
            sessionId,
            messageId,
            sequenceNumber: event.sequence_number,
            eventId: event.id,
            reason: 'MessageQueue unavailable',
          });
        } catch (dbError) {
          this.logger.error('❌ Fallback DB write also failed', {
            queueError,
            dbError,
            sessionId,
            messageId,
          });
          // Re-throw original queue error with context
          throw new Error(`Message persistence failed: Queue error - ${queueError instanceof Error ? queueError.message : 'Unknown'}, DB fallback error - ${dbError instanceof Error ? dbError.message : 'Unknown'}`);
        }
      }

      this.logger.info('✅ User message saved', { sessionId, messageId, userId });

      // ⭐ Return all necessary data for frontend confirmation
      return {
        messageId,
        sequenceNumber: event.sequence_number,
        eventId: event.id,
      };
    } catch (error) {
      this.logger.error('❌ Failed to save user message', {
        error,
        sessionId,
        userId,
      });
      throw error;
    }
  }

  /**
   * ⭐ PHASE 1B: saveAgentMessage() REMOVED
   *
   * This method was deprecated and removed in Phase 1B.
   *
   * **Why removed?**
   * - DirectAgentService now handles persistence directly via EventStore + MessageQueue
   * - Eliminates redundant layer and ensures Anthropic message IDs flow correctly
   * - ChatMessageHandler no longer calls this method (fallback logic removed)
   *
   * **Migration path:**
   * - Agent messages: Use DirectAgentService (writes to EventStore + MessageQueue)
   * - User messages: Use saveUserMessage() below
   * - Tool results: Use updateToolResult() below
   *
   * **Removed**: 2025-11-24
   */

  /**
   * ⭐ PHASE 1B: saveThinkingMessage() REMOVED
   *
   * This method was deprecated and removed in Phase 1B.
   *
   * **Why removed?**
   * - DirectAgentService now handles thinking persistence directly via EventStore + MessageQueue
   * - Eliminates redundant layer
   * - ChatMessageHandler no longer calls this method (fallback logic removed)
   *
   * **Removed**: 2025-11-24
   */

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
    // ⭐ VALIDATION: Check for undefined toolUseId
    if (!toolUseId || toolUseId === 'undefined' || toolUseId.trim() === '') {
      this.logger.error('❌ saveToolUseMessage called with invalid toolUseId', {
        toolUseId,
        toolName,
        sessionId,
        userId,
      });
      throw new Error(`Invalid toolUseId: ${toolUseId}. Cannot save tool use message.`);
    }

    const messageId = toolUseId; // Use toolUseId as messageId for consistency

    try {
      // 1. Append event to EventStore (gets atomic sequence number)
      const event = await this.eventStore.appendEvent(sessionId, 'tool_use_requested', {
        tool_use_id: toolUseId,
        tool_name: toolName,
        tool_args: toolArgs,
        user_id: userId,  // ⭐ Audit trail
      });

      this.logger.info('✅ Tool use event appended to EventStore', {
        sessionId,
        toolUseId,
        toolName,
        eventId: event.id,
        sequenceNumber: event.sequence_number, // ⭐ CRITICAL: sequence from EventStore
      });

      // 2. Queue for DB persistence (with sequence number)
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
        // ⭐ CRITICAL FIX: Pass sequenceNumber and eventId from EventStore
        sequenceNumber: event.sequence_number,
        eventId: event.id,
      });

      this.logger.info('✅ Tool use message queued for persistence', {
        sessionId,
        toolUseId,
        toolName,
        sequenceNumber: event.sequence_number,
        eventId: event.id,
      });

      return messageId;
    } catch (error) {
      this.logger.error('Failed to save tool use message', {
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
    // ⭐ VALIDATION: Check for undefined toolUseId
    if (!toolUseId || toolUseId === 'undefined' || toolUseId.trim() === '') {
      // 🚨 ENHANCED ERROR: Stack trace + detailed diagnostics
      const stackTrace = new Error().stack;

      this.logger.error('❌ updateToolResult called with invalid toolUseId', {
        toolUseId,
        toolUseIdType: typeof toolUseId,
        toolUseIdValue: toolUseId,
        toolUseIdLength: toolUseId?.length || 0,
        toolName,
        sessionId,
        userId,
        toolArgs: toolArgs,
        success,
        error,
        stackTrace,
      });

      throw new Error(
        `❌ INVALID TOOL USE ID ERROR:\n` +
        `\n📋 Details:` +
        `\n  - toolUseId: "${toolUseId}"` +
        `\n  - Type: ${typeof toolUseId}` +
        `\n  - Length: ${toolUseId?.length || 0}` +
        `\n  - Tool Name: ${toolName}` +
        `\n  - Session ID: ${sessionId}` +
        `\n  - User ID: ${userId}` +
        `\n\n🔍 Possible Causes:` +
        `\n  1. SDK did not provide tool use ID in content_block_start` +
        `\n  2. ID was lost during toolUses array push` +
        `\n  3. ID corruption during tool execution loop` +
        `\n  4. Caller passed undefined/null directly` +
        `\n\n💡 Check TRACE logs [TRACE 1/8 through TRACE 7/8] to find where ID was lost` +
        `\n\n📍 Stack Trace:\n${stackTrace}`
      );
    }

    try {
      // ✅ FIX PHASE 2: NO llamar a appendEvent() - evento ya persistido por DirectAgentService
      // La llamada a appendEvent() generaba un NUEVO sequence, causando duplicados

      // ✅ Actualizar messages table usando tool_use_id
      const params: SqlParams = {
        tool_use_id: toolUseId,  // ⬅️ FIXED: Use tool_use_id column, not id
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
        WHERE tool_use_id = @tool_use_id AND session_id = @session_id
        `,
        params
      );

      this.logger.debug('Tool result updated', {
        sessionId,
        userId,
        toolUseId,
        toolName,
        success,
      });
    } catch (error) {
      this.logger.error('Failed to update tool result', {
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
      // ⭐ UPDATED 2025-11-24: Added Phase 1A token tracking columns
      let query = `
        SELECT id, session_id, role, message_type, content, metadata,
               token_count, stop_reason, sequence_number, event_id, tool_use_id,
               model, input_tokens, output_tokens, created_at
        FROM messages
        WHERE session_id = @session_id
        ORDER BY
          CASE
            WHEN sequence_number IS NULL THEN 999999999
            ELSE sequence_number
          END ASC,
          created_at ASC
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
      this.logger.error('Failed to get messages by session', { error, sessionId });
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
      // ⭐ UPDATED 2025-11-24: Added Phase 1A token tracking columns
      const result = await executeQuery<MessageDbRecord>(
        `
        SELECT id, session_id, role, message_type, content, metadata,
               token_count, stop_reason, sequence_number, event_id, tool_use_id,
               model, input_tokens, output_tokens, created_at
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
      this.logger.error('Failed to get message by ID', { error, messageId });
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

      this.logger.info('Messages deleted for session', { sessionId, deletedCount });

      return deletedCount;
    } catch (error) {
      this.logger.error('Failed to delete messages', { error, sessionId });
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
      this.logger.error('Failed to get message count', { error, sessionId });
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
      this.logger.error('Failed to check if first user message', { error, sessionId });
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
    this.logger.info('Replaying messages from EventStore', { sessionId });

    await this.eventStore.replayEvents(sessionId, async (event) => {
      // Process each event and reconstruct messages
      this.logger.debug('Replaying event', {
        eventType: event.event_type,
        sequenceNumber: event.sequence_number,
      });

      // TODO: Implement event replay logic
      // This would reconstruct the messages table from events
    });

    this.logger.info('Message replay completed', { sessionId });
  }
}

/**
 * Get MessageService singleton instance
 */
export function getMessageService(): MessageService {
  return MessageService.getInstance();
}

