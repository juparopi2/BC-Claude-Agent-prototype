/**
 * SearchIndexComparator (PRD-304)
 *
 * Shared helper used by MissingFromSearchDetector and OrphanedInSearchDetector.
 * Compares the set of ready file IDs in the DB against those in the Azure AI
 * Search index for a given user, returning the symmetric difference.
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DB_BATCH_SIZE = 500;

// ──────────────────────────────────────────────────────────────────────────────
// Result type
// ──────────────────────────────────────────────────────────────────────────────

export interface SearchIndexComparisonResult {
  /** All ready file IDs found in the DB (uppercased) */
  dbFileIds: Set<string>;
  /** All file IDs found in the AI Search index (uppercased) */
  searchFileIds: Set<string>;
  /** File IDs that are ready in DB but absent from the search index */
  missingFromSearch: string[];
  /** File IDs that exist in the search index but have no matching DB row */
  orphanedInSearch: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Comparator
// ──────────────────────────────────────────────────────────────────────────────

export class SearchIndexComparator {
  private readonly logger = createChildLogger({ service: 'SearchIndexComparator' });

  /**
   * Compare the DB ready-file set against the search index for a user.
   *
   * Uses a paginated DB query (DB_BATCH_SIZE = 500) to avoid loading all file
   * IDs into memory at once. All IDs are normalised to UPPERCASE.
   */
  async compare(userId: string): Promise<SearchIndexComparisonResult> {
    // ── Collect all file IDs from DB (paginated) ─────────────────────────

    const dbFileIds = new Set<string>();
    let skip = 0;

    while (true) {
      const batch = await prisma.files.findMany({
        where: { user_id: userId, pipeline_status: 'ready', deleted_at: null, is_folder: false },
        select: { id: true },
        skip,
        take: DB_BATCH_SIZE,
      });

      if (batch.length === 0) break;

      for (const f of batch) {
        dbFileIds.add(f.id.toUpperCase());
      }

      skip += DB_BATCH_SIZE;

      if (batch.length < DB_BATCH_SIZE) break;
    }

    this.logger.debug({ userId, dbReadyCount: dbFileIds.size }, 'SearchIndexComparator: DB ready files collected');

    // ── Collect all file IDs from search index ────────────────────────────

    const { VectorSearchService } = await import('@/services/search/VectorSearchService');
    const searchFileIds = new Set(
      (await VectorSearchService.getInstance().getUniqueFileIds(userId)).map((id) =>
        id.toUpperCase(),
      ),
    );

    this.logger.debug({ userId, searchIndexCount: searchFileIds.size }, 'SearchIndexComparator: search index files collected');

    // ── Compute set differences ───────────────────────────────────────────

    const missingFromSearch = [...dbFileIds].filter((id) => !searchFileIds.has(id));
    const orphanedInSearch = [...searchFileIds].filter((id) => !dbFileIds.has(id));

    return { dbFileIds, searchFileIds, missingFromSearch, orphanedInSearch };
  }
}
