/**
 * ExternalFileCleanupRepairer
 *
 * Soft-deletes files that are no longer accessible externally, using the same
 * cleanup pattern for two distinct detection cases:
 *
 *   • external_not_found       — OneDrive/SharePoint files that returned a
 *                                Graph API 404 (file deleted or moved externally)
 *   • disconnected_connection  — Files whose connection was disconnected, expired,
 *                                or hard-deleted (files are inaccessible via Graph)
 *
 * Cleanup sequence per file:
 *   1. Vector cleanup (best-effort) — delete AI Search index chunks
 *   2. Hard-delete file_chunks DB rows
 *   3. Soft-delete the file — MUST set BOTH deleted_at AND deletion_status='pending'
 *
 * The FileDeletionWorker handles physical cleanup (blob, search index hard-delete,
 * final DB row removal) asynchronously after the soft-delete.
 *
 * @module services/sync/health/repairers
 */

import { createChildLogger } from '@/shared/utils/logger';

// ──────────────────────────────────────────────────────────────────────────────
// Repairer
// ──────────────────────────────────────────────────────────────────────────────

export class ExternalFileCleanupRepairer {
  private readonly logger = createChildLogger({ service: 'ExternalFileCleanupRepairer' });

  /**
   * Soft-delete inaccessible external files and clean up their stored artifacts.
   *
   * Handles both `external_not_found` and `disconnected_connection` file sets
   * via the same cleanup logic. Per-file try/catch ensures one failure never
   * aborts the rest.
   *
   * @param userId  - Owning user (for tenant isolation in vector cleanup)
   * @param fileIds - Uppercase file IDs to clean up
   * @returns Count of successfully cleaned files and error count
   */
  async cleanup(
    userId: string,
    fileIds: string[],
  ): Promise<{ cleaned: number; errors: number }> {
    let cleaned = 0;
    let errors = 0;

    const { prisma } = await import('@/infrastructure/database/prisma');

    for (const fileId of fileIds) {
      try {
        // Step 1 — Delete vector chunks (best-effort; failure does not abort)
        try {
          const { VectorSearchService } = await import('@/services/search/VectorSearchService');
          await VectorSearchService.getInstance().deleteChunksForFile(fileId, userId);
        } catch (vecErr) {
          const errorInfo =
            vecErr instanceof Error
              ? { message: vecErr.message, name: vecErr.name }
              : { value: String(vecErr) };
          this.logger.warn(
            { fileId, userId, error: errorInfo },
            'Failed to delete vector chunks for inaccessible file (best-effort, continuing)',
          );
        }

        // Step 2 — Hard-delete file_chunks DB records
        await prisma.file_chunks.deleteMany({ where: { file_id: fileId } });

        // Step 3 — Soft-delete the file row
        // MUST set BOTH fields — cleanup queries check deletion_status, not deleted_at
        // Optimistic concurrency guard: deletion_status: null ensures we only update
        // files that have not already been soft-deleted between detection and repair.
        // If count is 0, the file was already deleted — skip silently.
        const result = await prisma.files.updateMany({
          where: { id: fileId, deletion_status: null },
          data: { deleted_at: new Date(), deletion_status: 'pending' },
        });

        if (result.count === 0) {
          this.logger.debug(
            { fileId, userId },
            'File already soft-deleted before repair — skipping',
          );
          continue;
        }

        cleaned++;
      } catch (err) {
        const errorInfo =
          err instanceof Error
            ? { message: err.message, name: err.name }
            : { value: String(err) };
        this.logger.warn(
          { fileId, userId, error: errorInfo },
          'Failed to clean up inaccessible external file',
        );
        errors++;
      }
    }

    return { cleaned, errors };
  }
}
