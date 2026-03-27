/**
 * StaleSearchMetadataDetector (PRD-304)
 *
 * Detects 'ready' files whose metadata in the Azure AI Search index is stale
 * relative to the DB. Specifically checks:
 *   - sourceType mismatch (e.g., 'local' in search vs 'onedrive' in DB)
 *   - parentFolderId mismatch (file moved to a different folder)
 *
 * Stale metadata means RAG search may return incorrect context about file origin
 * or location. Repair: reset to 'queued' to trigger re-indexing with correct metadata.
 *
 * Note: Files absent from the search index entirely are handled by
 * MissingFromSearchDetector — this detector only checks files that ARE indexed.
 *
 * Samples up to MAX_SAMPLE_SIZE files per run to bound cost.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { DriftDetector, DetectionResult, DetectedFileRow } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Detector
// ──────────────────────────────────────────────────────────────────────────────

export class StaleSearchMetadataDetector implements DriftDetector<DetectedFileRow> {
  readonly name = 'StaleSearchMetadataDetector';

  private readonly logger = createChildLogger({ service: 'StaleSearchMetadataDetector' });

  private static readonly MAX_SAMPLE_SIZE = 200;

  async detect(userId: string): Promise<DetectionResult<DetectedFileRow>> {
    // 1. Get all ready non-folder files from DB with metadata
    const dbFiles = await prisma.files.findMany({
      where: {
        user_id: userId,
        pipeline_status: 'ready',
        deleted_at: null,
        is_folder: false,
      },
      select: {
        id: true,
        name: true,
        mime_type: true,
        source_type: true,
        parent_folder_id: true,
        connection_scope_id: true,
      },
    });

    if (dbFiles.length === 0) return { items: [], count: 0 };

    // 2. Get search metadata for this user (single batched call)
    const { VectorSearchService } = await import('@/services/search/VectorSearchService');
    const searchService = VectorSearchService.getInstance();

    let searchMetadata: Map<string, { sourceType: string | null; parentFolderId: string | null; siteId: string | null }>;
    try {
      searchMetadata = await searchService.getFileMetadataForUser(userId);
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      this.logger.warn(
        { userId, error: errorInfo },
        'StaleSearchMetadataDetector: failed to fetch search metadata, skipping',
      );
      return { items: [], count: 0 };
    }

    // 3. Compare DB vs Search metadata (sample up to MAX_SAMPLE_SIZE)
    const staleFiles: DetectedFileRow[] = [];
    let sampled = 0;

    for (const dbFile of dbFiles) {
      if (sampled >= StaleSearchMetadataDetector.MAX_SAMPLE_SIZE) break;

      const fileId = dbFile.id.toUpperCase();
      const searchDoc = searchMetadata.get(fileId);
      if (!searchDoc) continue; // File not in search — handled by MissingFromSearchDetector

      sampled++;

      const dbSourceType = dbFile.source_type ?? 'local';
      const dbParentFolderId = dbFile.parent_folder_id?.toUpperCase() ?? null;

      const searchSourceType = searchDoc.sourceType ?? 'local';
      const searchParentFolderId = searchDoc.parentFolderId?.toUpperCase() ?? null;

      if (dbSourceType !== searchSourceType || dbParentFolderId !== searchParentFolderId) {
        staleFiles.push({
          id: fileId,
          name: dbFile.name,
          mime_type: dbFile.mime_type,
          connection_scope_id: dbFile.connection_scope_id,
        });
      }
    }

    this.logger.debug(
      { userId, sampled, staleCount: staleFiles.length },
      'StaleSearchMetadataDetector: detection complete',
    );

    return { items: staleFiles, count: staleFiles.length };
  }
}
