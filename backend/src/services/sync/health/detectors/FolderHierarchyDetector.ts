/**
 * FolderHierarchyDetector (PRD-304)
 *
 * Detects folder hierarchy integrity issues for a user. Three issue types:
 *
 *   1. Orphaned children — files/folders whose parent_folder_id references a
 *      non-existent (or soft-deleted) folder. Detected via raw SQL NOT EXISTS.
 *
 *   2. Missing scope root folders — scope_type='folder' scopes whose root
 *      folder (external_id = scope_resource_id) is absent from the files table.
 *      The root folder is normally created by ensureScopeRootFolder() during
 *      initial sync.
 *
 *   3. Broken chains — subset of #1 where the orphan is itself a folder
 *      (cascading breakage).
 *
 * Transient orphan guard: files belonging to scopes with sync_status IN
 * ('syncing', 'sync_queued') are excluded to avoid false positives during
 * active sync.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { FolderHierarchyDetection } from '../types';
import type { DriftDetector, DetectionResult } from './types';

export class FolderHierarchyDetector implements DriftDetector<FolderHierarchyDetection> {
  readonly name = 'FolderHierarchyDetector';

  private readonly logger = createChildLogger({ service: 'FolderHierarchyDetector' });

  async detect(userId: string): Promise<DetectionResult<FolderHierarchyDetection>> {
    const result = await this.detectIssues(userId);
    return { items: [result], count: result.scopeIdsToResync.length };
  }

  /**
   * Core detection logic — returns the full FolderHierarchyDetection struct.
   * Exposed as a named method so callers can destructure the result directly
   * without going through the DetectionResult wrapper.
   */
  async detectIssues(userId: string): Promise<FolderHierarchyDetection> {
    // ── 1. Orphaned children (parent_folder_id → non-existent / soft-deleted) ──

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

    // ── 2. Missing scope root folders ──────────────────────────────────────

    const userScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: userId, status: 'connected' },
        scope_type: 'folder', // Only folder scopes have a root folder — library root items use parent_folder_id=null
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

    // ── 3. Build deduplicated set of scope IDs that need resync ────────────

    const scopeIdsToResync = new Set<string>();

    for (const orphan of orphanedChildren) {
      if (orphan.connection_scope_id) {
        scopeIdsToResync.add(orphan.connection_scope_id.toUpperCase());
      }
    }

    for (const missing of missingScopeRoots) {
      scopeIdsToResync.add(missing.scopeId.toUpperCase());
    }

    this.logger.debug(
      {
        userId,
        orphanedChildrenCount: orphanedChildren.length,
        missingScopeRootsCount: missingScopeRoots.length,
        scopesToResyncCount: scopeIdsToResync.size,
      },
      'FolderHierarchyDetector: detection complete',
    );

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
}
