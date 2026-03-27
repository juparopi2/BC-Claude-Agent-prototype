/**
 * SyncReconciliationService (PRD-300)
 *
 * Reconciliation between DB files and Azure AI Search index to detect and
 * optionally repair drift. Runs hourly (24x/day) via MaintenanceWorker cron,
 * and on-demand per-user via POST /api/sync/health/reconcile.
 *
 * Eight drift conditions detected:
 *   1. Files in DB as 'ready' but missing from the search index
 *   2. Documents in search index with no matching DB file (orphaned)
 *   3. Failed files eligible for retry (retry_count < 3)
 *   4. Stuck pipeline files (> 30 min in intermediate state)
 *   5. Ready images missing image_embeddings records
 *   6. External files (OneDrive/SharePoint) that no longer exist (Graph API 404)
 *   7. Broken folder hierarchy (orphaned children, missing scope roots)
 *   8. Files on disconnected/expired connections (orphaned by disconnection)
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
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import type { ReconciliationReport, ReconciliationRepairs } from './types';
import { ReconciliationInProgressError, ReconciliationCooldownError } from './types';
import { SearchIndexComparator } from './detectors/SearchIndexComparator';
import { FailedRetriableDetector } from './detectors/FailedRetriableDetector';
import { StuckPipelineDetector } from './detectors/StuckPipelineDetector';
import { ExternalNotFoundDetector } from './detectors/ExternalNotFoundDetector';
import { ImageEmbeddingDetector } from './detectors/ImageEmbeddingDetector';
import { FolderHierarchyDetector } from './detectors/FolderHierarchyDetector';
import { DisconnectedFilesDetector } from './detectors/DisconnectedFilesDetector';
import { FileRequeueRepairer } from './repairers/FileRequeueRepairer';
import { OrphanCleanupRepairer } from './repairers/OrphanCleanupRepairer';
import { ExternalFileCleanupRepairer } from './repairers/ExternalFileCleanupRepairer';
import { FolderHierarchyRepairer } from './repairers/FolderHierarchyRepairer';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_USERS_PER_RUN = 50;
const COOLDOWN_SECONDS = 300; // 5 minutes
const COOLDOWN_KEY_PREFIX = 'sync:reconcile_cooldown:';

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
   * Diagnoses 7 drift conditions, then optionally repairs them.
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
    const normalizedId = userId.toUpperCase();
    const shouldRepair = options?.forceRepair || env.SYNC_RECONCILIATION_AUTO_REPAIR;

    // ── Detection phase ───────────────────────────────────────────────────

    // a/b/c. DB vs Search index comparison (missing + orphaned)
    const comparator = new SearchIndexComparator();
    const comparison = await comparator.compare(normalizedId);

    // d. Failed files eligible for retry
    const failedRetriableResult = await new FailedRetriableDetector().detect(normalizedId);
    const failedRetriableRows = failedRetriableResult.items;
    const failedRetriable = failedRetriableRows.map((f) => f.id);

    // e. Stuck pipeline files
    const stuckPipelineResult = await new StuckPipelineDetector().detect(normalizedId);
    const stuckFileRows = stuckPipelineResult.items;
    const stuckFiles = stuckFileRows.map((f) => f.id);

    // f. External files that no longer exist (Graph API 404)
    const externalNotFoundResult = await new ExternalNotFoundDetector().detect(normalizedId);
    const externalNotFound = externalNotFoundResult.items;

    // g. Ready images missing image_embeddings
    const imagesMissingResult = await new ImageEmbeddingDetector().detect(normalizedId);
    const imagesMissingEmbeddings = imagesMissingResult.items;

    // h. Folder hierarchy issues
    const folderHierarchyIssues = await new FolderHierarchyDetector().detectIssues(normalizedId);

    // i. Files on disconnected/expired connections
    const disconnectedResult = await new DisconnectedFilesDetector().detect(normalizedId);
    const disconnectedConnectionFiles = disconnectedResult.items;

    // ── Repair phase ──────────────────────────────────────────────────────

    let repairs: ReconciliationRepairs;

    if (shouldRepair) {
      const requeuer = new FileRequeueRepairer();
      const orphanCleaner = new OrphanCleanupRepairer();
      const externalCleaner = new ExternalFileCleanupRepairer();
      const hierarchyRepairer = new FolderHierarchyRepairer();

      // Re-enqueue files missing from the search index
      const missingResult = await requeuer.requeueMissingFromSearch(normalizedId, comparison.missingFromSearch);

      // Delete orphaned search documents
      const orphanResult = await orphanCleaner.cleanup(normalizedId, comparison.orphanedInSearch);

      // Re-enqueue failed files eligible for retry
      const failedResult = await requeuer.requeueFailedRetriable(normalizedId, failedRetriableRows);

      // Re-enqueue stuck pipeline files
      const stuckResult = await requeuer.requeueStuckFiles(normalizedId, stuckFileRows);

      // Re-enqueue ready images missing embeddings
      const imageResult = await requeuer.requeueImagesMissingEmbeddings(normalizedId, imagesMissingEmbeddings);

      // Soft-delete external files that no longer exist
      const externalResult = await externalCleaner.cleanup(normalizedId, externalNotFound);

      // Soft-delete files on disconnected/expired connections
      const disconnectedCleanResult = await externalCleaner.cleanup(normalizedId, disconnectedConnectionFiles);

      // Repair folder hierarchy issues
      const hierarchyRepairs = await hierarchyRepairer.repair(normalizedId, folderHierarchyIssues);

      // Aggregate all errors
      const totalErrors =
        missingResult.errors +
        orphanResult.errors +
        failedResult.errors +
        stuckResult.errors +
        imageResult.errors +
        externalResult.errors +
        disconnectedCleanResult.errors;

      repairs = {
        missingRequeued: missingResult.missingRequeued,
        orphansDeleted: orphanResult.orphansDeleted,
        failedRequeued: failedResult.failedRequeued,
        stuckRequeued: stuckResult.stuckRequeued,
        imageRequeued: imageResult.imageRequeued,
        externalNotFoundCleaned: externalResult.cleaned,
        disconnectedConnectionCleaned: disconnectedCleanResult.cleaned,
        folderHierarchy: hierarchyRepairs,
        errors: totalErrors,
      };
    } else {
      repairs = {
        missingRequeued: 0, orphansDeleted: 0, failedRequeued: 0, stuckRequeued: 0,
        imageRequeued: 0, externalNotFoundCleaned: 0, disconnectedConnectionCleaned: 0,
        folderHierarchy: { scopeRootsRecreated: 0, scopesResynced: 0, scopesSkippedDisconnected: 0, localFilesReparented: 0, foldersRestored: 0, errors: 0 },
        errors: 0,
      };
    }

    // ── Build and log report ──────────────────────────────────────────────

    const report: ReconciliationReport = {
      timestamp: new Date(),
      userId,
      dbReadyFiles: comparison.dbFileIds.size,
      searchIndexedFiles: comparison.searchFileIds.size,
      missingFromSearch: comparison.missingFromSearch,
      orphanedInSearch: comparison.orphanedInSearch,
      failedRetriable,
      stuckFiles,
      imagesMissingEmbeddings,
      externalNotFound,
      disconnectedConnectionFiles,
      folderHierarchyIssues,
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
        externalNotFound: undefined,
        folderHierarchyIssues: undefined, // Don't log full details
        missingCount: comparison.missingFromSearch.length,
        orphanedCount: comparison.orphanedInSearch.length,
        failedRetriableCount: failedRetriable.length,
        stuckFilesCount: stuckFiles.length,
        imagesMissingEmbeddingsCount: imagesMissingEmbeddings.length,
        externalNotFoundCount: externalNotFound.length,
        disconnectedConnectionFiles: undefined,
        disconnectedConnectionFilesCount: disconnectedConnectionFiles.length,
        orphanedChildrenCount: folderHierarchyIssues.orphanedChildren.length,
        missingScopeRootsCount: folderHierarchyIssues.missingScopeRoots.length,
        scopesToResyncCount: folderHierarchyIssues.scopeIdsToResync.length,
      },
      'Reconciliation report for user',
    );

    return report;
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
