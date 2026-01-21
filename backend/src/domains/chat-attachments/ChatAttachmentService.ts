/**
 * ChatAttachmentService
 *
 * Service for managing ephemeral chat attachments that are sent directly
 * to Anthropic as native document/image content blocks.
 *
 * Key Responsibilities:
 * - CRUD operations for chat_attachments table
 * - Multi-tenant isolation (user_id filtering)
 * - TTL management for ephemeral attachments
 * - Blob storage coordination for upload/delete
 *
 * Architecture Notes:
 * - Uses singleton pattern with DI support for testing
 * - All IDs are UPPERCASE per project conventions
 * - Soft delete with grace period for blob cleanup
 */

import { randomUUID } from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';
import { getFileUploadService } from '@/services/files/FileUploadService';
import {
  CHAT_ATTACHMENT_CONFIG,
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
  isImageMimeType,
  parseChatAttachment,
} from '@bc-agent/shared';
import type {
  ChatAttachmentDbRecord,
  ParsedChatAttachment,
  ChatAttachmentMediaType,
  ChatAttachmentSummary,
  ChatAttachmentStatus,
} from '@bc-agent/shared';
import type { Logger } from 'pino';

// ============================================
// Types
// ============================================

export interface UploadAttachmentOptions {
  userId: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  ttlHours?: number;
  contentHash?: string;
}

export interface DeleteAttachmentResult {
  id: string;
  blobPath: string;
}

// ============================================
// Service Implementation
// ============================================

export class ChatAttachmentService {
  private static instance: ChatAttachmentService | null = null;
  private readonly logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'ChatAttachmentService' });
  }

  public static getInstance(): ChatAttachmentService {
    if (!ChatAttachmentService.instance) {
      ChatAttachmentService.instance = new ChatAttachmentService();
    }
    return ChatAttachmentService.instance;
  }

  // ========================================
  // Upload
  // ========================================

  /**
   * Upload a new chat attachment
   *
   * Validates MIME type and size, uploads to blob storage,
   * and creates database record with TTL.
   *
   * @param options - Upload options including buffer and metadata
   * @returns Parsed attachment for API response
   * @throws Error if validation fails or upload fails
   */
  async uploadAttachment(options: UploadAttachmentOptions): Promise<ParsedChatAttachment> {
    const {
      userId,
      sessionId,
      fileName,
      mimeType,
      sizeBytes,
      buffer,
      ttlHours = CHAT_ATTACHMENT_CONFIG.DEFAULT_TTL_HOURS,
      contentHash,
    } = options;

    // Validate MIME type
    if (!CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType as ChatAttachmentMediaType)) {
      this.logger.warn({ mimeType, userId }, 'Unsupported MIME type for chat attachment');
      throw new Error(
        `MIME type '${mimeType}' is not supported. Allowed types: ${CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.join(', ')}`
      );
    }

    // Validate size based on MIME type
    const maxSize = isImageMimeType(mimeType)
      ? CHAT_ATTACHMENT_CONFIG.MAX_IMAGE_SIZE_BYTES
      : CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES;

    if (sizeBytes > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      const typeLabel = isImageMimeType(mimeType) ? 'images' : 'documents';
      this.logger.warn({ sizeBytes, maxSize, mimeType, userId }, 'File size exceeds limit');
      throw new Error(`File size exceeds maximum allowed (${maxSizeMB}MB for ${typeLabel})`);
    }

    // Generate UPPERCASE ID
    const attachmentId = randomUUID().toUpperCase();

    // Generate blob path for chat attachments
    const timestamp = Date.now();
    const sanitizedFileName = this.sanitizeFileName(fileName);
    const blobPath = `chat-attachments/${userId}/${sessionId}/${timestamp}-${sanitizedFileName}`;

    // Upload to blob storage first
    const fileUploadService = getFileUploadService();
    await fileUploadService.uploadToBlob(buffer, blobPath, mimeType);

    this.logger.debug({ attachmentId, blobPath, userId, sessionId }, 'Uploaded attachment to blob');

    // Create database record
    const query = `
      INSERT INTO chat_attachments (
        id, user_id, session_id, name, mime_type, size_bytes,
        blob_path, content_hash, expires_at, created_at
      )
      OUTPUT INSERTED.*
      VALUES (
        @id, @user_id, @session_id, @name, @mime_type, @size_bytes,
        @blob_path, @content_hash, DATEADD(HOUR, @ttl_hours, GETUTCDATE()), GETUTCDATE()
      )
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, {
      id: attachmentId,
      user_id: userId,
      session_id: sessionId,
      name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      blob_path: blobPath,
      content_hash: contentHash || null,
      ttl_hours: ttlHours,
    });

    if (!result.recordset[0]) {
      this.logger.error({ attachmentId, userId }, 'Failed to create attachment record');
      throw new Error('Failed to create attachment record');
    }

    this.logger.info({ attachmentId, userId, sessionId, fileName, ttlHours }, 'Chat attachment uploaded');

    return parseChatAttachment(result.recordset[0]);
  }

  // ========================================
  // Read Operations
  // ========================================

  /**
   * Get a single attachment by ID with ownership validation
   *
   * @param userId - User ID for ownership check
   * @param attachmentId - Attachment ID
   * @returns Parsed attachment or null if not found
   */
  async getAttachment(userId: string, attachmentId: string): Promise<ParsedChatAttachment | null> {
    const query = `
      SELECT *
      FROM chat_attachments
      WHERE id = @id AND user_id = @user_id AND is_deleted = 0
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, {
      id: attachmentId,
      user_id: userId,
    });

    if (!result.recordset[0]) {
      return null;
    }

    return parseChatAttachment(result.recordset[0]);
  }

  /**
   * Get multiple attachments by IDs for agent execution
   *
   * Filters out expired and deleted attachments.
   * Used when resolving chat attachments for Anthropic content blocks.
   *
   * @param userId - User ID for ownership check
   * @param attachmentIds - Array of attachment IDs
   * @returns Array of valid, non-expired attachments
   */
  async getAttachmentsByIds(
    userId: string,
    attachmentIds: string[]
  ): Promise<ParsedChatAttachment[]> {
    if (attachmentIds.length === 0) {
      return [];
    }

    // Build parameterized IN clause
    const idParams = attachmentIds.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, unknown> = { user_id: userId };
    attachmentIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const query = `
      SELECT *
      FROM chat_attachments
      WHERE id IN (${idParams})
        AND user_id = @user_id
        AND is_deleted = 0
        AND expires_at > GETUTCDATE()
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, params);

    return result.recordset.map(parseChatAttachment);
  }

  /**
   * Get all non-expired attachments for a session
   *
   * @param userId - User ID for ownership check
   * @param sessionId - Session ID
   * @returns Array of attachments ordered by creation date (newest first)
   */
  async getAttachmentsBySession(
    userId: string,
    sessionId: string
  ): Promise<ParsedChatAttachment[]> {
    const query = `
      SELECT *
      FROM chat_attachments
      WHERE user_id = @user_id AND session_id = @session_id AND is_deleted = 0
      ORDER BY created_at DESC
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, {
      user_id: userId,
      session_id: sessionId,
    });

    return result.recordset.map(parseChatAttachment);
  }

  /**
   * Get raw attachment record with blob path for content resolution
   *
   * @param userId - User ID for ownership check
   * @param attachmentId - Attachment ID
   * @returns Raw database record or null
   */
  async getAttachmentRecord(
    userId: string,
    attachmentId: string
  ): Promise<ChatAttachmentDbRecord | null> {
    const query = `
      SELECT *
      FROM chat_attachments
      WHERE id = @id AND user_id = @user_id AND is_deleted = 0 AND expires_at > GETUTCDATE()
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, {
      id: attachmentId,
      user_id: userId,
    });

    return result.recordset[0] || null;
  }

  /**
   * Get lightweight attachment summaries by IDs.
   *
   * Returns ChatAttachmentSummary (not full ParsedChatAttachment) for
   * efficient WebSocket event emission. Used when user_message_confirmed
   * needs to include attachment metadata for immediate frontend rendering.
   *
   * @param userId - User ID for ownership check
   * @param attachmentIds - Array of attachment IDs
   * @returns Array of summaries (order matches input IDs where found)
   */
  async getAttachmentSummaries(
    userId: string,
    attachmentIds: string[]
  ): Promise<ChatAttachmentSummary[]> {
    if (attachmentIds.length === 0) {
      return [];
    }

    // Build parameterized IN clause
    const idParams = attachmentIds.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, unknown> = { user_id: userId };
    attachmentIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const query = `
      SELECT id, name, mime_type, size_bytes, expires_at, is_deleted
      FROM chat_attachments
      WHERE id IN (${idParams})
        AND user_id = @user_id
        AND is_deleted = 0
    `;

    const result = await executeQuery<{
      id: string;
      name: string;
      mime_type: string;
      size_bytes: number;
      expires_at: Date;
      is_deleted: boolean;
    }>(query, params);

    // Convert to summaries
    const now = new Date();
    return result.recordset.map((record): ChatAttachmentSummary => {
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
    });
  }

  // ========================================
  // Delete Operations
  // ========================================

  /**
   * Soft delete an attachment
   *
   * Marks as deleted but keeps record for blob cleanup coordination.
   *
   * @param userId - User ID for ownership check
   * @param attachmentId - Attachment ID
   * @returns Deleted attachment info (for blob cleanup) or null if not found
   */
  async deleteAttachment(
    userId: string,
    attachmentId: string
  ): Promise<DeleteAttachmentResult | null> {
    const query = `
      UPDATE chat_attachments
      SET is_deleted = 1, deleted_at = GETUTCDATE()
      OUTPUT INSERTED.id, INSERTED.blob_path
      WHERE id = @id AND user_id = @user_id AND is_deleted = 0
    `;

    const result = await executeQuery<{ id: string; blob_path: string }>(query, {
      id: attachmentId,
      user_id: userId,
    });

    if (!result.recordset[0]) {
      return null;
    }

    this.logger.info({ attachmentId, userId }, 'Chat attachment soft deleted');

    return {
      id: result.recordset[0].id,
      blobPath: result.recordset[0].blob_path,
    };
  }

  // ========================================
  // Cleanup Operations
  // ========================================

  /**
   * Mark all expired attachments for deletion
   *
   * Called by cleanup job to identify attachments past TTL.
   *
   * @returns Number of attachments marked
   */
  async markExpiredForDeletion(): Promise<number> {
    const query = `
      UPDATE chat_attachments
      SET is_deleted = 1, deleted_at = GETUTCDATE()
      WHERE expires_at < GETUTCDATE() AND is_deleted = 0
    `;

    const result = await executeQuery(query, {});

    const count = result.rowsAffected[0] || 0;

    if (count > 0) {
      this.logger.info({ count }, 'Marked expired chat attachments for deletion');
    }

    return count;
  }

  /**
   * Get soft-deleted attachments ready for hard delete
   *
   * Returns attachments deleted beyond the grace period.
   *
   * @param limit - Maximum number of records to return
   * @returns Array of raw records for blob cleanup
   */
  async getDeletedAttachments(limit: number): Promise<ChatAttachmentDbRecord[]> {
    const query = `
      SELECT TOP (@limit) *
      FROM chat_attachments
      WHERE is_deleted = 1
        AND deleted_at < DATEADD(HOUR, -${CHAT_ATTACHMENT_CONFIG.GRACE_PERIOD_HOURS}, GETUTCDATE())
    `;

    const result = await executeQuery<ChatAttachmentDbRecord>(query, { limit });

    return result.recordset;
  }

  /**
   * Permanently delete attachment records
   *
   * Called after blob storage cleanup is complete.
   *
   * @param attachmentIds - IDs to delete
   * @returns Number of records deleted
   */
  async hardDeleteAttachments(attachmentIds: string[]): Promise<number> {
    if (attachmentIds.length === 0) {
      return 0;
    }

    // Build parameterized IN clause
    const idParams = attachmentIds.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, unknown> = {};
    attachmentIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const query = `
      DELETE FROM chat_attachments
      WHERE id IN (${idParams})
    `;

    const result = await executeQuery(query, params);

    const count = result.rowsAffected[0] || 0;

    if (count > 0) {
      this.logger.info({ count, attachmentIds }, 'Hard deleted chat attachments');
    }

    return count;
  }

  // ========================================
  // Private Helpers
  // ========================================

  /**
   * Sanitize filename for blob storage path
   *
   * Removes path traversal attempts and unsafe characters.
   * Unicode characters are replaced with hyphens.
   */
  private sanitizeFileName(fileName: string): string {
    // Remove path traversal attempts
    const baseName = fileName.replace(/^.*[\\\/]/, '');

    // Replace unsafe characters with hyphens
    const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, '-');

    // Remove consecutive hyphens
    return sanitized.replace(/-+/g, '-');
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Get the ChatAttachmentService singleton instance
 */
export function getChatAttachmentService(): ChatAttachmentService {
  return ChatAttachmentService.getInstance();
}

/**
 * Reset singleton instance for testing
 */
export function __resetChatAttachmentService(): void {
  (ChatAttachmentService as unknown as { instance: ChatAttachmentService | null }).instance = null;
}
