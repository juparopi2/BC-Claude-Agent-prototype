/**
 * FileChunkWorkerV2 (PRD-04)
 *
 * V2 text chunking worker using BullMQ Flows for guaranteed sequencing.
 *
 * Pipeline: extract → [chunk] → embed → pipeline-complete
 *
 * Note: The extract worker already transitioned the file to 'chunking' state.
 * This worker verifies the state, delegates to FileChunkingService, and
 * transitions to 'embedding'.
 *
 * @module infrastructure/queue/workers/v2
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileChunkWorkerV2' });

/** Job data for V2 chunk stage */
export interface V2ChunkJobData {
  fileId: string;
  batchId: string;
  userId: string;
  mimeType: string;
}

export interface FileChunkWorkerV2Dependencies {
  logger?: ILoggerMinimal;
}

export class FileChunkWorkerV2 {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileChunkWorkerV2Dependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<V2ChunkJobData>): Promise<void> {
    const { fileId, batchId, userId, mimeType } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'chunk',
    });

    jobLogger.info({ mimeType }, 'V2 chunk worker started');

    // 1. Verify file is in 'chunking' state (set by extract worker)
    const { getFileRepositoryV2 } = await import(
      '@/services/files/repository/FileRepositoryV2'
    );
    const repo = getFileRepositoryV2();

    const currentStatus = await repo.getPipelineStatus(fileId, userId);
    if (currentStatus !== PIPELINE_STATUS.CHUNKING) {
      jobLogger.warn(
        { expectedStatus: PIPELINE_STATUS.CHUNKING, actualStatus: currentStatus },
        'File not in expected chunking state — skipping',
      );
      return;
    }

    try {
      // 2. Delegate to existing FileChunkingService (skip V1 enqueue)
      const { getFileChunkingService } = await import(
        '@/services/files/FileChunkingService'
      );
      const service = getFileChunkingService();

      await service.processFileChunks(
        { fileId, userId, mimeType },
        { skipNextStageEnqueue: true },
      );

      // 3. CAS transition: chunking → embedding
      const advanceResult = await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.CHUNKING,
        PIPELINE_STATUS.EMBEDDING,
      );

      if (!advanceResult.success) {
        jobLogger.error(
          { error: advanceResult.error },
          'Failed to advance to embedding state after successful chunking',
        );
        throw new Error(`State advance failed: ${advanceResult.error}`);
      }

      // 4. Dual-write: legacy embedding_status = 'processing'
      // (FileChunkingService already sets embedding_status to 'processing' at start)

      jobLogger.info('V2 chunk completed successfully');
    } catch (error) {
      // Transition to failed state
      await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.CHUNKING,
        PIPELINE_STATUS.FAILED,
      ).catch((transErr) => {
        jobLogger.error(
          { error: transErr instanceof Error ? transErr.message : String(transErr) },
          'Failed to transition to FAILED state',
        );
      });

      this.log.warn(
        { fileId, stage: 'chunk', attempts: job.attemptsMade },
        'File chunking permanently failed — DLQ entry pending',
      );

      throw error; // Re-throw for BullMQ retry
    }
  }
}

/** Factory function */
export function getFileChunkWorkerV2(deps?: FileChunkWorkerV2Dependencies): FileChunkWorkerV2 {
  return new FileChunkWorkerV2(deps);
}
