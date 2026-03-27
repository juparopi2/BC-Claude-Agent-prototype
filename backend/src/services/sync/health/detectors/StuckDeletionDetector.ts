/**
 * StuckDeletionDetector (PRD-304)
 *
 * Detects files with deletion_status='pending' that have been stuck in that
 * state for more than 1 hour. These files were soft-deleted but the
 * FileDeletionWorker never completed the cleanup.
 *
 * Resolution is via hierarchical truth:
 *   - Connection connected → file is resurrected (deletion was premature)
 *   - Connection dead/missing → file is hard-deleted (deletion was correct)
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { DriftDetector, DetectionResult, StuckDeletionFileRow } from './types';

const STUCK_DELETION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export class StuckDeletionDetector implements DriftDetector<StuckDeletionFileRow> {
  readonly name = 'StuckDeletionDetector';
  private readonly logger = createChildLogger({ service: 'StuckDeletionDetector' });

  async detect(userId: string): Promise<DetectionResult<StuckDeletionFileRow>> {
    const { prisma } = await import('@/infrastructure/database/prisma');
    const stuckThreshold = new Date(Date.now() - STUCK_DELETION_THRESHOLD_MS);

    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        deletion_status: 'pending',
        deleted_at: { lt: stuckThreshold },
      },
      select: {
        id: true,
        name: true,
        mime_type: true,
        connection_scope_id: true,
        connection_id: true,
        source_type: true,
      },
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
