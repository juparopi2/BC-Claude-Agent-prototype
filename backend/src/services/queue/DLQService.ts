/**
 * DLQService (PRD-04)
 *
 * Manages the dead letter queue for permanently failed file processing jobs.
 * Provides listing, single retry, and bulk retry operations.
 *
 * DLQ entries are stored as BullMQ jobs in the DLQ queue.
 * Retry creates a new processing flow via ProcessingFlowFactory.
 *
 * @module services/queue
 */

import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { DLQEntry, DLQListResponse, FailedPipelineStage } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'DLQService' });

export class DLQService {
  /**
   * Add a file to the dead letter queue.
   */
  async addToDeadLetter(entry: {
    fileId: string;
    batchId: string;
    userId: string;
    stage: FailedPipelineStage;
    error: string;
    stack?: string;
    attempts: number;
  }): Promise<void> {
    const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
    const mq = getMessageQueue();

    // Use the internal queue manager to add directly to the DLQ queue
    const job = await (mq as unknown as {
      queueManager: { getQueue: (name: string) => { add: (name: string, data: unknown) => Promise<{ id?: string }> } | undefined };
    }).queueManager?.getQueue?.('v2-dead-letter-queue' as unknown as string)?.add('v2-dead-letter', {
      ...entry,
      failedAt: new Date().toISOString(),
    });

    logger.info(
      { fileId: entry.fileId, stage: entry.stage, jobId: job?.id },
      'Added file to DLQ',
    );
  }

  /**
   * List DLQ entries for a user (paginated).
   */
  async listEntries(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<DLQListResponse> {
    // For now, query from DB since DLQ entries are also tracked in pipeline_status=failed
    const { prisma } = await import('@/infrastructure/database/prisma');

    const where = {
      user_id: userId,
      pipeline_status: PIPELINE_STATUS.FAILED,
      deletion_status: null,
    };

    const [files, total] = await Promise.all([
      prisma.files.findMany({
        where,
        select: {
          id: true,
          name: true,
          batch_id: true,
          pipeline_status: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.files.count({ where }),
    ]);

    const entries: DLQEntry[] = files.map((f) => ({
      fileId: f.id.toUpperCase(),
      batchId: (f.batch_id ?? '').toUpperCase(),
      userId,
      stage: 'extract' as FailedPipelineStage, // Default; full stage tracking in future
      error: 'Processing failed',
      attempts: 0,
      failedAt: f.updated_at ? new Date(f.updated_at).toISOString() : new Date().toISOString(),
    }));

    return { entries, total, page, pageSize };
  }

  /**
   * Retry a single failed file by creating a new processing flow.
   */
  async retryFile(fileId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

    // 1. Transition failed → queued
    const result = await repo.transitionStatus(
      fileId, userId,
      PIPELINE_STATUS.FAILED,
      PIPELINE_STATUS.QUEUED,
    );

    if (!result.success) {
      logger.warn({ fileId, error: result.error }, 'Cannot retry file — transition failed');
      return { success: false, error: result.error };
    }

    // 2. Read file details for the flow
    const { prisma } = await import('@/infrastructure/database/prisma');
    const file = await prisma.files.findFirst({
      where: { id: fileId, user_id: userId },
      select: { id: true, name: true, mime_type: true, blob_path: true, batch_id: true },
    });

    if (!file) {
      return { success: false, error: 'File not found' };
    }

    // 3. Create new processing flow
    const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
    const queue = getMessageQueue();
    await queue.addFileProcessingFlow({
      fileId,
      userId,
      batchId: (file.batch_id ?? '').toUpperCase(),
      mimeType: file.mime_type,
      blobPath: file.blob_path ?? undefined,
      fileName: file.name,
    });

    logger.info({ fileId, userId }, 'File retried via processing flow');
    return { success: true };
  }

  /**
   * Retry all failed files for a user.
   */
  async retryAll(userId: string): Promise<{ retried: number; failed: number }> {
    const { prisma } = await import('@/infrastructure/database/prisma');
    const failedFiles = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: PIPELINE_STATUS.FAILED,
        deletion_status: null,
      },
      select: { id: true },
      take: 100, // Safety limit
    });

    let retried = 0;
    let failed = 0;

    for (const file of failedFiles) {
      const result = await this.retryFile(file.id, userId);
      if (result.success) {
        retried++;
      } else {
        failed++;
      }
    }

    logger.info({ userId, retried, failed }, 'Bulk retry completed');
    return { retried, failed };
  }
}

// Singleton
let instance: DLQService | undefined;

export function getDLQService(): DLQService {
  if (!instance) {
    instance = new DLQService();
  }
  return instance;
}

export function __resetDLQService(): void {
  instance = undefined;
}
