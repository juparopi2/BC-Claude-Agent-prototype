/**
 * ExternalNotFoundDetector (PRD-304)
 *
 * Detects external files (OneDrive / SharePoint) that no longer exist in the
 * cloud — identified by a Graph API 404 error in their last processing error.
 *
 * These files failed with one of:
 *   - "Graph API error (404)"
 *   - "itemNotFound"
 *   - "resource could not be found"
 *
 * They should be soft-deleted since the underlying resource is gone.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult } from './types';

export class ExternalNotFoundDetector implements DriftDetector<string> {
  readonly name = 'ExternalNotFoundDetector';

  private readonly logger = createChildLogger({ service: 'ExternalNotFoundDetector' });

  async detect(userId: string): Promise<DetectionResult<string>> {
    const rows = await prisma.files.findMany({
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

    const items = rows.map((f) => f.id.toUpperCase());

    this.logger.debug(
      { userId, count: items.length },
      'ExternalNotFoundDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
