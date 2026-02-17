/**
 * FileExtractWorkerV2 (PRD-04)
 *
 * V2 text extraction worker using BullMQ Flows for guaranteed sequencing.
 * Replaces fire-and-forget chain with atomic CAS state transitions.
 *
 * Pipeline: [extract] → chunk → embed → pipeline-complete
 *
 * @module infrastructure/queue/workers/v2
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileExtractWorkerV2' });

/** Job data for V2 extract stage */
export interface V2ExtractJobData {
  fileId: string;
  batchId: string;
  userId: string;
  mimeType: string;
  blobPath: string;
  fileName: string;
}

export interface FileExtractWorkerV2Dependencies {
  logger?: ILoggerMinimal;
}

export class FileExtractWorkerV2 {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileExtractWorkerV2Dependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<V2ExtractJobData>): Promise<void> {
    const { fileId, batchId, userId, mimeType, blobPath, fileName } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'extract',
    });

    jobLogger.info({ mimeType, fileName }, 'V2 extract worker started');

    // 1. CAS transition: queued → extracting
    const { getFileRepositoryV2 } = await import(
      '@/services/files/repository/FileRepositoryV2'
    );
    const repo = getFileRepositoryV2();

    const claimResult = await repo.transitionStatus(
      fileId, userId,
      PIPELINE_STATUS.QUEUED,
      PIPELINE_STATUS.EXTRACTING,
    );

    if (!claimResult.success) {
      jobLogger.warn(
        { error: claimResult.error, previousStatus: claimResult.previousStatus },
        'Failed to claim file for extraction — skipping',
      );
      return; // Another worker or retry already claimed it
    }

    try {
      // 2. Delegate to existing FileProcessingService (skip V1 enqueue)
      const { getFileProcessingService } = await import(
        '@/services/files/FileProcessingService'
      );
      const service = getFileProcessingService();

      await service.processFile(
        { fileId, userId, mimeType, blobPath, fileName },
        { skipNextStageEnqueue: true },
      );

      // 3. CAS transition: extracting → chunking
      const advanceResult = await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.EXTRACTING,
        PIPELINE_STATUS.CHUNKING,
      );

      if (!advanceResult.success) {
        jobLogger.error(
          { error: advanceResult.error },
          'Failed to advance to chunking state after successful extraction',
        );
        throw new Error(`State advance failed: ${advanceResult.error}`);
      }

      // 4. Dual-write: legacy processing_status is already updated by FileProcessingService
      // (it calls updateStatus → FileService.updateProcessingStatus → sets processing_status='completed')

      jobLogger.info('V2 extract completed successfully');
    } catch (error) {
      // Transition to failed state
      await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.EXTRACTING,
        PIPELINE_STATUS.FAILED,
      ).catch((transErr) => {
        jobLogger.error(
          { error: transErr instanceof Error ? transErr.message : String(transErr) },
          'Failed to transition to FAILED state',
        );
      });

      // Add to DLQ
      await this.addToDLQ(job.data, error, job.attemptsMade).catch((dlqErr) => {
        jobLogger.error(
          { error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr) },
          'Failed to add to DLQ',
        );
      });

      throw error; // Re-throw for BullMQ retry
    }
  }

  private async addToDLQ(
    data: V2ExtractJobData,
    error: unknown,
    attempts: number,
  ): Promise<void> {
    // Add to DLQ via DLQService
    const { getDLQService } = await import('@/services/queue/DLQService');
    const dlqService = getDLQService();

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    await dlqService.addToDeadLetter({
      fileId: data.fileId,
      batchId: data.batchId,
      userId: data.userId,
      stage: 'extract',
      error: errorMessage,
      stack: errorStack,
      attempts,
    }).catch((dlqErr) => {
      this.log.error(
        { error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr) },
        'Failed to add entry to DLQ',
      );
    });

    this.log.warn(
      { fileId: data.fileId, stage: 'extract', attempts },
      'File extraction permanently failed — DLQ entry pending',
    );
  }
}

/** Factory function */
export function getFileExtractWorkerV2(deps?: FileExtractWorkerV2Dependencies): FileExtractWorkerV2 {
  return new FileExtractWorkerV2(deps);
}
