/**
 * FileRequeueRepairer
 *
 * Handles four re-queue repair actions for the SyncReconciliationService:
 *   1. requeueMissingFromSearch   — 'ready' files absent from the AI Search index
 *   2. requeueFailedRetriable     — 'failed' files with retry_count < 3
 *   3. requeueStuckFiles          — files stuck in an intermediate pipeline state > 30 min
 *   4. requeueImagesMissingEmbeddings — 'ready' image files with no image_embeddings record
 *
 * All repairs use optimistic concurrency: updateMany WHERE includes expected
 * pipeline_status, so a no-op (count=0) means a worker already transitioned the
 * file and we safely skip enqueue.
 *
 * Errors are captured per-file so that one failure never aborts the rest.
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface FileRequeueResult {
  missingRequeued: number;
  failedRequeued: number;
  stuckRequeued: number;
  imageRequeued: number;
  errors: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class FileRequeueRepairer {
  private readonly logger = createChildLogger({ service: 'FileRequeueRepairer' });

  /**
   * Re-queue files that are 'ready' in DB but absent from the AI Search index.
   *
   * @param userId  - Owning user (for audit logging; actual ownership is on file row)
   * @param fileIds - Uppercase file IDs detected as missing
   * @returns Count of successfully re-queued files and error count
   */
  async requeueMissingFromSearch(
    userId: string,
    fileIds: string[],
  ): Promise<{ missingRequeued: number; errors: number }> {
    let missingRequeued = 0;
    let errors = 0;

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const fileId of fileIds) {
      try {
        const file = await prisma.files.findUnique({
          where: { id: fileId },
          select: {
            id: true,
            name: true,
            mime_type: true,
            user_id: true,
            connection_scope_id: true,
          },
        });

        if (!file) continue;

        // Optimistic: only reset if still 'ready' (not already re-queued by another process)
        const result = await prisma.files.updateMany({
          where: { id: fileId, pipeline_status: 'ready' },
          data: { pipeline_status: 'queued', updated_at: new Date() },
        });

        if (result.count === 0) continue; // File already transitioned — skip enqueue

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? fileId,
          userId: file.user_id,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        missingRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, userId, error: errorInfo },
          'Failed to re-enqueue missing file',
        );
        errors++;
      }
    }

    return { missingRequeued, errors };
  }

  /**
   * Re-queue failed files that are eligible for retry (retry_count < 3).
   *
   * Resets retry count and last_error so the pipeline restarts cleanly.
   *
   * @param userId - Owning user
   * @param files  - File rows from the failed-retriable detection query
   * @returns Count of successfully re-queued files and error count
   */
  async requeueFailedRetriable(
    userId: string,
    files: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
  ): Promise<{ failedRequeued: number; errors: number }> {
    let failedRequeued = 0;
    let errors = 0;

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const file of files) {
      try {
        // Optimistic: only reset if still 'failed'
        const result = await prisma.files.updateMany({
          where: { id: file.id, pipeline_status: 'failed' },
          data: {
            pipeline_status: 'queued',
            pipeline_retry_count: 0,
            last_error: null,
            updated_at: new Date(),
          },
        });

        if (result.count === 0) continue; // Already transitioned — skip enqueue

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        failedRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'Failed to re-enqueue failed file',
        );
        errors++;
      }
    }

    return { failedRequeued, errors };
  }

  /**
   * Re-queue files stuck in an intermediate pipeline state (> 30 min).
   *
   * @param userId - Owning user
   * @param files  - File rows from the stuck-pipeline detection query
   * @returns Count of successfully re-queued files and error count
   */
  async requeueStuckFiles(
    userId: string,
    files: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
  ): Promise<{ stuckRequeued: number; errors: number }> {
    let stuckRequeued = 0;
    let errors = 0;

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const file of files) {
      try {
        // Optimistic: only reset if still in an intermediate state
        const result = await prisma.files.updateMany({
          where: {
            id: file.id,
            pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
          },
          data: {
            pipeline_status: 'queued',
            updated_at: new Date(),
          },
        });

        if (result.count === 0) continue; // File already reached 'ready' or 'failed' — skip

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        stuckRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'Failed to re-enqueue stuck file',
        );
        errors++;
      }
    }

    return { stuckRequeued, errors };
  }

  /**
   * Re-queue 'ready' image files that are missing an image_embeddings record.
   *
   * @param userId  - Owning user
   * @param fileIds - Uppercase file IDs detected as missing embeddings
   * @returns Count of successfully re-queued files and error count
   */
  async requeueImagesMissingEmbeddings(
    userId: string,
    fileIds: string[],
  ): Promise<{ imageRequeued: number; errors: number }> {
    let imageRequeued = 0;
    let errors = 0;

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const fileId of fileIds) {
      try {
        const file = await prisma.files.findUnique({
          where: { id: fileId },
          select: { id: true, name: true, mime_type: true, connection_scope_id: true },
        });
        if (!file) continue;

        // Optimistic: only reset if still 'ready'
        const result = await prisma.files.updateMany({
          where: { id: fileId, pipeline_status: 'ready' },
          data: { pipeline_status: 'queued', updated_at: new Date() },
        });

        if (result.count === 0) continue; // Already transitioned — skip enqueue

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        imageRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, userId, error: errorInfo },
          'Failed to re-enqueue image missing embedding',
        );
        errors++;
      }
    }

    return { imageRequeued, errors };
  }
}
