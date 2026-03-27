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
    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'failed',
        pipeline_retry_count: { lt: 3 },
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
      { userId, count: items.length },
      'FailedRetriableDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
