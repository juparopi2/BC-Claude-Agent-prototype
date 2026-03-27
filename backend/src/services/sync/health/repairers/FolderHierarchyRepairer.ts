/**
 * FolderHierarchyRepairer
 *
 * Repairs broken folder hierarchy issues detected by SyncReconciliationService.
 *
 * Three repair actions:
 *   1. Recreate missing scope root folders — quick DB create via ensureScopeRootFolder,
 *      no Graph API call required.
 *   2. Queue full resync for affected scopes — clears last_sync_cursor → forces a
 *      complete InitialSync which rebuilds the entire folder tree.
 *   3. Reparent orphaned local files — files with no connection_scope_id whose
 *      parent_folder_id references a missing row are moved to root (null).
 *
 * Rate limiting:
 *   - Max MAX_SCOPES_TO_RESYNC_PER_RUN scopes resynced per reconciliation run
 *   - Redis 30-min cooldown per scope (sync:hierarchy_resync:{scopeId}) — fail-open
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import type { FolderHierarchyDetection, FolderHierarchyRepairs } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_SCOPES_TO_RESYNC_PER_RUN = 5;
const HIERARCHY_RESYNC_COOLDOWN_PREFIX = 'sync:hierarchy_resync:';
const HIERARCHY_RESYNC_COOLDOWN_SECONDS = 1800; // 30 minutes

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class FolderHierarchyRepairer {
  private readonly logger = createChildLogger({ service: 'FolderHierarchyRepairer' });

  /**
   * Repair folder hierarchy issues for a user.
   *
   * @param userId    - Owning user
   * @param detection - Results from detectFolderHierarchyIssues()
   * @returns Repair counts and error count
   */
  async repair(
    userId: string,
    detection: FolderHierarchyDetection,
  ): Promise<FolderHierarchyRepairs> {
    const repairs: FolderHierarchyRepairs = {
      scopeRootsRecreated: 0,
      scopesResynced: 0,
      scopesSkippedDisconnected: 0,
      localFilesReparented: 0,
      foldersRestored: 0,
      errors: 0,
    };

    // ── 1. Recreate missing scope root folders ──────────────────────────────

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
          isShared: !!missing.remoteDriveId,
        });

        repairs.scopeRootsRecreated++;
        this.logger.info(
          { scopeId: missing.scopeId, scopeDisplayName: missing.scopeDisplayName },
          'Recreated missing scope root folder',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { scopeId: missing.scopeId, error: errorInfo },
          'Failed to recreate scope root folder',
        );
        repairs.errors++;
      }
    }

    // ── 2. Queue full resync for affected scopes (capped per run) ───────────

    const { prisma } = await import('@/infrastructure/database/prisma');
    const { getMessageQueue } = await import('@/infrastructure/queue');

    let resyncCount = 0;
    for (const scopeId of detection.scopeIdsToResync) {
      if (resyncCount >= MAX_SCOPES_TO_RESYNC_PER_RUN) break;

      try {
        // Check Redis cooldown — fail-open if Redis unavailable
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
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { scopeId, error: errorInfo },
          'Failed to queue scope resync for hierarchy repair',
        );
        repairs.errors++;
      }
    }

    // ── 3. Reparent orphaned local files to root ────────────────────────────
    // Local files have no connection_scope_id — move to root (parent_folder_id = null)

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
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ error: errorInfo }, 'Failed to reparent local orphans');
        repairs.errors++;
      }
    }

    // ── 4. Restore soft-deleted folders on active scopes ────────────────────
    // These folders were erroneously soft-deleted (e.g., FileExtractWorker 404 on
    // folders, or disconnect/reconnect race) but belong to active synced scopes.

    if (detection.softDeletedFoldersOnActiveScopes.length > 0) {
      try {
        const folderIds = detection.softDeletedFoldersOnActiveScopes.map((f) => f.id);
        const { prisma: db } = await import('@/infrastructure/database/prisma');

        const result = await db.files.updateMany({
          where: {
            id: { in: folderIds },
            is_folder: true,
            deletion_status: { not: null },
          },
          data: {
            deleted_at: null,
            deletion_status: null,
            pipeline_status: 'ready',
          },
        });

        repairs.foldersRestored = result.count;
        this.logger.info(
          { count: result.count, folderIds: folderIds.slice(0, 5) },
          'Restored soft-deleted folders on active scopes',
        );
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn({ error: errorInfo }, 'Failed to restore soft-deleted folders');
        repairs.errors++;
      }
    }

    return repairs;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — Redis cooldown helpers
  // ──────────────────────────────────────────────────────────────────────────

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
}
