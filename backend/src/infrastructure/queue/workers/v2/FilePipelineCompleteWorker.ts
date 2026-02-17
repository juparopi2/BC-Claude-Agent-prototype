/**
 * FilePipelineCompleteWorker (PRD-04)
 *
 * Final stage of the V2 pipeline. Runs AFTER all other stages complete
 * (BullMQ Flow parent behavior).
 *
 * Pipeline: extract → chunk → embed → [pipeline-complete]
 *
 * Responsibilities:
 * - Increment processed_count on the upload_batches table
 * - Emit batch progress WebSocket events
 * - Detect batch completion (all files processed)
 *
 * @module infrastructure/queue/workers/v2
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { PipelineStatus } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FilePipelineCompleteWorker' });

/** Job data for V2 pipeline-complete stage */
export interface V2PipelineCompleteJobData {
  fileId: string;
  batchId: string;
  userId: string;
}

export interface FilePipelineCompleteWorkerDependencies {
  logger?: ILoggerMinimal;
}

export class FilePipelineCompleteWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FilePipelineCompleteWorkerDependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<V2PipelineCompleteJobData>): Promise<void> {
    const { fileId, batchId, userId } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'pipeline-complete',
    });

    jobLogger.info('V2 pipeline-complete worker started');

    try {
      // 1. Read file's final pipeline_status
      const { getFileRepositoryV2 } = await import(
        '@/services/files/repository/FileRepositoryV2'
      );
      const repo = getFileRepositoryV2();
      const finalStatus = await repo.getPipelineStatus(fileId, userId);

      jobLogger.info({ finalStatus }, 'File final status');

      // 2. Increment processed_count on upload_batches
      const { prisma } = await import('@/infrastructure/database/prisma');
      await prisma.$executeRaw`
        UPDATE upload_batches
        SET processed_count = processed_count + 1,
            updated_at = GETUTCDATE()
        WHERE id = ${batchId}
          AND user_id = ${userId}
      `;

      // 3. Read batch progress
      const batch = await prisma.upload_batches.findFirst({
        where: { id: batchId, user_id: userId },
        select: { total_files: true, confirmed_count: true, processed_count: true },
      });

      const totalFiles = batch?.total_files ?? 0;
      const processedCount = batch?.processed_count ?? 0;
      const isComplete = processedCount >= totalFiles;

      jobLogger.info(
        { totalFiles, processedCount, isComplete },
        'Batch progress updated',
      );

      // 4. Emit WebSocket events (fire-and-forget)
      this.emitBatchEvents(
        fileId, batchId, userId,
        finalStatus ?? PIPELINE_STATUS.FAILED,
        totalFiles, processedCount, isComplete,
      );

      jobLogger.info('V2 pipeline-complete finished');
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };

      jobLogger.error(
        { error: errorInfo },
        'Pipeline-complete worker failed',
      );

      throw error;
    }
  }

  private emitBatchEvents(
    fileId: string,
    batchId: string,
    userId: string,
    finalStatus: PipelineStatus,
    totalFiles: number,
    processedCount: number,
    isComplete: boolean,
  ): void {
    // Batch events are emitted via the SocketIO infrastructure
    // For now, log the events. Full WebSocket integration in PRD-06.
    this.log.info(
      {
        event: 'batch:file-processed',
        fileId, batchId, userId,
        finalStatus,
        batchProgress: { total: totalFiles, processed: processedCount, isComplete },
      },
      'Batch file processed event',
    );

    if (isComplete) {
      this.log.info(
        { event: 'batch:completed', batchId, userId, totalFiles },
        'Batch completed event',
      );
    }
  }
}

/** Factory function */
export function getFilePipelineCompleteWorker(
  deps?: FilePipelineCompleteWorkerDependencies,
): FilePipelineCompleteWorker {
  return new FilePipelineCompleteWorker(deps);
}
