/**
 * StuckDeletionDetector (PRD-304)
 *
 * Detects files with deletion_status='pending' that are stuck in that state.
 * These files were soft-deleted but the FileDeletionWorker never completed
 * the cleanup. Uses a two-path OR strategy:
 *
 * Fast path (no time threshold): Files on connected+synced scopes.
 *   Disconnect/reconnect races cause delta cursors to skip unchanged files,
 *   leaving them stuck indefinitely. These are caught immediately without
 *   waiting for the 1-hour threshold.
 *
 * Slow path (1-hour threshold): All other stuck deletions.
 *   Gives FileDeletionWorker time to complete legitimate cleanup before
 *   treating a file as stuck.
 *
 * Resolution is via hierarchical truth (handled by StuckDeletionRepairer):
 *   - Connection connected → file is resurrected (deletion was premature)
 *   - Connection dead/missing → file is hard-deleted (deletion was correct)
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { DriftDetector, DetectionResult, StuckDeletionFileRow } from './types';

const STUCK_DELETION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const FILE_SELECT = {
  id: true,
  name: true,
  mime_type: true,
  connection_scope_id: true,
  connection_id: true,
  source_type: true,
} as const;

export class StuckDeletionDetector implements DriftDetector<StuckDeletionFileRow> {
  readonly name = 'StuckDeletionDetector';
  private readonly logger = createChildLogger({ service: 'StuckDeletionDetector' });

  async detect(userId: string): Promise<DetectionResult<StuckDeletionFileRow>> {
    const { prisma } = await import('@/infrastructure/database/prisma');
    const stuckThreshold = new Date(Date.now() - STUCK_DELETION_THRESHOLD_MS);

    // Pre-fetch scope IDs for connected+non-error scopes owned by this user.
    // The files model has no Prisma relation to connection_scopes, so we resolve
    // the scope IDs in a separate query and use `{ in: [...] }` below.
    const activeScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: userId, status: 'connected' },
        sync_status: { notIn: ['error'] },
      },
      select: { id: true },
    });
    const activeScopeIds = activeScopes.map((s) => s.id);

    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: 'pending',
        OR: [
          // Fast path: files on connected+synced scopes — no time threshold.
          // Disconnect/reconnect race: delta cursor won't re-deliver unchanged
          // files, so these will remain stuck indefinitely without this path.
          ...(activeScopeIds.length > 0
            ? [{ connection_scope_id: { in: activeScopeIds } }]
            : []),
          // Slow path: everything else — after 1-hour threshold.
          // Gives FileDeletionWorker time to complete legitimate cleanup.
          {
            deleted_at: { lt: stuckThreshold },
          },
        ],
      },
      select: FILE_SELECT,
    });

    const items: StuckDeletionFileRow[] = rows.map((f) => ({
      id: f.id.toUpperCase(),
      name: f.name,
      mime_type: f.mime_type,
      connection_scope_id: f.connection_scope_id,
      connection_id: f.connection_id,
      source_type: f.source_type,
    }));

    this.logger.debug(
      { userId, count: items.length, stuckThreshold },
      'StuckDeletionDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
