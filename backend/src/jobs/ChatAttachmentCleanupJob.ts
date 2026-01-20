/**
 * Chat Attachment Cleanup Job
 *
 * Manages lifecycle of ephemeral chat attachments:
 * 1. Mark expired attachments as deleted (soft delete)
 * 2. Delete blobs for attachments past grace period
 * 3. Hard delete database records past grace period
 *
 * Run modes:
 * - Scheduled: Run every hour to cleanup expired attachments
 * - Manual: Trigger one-time cleanup for testing/maintenance
 *
 * Configuration:
 * - Default TTL: 24 hours
 * - Grace period after soft delete: 24 hours
 * - Cleanup interval: 1 hour
 *
 * Usage:
 * ```typescript
 * const job = getChatAttachmentCleanupJob();
 *
 * // Run full cleanup
 * const summary = await job.runCleanup();
 *
 * // Mark expired only (no blob/hard deletion)
 * await job.markExpiredAttachments();
 * ```
 *
 * @module jobs/ChatAttachmentCleanupJob
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getChatAttachmentService, type IChatAttachmentService } from '@/domains/chat-attachments';
import { getFileUploadService } from '@/services/files/FileUploadService';

/**
 * Result of a cleanup run
 */
export interface CleanupResult {
  /** Attachments marked as expired (soft deleted) */
  markedExpired: number;
  /** Blobs successfully deleted */
  blobsDeleted: number;
  /** Blobs failed to delete */
  blobsFailed: number;
  /** Records hard deleted from database */
  recordsHardDeleted: number;
  /** Errors encountered during cleanup */
  errors: string[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Default batch size for cleanup operations
 */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Dependencies for ChatAttachmentCleanupJob (for testing)
 */
export interface ChatAttachmentCleanupJobDependencies {
  chatAttachmentService?: IChatAttachmentService;
  fileUploadService?: { deleteFromBlob: (blobPath: string) => Promise<void> };
  batchSize?: number;
}

/**
 * Job to cleanup expired ephemeral chat attachments
 */
export class ChatAttachmentCleanupJob {
  private chatAttachmentService: IChatAttachmentService;
  private fileUploadService: { deleteFromBlob: (blobPath: string) => Promise<void> };
  private batchSize: number;
  private log = createChildLogger({ service: 'ChatAttachmentCleanupJob' });

  constructor(deps?: ChatAttachmentCleanupJobDependencies) {
    this.chatAttachmentService = deps?.chatAttachmentService ?? getChatAttachmentService();
    this.fileUploadService = deps?.fileUploadService ?? getFileUploadService();
    this.batchSize = deps?.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Run full cleanup process
   *
   * Steps:
   * 1. Mark all expired attachments as deleted (soft delete)
   * 2. Get all attachments past grace period
   * 3. Delete their blobs from storage
   * 4. Hard delete records from database
   *
   * @returns Cleanup result with statistics
   */
  async runCleanup(): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      markedExpired: 0,
      blobsDeleted: 0,
      blobsFailed: 0,
      recordsHardDeleted: 0,
      errors: [],
      durationMs: 0,
    };

    this.log.info('Starting chat attachment cleanup');

    try {
      // Step 1: Mark expired attachments as deleted
      result.markedExpired = await this.markExpiredAttachments();

      // Step 2: Get attachments past grace period (for blob deletion + hard delete)
      // The grace period logic is built into getDeletedAttachments()
      const attachmentsToDelete = await this.chatAttachmentService.getDeletedAttachments(
        this.batchSize
      );

      if (attachmentsToDelete.length === 0) {
        this.log.info({ markedExpired: result.markedExpired }, 'No attachments past grace period');
        result.durationMs = Date.now() - startTime;
        return result;
      }

      this.log.info(
        { count: attachmentsToDelete.length },
        'Found attachments past grace period for deletion'
      );

      // Step 3: Delete blobs
      const blobPathsToDelete: string[] = [];
      for (const attachment of attachmentsToDelete) {
        try {
          await this.fileUploadService.deleteFromBlob(attachment.blobPath);
          result.blobsDeleted++;
          blobPathsToDelete.push(attachment.blobPath);
          this.log.debug({ blobPath: attachment.blobPath }, 'Deleted blob');
        } catch (error) {
          result.blobsFailed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to delete blob ${attachment.blobPath}: ${errorMsg}`);
          this.log.warn(
            { blobPath: attachment.blobPath, error: errorMsg },
            'Failed to delete blob'
          );
          // Continue with other deletions - don't fail the whole batch
        }
      }

      // Step 4: Hard delete records (only for successfully deleted blobs or all if needed)
      const idsToHardDelete = attachmentsToDelete.map((a) => a.id);
      if (idsToHardDelete.length > 0) {
        result.recordsHardDeleted = await this.chatAttachmentService.hardDeleteAttachments(
          idsToHardDelete
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);
      this.log.error({ error: errorMsg }, 'Cleanup job failed');
    }

    result.durationMs = Date.now() - startTime;

    this.log.info(
      {
        markedExpired: result.markedExpired,
        blobsDeleted: result.blobsDeleted,
        blobsFailed: result.blobsFailed,
        recordsHardDeleted: result.recordsHardDeleted,
        errors: result.errors.length,
        durationMs: result.durationMs,
      },
      'Chat attachment cleanup completed'
    );

    return result;
  }

  /**
   * Mark expired attachments as deleted (soft delete)
   *
   * This can be called separately for more frequent soft-deletes
   * without running the full cleanup process.
   *
   * @returns Number of attachments marked as deleted
   */
  async markExpiredAttachments(): Promise<number> {
    try {
      const marked = await this.chatAttachmentService.markExpiredForDeletion();
      this.log.info({ count: marked }, 'Marked expired attachments for deletion');
      return marked;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error({ error: errorMsg }, 'Failed to mark expired attachments');
      throw error;
    }
  }
}

// Singleton instance
let instance: ChatAttachmentCleanupJob | null = null;

/**
 * Get the singleton ChatAttachmentCleanupJob instance
 */
export function getChatAttachmentCleanupJob(): ChatAttachmentCleanupJob {
  if (!instance) {
    instance = new ChatAttachmentCleanupJob();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetChatAttachmentCleanupJob(): void {
  instance = null;
}
