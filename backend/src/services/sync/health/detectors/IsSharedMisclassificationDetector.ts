/**
 * IsSharedMisclassificationDetector
 *
 * Detects files/folders with is_shared=true that should not be shared.
 *
 * SharePoint items should NEVER have is_shared=true — the is_shared flag is
 * only for OneDrive "Shared with me" items. SharePoint scopes always have
 * remote_drive_id (the library drive ID for Graph API), but this is NOT a
 * sharing indicator.
 *
 * The sync pipeline historically used `isShared: !!scope.remote_drive_id`
 * which incorrectly marked all SharePoint items as shared.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Detector
// ──────────────────────────────────────────────────────────────────────────────

export class IsSharedMisclassificationDetector implements DriftDetector<string> {
  readonly name = 'IsSharedMisclassificationDetector';

  private readonly logger = createChildLogger({ service: 'IsSharedMisclassificationDetector' });

  async detect(userId: string): Promise<DetectionResult<string>> {
    // Find SharePoint files/folders marked as shared — they should all be is_shared=false
    const rows = await prisma.files.findMany({
      where: {
        user_id: userId,
        source_type: 'sharepoint',
        is_shared: true,
        deletion_status: null,
      },
      select: { id: true },
    });

    const items = rows.map((f) => f.id.toUpperCase());

    this.logger.debug(
      { userId, count: items.length },
      'IsSharedMisclassificationDetector: detection complete',
    );

    return { items, count: items.length };
  }
}
