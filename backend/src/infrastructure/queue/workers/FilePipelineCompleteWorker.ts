/**
 * FilePipelineCompleteWorker (PRD-04)
 *
 * Final stage of the pipeline. Runs AFTER all other stages complete
 * (BullMQ Flow parent behavior).
 *
 * Pipeline: extract → chunk → embed → [pipeline-complete]
 *
 * Responsibilities:
 * - Increment processed_count on the upload_batches table
 * - Emit batch progress WebSocket events
 * - Detect batch completion (all files processed)
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS, SYNC_WS_EVENTS } from '@bc-agent/shared';
import type { PipelineStatus, ProcessingProgressPayload, ProcessingCompletedPayload } from '@bc-agent/shared';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FilePipelineCompleteWorker' });

/** Job data for pipeline-complete stage */
export interface PipelineCompleteJobData {
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

  async process(job: Job<PipelineCompleteJobData>): Promise<void> {
    const { fileId, batchId, userId } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'pipeline-complete',
    });

    jobLogger.info('Pipeline-complete worker started');

    try {
      // 1. Read file's final pipeline_status
      const { getFileRepository } = await import(
        '@/services/files/repository/FileRepository'
      );
      const repo = getFileRepository();
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

      // PRD-117: Scope-aware processing tracking
      const fileRecord = await prisma.files.findFirst({
        where: { id: fileId, user_id: userId },
        select: { connection_scope_id: true },
      });

      if (fileRecord?.connection_scope_id) {
        const scopeId = fileRecord.connection_scope_id;
        const isSuccess = finalStatus === PIPELINE_STATUS.READY;
        const incrementCol = isSuccess ? 'processing_completed' : 'processing_failed';

        await prisma.$executeRawUnsafe(
          `UPDATE connection_scopes SET ${incrementCol} = ${incrementCol} + 1, updated_at = GETUTCDATE() WHERE id = @P1`,
          scopeId
        );

        // Read scope counters to check completion
        const scope = await prisma.connection_scopes.findFirst({
          where: { id: scopeId },
          select: {
            processing_total: true,
            processing_completed: true,
            processing_failed: true,
            connection_id: true,
          },
        });

        if (scope) {
          const totalProcessed = (scope.processing_completed ?? 0) + (scope.processing_failed ?? 0);
          const isAllDone = totalProcessed >= (scope.processing_total ?? 0) && (scope.processing_total ?? 0) > 0;

          // Emit progress event
          this.emitScopeProgress(userId, scopeId, scope);

          if (isAllDone) {
            const processingStatus = (scope.processing_failed ?? 0) > 0 ? 'partial_failure' : 'completed';
            await prisma.connection_scopes.update({
              where: { id: scopeId },
              data: { processing_status: processingStatus, updated_at: new Date() },
            });
            this.emitScopeCompleted(userId, scopeId, scope);
          }
        }
      }

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

      jobLogger.info('Pipeline-complete finished');
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

  /**
   * PRD-117: Emit processing progress for scope-aware tracking.
   */
  private emitScopeProgress(
    userId: string,
    scopeId: string,
    scope: { processing_total: number; processing_completed: number; processing_failed: number; connection_id: string }
  ): void {
    try {
      const { isSocketServiceInitialized, getSocketIO } = require('@/services/websocket/SocketService');
      if (!isSocketServiceInitialized()) return;

      const total = scope.processing_total ?? 0;
      const completed = (scope.processing_completed ?? 0) + (scope.processing_failed ?? 0);

      const payload: ProcessingProgressPayload = {
        connectionId: scope.connection_id,
        scopeId,
        total,
        completed: scope.processing_completed ?? 0,
        failed: scope.processing_failed ?? 0,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      };

      getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.PROCESSING_PROGRESS, payload);
    } catch (err) {
      // Non-fatal: socket may not be available
      this.log.debug({ error: err instanceof Error ? err.message : String(err), userId, scopeId }, 'Failed to emit processing progress');
    }
  }

  /**
   * PRD-117: Emit processing completed for scope-aware tracking.
   */
  private emitScopeCompleted(
    userId: string,
    scopeId: string,
    scope: { processing_total: number; processing_completed: number; processing_failed: number; connection_id: string }
  ): void {
    try {
      const { isSocketServiceInitialized, getSocketIO } = require('@/services/websocket/SocketService');
      if (!isSocketServiceInitialized()) return;

      const payload: ProcessingCompletedPayload = {
        connectionId: scope.connection_id,
        scopeId,
        totalProcessed: (scope.processing_completed ?? 0) + (scope.processing_failed ?? 0),
        totalReady: scope.processing_completed ?? 0,
        totalFailed: scope.processing_failed ?? 0,
      };

      getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.PROCESSING_COMPLETED, payload);
    } catch (err) {
      // Non-fatal: socket may not be available
      this.log.debug({ error: err instanceof Error ? err.message : String(err), userId, scopeId }, 'Failed to emit processing completed');
    }
  }
}

/** Factory function */
export function getFilePipelineCompleteWorker(
  deps?: FilePipelineCompleteWorkerDependencies,
): FilePipelineCompleteWorker {
  return new FilePipelineCompleteWorker(deps);
}
