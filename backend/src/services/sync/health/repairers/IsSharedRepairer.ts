/**
 * IsSharedRepairer
 *
 * Corrects is_shared=true on SharePoint files/folders that were misclassified
 * by the sync pipeline's `isShared: !!scope.remote_drive_id` logic.
 *
 * SharePoint scopes always have remote_drive_id (the library drive ID), but
 * this is NOT a sharing indicator. Only OneDrive "Shared with me" items should
 * have is_shared=true.
 *
 * This is a metadata-only repair — no file reprocessing required.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class IsSharedRepairer {
  private readonly logger = createChildLogger({ service: 'IsSharedRepairer' });

  /**
   * Set is_shared=false on misclassified SharePoint items.
   *
   * @param userId - Owning user
   * @param fileIds - Uppercase file IDs to correct
   * @returns Count of corrected items and errors
   */
  async repair(
    userId: string,
    fileIds: string[],
  ): Promise<{ corrected: number; errors: number }> {
    if (fileIds.length === 0) {
      return { corrected: 0, errors: 0 };
    }

    try {
      const result = await prisma.files.updateMany({
        where: {
          id: { in: fileIds },
          user_id: userId,
          source_type: 'sharepoint',
          is_shared: true,
        },
        data: { is_shared: false },
      });

      this.logger.info(
        { userId, requested: fileIds.length, corrected: result.count },
        'IsSharedRepairer: corrected SharePoint is_shared misclassification',
      );

      return { corrected: result.count, errors: 0 };
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      this.logger.warn(
        { userId, error: errorInfo, fileCount: fileIds.length },
        'IsSharedRepairer: failed to correct is_shared',
      );
      return { corrected: 0, errors: 1 };
    }
  }
}
