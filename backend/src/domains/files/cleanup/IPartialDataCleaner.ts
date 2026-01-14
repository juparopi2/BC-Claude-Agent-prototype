/**
 * Partial Data Cleaner Interface
 *
 * Cleans up orphaned data when file processing fails permanently.
 * Single Responsibility: Only cleanup operations.
 *
 * @module domains/files/cleanup
 */

import type { CleanupResult, BatchCleanupResult } from '@bc-agent/shared';

/**
 * Options for cleanup operations
 */
export interface CleanupOptions {
  /** If true, only report what would be deleted without actually deleting */
  dryRun?: boolean;
}

/**
 * Partial Data Cleaner Interface
 *
 * Cleans up orphaned data when file processing fails permanently.
 * Uses VectorSearchService for AI Search operations and SQL for chunk cleanup.
 */
export interface IPartialDataCleaner {
  /**
   * Clean up partial data for a single file.
   *
   * Called after max retries exceeded.
   * Removes chunks from DB and search documents from Azure AI Search.
   *
   * @param userId - User ID for multi-tenant isolation
   * @param fileId - File ID
   * @param options - Cleanup options (e.g., dryRun)
   * @returns Cleanup statistics
   */
  cleanupForFile(
    userId: string,
    fileId: string,
    options?: CleanupOptions
  ): Promise<CleanupResult>;

  /**
   * Clean up orphaned chunks (chunks without parent file).
   *
   * Used by scheduled cleanup job.
   *
   * @param olderThanDays - Only clean chunks older than N days
   * @param options - Cleanup options
   * @returns Number of chunks deleted
   */
  cleanupOrphanedChunks(
    olderThanDays?: number,
    options?: CleanupOptions
  ): Promise<number>;

  /**
   * Clean up orphaned search documents.
   *
   * Removes search documents whose parent chunk no longer exists.
   * Delegates to OrphanCleanupJob for actual AI Search cleanup.
   *
   * @returns Number of documents deleted
   */
  cleanupOrphanedSearchDocs(): Promise<number>;

  /**
   * Batch cleanup for files that have been failed for > N days.
   *
   * Used by scheduled cleanup job to clean up old failures.
   *
   * @param olderThanDays - Clean files failed more than N days ago
   * @param options - Cleanup options
   * @returns Batch cleanup statistics
   */
  cleanupOldFailedFiles(
    olderThanDays: number,
    options?: CleanupOptions
  ): Promise<BatchCleanupResult>;
}
