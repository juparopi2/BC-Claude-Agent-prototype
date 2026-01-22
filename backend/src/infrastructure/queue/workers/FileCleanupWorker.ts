/**
 * FileCleanupWorker
 *
 * Cleans up old failed files, orphaned chunks, and orphaned search documents.
 * Runs as scheduled background job.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { FileCleanupJob } from '../types';

/**
 * Dependencies for FileCleanupWorker
 */
export interface FileCleanupWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * FileCleanupWorker
 */
export class FileCleanupWorker {
  private static instance: FileCleanupWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: FileCleanupWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileCleanupWorker' });
  }

  public static getInstance(deps?: FileCleanupWorkerDependencies): FileCleanupWorker {
    if (!FileCleanupWorker.instance) {
      FileCleanupWorker.instance = new FileCleanupWorker(deps);
    }
    return FileCleanupWorker.instance;
  }

  public static resetInstance(): void {
    FileCleanupWorker.instance = null;
  }

  /**
   * Process file cleanup job
   */
  async process(job: Job<FileCleanupJob>): Promise<void> {
    const {
      type,
      userId,
      failedFileRetentionDays = 30,
      orphanedChunkRetentionDays = 7,
    } = job.data;

    this.log.info('Processing file cleanup job', {
      jobId: job.id,
      type,
      userId: userId || 'all-users',
      failedFileRetentionDays,
      orphanedChunkRetentionDays,
      attemptNumber: job.attemptsMade,
    });

    try {
      // Dynamic import to avoid circular dependencies
      const { getPartialDataCleaner } = await import('@/domains/files/cleanup');
      const cleaner = getPartialDataCleaner();

      switch (type) {
        case 'failed_files': {
          const result = await cleaner.cleanupOldFailedFiles(failedFileRetentionDays);
          this.log.info('Failed files cleanup completed', {
            jobId: job.id,
            filesProcessed: result.filesProcessed,
            chunksDeleted: result.totalChunksDeleted,
            searchDocsDeleted: result.totalSearchDocsDeleted,
            failures: result.failures.length,
          });
          break;
        }
        case 'orphaned_chunks': {
          const count = await cleaner.cleanupOrphanedChunks(orphanedChunkRetentionDays);
          this.log.info('Orphaned chunks cleanup completed', {
            jobId: job.id,
            chunksDeleted: count,
          });
          break;
        }
        case 'orphaned_search_docs': {
          const count = await cleaner.cleanupOrphanedSearchDocs();
          this.log.info('Orphaned search docs cleanup completed', {
            jobId: job.id,
            searchDocsDeleted: count,
          });
          break;
        }
        case 'daily_full': {
          // Run all cleanup tasks sequentially
          this.log.info('Starting daily full cleanup', { jobId: job.id });

          // 1. Clean old failed files
          const failedResult = await cleaner.cleanupOldFailedFiles(failedFileRetentionDays);

          // 2. Clean orphaned chunks
          const chunksDeleted = await cleaner.cleanupOrphanedChunks(orphanedChunkRetentionDays);

          // 3. Clean orphaned search documents
          const searchDocsDeleted = await cleaner.cleanupOrphanedSearchDocs();

          this.log.info('Daily full cleanup completed', {
            jobId: job.id,
            failedFilesProcessed: failedResult.filesProcessed,
            failedFilesChunksDeleted: failedResult.totalChunksDeleted,
            failedFilesSearchDocsDeleted: failedResult.totalSearchDocsDeleted,
            orphanedChunksDeleted: chunksDeleted,
            orphanedSearchDocsDeleted: searchDocsDeleted,
          });
          break;
        }
        default:
          this.log.error('Unknown cleanup job type', { jobId: job.id, type });
          throw new Error(`Unknown cleanup job type: ${type}`);
      }
    } catch (error) {
      this.log.error('File cleanup job failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        type,
        userId,
        attemptNumber: job.attemptsMade,
      });
      throw error; // Will trigger retry
    }
  }
}

/**
 * Get FileCleanupWorker singleton
 */
export function getFileCleanupWorker(deps?: FileCleanupWorkerDependencies): FileCleanupWorker {
  return FileCleanupWorker.getInstance(deps);
}

/**
 * Reset FileCleanupWorker singleton (for testing)
 */
export function __resetFileCleanupWorker(): void {
  FileCleanupWorker.resetInstance();
}
