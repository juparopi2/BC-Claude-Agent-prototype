/**
 * DisconnectedFilesDetector (PRD-304)
 *
 * Detects files associated with connections that are no longer active. Two
 * scenarios are covered in a two-pass query:
 *
 *   Pass 1 (Prisma): Files with a connections row whose status is
 *     'disconnected' or 'expired'.
 *
 *   Pass 2 (Raw SQL): Files with a non-null connection_id that references a
 *     connections row that was hard-deleted (no matching row exists).
 *
 * Both sets are merged (deduped) into a single list of file IDs.
 *
 * These files are inaccessible — Graph API calls will fail — and should be
 * soft-deleted so that the FileDeletionWorker can handle physical cleanup.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult } from './types';

export class DisconnectedFilesDetector implements DriftDetector<string> {
  readonly name = 'DisconnectedFilesDetector';

  private readonly logger = createChildLogger({ service: 'DisconnectedFilesDetector' });

  async detect(userId: string): Promise<DetectionResult<string>> {
    // ── Pass 1: disconnected / expired connection rows ─────────────────────

    const disconnectedFileRows = await prisma.files.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        deletion_status: null,
        connection_id: { not: null },
        connections: {
          status: { in: ['disconnected', 'expired'] },
        },
      },
      select: { id: true },
    });

    const disconnectedConnectionFiles = disconnectedFileRows.map((f) => f.id.toUpperCase());

    // ── Pass 2: hard-deleted connections (no connections row at all) ────────

    const orphanedConnectionFiles = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT f.id
      FROM files f
      WHERE f.user_id = ${userId}
        AND f.connection_id IS NOT NULL
        AND f.deleted_at IS NULL
        AND f.deletion_status IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM connections c WHERE c.id = f.connection_id
        )
    `;

    for (const f of orphanedConnectionFiles) {
      const upperId = f.id.toUpperCase();
      if (!disconnectedConnectionFiles.includes(upperId)) {
        disconnectedConnectionFiles.push(upperId);
      }
    }

    this.logger.debug(
      {
        userId,
        disconnectedCount: disconnectedFileRows.length,
        orphanedCount: orphanedConnectionFiles.length,
        totalCount: disconnectedConnectionFiles.length,
      },
      'DisconnectedFilesDetector: detection complete',
    );

    return { items: disconnectedConnectionFiles, count: disconnectedConnectionFiles.length };
  }
}
