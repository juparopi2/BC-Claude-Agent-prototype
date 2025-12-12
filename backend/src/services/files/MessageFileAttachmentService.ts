/**
 * Message File Attachment Service
 *
 * Phase 5: Chat Integration with Files - Ciclo 4
 * Handles persistence of file attachments associated with chat messages.
 *
 * Tracks:
 * - Direct attachments: Files user explicitly attached to their message
 * - Citations: Files Claude referenced in its response
 * - Semantic matches: Files found via semantic search (future)
 */

import { randomUUID } from 'crypto';
import { executeQuery, SqlParams } from '@/config/database';
import { createChildLogger } from '@/utils/logger';
import type {
  FileUsageType,
  AttachmentRecordResult,
  MessageAttachmentInfo,
} from './citations/types';

const logger = createChildLogger({ service: 'MessageFileAttachmentService' });

/**
 * Database record for message_file_attachments table
 */
interface AttachmentDbRecord {
  file_id: string;
  usage_type: string;
  relevance_score: number | null;
  created_at: Date;
}

export class MessageFileAttachmentService {
  /**
   * Records file attachments for a message.
   *
   * @param messageId - The message ID to attach files to
   * @param fileIds - Array of file IDs to attach
   * @param usageType - Type of attachment (direct, citation, semantic_match)
   * @param relevanceScore - Optional relevance score (for semantic matches)
   * @returns Result with success status and records created count
   */
  async recordAttachments(
    messageId: string,
    fileIds: string[],
    usageType: FileUsageType,
    relevanceScore: number | null = null
  ): Promise<AttachmentRecordResult> {
    if (fileIds.length === 0) {
      return { success: true, recordsCreated: 0 };
    }

    try {
      // Build bulk INSERT statement
      const params: SqlParams = {
        message_id: messageId,
      };

      const values: string[] = [];

      for (let i = 0; i < fileIds.length; i++) {
        const fileId = fileIds[i];
        if (!fileId) continue;

        const id = randomUUID();

        params[`id_${i}`] = id;
        params[`file_id_${i}`] = fileId;
        params[`usage_type_${i}`] = usageType;
        params[`relevance_score_${i}`] = relevanceScore;

        values.push(`(
          @id_${i},
          @message_id,
          @file_id_${i},
          @usage_type_${i},
          @relevance_score_${i},
          GETUTCDATE()
        )`);
      }

      const sql = `
        INSERT INTO message_file_attachments (
          id,
          message_id,
          file_id,
          usage_type,
          relevance_score,
          created_at
        )
        VALUES ${values.join(', ')}
      `;

      await executeQuery(sql, params);

      logger.debug(
        { messageId, fileIds, usageType, count: fileIds.length },
        'Recorded file attachments'
      );

      return { success: true, recordsCreated: fileIds.length };
    } catch (error) {
      logger.error({ error, messageId, fileIds, usageType }, 'Failed to record attachments');
      throw error;
    }
  }

  /**
   * Gets all file attachments for a message.
   *
   * @param messageId - The message ID to get attachments for
   * @param usageType - Optional filter by usage type
   * @returns Array of attachment info
   */
  async getAttachmentsForMessage(
    messageId: string,
    usageType?: FileUsageType
  ): Promise<MessageAttachmentInfo[]> {
    let sql = `
      SELECT file_id, usage_type, relevance_score, created_at
      FROM message_file_attachments
      WHERE message_id = @message_id
    `;

    const params: SqlParams = { message_id: messageId };

    if (usageType) {
      sql += ' AND usage_type = @usage_type';
      params.usage_type = usageType;
    }

    sql += ' ORDER BY created_at ASC';

    const result = await executeQuery<AttachmentDbRecord>(sql, params);

    return result.recordset.map((record) => ({
      fileId: record.file_id,
      usageType: record.usage_type as FileUsageType,
      relevanceScore: record.relevance_score,
      createdAt: record.created_at,
    }));
  }

  /**
   * Deletes all attachments for a message.
   *
   * @param messageId - The message ID to delete attachments for
   * @returns Number of records deleted
   */
  async deleteAttachmentsForMessage(messageId: string): Promise<number> {
    const sql = `
      DELETE FROM message_file_attachments
      WHERE message_id = @message_id
    `;

    const result = await executeQuery(sql, { message_id: messageId });
    const deleted = result.rowsAffected?.[0] ?? 0;

    logger.debug({ messageId, deleted }, 'Deleted file attachments');

    return deleted;
  }

  /**
   * Records multiple usage types at once (e.g., direct + citations).
   *
   * @param messageId - The message ID to attach files to
   * @param attachments - Object with usage types as keys and file ID arrays as values
   */
  async recordMultipleUsageTypes(
    messageId: string,
    attachments: Partial<Record<FileUsageType, string[]>>
  ): Promise<void> {
    const usageTypes: FileUsageType[] = ['direct', 'citation', 'semantic_match'];

    for (const usageType of usageTypes) {
      const fileIds = attachments[usageType];
      if (fileIds && fileIds.length > 0) {
        await this.recordAttachments(messageId, fileIds, usageType);
      }
    }
  }
}

// Singleton instance
let instance: MessageFileAttachmentService | null = null;

/**
 * Gets the singleton instance of MessageFileAttachmentService
 */
export function getMessageFileAttachmentService(): MessageFileAttachmentService {
  if (!instance) {
    instance = new MessageFileAttachmentService();
  }
  return instance;
}
