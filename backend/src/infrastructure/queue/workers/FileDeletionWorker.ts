/**
 * FileDeletionWorker
 *
 * Processes file deletion jobs by delegating to FileDeletionProcessor.
 * Sequential processing (concurrency=1) to avoid SQL deadlocks.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import type { FileDeletionJobData } from '@bc-agent/shared';

/**
 * Dependencies for FileDeletionWorker
 */
export interface FileDeletionWorkerDependencies {
  logger?: ILoggerMinimal;
}

/**
 * FileDeletionWorker
 */
export class FileDeletionWorker {
  private static instance: FileDeletionWorker | null = null;

  private readonly log: ILoggerMinimal;

  constructor(deps?: FileDeletionWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'FileDeletionWorker' });
  }

  public static getInstance(deps?: FileDeletionWorkerDependencies): FileDeletionWorker {
    if (!FileDeletionWorker.instance) {
      FileDeletionWorker.instance = new FileDeletionWorker(deps);
    }
    return FileDeletionWorker.instance;
  }

  public static resetInstance(): void {
    FileDeletionWorker.instance = null;
  }

  /**
   * Process file deletion job
   *
   * Delegates to FileDeletionProcessor domain module.
   */
  async process(job: Job<FileDeletionJobData>): Promise<void> {
    this.log.info('Processing file deletion job', {
      jobId: job.id,
      fileId: job.data.fileId,
      userId: job.data.userId,
      batchId: job.data.batchId,
      deletionReason: job.data.deletionReason,
      attemptNumber: job.attemptsMade,
    });

    // Dynamic import to avoid circular dependencies
    const { getFileDeletionProcessor } = await import('@/domains/files/deletion');
    const processor = getFileDeletionProcessor();

    // Delegate to domain processor (throws on failure for BullMQ retry)
    await processor.processJob(job.data);
  }
}

/**
 * Get FileDeletionWorker singleton
 */
export function getFileDeletionWorker(deps?: FileDeletionWorkerDependencies): FileDeletionWorker {
  return FileDeletionWorker.getInstance(deps);
}

/**
 * Reset FileDeletionWorker singleton (for testing)
 */
export function __resetFileDeletionWorker(): void {
  FileDeletionWorker.resetInstance();
}
