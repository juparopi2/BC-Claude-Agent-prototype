/**
 * OrphanCleanupRepairer
 *
 * Deletes orphaned search documents — chunks that exist in the Azure AI Search
 * index but have no matching row in the DB files table.
 *
 * These arise when a file is hard-deleted from the DB without cleaning up its
 * index documents, or when a partial cleanup leaves stale chunks behind.
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class OrphanCleanupRepairer {
  private readonly logger = createChildLogger({ service: 'OrphanCleanupRepairer' });

  /**
   * Delete orphaned chunks from the AI Search index for each provided file ID.
   *
   * Per-file try/catch ensures one failure never aborts the rest.
   *
   * @param userId         - Owning user (passed through to VectorSearchService for tenant isolation)
   * @param orphanedFileIds - Uppercase file IDs whose search chunks have no matching DB row
   * @returns Count of deleted orphans and error count
   */
  async cleanup(
    userId: string,
    orphanedFileIds: string[],
  ): Promise<{ orphansDeleted: number; errors: number }> {
    let orphansDeleted = 0;
    let errors = 0;

    for (const fileId of orphanedFileIds) {
      try {
        const { VectorSearchService } = await import('@/services/search/VectorSearchService');
        await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
        orphansDeleted++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, userId, error: errorInfo },
          'Failed to delete orphaned search chunks',
        );
        errors++;
      }
    }

    return { orphansDeleted, errors };
  }
}
