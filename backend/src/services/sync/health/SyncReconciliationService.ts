/**
 * SyncReconciliationService (PRD-300)
 *
 * Reconciliation between DB files and Azure AI Search index to detect and
 * optionally repair drift. Runs hourly (24x/day) via MaintenanceWorker cron,
 * and on-demand per-user via POST /api/sync/health/reconcile.
 *
 * Five drift conditions detected:
 *   1. Files in DB as 'ready' but missing from the search index
 *   2. Documents in search index with no matching DB file (orphaned)
 *   3. Failed files eligible for retry (retry_count < 3)
 *   4. Stuck pipeline files (> 30 min in intermediate state)
 *   5. Ready images missing image_embeddings records
 *
 * Cron: respects SYNC_RECONCILIATION_AUTO_REPAIR env var (dry-run by default).
 * On-demand: always repairs (user explicitly requested it).
 *
 * All repair paths use optimistic concurrency (status guard) to prevent race
 * conditions with active file processing workers.
 *
 * @module services/sync/health
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { env } from '@/infrastructure/config/environment';
import { getMessageQueue } from '@/infrastructure/queue';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import type { ReconciliationReport, ReconciliationRepairs } from './types';
import { ReconciliationInProgressError, ReconciliationCooldownError } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_USERS_PER_RUN = 50;
const DB_BATCH_SIZE = 500;
const COOLDOWN_SECONDS = 300; // 5 minutes
const COOLDOWN_KEY_PREFIX = 'sync:reconcile_cooldown:';
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

export class SyncReconciliationService {
  private readonly logger = createChildLogger({ service: 'SyncReconciliationService' });

  /** In-memory guard to prevent concurrent reconciliation for the same user. */
  private readonly activeReconciliations = new Set<string>();

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Cron entry point — run reconciliation for up to MAX_USERS_PER_RUN users.
   *
   * Each user is processed sequentially so that one failure does not abort the
   * entire run. Errors are captured per-user and logged at warn level.
   *
   * @returns One ReconciliationReport per successfully checked user.
   */
  async run(): Promise<ReconciliationReport[]> {
    this.logger.info({ maxUsers: MAX_USERS_PER_RUN }, 'SyncReconciliationService: starting run');

    const users = await prisma.files.findMany({
      where: { pipeline_status: 'ready', deleted_at: null },
      distinct: ['user_id'],
      select: { user_id: true },
      take: MAX_USERS_PER_RUN,
    });

    this.logger.info({ userCount: users.length }, 'SyncReconciliationService: users to reconcile');

    const reports: ReconciliationReport[] = [];

    for (const { user_id: userId } of users) {
      try {
        const report = await this.reconcileUser(userId);
        reports.push(report);
      } catch (err) {
        // Skip ReconciliationInProgressError silently — on-demand is running for this user
        if (err instanceof ReconciliationInProgressError) {
          this.logger.info({ userId }, 'SyncReconciliationService: user reconciliation in progress via on-demand, skipping');
          continue;
        }
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name, stack: err.stack }
            : { value: String(err) };
        this.logger.warn(
          { userId, error: errorInfo },
          'SyncReconciliationService: user reconciliation failed, skipping',
        );
      }
    }

    this.logger.info(
      { usersChecked: reports.length, usersAttempted: users.length },
      'SyncReconciliationService: run complete',
    );

    return reports;
  }

  /**
   * On-demand reconciliation for a single user.
   *
   * Enforces:
   *   - Redis cooldown (5 min between calls per user)
   *   - In-memory concurrency guard (one active reconciliation per user)
   *   - Always repairs (bypasses SYNC_RECONCILIATION_AUTO_REPAIR)
   *
   * @throws ReconciliationCooldownError if called within cooldown period
   * @throws ReconciliationInProgressError if reconciliation is already active for this user
   */
  async reconcileUserOnDemand(userId: string): Promise<ReconciliationReport> {
    const normalizedId = userId.toUpperCase();

    // ── Check Redis cooldown ──────────────────────────────────────────────
    await this.checkCooldown(normalizedId);

    // ── Run reconciliation (with forceRepair) ─────────────────────────────
    const report = await this.reconcileUser(userId, { forceRepair: true });

    // ── Set cooldown on success ───────────────────────────────────────────
    await this.setCooldown(normalizedId);

    return report;
  }

  /**
   * Reconcile a single user's files against the search index.
   *
   * Diagnoses 5 drift conditions, then optionally repairs them.
   *
   * @param userId - The user whose files to reconcile.
   * @param options.forceRepair - When true, always repair regardless of env var.
   */
  async reconcileUser(
    userId: string,
    options?: { forceRepair?: boolean },
  ): Promise<ReconciliationReport> {
    const normalizedId = userId.toUpperCase();

    // ── Concurrency guard ─────────────────────────────────────────────────
    if (this.activeReconciliations.has(normalizedId)) {
      throw new ReconciliationInProgressError(userId);
    }

    this.activeReconciliations.add(normalizedId);

    try {
      return await this.doReconcileUser(userId, options);
    } finally {
      this.activeReconciliations.delete(normalizedId);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — per-user reconciliation
  // ──────────────────────────────────────────────────────────────────────────

  private async doReconcileUser(
    userId: string,
    options?: { forceRepair?: boolean },
  ): Promise<ReconciliationReport> {
    // ── a. Collect all file IDs from DB (paginated) ───────────────────────

    const dbFileIds = new Set<string>();
    let skip = 0;

    while (true) {
      const batch = await prisma.files.findMany({
        where: { user_id: userId, pipeline_status: 'ready', deleted_at: null },
        select: { id: true },
        skip,
        take: DB_BATCH_SIZE,
      });

      if (batch.length === 0) break;

      for (const f of batch) {
        dbFileIds.add(f.id.toUpperCase());
      }

      skip += DB_BATCH_SIZE;

      if (batch.length < DB_BATCH_SIZE) break;
    }

    // ── b. Collect all file IDs from search index ─────────────────────────

    const { VectorSearchService } = await import('@/services/search/VectorSearchService');
    const searchFileIds = new Set(
      (await VectorSearchService.getInstance().getUniqueFileIds(userId)).map((id) =>
        id.toUpperCase(),
      ),
    );

    // ── c. Compute set differences ────────────────────────────────────────

    const missingFromSearch = [...dbFileIds].filter((id) => !searchFileIds.has(id));
    const orphanedInSearch = [...searchFileIds].filter((id) => !dbFileIds.has(id));

    // ── d. Detect failed files eligible for retry ─────────────────────────

    const failedRetriableRows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'failed',
        pipeline_retry_count: { lt: 3 },
        deleted_at: null,
      },
      select: { id: true, name: true, mime_type: true, connection_scope_id: true },
    });
    const failedRetriable = failedRetriableRows.map((f) => f.id.toUpperCase());

    // ── e. Detect stuck pipeline files (> 30 min in any non-terminal state)

    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuckFileRows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
        updated_at: { lt: stuckThreshold },
        deleted_at: null,
      },
      select: { id: true, name: true, mime_type: true, connection_scope_id: true },
    });
    const stuckFiles = stuckFileRows.map((f) => f.id.toUpperCase());

    // ── f. Detect ready images missing image_embeddings ───────────────────

    const readyImages = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'ready',
        deleted_at: null,
        mime_type: { startsWith: 'image/' },
      },
      select: { id: true },
    });

    let imagesMissingEmbeddings: string[] = [];
    if (readyImages.length > 0) {
      const imageIds = readyImages.map((f) => f.id);
      const imagesWithEmbs = await prisma.image_embeddings.findMany({
        where: { user_id: userId, file_id: { in: imageIds } },
        select: { file_id: true },
      });
      const embFileIds = new Set(imagesWithEmbs.map((e) => e.file_id.toUpperCase()));
      imagesMissingEmbeddings = readyImages
        .filter((f) => !embFileIds.has(f.id.toUpperCase()))
        .map((f) => f.id.toUpperCase());
    }

    // ── g. Optionally repair ──────────────────────────────────────────────

    const shouldRepair = options?.forceRepair || env.SYNC_RECONCILIATION_AUTO_REPAIR;

    let repairs: ReconciliationRepairs;

    if (shouldRepair) {
      repairs = await this.performRepairs(
        userId,
        missingFromSearch,
        orphanedInSearch,
        failedRetriableRows,
        stuckFileRows,
        imagesMissingEmbeddings,
      );
    } else {
      repairs = { missingRequeued: 0, orphansDeleted: 0, failedRequeued: 0, stuckRequeued: 0, imageRequeued: 0, errors: 0 };
    }

    // ── h. Build and log report ───────────────────────────────────────────

    const report: ReconciliationReport = {
      timestamp: new Date(),
      userId,
      dbReadyFiles: dbFileIds.size,
      searchIndexedFiles: searchFileIds.size,
      missingFromSearch,
      orphanedInSearch,
      failedRetriable,
      stuckFiles,
      imagesMissingEmbeddings,
      repairs,
      dryRun: !shouldRepair,
    };

    this.logger.info(
      {
        ...report,
        // Omit full arrays from log — use counts instead
        missingFromSearch: undefined,
        orphanedInSearch: undefined,
        failedRetriable: undefined,
        stuckFiles: undefined,
        imagesMissingEmbeddings: undefined,
        missingCount: missingFromSearch.length,
        orphanedCount: orphanedInSearch.length,
        failedRetriableCount: failedRetriable.length,
        stuckFilesCount: stuckFiles.length,
        imagesMissingEmbeddingsCount: imagesMissingEmbeddings.length,
      },
      'Reconciliation report for user',
    );

    return report;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — repairs (optimistic concurrency)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Attempt to repair detected drift.
   *
   * All DB updates use optimistic concurrency: the WHERE clause includes the
   * expected pipeline_status so that if a worker transitions the file between
   * detection and repair, the update is a no-op (count=0) and we skip enqueue.
   *
   * Errors are captured per-file so that one failure does not abort the rest.
   */
  private async performRepairs(
    userId: string,
    missingFromSearch: string[],
    orphanedInSearch: string[],
    failedRetriableRows: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
    stuckFileRows: Array<{ id: string; name: string; mime_type: string; connection_scope_id: string | null }>,
    imagesMissingEmbeddings: string[],
  ): Promise<ReconciliationRepairs> {
    const repairs: ReconciliationRepairs = {
      missingRequeued: 0, orphansDeleted: 0,
      failedRequeued: 0, stuckRequeued: 0, imageRequeued: 0,
      errors: 0,
    };

    // ── Re-enqueue files missing from the search index ───────────────────

    for (const fileId of missingFromSearch) {
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

        repairs.missingRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, error: errorInfo },
          'Failed to re-enqueue missing file',
        );
        repairs.errors++;
      }
    }

    // ── Delete orphaned search documents ──────────────────────────────────

    for (const fileId of orphanedInSearch) {
      try {
        const { VectorSearchService } = await import('@/services/search/VectorSearchService');
        await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
        repairs.orphansDeleted++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, error: errorInfo },
          'Failed to delete orphaned search chunks',
        );
        repairs.errors++;
      }
    }

    // ── Re-enqueue failed files eligible for retry ────────────────────────

    for (const file of failedRetriableRows) {
      try {
        // Optimistic: only reset if still 'failed'
        const result = await prisma.files.updateMany({
          where: { id: file.id, pipeline_status: 'failed' },
          data: {
            pipeline_status: 'queued',
            pipeline_retry_count: 0,
            last_processing_error: null,
            updated_at: new Date(),
          },
        });

        if (result.count === 0) continue;

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        repairs.failedRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ fileId: file.id, error: errorInfo }, 'Failed to re-enqueue failed file');
        repairs.errors++;
      }
    }

    // ── Re-enqueue stuck intermediate pipeline files ──────────────────────

    for (const file of stuckFileRows) {
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

        repairs.stuckRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ fileId: file.id, error: errorInfo }, 'Failed to re-enqueue stuck file');
        repairs.errors++;
      }
    }

    // ── Re-enqueue ready images missing embeddings ────────────────────────

    for (const fileId of imagesMissingEmbeddings) {
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

        if (result.count === 0) continue;

        await getMessageQueue().addFileProcessingFlow({
          fileId: file.id,
          batchId: file.connection_scope_id ?? file.id,
          userId,
          mimeType: file.mime_type,
          fileName: file.name,
        });

        repairs.imageRequeued++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ fileId, error: errorInfo }, 'Failed to re-enqueue image missing embedding');
        repairs.errors++;
      }
    }

    return repairs;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — Redis cooldown
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if user is within cooldown period. Throws if cooldown is active.
   * Fails open: if Redis is unavailable, allow the call through.
   */
  private async checkCooldown(normalizedUserId: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return; // Fail open

    try {
      const key = `${COOLDOWN_KEY_PREFIX}${normalizedUserId}`;
      const ttl = await client.ttl(key);

      if (ttl > 0) {
        throw new ReconciliationCooldownError(ttl);
      }
    } catch (err) {
      if (err instanceof ReconciliationCooldownError) throw err;
      // Redis error — fail open
      this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Redis cooldown check failed, proceeding');
    }
  }

  /**
   * Set cooldown after successful reconciliation.
   * Best-effort: Redis failure does not fail the reconciliation.
   */
  private async setCooldown(normalizedUserId: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      const key = `${COOLDOWN_KEY_PREFIX}${normalizedUserId}`;
      await client.set(key, '1', { EX: COOLDOWN_SECONDS });
    } catch (err) {
      this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to set reconciliation cooldown');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let instance: SyncReconciliationService | undefined;

/**
 * Get the SyncReconciliationService singleton.
 */
export function getSyncReconciliationService(): SyncReconciliationService {
  if (!instance) {
    instance = new SyncReconciliationService();
  }
  return instance;
}

/**
 * Reset the singleton (test helper only).
 */
export function __resetSyncReconciliationService(): void {
  instance = undefined;
}
