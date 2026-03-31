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
  readyWithoutChunksRequeued: number;
  staleMetadataRequeued: number;
  errors: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class FileRequeueRepairer {
  private readonly logger = createChildLogger({ service: 'FileRequeueRepairer' });

  /**
   * PRD-305: Adjust connection_scopes processing counters after re-enqueue.
   *
   * When files are re-queued, FilePipelineCompleteWorker will re-increment
   * processing_completed or processing_failed. To avoid double-counting,
   * we decrement the relevant counter for the files being re-processed.
   *
   * Uses CASE WHEN guards to prevent negative values.
   */
  private async adjustScopeCounters(
    scopeCounts: Map<string, number>,
    adjustment: 'decrement_failed' | 'decrement_completed' | 'status_only' | 'increment_failed',
  ): Promise<void> {
    if (scopeCounts.size === 0) return;

    const { prisma } = await import('@/infrastructure/database/prisma');

    for (const [scopeId, count] of scopeCounts) {
      if (!scopeId) continue;
      try {
        if (adjustment === 'decrement_failed') {
          await prisma.$executeRawUnsafe(
            `UPDATE connection_scopes
             SET processing_failed = CASE WHEN processing_failed >= @P1 THEN processing_failed - @P1 ELSE 0 END,
                 processing_status = 'processing',
                 updated_at = GETUTCDATE()
             WHERE id = @P2`,
            count,
            scopeId,
          );
        } else if (adjustment === 'decrement_completed') {
          await prisma.$executeRawUnsafe(
            `UPDATE connection_scopes
             SET processing_completed = CASE WHEN processing_completed >= @P1 THEN processing_completed - @P1 ELSE 0 END,
                 processing_status = 'processing',
                 updated_at = GETUTCDATE()
             WHERE id = @P2`,
            count,
            scopeId,
          );
        } else if (adjustment === 'increment_failed') {
          // Permanently failed stuck files: increment processing_failed since they never
          // reached a terminal state — FilePipelineCompleteWorker will not run for them.
          await prisma.$executeRawUnsafe(
            `UPDATE connection_scopes
             SET processing_failed = processing_failed + @P1,
                 updated_at = GETUTCDATE()
             WHERE id = @P2`,
            count,
            scopeId,
          );
        } else {
          // status_only: just reset processing_status for stuck files
          await prisma.$executeRawUnsafe(
            `UPDATE connection_scopes
             SET processing_status = 'processing',
                 updated_at = GETUTCDATE()
             WHERE id = @P1`,
            scopeId,
          );
        }

        this.logger.debug({ scopeId, count, adjustment }, 'Adjusted scope counters after requeue');
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.logger.warn(
          { scopeId, count, adjustment, error: errorInfo },
          'Failed to adjust scope counters after requeue',
        );
      }
    }
  }

  /** Accumulate per-scope count from a file's connection_scope_id. */
  private accumulateScopeCount(
    scopeCounts: Map<string, number>,
    scopeId: string | null | undefined,
  ): void {
    if (!scopeId) return;
    scopeCounts.set(scopeId, (scopeCounts.get(scopeId) ?? 0) + 1);
  }

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
    const scopeCounts = new Map<string, number>();

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

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? fileId,
          userId: file.user_id,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueMissingFromSearch');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
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

    // PRD-305: These were 'ready' files (counted as completed) — decrement to avoid double-counting
    await this.adjustScopeCounters(scopeCounts, 'decrement_completed');

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
    const scopeCounts = new Map<string, number>();

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

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueFailedRetriable');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
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

    // PRD-305: These were 'failed' files — decrement failed counter to avoid double-counting
    await this.adjustScopeCounters(scopeCounts, 'decrement_failed');

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
    const scopeCounts = new Map<string, number>();

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const file of files) {
      try {
        // Optimistic: only reset if still in an intermediate state AND retries not exhausted.
        // Files with pipeline_retry_count >= 3 are handled by permanentlyFailExhaustedFiles()
        // and should never reach this method — the guard is a safety net for race conditions.
        const result = await prisma.files.updateMany({
          where: {
            id: file.id,
            pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
            pipeline_retry_count: { lt: 3 },
          },
          data: {
            pipeline_status: 'queued',
            updated_at: new Date(),
          },
        });

        if (result.count === 0) continue; // File already reached 'ready'/'failed', or retries exhausted — skip

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueStuckFiles');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
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

    // PRD-305: Stuck files were already in processing_total but never finished — just reset status
    await this.adjustScopeCounters(scopeCounts, 'status_only');

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
    const scopeCounts = new Map<string, number>();

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

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueImagesMissingEmbeddings');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
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

    // PRD-305: These were 'ready' images (counted as completed) — decrement to avoid double-counting
    await this.adjustScopeCounters(scopeCounts, 'decrement_completed');

    return { imageRequeued, errors };
  }

  /**
   * Re-queue 'ready' non-image files that have zero file_chunks records.
   *
   * These files completed the pipeline without producing searchable chunks,
   * so they are not findable via RAG. Resetting to 'queued' triggers a full
   * re-processing run.
   *
   * @param userId - Owning user
   * @param files  - File rows detected as ready-without-chunks
   * @returns Count of successfully re-queued files and error count
   */
  async requeueReadyWithoutChunks(
    userId: string,
    files: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
  ): Promise<{ readyWithoutChunksRequeued: number; errors: number }> {
    let readyWithoutChunksRequeued = 0;
    let errors = 0;
    const scopeCounts = new Map<string, number>();

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const file of files) {
      try {
        // Optimistic: only reset if still 'ready'
        const result = await prisma.files.updateMany({
          where: { id: file.id, pipeline_status: 'ready' },
          data: { pipeline_status: 'queued', updated_at: new Date() },
        });

        if (result.count === 0) continue; // Already transitioned — skip enqueue

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueReadyWithoutChunks');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
        readyWithoutChunksRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'Failed to re-enqueue ready-without-chunks file',
        );
        errors++;
      }
    }

    // PRD-305: These were 'ready' files (counted as completed) — decrement to avoid double-counting
    await this.adjustScopeCounters(scopeCounts, 'decrement_completed');

    return { readyWithoutChunksRequeued, errors };
  }

  /**
   * Re-queue 'ready' files whose search index metadata is stale
   * (sourceType or parentFolderId mismatch between DB and AI Search).
   *
   * Resetting to 'queued' triggers re-indexing which will write correct metadata.
   *
   * @param userId - Owning user
   * @param files  - File rows detected as having stale search metadata
   * @returns Count of successfully re-queued files and error count
   */
  async requeueStaleMetadata(
    userId: string,
    files: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
  ): Promise<{ staleMetadataRequeued: number; errors: number }> {
    let staleMetadataRequeued = 0;
    let errors = 0;
    const scopeCounts = new Map<string, number>();

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    for (const file of files) {
      try {
        // Optimistic: only reset if still 'ready'
        const result = await prisma.files.updateMany({
          where: { id: file.id, pipeline_status: 'ready' },
          data: { pipeline_status: 'queued', updated_at: new Date() },
        });

        if (result.count === 0) continue; // Already transitioned — skip enqueue

        const mq = getMessageQueue();
        await mq.removeExistingPipelineJobs(file.id);
        await mq.addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        if (!(await mq.verifyPipelineJobExists(file.id))) {
          this.logger.warn({ fileId: file.id, userId }, 'Pipeline job not found after enqueue in requeueStaleMetadata');
          errors++;
          continue;
        }

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
        staleMetadataRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'Failed to re-enqueue stale-metadata file',
        );
        errors++;
      }
    }

    // PRD-305: These were 'ready' files (counted as completed) — decrement to avoid double-counting
    await this.adjustScopeCounters(scopeCounts, 'decrement_completed');

    return { staleMetadataRequeued, errors };
  }

  /**
   * Permanently fail files stuck in an intermediate pipeline state whose retry
   * count has reached or exceeded the maximum (>= 3).
   *
   * These files were detected by StuckPipelineDetector but partitioned out of
   * the normal requeue path because retrying them further is futile.
   *
   * Uses optimistic concurrency: updateMany WHERE includes both expected
   * pipeline_status and pipeline_retry_count >= 3. If a worker already
   * transitioned the file, count=0 and we skip without error.
   *
   * @param userId - Owning user (for logging)
   * @param files  - File rows with pipeline_retry_count >= 3
   * @returns Count of permanently failed files and error count
   */
  async permanentlyFailExhaustedFiles(
    userId: string,
    files: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null; pipeline_retry_count: number }>,
  ): Promise<{ permanentlyFailed: number; errors: number }> {
    let permanentlyFailed = 0;
    let errors = 0;
    const scopeCounts = new Map<string, number>();

    const { prisma } = await import('@/infrastructure/database/prisma');

    for (const file of files) {
      try {
        const result = await prisma.files.updateMany({
          where: {
            id: file.id,
            pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
            pipeline_retry_count: { gte: 3 },
          },
          data: {
            pipeline_status: 'failed',
            last_error: 'Permanently failed: max retries exhausted',
            updated_at: new Date(),
          },
        });

        if (result.count === 0) continue; // Already transitioned — skip

        this.logger.warn(
          { fileId: file.id, userId, pipeline_retry_count: file.pipeline_retry_count },
          'File permanently failed (max retries exhausted)',
        );

        this.accumulateScopeCount(scopeCounts, file.connection_scope_id);
        permanentlyFailed++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId: file.id, userId, error: errorInfo },
          'Failed to permanently fail exhausted file',
        );
        errors++;
      }
    }

    // Increment processing_failed counter on scopes — these files never ran
    // FilePipelineCompleteWorker so their failure wasn't counted yet.
    await this.adjustScopeCounters(scopeCounts, 'increment_failed');

    return { permanentlyFailed, errors };
  }
}
