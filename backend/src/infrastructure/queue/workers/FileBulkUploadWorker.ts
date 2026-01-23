/**
 * FileBulkUploadWorker
 *
 * Processes bulk upload jobs by delegating to BulkUploadProcessor.
 * Creates database records for files uploaded via SAS URL.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { BulkUploadJobData } from '@bc-agent/shared';

/**
 * Dependencies for FileBulkUploadWorker
 */
export interface FileBulkUploadWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * FileBulkUploadWorker
 */
export class FileBulkUploadWorker {
  private static instance: FileBulkUploadWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: FileBulkUploadWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileBulkUploadWorker' });
  }

  public static getInstance(deps?: FileBulkUploadWorkerDependencies): FileBulkUploadWorker {
    if (!FileBulkUploadWorker.instance) {
      FileBulkUploadWorker.instance = new FileBulkUploadWorker(deps);
    }
    return FileBulkUploadWorker.instance;
  }

  public static resetInstance(): void {
    FileBulkUploadWorker.instance = null;
  }

  /**
   * Process bulk upload job
   *
   * Delegates to BulkUploadProcessor domain module.
   */
  async process(job: Job<BulkUploadJobData>): Promise<void> {
    const { tempId, userId, batchId, fileName, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId,
      tempId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
      batchId,
      fileName,
    });

    jobLogger.info('Processing bulk upload job', {
      attemptNumber: job.attemptsMade,
    });

    // Dynamic import to avoid circular dependencies
    const { getBulkUploadProcessor } = await import('@/domains/files/bulk-upload');
    const processor = getBulkUploadProcessor();

    // Delegate to domain processor (throws on failure for BullMQ retry)
    await processor.processJob(job.data);
  }
}

/**
 * Get FileBulkUploadWorker singleton
 */
export function getFileBulkUploadWorker(deps?: FileBulkUploadWorkerDependencies): FileBulkUploadWorker {
  return FileBulkUploadWorker.getInstance(deps);
}

/**
 * Reset FileBulkUploadWorker singleton (for testing)
 */
export function __resetFileBulkUploadWorker(): void {
  FileBulkUploadWorker.resetInstance();
}
