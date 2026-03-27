/**
 * StuckPipelineDetector (PRD-304)
 *
 * Detects files stuck in an intermediate pipeline state (queued, extracting,
 * chunking, embedding) for longer than STUCK_THRESHOLD_MS (30 minutes).
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult, DetectedFileRow } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ──────────────────────────────────────────────────────────────────────────────
// Detector
// ──────────────────────────────────────────────────────────────────────────────

export class StuckPipelineDetector implements DriftDetector<DetectedFileRow> {
  readonly name = 'StuckPipelineDetector';

  private readonly logger = createChildLogger({ service: 'StuckPipelineDetector' });

  async detect(userId: string): Promise<DetectionResult<DetectedFileRow>> {
    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: { in: ['queued', 'extracting', 'chunking', 'embedding'] },
        updated_at: { lt: stuckThreshold },
        deleted_at: null,
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
      { userId, count: items.length, stuckThreshold },
      'StuckPipelineDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
