/**
 * SyncReconciliationService (PRD-300)
 *
 * Reconciliation between DB files and Azure AI Search index to detect and
 * optionally repair drift. Runs hourly (24x/day) via MaintenanceWorker cron,
 * and on-demand per-user via POST /api/sync/health/reconcile.
 *
 * Seven drift conditions detected:
 *   1. Files in DB as 'ready' but missing from the search index
 *   2. Documents in search index with no matching DB file (orphaned)
 *   3. Failed files eligible for retry (retry_count < 3)
 *   4. Stuck pipeline files (> 30 min in intermediate state)
 *   5. Ready images missing image_embeddings records
 *   6. External files (OneDrive/SharePoint) that no longer exist (Graph API 404)
 *   7. Broken folder hierarchy (orphaned children, missing scope roots)
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
import type { ReconciliationReport, ReconciliationRepairs, FolderHierarchyDetection, FolderHierarchyRepairs } from './types';
import { ReconciliationInProgressError, ReconciliationCooldownError } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_USERS_PER_RUN = 50;
const DB_BATCH_SIZE = 500;
const COOLDOWN_SECONDS = 300; // 5 minutes
const COOLDOWN_KEY_PREFIX = 'sync:reconcile_cooldown:';
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const HIERARCHY_RESYNC_COOLDOWN_PREFIX = 'sync:hierarchy_resync:';
const HIERARCHY_RESYNC_COOLDOWN_SECONDS = 1800; // 30 minutes
const MAX_SCOPES_TO_RESYNC_PER_RUN = 5;

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

    // ── f. Detect external files that no longer exist (Graph API 404) ────────

    const externalNotFoundRows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'failed',
        deleted_at: null,
        deletion_status: null,
        source_type: { in: ['onedrive', 'sharepoint'] },
        OR: [
          { last_error: { contains: 'Graph API error (404)' } },
          { last_error: { contains: 'itemNotFound' } },
          { last_error: { contains: 'resource could not be found' } },
        ],
      },
      select: { id: true },
    });
    const externalNotFound = externalNotFoundRows.map((f) => f.id.toUpperCase());

    // ── g. Detect ready images missing image_embeddings ───────────────────

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

    // ── h. Detect folder hierarchy issues ───────────────────────────────

    const folderHierarchyIssues = await this.detectFolderHierarchyIssues(userId);

    // ── i. Optionally repair ──────────────────────────────────────────────

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
        externalNotFound,
      );

      // Folder hierarchy repair (independent of file-level repairs)
      repairs.folderHierarchy = await this.repairFolderHierarchy(userId, folderHierarchyIssues);
    } else {
      repairs = {
        missingRequeued: 0, orphansDeleted: 0, failedRequeued: 0, stuckRequeued: 0,
        imageRequeued: 0, externalNotFoundCleaned: 0,
        folderHierarchy: { scopeRootsRecreated: 0, scopesResynced: 0, scopesSkippedDisconnected: 0, localFilesReparented: 0, errors: 0 },
        errors: 0,
      };
    }

    // ── j. Build and log report ───────────────────────────────────────────

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
      externalNotFound,
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
        missingCount: missingFromSearch.length,
        orphanedCount: orphanedInSearch.length,
        failedRetriableCount: failedRetriable.length,
        stuckFilesCount: stuckFiles.length,
        imagesMissingEmbeddingsCount: imagesMissingEmbeddings.length,
        externalNotFoundCount: externalNotFound.length,
        orphanedChildrenCount: folderHierarchyIssues.orphanedChildren.length,
        missingScopeRootsCount: folderHierarchyIssues.missingScopeRoots.length,
        scopesToResyncCount: folderHierarchyIssues.scopeIdsToResync.length,
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
    externalNotFound: string[],
  ): Promise<ReconciliationRepairs> {
    const repairs: ReconciliationRepairs = {
      missingRequeued: 0, orphansDeleted: 0,
      failedRequeued: 0, stuckRequeued: 0, imageRequeued: 0,
      externalNotFoundCleaned: 0,
      folderHierarchy: { scopeRootsRecreated: 0, scopesResynced: 0, scopesSkippedDisconnected: 0, localFilesReparented: 0, errors: 0 },
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
            last_error: null,
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

    // ── Soft-delete external files that no longer exist (Graph API 404) ───

    for (const fileId of externalNotFound) {
      try {
        // Delete vector chunks (best-effort)
        try {
          const { VectorSearchService } = await import('@/services/search/VectorSearchService');
          await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
        } catch (vecErr) {
          const errorInfo =
            vecErr instanceof Error
              ? { message: vecErr.message, name: vecErr.name }
              : { value: String(vecErr) };
          this.logger.warn({ fileId, error: errorInfo }, 'Failed to delete vector chunks for external-not-found file');
        }

        // Delete file_chunks records
        await prisma.file_chunks.deleteMany({ where: { file_id: fileId } });

        // Soft-delete — must set BOTH fields per project convention
        await prisma.files.update({
          where: { id: fileId },
          data: { deleted_at: new Date(), deletion_status: 'pending' },
        });

        repairs.externalNotFoundCleaned++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ fileId, error: errorInfo }, 'Failed to soft-delete external-not-found file');
        repairs.errors++;
      }
    }

    return repairs;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — folder hierarchy detection & repair
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Detect folder hierarchy integrity issues for a user.
   *
   * Three issue types:
   *   1. Orphaned children — files/folders whose parent_folder_id references a missing row
   *   2. Missing scope root folders — folder/library scopes with no root folder in files table
   *   3. Broken chains — subset of #1 where the orphan is itself a folder (cascading breakage)
   */
  private async detectFolderHierarchyIssues(userId: string): Promise<FolderHierarchyDetection> {
    // ── 1. Orphaned children (parent_folder_id → non-existent or soft-deleted folder) ──

    const orphanedChildren = await prisma.$queryRaw<Array<{
      id: string;
      parent_folder_id: string;
      connection_scope_id: string | null;
      is_folder: boolean;
      source_type: string | null;
    }>>`
      SELECT f.id, f.parent_folder_id, f.connection_scope_id, f.is_folder, f.source_type
      FROM files f
      WHERE f.user_id = ${userId}
        AND f.parent_folder_id IS NOT NULL
        AND f.deleted_at IS NULL
        AND f.deletion_status IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM files p
          WHERE p.id = f.parent_folder_id
            AND p.deleted_at IS NULL
            AND p.deletion_status IS NULL
        )
        AND (f.connection_scope_id IS NULL OR f.connection_scope_id NOT IN (
          SELECT id FROM connection_scopes WHERE sync_status IN ('syncing', 'sync_queued')
        ))
    `;

    // ── 2. Missing scope root folders ──

    const userScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: userId, status: 'connected' },
        scope_type: { in: ['folder', 'library'] },
        sync_status: { in: ['synced', 'idle', 'error'] },
      },
      select: {
        id: true,
        scope_resource_id: true,
        connection_id: true,
        scope_type: true,
        scope_display_name: true,
        remote_drive_id: true,
        connections: { select: { provider: true, microsoft_drive_id: true } },
      },
    });

    const missingScopeRoots: FolderHierarchyDetection['missingScopeRoots'] = [];

    for (const scope of userScopes) {
      if (!scope.scope_resource_id) continue;

      const rootExists = await prisma.files.findFirst({
        where: {
          connection_id: scope.connection_id,
          external_id: scope.scope_resource_id,
          deleted_at: null,
          deletion_status: null,
        },
        select: { id: true },
      });

      if (!rootExists) {
        missingScopeRoots.push({
          scopeId: scope.id,
          connectionId: scope.connection_id,
          scopeResourceId: scope.scope_resource_id,
          scopeDisplayName: scope.scope_display_name,
          remoteDriveId: scope.remote_drive_id,
          provider: scope.connections.provider,
          microsoftDriveId: scope.connections.microsoft_drive_id,
        });
      }
    }

    // ── 3. Build deduplicated set of scope IDs that need resync ──

    const scopeIdsToResync = new Set<string>();

    // From orphaned children — group by connection_scope_id
    for (const orphan of orphanedChildren) {
      if (orphan.connection_scope_id) {
        scopeIdsToResync.add(orphan.connection_scope_id.toUpperCase());
      }
    }

    // From missing scope roots
    for (const missing of missingScopeRoots) {
      scopeIdsToResync.add(missing.scopeId.toUpperCase());
    }

    return {
      orphanedChildren: orphanedChildren.map((o) => ({
        id: o.id,
        parentFolderId: o.parent_folder_id,
        connectionScopeId: o.connection_scope_id,
        isFolder: o.is_folder,
        sourceType: o.source_type,
      })),
      missingScopeRoots,
      scopeIdsToResync: [...scopeIdsToResync],
    };
  }

  /**
   * Repair folder hierarchy issues.
   *
   * Three repair actions:
   *   1. Recreate missing scope root folders (quick DB create, no Graph API)
   *   2. Queue full resync for affected scopes (clears delta cursor → forces full initial sync)
   *   3. Reparent orphaned local files to root (parent_folder_id = null)
   */
  private async repairFolderHierarchy(
    userId: string,
    detection: FolderHierarchyDetection,
  ): Promise<FolderHierarchyRepairs> {
    const repairs: FolderHierarchyRepairs = {
      scopeRootsRecreated: 0,
      scopesResynced: 0,
      scopesSkippedDisconnected: 0,
      localFilesReparented: 0,
      errors: 0,
    };

    // ── 1. Recreate missing scope root folders ──

    for (const missing of detection.missingScopeRoots) {
      try {
        const { ensureScopeRootFolder } = await import('@/services/sync/FolderHierarchyResolver');
        const folderMap = new Map<string, string>();
        const effectiveDriveId = missing.remoteDriveId ?? missing.microsoftDriveId;

        await ensureScopeRootFolder({
          connectionId: missing.connectionId,
          scopeId: missing.scopeId,
          userId,
          scopeResourceId: missing.scopeResourceId,
          scopeDisplayName: missing.scopeDisplayName,
          microsoftDriveId: effectiveDriveId,
          folderMap,
          provider: missing.provider,
        });

        repairs.scopeRootsRecreated++;
        this.logger.info(
          { scopeId: missing.scopeId, scopeDisplayName: missing.scopeDisplayName },
          'Recreated missing scope root folder',
        );
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.logger.warn(
          { scopeId: missing.scopeId, error: errorInfo },
          'Failed to recreate scope root folder',
        );
        repairs.errors++;
      }
    }

    // ── 2. Queue full resync for affected scopes (max cap per run) ──

    let resyncCount = 0;
    for (const scopeId of detection.scopeIdsToResync) {
      if (resyncCount >= MAX_SCOPES_TO_RESYNC_PER_RUN) break;

      try {
        // Check Redis cooldown
        if (await this.isResyncCooldownActive(scopeId)) {
          this.logger.debug({ scopeId }, 'Scope hierarchy resync on cooldown, skipping');
          continue;
        }

        const scope = await prisma.connection_scopes.findUnique({
          where: { id: scopeId },
          select: {
            id: true,
            connection_id: true,
            sync_status: true,
            connections: { select: { user_id: true, status: true } },
          },
        });

        if (!scope) continue;

        if (scope.connections.status !== 'connected') {
          repairs.scopesSkippedDisconnected++;
          continue;
        }

        if (['syncing', 'sync_queued'].includes(scope.sync_status)) continue;

        // Clear delta cursor → forces full initial sync (rebuilds ALL folders)
        await prisma.connection_scopes.update({
          where: { id: scopeId },
          data: {
            last_sync_cursor: null,
            sync_status: 'sync_queued',
            updated_at: new Date(),
          },
        });

        // Queue initial sync job
        await getMessageQueue().addInitialSyncJob({
          scopeId,
          connectionId: scope.connection_id,
          userId: scope.connections.user_id,
        });

        await this.setResyncCooldown(scopeId);
        repairs.scopesResynced++;
        resyncCount++;

        this.logger.info({ scopeId }, 'Queued full resync for folder hierarchy repair');
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.logger.warn({ scopeId, error: errorInfo }, 'Failed to queue scope resync for hierarchy repair');
        repairs.errors++;
      }
    }

    // ── 3. Reparent orphaned local files (no connection_scope_id → move to root) ──

    const localOrphans = detection.orphanedChildren.filter((o) => !o.connectionScopeId);
    if (localOrphans.length > 0) {
      try {
        const localOrphanIds = localOrphans.map((o) => o.id);
        await prisma.files.updateMany({
          where: { id: { in: localOrphanIds } },
          data: { parent_folder_id: null, updated_at: new Date() },
        });
        repairs.localFilesReparented = localOrphans.length;
        this.logger.info(
          { count: localOrphans.length },
          'Reparented orphaned local files to root',
        );
      } catch (err) {
        const errorInfo = err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
        this.logger.warn({ error: errorInfo }, 'Failed to reparent local orphans');
        repairs.errors++;
      }
    }

    return repairs;
  }

  /** Check if a scope's hierarchy resync is on cooldown. Fail-open. */
  private async isResyncCooldownActive(scopeId: string): Promise<boolean> {
    const client = getRedisClient();
    if (!client) return false;

    try {
      const key = `${HIERARCHY_RESYNC_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      const ttl = await client.ttl(key);
      return ttl > 0;
    } catch {
      return false; // Fail open
    }
  }

  /** Set resync cooldown for a scope. Best-effort. */
  private async setResyncCooldown(scopeId: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      const key = `${HIERARCHY_RESYNC_COOLDOWN_PREFIX}${scopeId.toUpperCase()}`;
      await client.set(key, '1', { EX: HIERARCHY_RESYNC_COOLDOWN_SECONDS });
    } catch {
      // Best-effort
    }
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
