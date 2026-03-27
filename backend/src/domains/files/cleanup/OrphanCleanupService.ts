/**
 * OrphanCleanupService (PRD-05)
 *
 * Cleans up orphaned data across four scopes:
 * 1. Orphan blobs — blobs in Azure Storage with no matching DB record
 * 2. Abandoned uploads — files stuck in 'registered' status (blob uploaded but never confirmed)
 * 3. Old failures — files in 'failed' status beyond retention period
 * 4. Stuck deletions — files with deletion_status='pending' for > 24h (safety net)
 *
 * Called by the MaintenanceWorker daily at 03:00 UTC.
 *
 * @module domains/files/cleanup
 */

import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type { OrphanCleanupMetrics } from '@bc-agent/shared';
import type { ILoggerMinimal } from '@/infrastructure/queue/IMessageQueueDependencies';

const DEFAULT_ABANDONED_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_FAILURE_RETENTION_DAYS = 30;

export interface OrphanCleanupDeps {
  logger?: ILoggerMinimal;
}

export class OrphanCleanupService {
  private readonly log: ILoggerMinimal;

  constructor(deps?: OrphanCleanupDeps) {
    this.log = deps?.logger ?? createChildLogger({ service: 'OrphanCleanupService' });
  }

  /**
   * Run all three cleanup scopes and return aggregate metrics.
   */
  async run(options?: {
    abandonedThresholdMs?: number;
    failureRetentionDays?: number;
    skipOrphanBlobs?: boolean;
  }): Promise<OrphanCleanupMetrics> {
    const metrics: OrphanCleanupMetrics = {
      orphanBlobsDeleted: 0,
      abandonedUploadsDeleted: 0,
      oldFailuresDeleted: 0,
      stuckDeletionsDeleted: 0,
    };

    // Scope 1: Orphan blobs (optional — can be slow for large blob containers)
    if (!options?.skipOrphanBlobs) {
      try {
        metrics.orphanBlobsDeleted = await this.cleanupOrphanBlobs();
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { value: String(error) };
        this.log.error({ error: errorInfo }, 'Orphan blob cleanup failed');
      }
    }

    // Scope 2: Abandoned uploads
    try {
      metrics.abandonedUploadsDeleted = await this.cleanupAbandonedUploads(
        options?.abandonedThresholdMs ?? DEFAULT_ABANDONED_THRESHOLD_MS,
      );
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo }, 'Abandoned upload cleanup failed');
    }

    // Scope 3: Old failures
    try {
      metrics.oldFailuresDeleted = await this.cleanupOldFailures(
        options?.failureRetentionDays ?? DEFAULT_FAILURE_RETENTION_DAYS,
      );
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo }, 'Old failure cleanup failed');
    }

    // Scope 4: Stuck deletions (pending > 24 hours — safety net)
    try {
      metrics.stuckDeletionsDeleted = await this.cleanupStuckDeletions();
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      this.log.error({ error: errorInfo }, 'Stuck deletion cleanup failed');
    }

    this.log.info({ metrics }, 'Orphan cleanup completed');
    return metrics;
  }

  /**
   * Scope 1: Find blobs in Azure Storage that have no matching DB record and delete them.
   */
  private async cleanupOrphanBlobs(): Promise<number> {
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const uploadService = getFileUploadService();
    const { prisma } = await import('@/infrastructure/database/prisma');

    const blobPaths = await uploadService.listBlobs('users/');
    if (blobPaths.length === 0) return 0;

    // Query all known blob paths from DB in batches
    const knownPaths = new Set<string>();
    const BATCH_SIZE = 500;
    for (let i = 0; i < blobPaths.length; i += BATCH_SIZE) {
      const batch = blobPaths.slice(i, i + BATCH_SIZE);
      const files = await prisma.files.findMany({
        where: { blob_path: { in: batch } },
        select: { blob_path: true },
      });
      for (const f of files) {
        if (f.blob_path) knownPaths.add(f.blob_path);
      }
    }

    let deleted = 0;
    for (const blobPath of blobPaths) {
      if (!knownPaths.has(blobPath)) {
        try {
          await uploadService.deleteFromBlob(blobPath);
          deleted++;
        } catch (error) {
          this.log.warn({ blobPath, error: error instanceof Error ? error.message : String(error) }, 'Failed to delete orphan blob');
        }
      }
    }

    if (deleted > 0) {
      this.log.info({ deleted, totalBlobs: blobPaths.length }, 'Orphan blobs cleaned up');
    }
    return deleted;
  }

  /**
   * Scope 2: Delete files stuck in 'registered' status (upload started but never confirmed).
   */
  private async cleanupAbandonedUploads(thresholdMs: number): Promise<number> {
    const { getFileRepository } = await import('@/services/files/repository/FileRepository');
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const { prisma } = await import('@/infrastructure/database/prisma');
    const repo = getFileRepository();
    const uploadService = getFileUploadService();

    const abandonedFiles = await repo.findAbandonedFiles(thresholdMs);
    if (abandonedFiles.length === 0) return 0;

    let deleted = 0;
    for (const file of abandonedFiles) {
      try {
        // Delete blob if it exists
        if (file.blob_path) {
          await uploadService.deleteFromBlob(file.blob_path);
        }
        // Hard delete the DB record
        await prisma.files.deleteMany({
          where: { id: file.id, user_id: file.user_id },
        });
        deleted++;
      } catch (error) {
        this.log.warn(
          { fileId: file.id, error: error instanceof Error ? error.message : String(error) },
          'Failed to clean up abandoned upload',
        );
      }
    }

    this.log.info({ deleted, total: abandonedFiles.length }, 'Abandoned uploads cleaned up');
    return deleted;
  }

  /**
   * Scope 3: Delete files in 'failed' status that are older than the retention period.
   */
  private async cleanupOldFailures(retentionDays: number): Promise<number> {
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const { prisma } = await import('@/infrastructure/database/prisma');
    const uploadService = getFileUploadService();

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const oldFailedFiles = await prisma.files.findMany({
      where: {
        pipeline_status: PIPELINE_STATUS.FAILED,
        deletion_status: null,
        updated_at: { lt: cutoff },
      },
      select: { id: true, user_id: true, blob_path: true },
      take: 500,
    });

    if (oldFailedFiles.length === 0) return 0;

    let deleted = 0;
    for (const file of oldFailedFiles) {
      try {
        if (file.blob_path) {
          await uploadService.deleteFromBlob(file.blob_path);
        }
        await prisma.files.deleteMany({
          where: { id: file.id, user_id: file.user_id },
        });
        deleted++;
      } catch (error) {
        this.log.warn(
          { fileId: file.id, error: error instanceof Error ? error.message : String(error) },
          'Failed to clean up old failed file',
        );
      }
    }

    this.log.info({ deleted, total: oldFailedFiles.length, retentionDays }, 'Old failures cleaned up');
    return deleted;
  }

  /**
   * Scope 4: Hard-delete files stuck in 'pending' deletion for more than 24 hours.
   * Safety net — catches zombies that survive the hourly reconciliation.
   */
  private async cleanupStuckDeletions(): Promise<number> {
    const { prisma } = await import('@/infrastructure/database/prisma');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

    const stuckFiles = await prisma.files.findMany({
      where: {
        deletion_status: 'pending',
        deleted_at: { lt: cutoff },
      },
      select: { id: true, user_id: true, blob_path: true },
      take: 500,
    });

    if (stuckFiles.length === 0) return 0;

    let deleted = 0;
    for (const file of stuckFiles) {
      try {
        // Best-effort vector cleanup
        try {
          const { VectorSearchService } = await import('@/services/search/VectorSearchService');
          await VectorSearchService.getInstance().deleteChunksForFile(file.id, file.user_id);
        } catch { /* best-effort */ }

        // Delete blob if exists
        if (file.blob_path) {
          try {
            const { getFileUploadService } = await import('@/services/files/FileUploadService');
            await getFileUploadService().deleteFromBlob(file.blob_path);
          } catch { /* best-effort */ }
        }

        // Hard-delete chunks + embeddings + file
        await prisma.file_chunks.deleteMany({ where: { file_id: file.id } });
        await prisma.image_embeddings.deleteMany({ where: { file_id: file.id } });
        await prisma.files.deleteMany({ where: { id: file.id } });
        deleted++;
      } catch (error) {
        this.log.warn(
          { fileId: file.id, error: error instanceof Error ? error.message : String(error) },
          'Failed to clean up stuck deletion file',
        );
      }
    }

    this.log.info({ deleted, total: stuckFiles.length }, 'Stuck deletions cleaned up');
    return deleted;
  }
}

// Singleton
let instance: OrphanCleanupService | undefined;

export function getOrphanCleanupService(deps?: OrphanCleanupDeps): OrphanCleanupService {
  if (!instance) {
    instance = new OrphanCleanupService(deps);
  }
  return instance;
}

export function __resetOrphanCleanupService(): void {
  instance = undefined;
}
