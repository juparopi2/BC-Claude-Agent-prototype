/**
 * FileChunkWorker (PRD-04)
 *
 * Text chunking worker using BullMQ Flows for guaranteed sequencing.
 *
 * Pipeline: extract → [chunk] → embed → pipeline-complete
 *
 * Note: The extract worker already transitioned the file to 'chunking' state.
 * This worker verifies the state, delegates to FileChunkingService, and
 * transitions to 'embedding'.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileChunkWorker' });

/** Job data for chunk stage */
export interface ChunkJobData {
  fileId: string;
  batchId: string;
  userId: string;
  mimeType: string;
}

export interface FileChunkWorkerDependencies {
  logger?: ILoggerMinimal;
}

export class FileChunkWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileChunkWorkerDependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<ChunkJobData>): Promise<void> {
    const { fileId, batchId, userId, mimeType } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'chunk',
    });

    jobLogger.info({ mimeType }, 'Chunk worker started');

    // 1. Verify file is in 'chunking' state (set by extract worker)
    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

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

      jobLogger.info('Chunk completed successfully');
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
export function getFileChunkWorker(deps?: FileChunkWorkerDependencies): FileChunkWorker {
  return new FileChunkWorker(deps);
}
