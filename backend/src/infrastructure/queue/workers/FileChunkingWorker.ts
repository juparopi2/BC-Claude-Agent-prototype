/**
 * FileChunkingWorker
 *
 * Chunks extracted text and prepares for embedding generation.
 * Integrated with ProcessingRetryManager for robust retry handling.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { FileChunkingJob } from '../types';

/**
 * Dependencies for FileChunkingWorker
 */
export interface FileChunkingWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * FileChunkingWorker
 */
export class FileChunkingWorker {
  private static instance: FileChunkingWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: FileChunkingWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileChunkingWorker' });
  }

  public static getInstance(deps?: FileChunkingWorkerDependencies): FileChunkingWorker {
    if (!FileChunkingWorker.instance) {
      FileChunkingWorker.instance = new FileChunkingWorker(deps);
    }
    return FileChunkingWorker.instance;
  }

  public static resetInstance(): void {
    FileChunkingWorker.instance = null;
  }

  /**
   * Process file chunking job
   */
  async process(job: Job<FileChunkingJob>): Promise<void> {
    const { fileId, userId, sessionId, mimeType, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId,
      sessionId,
      fileId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      mimeType,
    });

    // Early exit if file was deleted during queue wait
    // This prevents race conditions where chunking continues after file deletion
    const { getFileRepository } = await import('@/services/files/repository/FileRepository');
    const fileRepository = getFileRepository();
    const isActive = await fileRepository.isFileActiveForProcessing(userId, fileId);
    if (!isActive) {
      jobLogger.info('File deleted or marked for deletion, skipping chunking');
      return; // Graceful exit - job completes successfully
    }

    jobLogger.info('Processing file chunking job', {
      attemptNumber: job.attemptsMade,
    });

    try {
      // Dynamic import to avoid circular dependencies
      const { getFileChunkingService } = await import('@/services/files/FileChunkingService');
      const fileChunkingService = getFileChunkingService();

      await fileChunkingService.processFileChunks(job.data);

      jobLogger.info('File chunking completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      jobLogger.error('File chunking job failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        fileId,
        userId,
        mimeType,
        attemptNumber: job.attemptsMade,
      });

      // Use ProcessingRetryManager for retry decision (chunking is part of processing phase)
      try {
        const { getProcessingRetryManager } = await import('@/domains/files/retry');
        const retryManager = getProcessingRetryManager();

        const decision = await retryManager.shouldRetry(userId, fileId, 'processing');

        jobLogger.info('Retry decision for file chunking', {
          jobId: job.id,
          fileId,
          userId,
          shouldRetry: decision.shouldRetry,
          newRetryCount: decision.newRetryCount,
          maxRetries: decision.maxRetries,
          reason: decision.reason,
        });

        if (decision.shouldRetry) {
          // Throw to trigger BullMQ retry
          throw error;
        }

        // Max retries exceeded - handle permanent failure
        await retryManager.handlePermanentFailure(userId, fileId, errorMessage, sessionId);
        this.log.warn('File chunking permanently failed after max retries', {
          jobId: job.id,
          fileId,
          userId,
          retryCount: decision.newRetryCount,
        });
        // Don't throw - job is complete (permanent failure)
        return;
      } catch (retryError) {
        // If retry decision fails, fall back to throwing original error
        if (retryError === error) {
          throw error;
        }
        this.log.error('Failed to process chunking retry decision', {
          jobId: job.id,
          fileId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        throw error; // Fall back to BullMQ retry
      }
    }
  }
}

/**
 * Get FileChunkingWorker singleton
 */
export function getFileChunkingWorker(deps?: FileChunkingWorkerDependencies): FileChunkingWorker {
  return FileChunkingWorker.getInstance(deps);
}

/**
 * Reset FileChunkingWorker singleton (for testing)
 */
export function __resetFileChunkingWorker(): void {
  FileChunkingWorker.resetInstance();
}
