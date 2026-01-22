/**
 * FileProcessingWorker
 *
 * Extracts text from uploaded documents using appropriate processors.
 * Integrated with ProcessingRetryManager for robust retry handling.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { FileProcessingJob } from '../types';

/**
 * Dependencies for FileProcessingWorker
 */
export interface FileProcessingWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * FileProcessingWorker
 */
export class FileProcessingWorker {
  private static instance: FileProcessingWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: FileProcessingWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileProcessingWorker' });
  }

  public static getInstance(deps?: FileProcessingWorkerDependencies): FileProcessingWorker {
    if (!FileProcessingWorker.instance) {
      FileProcessingWorker.instance = new FileProcessingWorker(deps);
    }
    return FileProcessingWorker.instance;
  }

  public static resetInstance(): void {
    FileProcessingWorker.instance = null;
  }

  /**
   * Process file processing job
   */
  async process(job: Job<FileProcessingJob>): Promise<void> {
    const jobData = job.data;
    const fileId = jobData?.fileId;
    const userId = jobData?.userId;
    const sessionId = jobData?.sessionId;
    const mimeType = jobData?.mimeType;
    const fileName = jobData?.fileName;

    // Immediate logging for debugging
    this.log.info('File processing job received by worker', {
      jobId: job.id,
      fileId,
      userId,
      mimeType,
      fileName,
      attemptsMade: job.attemptsMade,
      hasJobData: !!jobData,
    });

    // Validate required fields
    if (!fileId || !userId) {
      this.log.error('Invalid job data - missing required fields', {
        jobId: job.id,
        hasFileId: !!fileId,
        hasUserId: !!userId,
        hasJobData: !!jobData,
        jobDataKeys: jobData ? Object.keys(jobData) : [],
      });
      throw new Error(`Invalid job data: fileId=${fileId}, userId=${userId}`);
    }

    try {
      // Dynamic import to avoid circular dependencies
      this.log.debug('Importing FileProcessingService...', { fileId, jobId: job.id });
      const { getFileProcessingService } = await import('@/services/files/FileProcessingService');

      this.log.debug('Getting FileProcessingService singleton...', { fileId, jobId: job.id });
      const fileProcessingService = getFileProcessingService();

      this.log.debug('Calling FileProcessingService.processFile()...', { fileId, jobId: job.id });
      await fileProcessingService.processFile(job.data);

      this.log.info('File processing completed', {
        jobId: job.id,
        fileId,
        userId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log.error('File processing job failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        fileId,
        userId,
        mimeType,
        attemptNumber: job.attemptsMade,
      });

      // Use ProcessingRetryManager for retry decision
      try {
        const { getProcessingRetryManager } = await import('@/domains/files/retry');
        const retryManager = getProcessingRetryManager();

        const decision = await retryManager.shouldRetry(userId, fileId, 'processing');

        this.log.info('Retry decision for file processing', {
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
        this.log.warn('File processing permanently failed after max retries', {
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
        this.log.error('Failed to process retry decision', {
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
 * Get FileProcessingWorker singleton
 */
export function getFileProcessingWorker(deps?: FileProcessingWorkerDependencies): FileProcessingWorker {
  return FileProcessingWorker.getInstance(deps);
}

/**
 * Reset FileProcessingWorker singleton (for testing)
 */
export function __resetFileProcessingWorker(): void {
  FileProcessingWorker.resetInstance();
}
