/**
 * SyncReconciliationService (PRD-300)
 *
 * Daily reconciliation between DB files (pipeline_status='ready') and Azure AI Search
 * index to detect and optionally repair drift. Runs at 04:00 UTC via MaintenanceWorker.
 *
 * Two drift conditions detected:
 *   1. Files in DB as 'ready' but missing from the search index → re-enqueue for processing
 *   2. Documents in search index with no matching DB file → orphaned, remove from index
 *
 * Default behaviour is dry-run (no mutations). Set env var
 * SYNC_RECONCILIATION_AUTO_REPAIR=true to enable automatic repairs.
 *
 * @module services/sync/health
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { getMessageQueue } from '@/infrastructure/queue';
import type { ReconciliationReport, ReconciliationRepairs } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_USERS_PER_RUN = 50;
const DB_BATCH_SIZE = 500;

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

export class SyncReconciliationService {
  private readonly logger = createChildLogger({ service: 'SyncReconciliationService' });

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run reconciliation for up to MAX_USERS_PER_RUN users.
   *
   * Each user is processed sequentially (not concurrently) so that a single
   * user's failure does not abort the entire run. Errors are captured
   * per-user and logged at warn level.
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

  // ──────────────────────────────────────────────────────────────────────────
  // Private — per-user reconciliation
  // ──────────────────────────────────────────────────────────────────────────

  private async reconcileUser(userId: string): Promise<ReconciliationReport> {
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

    // ── d. Optionally repair ──────────────────────────────────────────────

    const autoRepair = process.env.SYNC_RECONCILIATION_AUTO_REPAIR === 'true';

    let repairs: ReconciliationRepairs;

    if (autoRepair) {
      repairs = await this.performRepairs(userId, missingFromSearch, orphanedInSearch);
    } else {
      repairs = { missingRequeued: 0, orphansDeleted: 0, errors: 0 };
    }

    // ── e. Build and log report ───────────────────────────────────────────

    const report: ReconciliationReport = {
      timestamp: new Date(),
      userId,
      dbReadyFiles: dbFileIds.size,
      searchIndexedFiles: searchFileIds.size,
      missingFromSearch,
      orphanedInSearch,
      repairs,
      dryRun: !autoRepair,
    };

    this.logger.info(
      {
        ...report,
        // Omit full arrays from log — use counts instead
        missingFromSearch: undefined,
        orphanedInSearch: undefined,
        missingCount: missingFromSearch.length,
        orphanedCount: orphanedInSearch.length,
      },
      'Reconciliation report for user',
    );

    return report;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — repairs
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Attempt to repair detected drift:
   *   - Missing from search: reset pipeline_status to 'queued' and re-enqueue.
   *   - Orphaned in search:  delete all chunks for the stale fileId.
   *
   * Errors are captured per-file so that one failure does not abort the rest.
   */
  private async performRepairs(
    userId: string,
    missingFromSearch: string[],
    orphanedInSearch: string[],
  ): Promise<ReconciliationRepairs> {
    const repairs: ReconciliationRepairs = { missingRequeued: 0, orphansDeleted: 0, errors: 0 };

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

        // Reset pipeline status so the processing pipeline picks it up again
        await prisma.files.update({
          where: { id: fileId },
          data: { pipeline_status: 'queued' },
        });

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

    return repairs;
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
