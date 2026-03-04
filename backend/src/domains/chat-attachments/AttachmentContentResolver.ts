/**
 * AttachmentContentResolver
 *
 * Resolves chat attachment IDs to Anthropic content blocks.
 * Classifies each attachment by routing category:
 * - anthropic_native: PDF, text/plain, images → sent as document/image blocks
 * - container_upload: DOCX, XLSX, PPTX, CSV, etc. → uploaded to Anthropic Files API,
 *   sent as container_upload blocks for sandbox processing
 *
 * Responsibilities:
 * - Validate attachment ownership (multi-tenant)
 * - Classify MIME type routing (native vs container_upload)
 * - Download files from Azure Blob Storage
 * - Convert to Anthropic document/image/container_upload content blocks
 * - Handle errors gracefully (skip failed attachments)
 * - Return routing metadata for supervisor hints
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getChatAttachmentService } from './ChatAttachmentService';
import {
  isImageMimeType,
  getAttachmentRoutingCategory,
  type AnthropicAttachmentContentBlock,
  type AnthropicContainerUploadBlock,
  type ChatAttachmentDbRecord,
  type ResolvedChatAttachment,
  type AttachmentRoutingMetadata,
  type AnthropicFileDocumentBlock,
  type AnthropicFileImageBlock,
} from '@bc-agent/shared';
import type { Logger } from 'pino';

// ============================================
// Service Implementation
// ============================================

/**
 * Result of resolving attachments, including routing metadata.
 */
export interface ResolveResult {
  /** Resolved attachments with content blocks */
  attachments: ResolvedChatAttachment[];

  /** Routing metadata for supervisor hints */
  routingMetadata: AttachmentRoutingMetadata;
}

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
   * Resolve attachment IDs to Anthropic content blocks with routing classification.
   *
   * For each attachment ID:
   * 1. Validate ownership and expiration
   * 2. Classify MIME type routing (native vs container_upload)
   * 3. For native: download + create document/image block (or use Files API reference)
   * 4. For container_upload: ensure Files API upload, create container_upload block
   *
   * Failed attachments are logged and skipped (graceful degradation).
   *
   * @param userId - User ID for ownership validation
   * @param attachmentIds - Array of attachment IDs to resolve
   * @returns Resolved attachments with content blocks and routing metadata
   */
  async resolve(
    userId: string,
    attachmentIds: string[]
  ): Promise<ResolvedChatAttachment[]>;
  async resolve(
    userId: string,
    attachmentIds: string[],
    options: { includeRoutingMetadata: true }
  ): Promise<ResolveResult>;
  async resolve(
    userId: string,
    attachmentIds: string[],
    options?: { includeRoutingMetadata?: boolean }
  ): Promise<ResolvedChatAttachment[] | ResolveResult> {
    if (attachmentIds.length === 0) {
      if (options?.includeRoutingMetadata) {
        return { attachments: [], routingMetadata: { hasContainerUploads: false, nonNativeTypes: [] } };
      }
      return [];
    }

    this.logger.debug({ userId, attachmentCount: attachmentIds.length }, 'Resolving chat attachments');

    const attachmentService = getChatAttachmentService();
    const fileUploadService = getFileUploadService();

    const results: ResolvedChatAttachment[] = [];
    const nonNativeTypes: string[] = [];
    let hasContainerUploads = false;

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

        const routingCategory = getAttachmentRoutingCategory(record.mime_type);

        if (routingCategory === 'container_upload') {
          // Container upload path: file must be on Anthropic Files API
          hasContainerUploads = true;
          nonNativeTypes.push(record.mime_type);

          const resolved = await this.resolveContainerUpload(record, attachmentService);
          if (resolved) {
            results.push(resolved);
          }
        } else {
          // Native path: document/image block (existing behavior)
          const resolved = await this.resolveNativeBlock(record, fileUploadService);
          if (resolved) {
            results.push(resolved);
          }
        }
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
      {
        userId,
        requested: attachmentIds.length,
        resolved: results.length,
        hasContainerUploads,
        nonNativeCount: nonNativeTypes.length,
      },
      'Chat attachments resolved'
    );

    if (options?.includeRoutingMetadata) {
      return {
        attachments: results,
        routingMetadata: {
          hasContainerUploads,
          nonNativeTypes: [...new Set(nonNativeTypes)],
        },
      };
    }

    return results;
  }

  /**
   * Resolve a native attachment (PDF, text/plain, images) to a content block.
   * Prefers Files API reference, falls back to base64 download.
   */
  private async resolveNativeBlock(
    record: ChatAttachmentDbRecord,
    fileUploadService: ReturnType<typeof getFileUploadService>
  ): Promise<ResolvedChatAttachment | null> {
    // Prefer Files API reference if available — no blob download needed
    if (record.anthropic_file_id) {
      const contentBlock = this.createFileReferenceBlock(record);
      if (!contentBlock) {
        // Fallback to base64 download below
      } else {
        this.logger.debug(
          { attachmentId: record.id, name: record.name, mimeType: record.mime_type, anthropicFileId: record.anthropic_file_id },
          'Resolved native attachment via Anthropic Files API reference'
        );

        return {
          id: record.id,
          name: record.name,
          mimeType: record.mime_type,
          buffer: Buffer.alloc(0),
          contentBlock,
          routingCategory: 'anthropic_native',
        };
      }
    }

    // Fallback: Download file from blob storage and base64-encode
    const buffer = await fileUploadService.downloadFromBlob(record.blob_path);
    const contentBlock = this.createContentBlock(record, buffer);

    this.logger.debug(
      { attachmentId: record.id, name: record.name, mimeType: record.mime_type },
      'Resolved native attachment via base64 fallback'
    );

    return {
      id: record.id,
      name: record.name,
      mimeType: record.mime_type,
      buffer,
      contentBlock,
      routingCategory: 'anthropic_native',
    };
  }

  /**
   * Resolve a container_upload attachment (DOCX, XLSX, PPTX, etc.).
   * Requires the file to be on Anthropic Files API.
   * If not yet uploaded, logs warning and skips.
   */
  private async resolveContainerUpload(
    record: ChatAttachmentDbRecord,
    attachmentService: ReturnType<typeof getChatAttachmentService>
  ): Promise<ResolvedChatAttachment | null> {
    let anthropicFileId = record.anthropic_file_id;

    if (!anthropicFileId) {
      // File not yet on Anthropic Files API — trigger upload and wait
      this.logger.info(
        { attachmentId: record.id, mimeType: record.mime_type },
        'Container upload: triggering Anthropic Files API upload'
      );

      try {
        anthropicFileId = await attachmentService.ensureAnthropicFileUpload(record.id, record.user_id);
      } catch (uploadError) {
        const errorInfo = uploadError instanceof Error
          ? { message: uploadError.message, name: uploadError.name }
          : { value: String(uploadError) };
        this.logger.warn(
          { attachmentId: record.id, error: errorInfo },
          'Failed to upload to Anthropic Files API for container_upload, skipping'
        );
        return null;
      }

      if (!anthropicFileId) {
        this.logger.warn(
          { attachmentId: record.id },
          'Anthropic Files API upload returned no file ID, skipping'
        );
        return null;
      }
    }

    const contentBlock: AnthropicContainerUploadBlock = {
      type: 'container_upload',
      file_id: anthropicFileId,
    };

    this.logger.debug(
      { attachmentId: record.id, name: record.name, mimeType: record.mime_type, anthropicFileId },
      'Resolved container_upload attachment'
    );

    return {
      id: record.id,
      name: record.name,
      mimeType: record.mime_type,
      buffer: Buffer.alloc(0),
      contentBlock,
      routingCategory: 'container_upload',
    };
  }

  /**
   * Create Anthropic content block using a Files API file reference.
   *
   * Used when the attachment has been pre-uploaded to Anthropic's Files API.
   * This avoids blob download and base64 encoding entirely.
   *
   * @param record - Attachment database record (must have anthropic_file_id)
   * @returns File-reference content block (document or image)
   */
  private createFileReferenceBlock(
    record: ChatAttachmentDbRecord
  ): AnthropicFileDocumentBlock | AnthropicFileImageBlock | null {
    const fileId = record.anthropic_file_id;
    if (!fileId) {
      this.logger.warn({ attachmentId: record.id }, 'Missing anthropic_file_id in createFileReferenceBlock');
      return null;
    }

    if (isImageMimeType(record.mime_type)) {
      return {
        type: 'image',
        source: {
          type: 'file',
          file_id: fileId,
        },
      };
    }

    return {
      type: 'document',
      source: {
        type: 'file',
        file_id: fileId,
      },
    };
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
