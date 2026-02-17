/**
 * BatchTimeoutService (PRD-05)
 *
 * Expires active upload batches that have exceeded their timeout.
 * Unconfirmed files (pipeline_status = 'registered') are deleted.
 * Files already in processing are preserved.
 *
 * Called by the MaintenanceWorker hourly.
 *
 * @module domains/files/cleanup
 */

import { createChildLogger } from '@/shared/utils/logger';
import { BATCH_STATUS, PIPELINE_STATUS } from '@bc-agent/shared';
import type { BatchTimeoutMetrics } from '@bc-agent/shared';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

export interface BatchTimeoutDeps {
  logger?: ILoggerMinimal;
}

export class BatchTimeoutService {
  private readonly log: ILoggerMinimal;

  constructor(deps?: BatchTimeoutDeps) {
    this.log = deps?.logger ?? createChildLogger({ service: 'BatchTimeoutService' });
  }

  /**
   * Find and expire timed-out batches, cleaning up their unconfirmed files.
   */
  async run(): Promise<BatchTimeoutMetrics> {
    const metrics: BatchTimeoutMetrics = {
      expiredBatches: 0,
      deletedFiles: 0,
    };

    try {
      const { prisma } = await import('@/infrastructure/database/prisma');
      const { getFileUploadService } = await import('@/services/files/FileUploadService');
      const uploadService = getFileUploadService();
      const now = new Date();

      // Find active batches past their expiry
      const expiredBatches = await prisma.upload_batches.findMany({
        where: {
          status: BATCH_STATUS.ACTIVE,
          expires_at: { lt: now },
        },
        select: { id: true, user_id: true, total_files: true },
        take: 100,
      });

      if (expiredBatches.length === 0) {
        this.log.debug('No expired batches found');
        return metrics;
      }

      this.log.info({ count: expiredBatches.length }, 'Expired batches detected');

      for (const batch of expiredBatches) {
        try {
          // Mark batch as expired
          await prisma.upload_batches.updateMany({
            where: { id: batch.id, status: BATCH_STATUS.ACTIVE },
            data: { status: BATCH_STATUS.EXPIRED, updated_at: now },
          });
          metrics.expiredBatches++;

          // Find unconfirmed files (still in 'registered' status)
          const unconfirmedFiles = await prisma.files.findMany({
            where: {
              batch_id: batch.id,
              user_id: batch.user_id,
              pipeline_status: PIPELINE_STATUS.REGISTERED,
              deletion_status: null,
            },
            select: { id: true, blob_path: true },
          });

          // Delete unconfirmed files and their blobs
          for (const file of unconfirmedFiles) {
            try {
              if (file.blob_path) {
                await uploadService.deleteFromBlob(file.blob_path);
              }
              await prisma.files.deleteMany({
                where: { id: file.id, user_id: batch.user_id },
              });
              metrics.deletedFiles++;
            } catch (error) {
              this.log.warn(
                { fileId: file.id, error: error instanceof Error ? error.message : String(error) },
                'Failed to delete unconfirmed file from expired batch',
              );
            }
          }

          this.log.info(
            { batchId: batch.id, unconfirmedFiles: unconfirmedFiles.length },
            'Batch expired and unconfirmed files cleaned up',
          );
        } catch (error) {
          const errorInfo = error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) };
          this.log.error({ error: errorInfo, batchId: batch.id }, 'Failed to process expired batch');
        }
      }

      this.log.info({ metrics }, 'Batch timeout processing completed');
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo }, 'Batch timeout service failed');
    }

    return metrics;
  }
}

// Singleton
let instance: BatchTimeoutService | undefined;

export function getBatchTimeoutService(deps?: BatchTimeoutDeps): BatchTimeoutService {
  if (!instance) {
    instance = new BatchTimeoutService(deps);
  }
  return instance;
}

export function __resetBatchTimeoutService(): void {
  instance = undefined;
}
