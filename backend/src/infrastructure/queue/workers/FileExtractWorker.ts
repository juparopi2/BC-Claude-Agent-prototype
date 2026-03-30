/**
 * FileExtractWorker (PRD-04)
 *
 * Text extraction worker using BullMQ Flows for guaranteed sequencing.
 * Replaces fire-and-forget chain with atomic CAS state transitions.
 *
 * Pipeline: [extract] → chunk → embed → pipeline-complete
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileExtractWorker' });

/** Job data for extract stage */
export interface ExtractJobData {
  fileId: string;
  batchId: string;
  userId: string;
  mimeType: string;
  blobPath: string;
  fileName: string;
}

export interface FileExtractWorkerDependencies {
  logger?: ILoggerMinimal;
}

export class FileExtractWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileExtractWorkerDependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<ExtractJobData>): Promise<void> {
    const { fileId, batchId, userId, mimeType, blobPath, fileName } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'extract',
    });

    jobLogger.info({ mimeType, fileName }, 'Extract worker started');

    // Guard: Folders are metadata-only — they should never enter the extract pipeline.
    // This can happen if a folder is mistakenly enqueued (e.g., during reconciliation resync).
    if (mimeType === 'inode/directory') {
      const { prisma } = await import('@/infrastructure/database/prisma');
      await prisma.files.updateMany({
        where: { id: fileId, is_folder: true },
        data: { pipeline_status: 'ready' },
      });
      jobLogger.warn({ fileId }, 'Folder entered extract pipeline — reset to ready, skipping');
      return;
    }

    // 1. CAS transition: queued → extracting
    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

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

    // PRD-305: Emit processing:started on first file in scope (atomic via Redis SETNX)
    await this.tryEmitProcessingStarted(batchId, userId, jobLogger);

    try {
      // 2. Delegate to existing FileProcessingService (skip V1 enqueue)
      const { getFileProcessingService } = await import(
        '@/services/files/FileProcessingService'
      );
      const service = getFileProcessingService();

      await service.processFile(
        { fileId, userId, mimeType, blobPath, fileName },
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

      jobLogger.info('Extract completed successfully');
    } catch (error) {
      // Detect Graph API 404 for external files — soft-delete instead of retry
      const { GraphApiError } = await import(
        '@/services/connectors/onedrive/GraphHttpClient'
      );
      if (error instanceof GraphApiError && error.statusCode === 404) {
        const fileRecord = await repo.findById(userId, fileId);
        const isExternal =
          fileRecord?.sourceType === 'onedrive' ||
          fileRecord?.sourceType === 'sharepoint';

        if (isExternal) {
          jobLogger.warn(
            { fileId, userId, sourceType: fileRecord.sourceType },
            'External file no longer exists (Graph API 404) — soft-deleting',
          );

          const { prisma } = await import('@/infrastructure/database/prisma');

          // Soft-delete — must set BOTH fields per project convention
          await prisma.files.update({
            where: { id: fileId },
            data: { deleted_at: new Date(), deletion_status: 'pending' },
          });

          // Vector cleanup (fire-and-forget, best-effort)
          try {
            const { VectorSearchService } = await import('@/services/search/VectorSearchService');
            await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
          } catch { /* best-effort */ }

          try {
            await prisma.file_chunks.deleteMany({ where: { file_id: fileId } });
          } catch { /* best-effort */ }

          // DO NOT rethrow — BullMQ job completes successfully, no retry
          return;
        }
      }

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

      // Emit failure WebSocket events (permanently_failed + readiness_changed)
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.emitFailureEvents(userId, fileId, errorMessage).catch((emitErr) => {
        jobLogger.error(
          { error: emitErr instanceof Error ? emitErr.message : String(emitErr) },
          'Failed to emit failure WebSocket events',
        );
      });

      throw error; // Re-throw for BullMQ retry
    }
  }

  private async emitFailureEvents(
    userId: string,
    fileId: string,
    errorMessage: string,
  ): Promise<void> {
    const { getProcessingRetryManager } = await import(
      '@/domains/files/retry/ProcessingRetryManager'
    );
    const retryManager = getProcessingRetryManager();
    await retryManager.handlePermanentFailure(userId, fileId, errorMessage);
  }

  /**
   * PRD-305: Emit processing:started when the first file in a scope begins extraction.
   * Uses Redis SETNX for atomicity — only the first worker wins.
   * Non-fatal: progress will still flow via processing:progress events.
   */
  private async tryEmitProcessingStarted(
    batchId: string,
    userId: string,
    jobLogger: ILoggerMinimal,
  ): Promise<void> {
    try {
      const { getRedisClient } = await import('@/infrastructure/redis/redis-client');
      const redis = getRedisClient();
      if (!redis) return;

      const key = `sync:processing_started:${batchId}`;
      const result = await redis.set(key, '1', { EX: 3600, NX: true });

      if (result !== 'OK') return; // Another worker already emitted for this scope

      // Verify batchId is a scope (sync files), not an upload batch
      const { prisma } = await import('@/infrastructure/database/prisma');
      const scope = await prisma.connection_scopes.findFirst({
        where: { id: batchId },
        select: { processing_total: true, connection_id: true },
      });

      if (!scope) return; // batchId is not a scope — skip (upload file)

      const { getSyncProgressEmitter } = await import('@/services/sync/SyncProgressEmitter');
      getSyncProgressEmitter().emitProcessingStarted(userId, {
        connectionId: scope.connection_id,
        scopeId: batchId,
        total: scope.processing_total ?? 0,
      });

      jobLogger.info({ scopeId: batchId }, 'Emitted processing:started for scope');
    } catch (err) {
      // Non-fatal — don't break extraction if the event fails
      const errorInfo = err instanceof Error
        ? { message: err.message, name: err.name }
        : { value: String(err) };
      jobLogger.warn({ error: errorInfo }, 'Failed to emit processing:started (non-fatal)');
    }
  }

  private async addToDLQ(
    data: ExtractJobData,
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
export function getFileExtractWorker(deps?: FileExtractWorkerDependencies): FileExtractWorker {
  return new FileExtractWorker(deps);
}
