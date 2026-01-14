/**
 * PartialDataCleaner
 *
 * Cleans up orphaned data when file processing fails permanently.
 *
 * Design Principles:
 * - Single Responsibility: Only cleanup operations
 * - Multi-tenant isolation: All operations require userId
 * - Eventual consistency: Best-effort cleanup, logs failures
 * - Reuses OrphanCleanupJob for AI Search operations
 *
 * @module domains/files/cleanup
 */

import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery } from '@/infrastructure/database/database';
import { VectorSearchService } from '@services/search/VectorSearchService';
import { getOrphanCleanupJob } from '@/jobs/OrphanCleanupJob';
import type { Logger } from 'pino';
import type { CleanupResult, BatchCleanupResult } from '@bc-agent/shared';
import type { IPartialDataCleaner, CleanupOptions } from './IPartialDataCleaner';
import { getFileProcessingConfig } from '../config';
import type { FileProcessingConfig } from '../config';

/**
 * Dependencies for PartialDataCleaner (DI support for testing)
 */
export interface PartialDataCleanerDependencies {
  config?: FileProcessingConfig;
  logger?: Logger;
  vectorSearchService?: VectorSearchService;
}

/**
 * PartialDataCleaner implementation
 *
 * Cleans up chunks and search documents when file processing fails.
 */
export class PartialDataCleaner implements IPartialDataCleaner {
  private static instance: PartialDataCleaner | null = null;

  private readonly log: Logger;
  private readonly config: FileProcessingConfig;
  private readonly vectorSearchService: VectorSearchService;

  private constructor(deps?: PartialDataCleanerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'PartialDataCleaner' });
    this.config = deps?.config ?? getFileProcessingConfig();
    this.vectorSearchService = deps?.vectorSearchService ?? VectorSearchService.getInstance();

    this.log.info('PartialDataCleaner initialized');
  }

  public static getInstance(deps?: PartialDataCleanerDependencies): PartialDataCleaner {
    if (!PartialDataCleaner.instance) {
      PartialDataCleaner.instance = new PartialDataCleaner(deps);
    }
    return PartialDataCleaner.instance;
  }

  public static resetInstance(): void {
    PartialDataCleaner.instance = null;
  }

  /**
   * Clean up partial data for a single file
   */
  async cleanupForFile(
    userId: string,
    fileId: string,
    options?: CleanupOptions
  ): Promise<CleanupResult> {
    this.log.info({ userId, fileId, dryRun: options?.dryRun }, 'Starting cleanup for file');

    let chunksDeleted = 0;
    let searchDocsDeleted = 0;

    try {
      // 1. Delete chunks from database
      if (!options?.dryRun) {
        const chunkResult = await executeQuery(
          `DELETE FROM file_chunks
           WHERE file_id = @fileId AND user_id = @userId`,
          { fileId, userId }
        );
        chunksDeleted = chunkResult.rowsAffected[0] || 0;
      } else {
        // In dryRun, count what would be deleted
        const countResult = await executeQuery<{ count: number }>(
          `SELECT COUNT(*) as count FROM file_chunks
           WHERE file_id = @fileId AND user_id = @userId`,
          { fileId, userId }
        );
        chunksDeleted = countResult.recordset[0]?.count || 0;
      }

      // 2. Delete search documents from Azure AI Search
      try {
        if (!options?.dryRun) {
          await this.vectorSearchService.deleteChunksForFile(fileId, userId);
          // deleteChunksForFile doesn't return count, estimate from chunksDeleted
          searchDocsDeleted = chunksDeleted;
        } else {
          // In dryRun, estimate from chunks with search_document_id
          const countResult = await executeQuery<{ count: number }>(
            `SELECT COUNT(*) as count FROM file_chunks
             WHERE file_id = @fileId AND search_document_id IS NOT NULL`,
            { fileId }
          );
          searchDocsDeleted = countResult.recordset[0]?.count || 0;
        }
      } catch (searchError) {
        // Log but don't fail - eventual consistency
        this.log.warn(
          {
            error: searchError instanceof Error ? searchError.message : String(searchError),
            userId,
            fileId,
          },
          'Failed to delete search documents (will be cleaned by orphan job)'
        );
      }

      this.log.info(
        {
          userId,
          fileId,
          chunksDeleted,
          searchDocsDeleted,
          dryRun: options?.dryRun,
        },
        'File cleanup completed'
      );

      return {
        fileId,
        chunksDeleted,
        searchDocumentsDeleted: searchDocsDeleted,
        success: true,
        error: undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log.error(
        {
          error: errorMessage,
          userId,
          fileId,
          chunksDeleted,
        },
        'File cleanup failed'
      );

      return {
        fileId,
        chunksDeleted,
        searchDocumentsDeleted: searchDocsDeleted,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Clean up orphaned chunks (chunks without parent file)
   */
  async cleanupOrphanedChunks(
    olderThanDays?: number,
    options?: CleanupOptions
  ): Promise<number> {
    const days = olderThanDays ?? this.config.cleanup.orphanedChunkRetentionDays;

    this.log.info({ olderThanDays: days, dryRun: options?.dryRun }, 'Cleaning up orphaned chunks');

    if (options?.dryRun) {
      // Count orphaned chunks
      const countResult = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM file_chunks fc
         LEFT JOIN files f ON fc.file_id = f.id
         WHERE f.id IS NULL
           AND fc.created_at < DATEADD(day, -@days, GETUTCDATE())`,
        { days }
      );
      return countResult.recordset[0]?.count || 0;
    }

    const result = await executeQuery(
      `DELETE fc FROM file_chunks fc
       LEFT JOIN files f ON fc.file_id = f.id
       WHERE f.id IS NULL
         AND fc.created_at < DATEADD(day, -@days, GETUTCDATE())`,
      { days }
    );

    const deleted = result.rowsAffected[0] || 0;

    this.log.info({ deleted, days }, 'Orphaned chunks cleanup completed');

    return deleted;
  }

  /**
   * Clean up orphaned search documents
   * Delegates to OrphanCleanupJob for actual AI Search cleanup
   */
  async cleanupOrphanedSearchDocs(): Promise<number> {
    this.log.info('Cleaning up orphaned search documents');

    const orphanJob = getOrphanCleanupJob();
    const summary = await orphanJob.runFullCleanup();

    this.log.info(
      {
        totalDeleted: summary.totalDeleted,
        totalFailed: summary.totalFailed,
      },
      'Orphaned search docs cleanup completed'
    );

    return summary.totalDeleted;
  }

  /**
   * Batch cleanup for files that have been failed for > N days
   */
  async cleanupOldFailedFiles(
    olderThanDays: number,
    options?: CleanupOptions
  ): Promise<BatchCleanupResult> {
    this.log.info({ olderThanDays, dryRun: options?.dryRun }, 'Starting cleanup of old failed files');

    // Get files that failed > N days ago
    const result = await executeQuery<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM files
       WHERE failed_at IS NOT NULL
         AND failed_at < DATEADD(day, -@days, GETUTCDATE())`,
      { days: olderThanDays }
    );

    const batchResult: BatchCleanupResult = {
      filesProcessed: 0,
      totalChunksDeleted: 0,
      totalSearchDocsDeleted: 0,
      failures: [],
    };

    for (const file of result.recordset) {
      batchResult.filesProcessed++;

      try {
        const cleanupResult = await this.cleanupForFile(file.user_id, file.id, options);

        batchResult.totalChunksDeleted += cleanupResult.chunksDeleted;
        batchResult.totalSearchDocsDeleted += cleanupResult.searchDocumentsDeleted;

        if (!cleanupResult.success && cleanupResult.error) {
          batchResult.failures.push({
            fileId: file.id,
            error: cleanupResult.error,
          });
        }
      } catch (error) {
        batchResult.failures.push({
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.log.info(batchResult, 'Old failed files cleanup completed');

    return batchResult;
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton PartialDataCleaner instance
 */
export function getPartialDataCleaner(deps?: PartialDataCleanerDependencies): PartialDataCleaner {
  return PartialDataCleaner.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetPartialDataCleaner(): void {
  PartialDataCleaner.resetInstance();
}
