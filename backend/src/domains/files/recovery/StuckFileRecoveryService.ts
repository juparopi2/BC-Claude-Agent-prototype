/**
 * StuckFileRecoveryService (PRD-05)
 *
 * Detects files stuck in non-terminal pipeline states and either
 * re-enqueues them (if retries remain) or marks them as permanently failed.
 *
 * Called by the MaintenanceWorker on a 15-minute schedule.
 *
 * @module domains/files/recovery
 */

import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { PipelineStatus, StuckFileRecoveryMetrics } from '@bc-agent/shared';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

const DEFAULT_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_RETRIES = 3;

export interface StuckFileRecoveryDeps {
  logger?: ILoggerMinimal;
}

export class StuckFileRecoveryService {
  private readonly log: ILoggerMinimal;

  constructor(deps?: StuckFileRecoveryDeps) {
    this.log = deps?.logger ?? createChildLogger({ service: 'StuckFileRecoveryService' });
  }

  /**
   * Detect and recover stuck files.
   *
   * Files are "stuck" when they remain in a non-terminal processing state
   * (queued, extracting, chunking, embedding) beyond the configured threshold.
   *
   * - Files with `pipeline_retry_count < maxRetries` are re-enqueued via V2 Flow.
   * - Files exceeding max retries are permanently failed.
   */
  async run(
    thresholdMs: number = DEFAULT_THRESHOLD_MS,
    maxRetries: number = DEFAULT_MAX_RETRIES,
  ): Promise<StuckFileRecoveryMetrics> {
    const metrics: StuckFileRecoveryMetrics = {
      totalStuck: 0,
      reEnqueued: 0,
      permanentlyFailed: 0,
      byStatus: {},
    };

    try {
      const { getFileRepositoryV2 } = await import(
        '@/services/files/repository/FileRepositoryV2'
      );
      const repo = getFileRepositoryV2();

      const stuckFiles = await repo.findStuckFiles(thresholdMs);
      metrics.totalStuck = stuckFiles.length;

      if (stuckFiles.length === 0) {
        this.log.debug('No stuck files found');
        return metrics;
      }

      this.log.info({ count: stuckFiles.length, thresholdMs }, 'Stuck files detected');

      for (const file of stuckFiles) {
        const status = file.pipeline_status;
        metrics.byStatus[status] = (metrics.byStatus[status] ?? 0) + 1;

        if (file.pipeline_retry_count >= maxRetries) {
          // Permanently fail
          await this.failFile(repo, file);
          metrics.permanentlyFailed++;
        } else {
          // Re-enqueue
          const ok = await this.recoverFile(repo, file);
          if (ok) {
            metrics.reEnqueued++;
          } else {
            metrics.permanentlyFailed++;
          }
        }
      }

      this.log.info({ metrics }, 'Stuck file recovery completed');
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo }, 'Stuck file recovery failed');
    }

    return metrics;
  }

  /**
   * Re-enqueue a stuck file by transitioning it to queued and creating a new V2 Flow.
   */
  private async recoverFile(
    repo: {
      transitionStatusWithRetry: (
        fileId: string,
        userId: string,
        from: PipelineStatus,
        to: PipelineStatus,
        retryIncrement?: number,
      ) => Promise<{ success: boolean }>;
    },
    file: { id: string; user_id: string; name: string; pipeline_status: string; pipeline_retry_count: number },
  ): Promise<boolean> {
    try {
      // Transition to failed first (required step since direct → queued from processing states is not allowed)
      const failResult = await repo.transitionStatusWithRetry(
        file.id, file.user_id,
        file.pipeline_status as PipelineStatus,
        PIPELINE_STATUS.FAILED,
        0, // No retry increment for the intermediate step
      );

      if (!failResult.success) {
        this.log.warn({ fileId: file.id, status: file.pipeline_status }, 'Cannot transition stuck file to failed');
        return false;
      }

      // Now transition failed → queued with retry increment
      const queueResult = await repo.transitionStatusWithRetry(
        file.id, file.user_id,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
        1,
      );

      if (!queueResult.success) {
        this.log.warn({ fileId: file.id }, 'Cannot transition stuck file to queued');
        return false;
      }

      // Create new V2 Flow
      const { prisma } = await import('@/infrastructure/database/prisma');
      const fileDetails = await prisma.files.findFirst({
        where: { id: file.id, user_id: file.user_id },
        select: { mime_type: true, blob_path: true, batch_id: true },
      });

      if (!fileDetails) {
        this.log.warn({ fileId: file.id }, 'File not found for re-enqueue');
        return false;
      }

      const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
      const mq = getMessageQueue();
      await mq.addFileProcessingFlow({
        fileId: file.id,
        userId: file.user_id,
        batchId: (fileDetails.batch_id ?? '').toUpperCase(),
        mimeType: fileDetails.mime_type,
        blobPath: fileDetails.blob_path,
        fileName: file.name,
      });

      this.log.info(
        { fileId: file.id, retryCount: file.pipeline_retry_count + 1 },
        'Stuck file re-enqueued',
      );
      return true;
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo, fileId: file.id }, 'Failed to recover stuck file');
      return false;
    }
  }

  /**
   * Mark a file as permanently failed (max retries exceeded).
   */
  private async failFile(
    repo: { forceStatus: (fileId: string, userId: string, status: PipelineStatus) => Promise<{ success: boolean }> },
    file: { id: string; user_id: string; pipeline_retry_count: number },
  ): Promise<void> {
    try {
      await repo.forceStatus(file.id, file.user_id, PIPELINE_STATUS.FAILED);
      this.log.warn(
        { fileId: file.id, retryCount: file.pipeline_retry_count },
        'Stuck file permanently failed (max retries exceeded)',
      );
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo, fileId: file.id }, 'Failed to mark stuck file as failed');
    }
  }
}

// Singleton
let instance: StuckFileRecoveryService | undefined;

export function getStuckFileRecoveryService(deps?: StuckFileRecoveryDeps): StuckFileRecoveryService {
  if (!instance) {
    instance = new StuckFileRecoveryService(deps);
  }
  return instance;
}

export function __resetStuckFileRecoveryService(): void {
  instance = undefined;
}
