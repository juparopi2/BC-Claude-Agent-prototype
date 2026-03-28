/**
 * FailedRetriableDetector (PRD-304)
 *
 * Detects files with pipeline_status='failed' and pipeline_retry_count < 3,
 * meaning they are eligible for another processing attempt.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult, DetectedFileRow } from './types';

export class FailedRetriableDetector implements DriftDetector<DetectedFileRow> {
  readonly name = 'FailedRetriableDetector';

  private readonly logger = createChildLogger({ service: 'FailedRetriableDetector' });

  async detect(userId: string): Promise<DetectionResult<DetectedFileRow>> {
    // Pre-fetch scope IDs that are actively syncing for this user.
    // The files model has no Prisma relation to connection_scopes, so we resolve
    // the scope IDs in a separate query and use `{ notIn: [...] }` below.
    const syncingScopes = await prisma.connection_scopes.findMany({
      where: {
        connections: { user_id: userId },
        sync_status: { in: ['syncing', 'sync_queued'] },
      },
      select: { id: true },
    });
    const syncingScopeIds = syncingScopes.map((s) => s.id);

    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'failed',
        pipeline_retry_count: { lt: 3 },
        deleted_at: null,
        deletion_status: null,
        // Transient sync guard: exclude files in actively-syncing scopes.
        // NULL scope IDs (local files) pass through since notIn doesn't match NULL.
        ...(syncingScopeIds.length > 0
          ? { OR: [{ connection_scope_id: null }, { connection_scope_id: { notIn: syncingScopeIds } }] }
          : {}),
      },
      select: { id: true, name: true, mime_type: true, connection_scope_id: true },
    });

    // Normalise IDs to UPPERCASE — preserve full row for repair use
    const items: DetectedFileRow[] = rows.map((f) => ({
      id: f.id.toUpperCase(),
      name: f.name,
      mime_type: f.mime_type,
      connection_scope_id: f.connection_scope_id,
    }));

    this.logger.debug(
      { userId, count: items.length },
      'FailedRetriableDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
