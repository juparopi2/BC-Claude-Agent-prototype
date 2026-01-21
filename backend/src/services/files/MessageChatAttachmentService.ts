/**
 * Message Chat Attachment Service
 *
 * Handles persistence of ephemeral chat attachments associated with messages.
 * Unlike MessageFileAttachmentService (for KB files), this tracks chat attachments
 * that are sent directly to Anthropic API without RAG processing.
 *
 * Usage Pattern:
 * 1. User uploads files via /api/chat/attachments → stored in chat_attachments
 * 2. User sends message with attachment IDs
 * 3. PersistenceCoordinator calls recordAttachments() to create linkage
 * 4. When fetching message history, getAttachmentsForMessages() returns summaries
 *
 * @module services/files/MessageChatAttachmentService
 */

import { randomUUID } from 'crypto';
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';
import type {
  ChatAttachmentStatus,
  ChatAttachmentSummary,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'MessageChatAttachmentService' });

/**
 * Database record from JOIN query
 */
interface AttachmentJoinRecord {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  expires_at: Date;
  is_deleted: boolean;
  created_at: Date;
}

/**
 * Result of recording attachments
 */
export interface RecordAttachmentsResult {
  success: boolean;
  recordsCreated: number;
}

/**
 * Service for managing message-to-chat-attachment relationships
 */
export class MessageChatAttachmentService {
  /**
   * Records chat attachments for a message.
   *
   * Creates entries in message_chat_attachments junction table linking
   * the message to its associated chat attachments.
   *
   * @param messageId - The message ID (can be Anthropic format or UUID)
   * @param attachmentIds - Array of chat attachment IDs to link
   * @returns Result with success status and records created count
   */
  async recordAttachments(
    messageId: string,
    attachmentIds: string[]
  ): Promise<RecordAttachmentsResult> {
    if (attachmentIds.length === 0) {
      return { success: true, recordsCreated: 0 };
    }

    try {
      // Build bulk INSERT statement
      const params: SqlParams = {
        message_id: messageId,
      };

      const values: string[] = [];

      for (let i = 0; i < attachmentIds.length; i++) {
        const attachmentId = attachmentIds[i];
        if (!attachmentId) continue;

        // D24/Section 12: All IDs must be UPPERCASE per CLAUDE.md
        const id = randomUUID().toUpperCase();

        params[`id_${i}`] = id;
        params[`attachment_id_${i}`] = attachmentId.toUpperCase();

        values.push(`(
          @id_${i},
          @message_id,
          @attachment_id_${i},
          GETUTCDATE()
        )`);
      }

      const sql = `
        INSERT INTO message_chat_attachments (
          id,
          message_id,
          chat_attachment_id,
          created_at
        )
        VALUES ${values.join(', ')}
      `;

      await executeQuery(sql, params);

      logger.debug(
        { messageId, attachmentIds, count: attachmentIds.length },
        'Recorded chat attachments for message'
      );

      return { success: true, recordsCreated: attachmentIds.length };
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      logger.error(
        { error: errorInfo, messageId, attachmentIds },
        'Failed to record chat attachments'
      );
      throw error;
    }
  }

  /**
   * Gets all chat attachments for a single message.
   *
   * @param messageId - The message ID to get attachments for
   * @returns Array of attachment summaries with current status
   */
  async getAttachmentsForMessage(messageId: string): Promise<ChatAttachmentSummary[]> {
    const sql = `
      SELECT
        ca.id,
        ca.name,
        ca.mime_type,
        ca.size_bytes,
        ca.expires_at,
        ca.is_deleted,
        ca.created_at
      FROM message_chat_attachments mca
      INNER JOIN chat_attachments ca ON mca.chat_attachment_id = ca.id
      WHERE mca.message_id = @message_id
      ORDER BY mca.created_at ASC
    `;

    const result = await executeQuery<AttachmentJoinRecord>(sql, { message_id: messageId });

    return result.recordset.map((record) => this.toSummary(record));
  }

  /**
   * Gets chat attachments for multiple messages in a single query.
   *
   * Optimized for batch fetching when loading message history.
   * Returns a Map keyed by message ID for O(1) lookups.
   *
   * @param messageIds - Array of message IDs to get attachments for
   * @returns Map of messageId -> ChatAttachmentSummary[]
   */
  async getAttachmentsForMessages(
    messageIds: string[]
  ): Promise<Map<string, ChatAttachmentSummary[]>> {
    const result = new Map<string, ChatAttachmentSummary[]>();

    if (messageIds.length === 0) {
      return result;
    }

    // Build parameterized IN clause
    const params: SqlParams = {};
    const placeholders: string[] = [];

    for (let i = 0; i < messageIds.length; i++) {
      const paramName = `msg_${i}`;
      params[paramName] = messageIds[i];
      placeholders.push(`@${paramName}`);
    }

    const sql = `
      SELECT
        mca.message_id,
        ca.id,
        ca.name,
        ca.mime_type,
        ca.size_bytes,
        ca.expires_at,
        ca.is_deleted,
        ca.created_at
      FROM message_chat_attachments mca
      INNER JOIN chat_attachments ca ON mca.chat_attachment_id = ca.id
      WHERE mca.message_id IN (${placeholders.join(', ')})
      ORDER BY mca.message_id, mca.created_at ASC
    `;

    const queryResult = await executeQuery<AttachmentJoinRecord & { message_id: string }>(
      sql,
      params
    );

    // Group by message ID
    for (const record of queryResult.recordset) {
      const messageId = record.message_id;
      const summary = this.toSummary(record);

      const existing = result.get(messageId);
      if (existing) {
        existing.push(summary);
      } else {
        result.set(messageId, [summary]);
      }
    }

    logger.debug(
      { messageIds: messageIds.length, attachmentsFound: queryResult.recordset.length },
      'Fetched chat attachments for messages'
    );

    return result;
  }

  /**
   * Deletes all attachment links for a message.
   *
   * Note: This does NOT delete the chat_attachments themselves,
   * only the junction table entries.
   *
   * @param messageId - The message ID to delete attachment links for
   * @returns Number of records deleted
   */
  async deleteAttachmentLinksForMessage(messageId: string): Promise<number> {
    const sql = `
      DELETE FROM message_chat_attachments
      WHERE message_id = @message_id
    `;

    const result = await executeQuery(sql, { message_id: messageId });
    const deleted = result.rowsAffected?.[0] ?? 0;

    logger.debug({ messageId, deleted }, 'Deleted chat attachment links');

    return deleted;
  }

  /**
   * Converts a database record to ChatAttachmentSummary.
   *
   * Determines current status based on expiration and deletion flags.
   */
  private toSummary(record: AttachmentJoinRecord): ChatAttachmentSummary {
    const now = new Date();
    let status: ChatAttachmentStatus = 'ready';

    if (record.is_deleted) {
      status = 'deleted';
    } else if (record.expires_at < now) {
      status = 'expired';
    }

    return {
      id: record.id,
      name: record.name,
      mimeType: record.mime_type,
      sizeBytes: record.size_bytes,
      isImage: record.mime_type.startsWith('image/'),
      status,
    };
  }
}

// Singleton instance
let instance: MessageChatAttachmentService | null = null;

/**
 * Gets the singleton instance of MessageChatAttachmentService
 */
export function getMessageChatAttachmentService(): MessageChatAttachmentService {
  if (!instance) {
    instance = new MessageChatAttachmentService();
  }
  return instance;
}

/**
 * Resets the singleton instance (for testing)
 */
export function resetMessageChatAttachmentService(): void {
  instance = null;
}
