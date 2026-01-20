/**
 * AttachmentContentResolver
 *
 * Resolves chat attachment IDs to Anthropic content blocks.
 * Downloads files from blob storage and converts them to base64-encoded
 * document or image content blocks.
 *
 * Responsibilities:
 * - Validate attachment ownership (multi-tenant)
 * - Download files from Azure Blob Storage
 * - Convert to Anthropic document/image content blocks
 * - Handle errors gracefully (skip failed attachments)
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getChatAttachmentService } from './ChatAttachmentService';
import {
  isImageMimeType,
  type AnthropicAttachmentContentBlock,
  type ChatAttachmentDbRecord,
  type ResolvedChatAttachment,
} from '@bc-agent/shared';
import type { Logger } from 'pino';

// ============================================
// Service Implementation
// ============================================

export class AttachmentContentResolver {
  private static instance: AttachmentContentResolver | null = null;
  private readonly logger: Logger;

  private constructor() {
    this.logger = createChildLogger({ service: 'AttachmentContentResolver' });
  }

  public static getInstance(): AttachmentContentResolver {
    if (!AttachmentContentResolver.instance) {
      AttachmentContentResolver.instance = new AttachmentContentResolver();
    }
    return AttachmentContentResolver.instance;
  }

  /**
   * Resolve attachment IDs to Anthropic content blocks
   *
   * For each attachment ID:
   * 1. Validate ownership and expiration
   * 2. Download file from blob storage
   * 3. Convert to appropriate content block (document/image)
   *
   * Failed attachments are logged and skipped (graceful degradation).
   *
   * @param userId - User ID for ownership validation
   * @param attachmentIds - Array of attachment IDs to resolve
   * @returns Array of resolved attachments with content blocks
   */
  async resolve(
    userId: string,
    attachmentIds: string[]
  ): Promise<ResolvedChatAttachment[]> {
    if (attachmentIds.length === 0) {
      return [];
    }

    this.logger.debug({ userId, attachmentCount: attachmentIds.length }, 'Resolving chat attachments');

    const attachmentService = getChatAttachmentService();
    const fileUploadService = getFileUploadService();

    const results: ResolvedChatAttachment[] = [];

    // Process attachments in order
    for (const attachmentId of attachmentIds) {
      try {
        // Get attachment record (validates ownership and expiration)
        const record = await attachmentService.getAttachmentRecord(userId, attachmentId);

        if (!record) {
          this.logger.warn(
            { attachmentId, userId },
            'Attachment not found or expired, skipping'
          );
          continue;
        }

        // Download file from blob storage
        const buffer = await fileUploadService.downloadFromBlob(record.blob_path);

        // Create content block
        const contentBlock = this.createContentBlock(record, buffer);

        results.push({
          id: record.id,
          name: record.name,
          mimeType: record.mime_type,
          buffer,
          contentBlock,
        });

        this.logger.debug(
          { attachmentId, name: record.name, mimeType: record.mime_type },
          'Resolved attachment'
        );
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };

        this.logger.warn(
          { attachmentId, userId, error: errorInfo },
          'Failed to resolve attachment, skipping'
        );
        // Continue with other attachments
      }
    }

    this.logger.info(
      { userId, requested: attachmentIds.length, resolved: results.length },
      'Chat attachments resolved'
    );

    return results;
  }

  /**
   * Create Anthropic content block from attachment record and buffer
   *
   * @param record - Attachment database record
   * @param buffer - File content buffer
   * @returns Document or image content block
   */
  private createContentBlock(
    record: ChatAttachmentDbRecord,
    buffer: Buffer
  ): AnthropicAttachmentContentBlock {
    const base64Data = buffer.toString('base64');

    if (isImageMimeType(record.mime_type)) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: record.mime_type,
          data: base64Data,
        },
      };
    }

    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: record.mime_type,
        data: base64Data,
      },
    };
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Get the AttachmentContentResolver singleton instance
 */
export function getAttachmentContentResolver(): AttachmentContentResolver {
  return AttachmentContentResolver.getInstance();
}

/**
 * Reset singleton instance for testing
 */
export function __resetAttachmentContentResolver(): void {
  (AttachmentContentResolver as unknown as { instance: AttachmentContentResolver | null }).instance = null;
}
