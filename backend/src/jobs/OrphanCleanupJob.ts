/**
 * Orphan Cleanup Job (D22)
 *
 * Detects and removes orphaned documents from Azure AI Search.
 * Orphans occur when:
 * - AI Search was unavailable during file deletion
 * - Network errors during cascade deletion
 * - Manual database cleanup without AI Search cleanup
 *
 * Run modes:
 * - One-time: Establish baseline (cleanup existing orphans)
 * - Scheduled: Weekly maintenance (prevent orphan accumulation)
 *
 * Usage:
 * ```typescript
 * const job = getOrphanCleanupJob();
 *
 * // Full cleanup for all users
 * const summary = await job.runFullCleanup();
 *
 * // Cleanup for specific user
 * const result = await job.cleanOrphansForUser('user-id-123');
 * ```
 *
 * @module jobs/OrphanCleanupJob
 */

import { createChildLogger } from '@/shared/utils/logger';
import { VectorSearchService } from '@services/search/VectorSearchService';
import { executeQuery } from '@/infrastructure/database/database';

/**
 * Result of cleaning orphans for a single user
 */
export interface OrphanCleanupResult {
  userId: string;
  totalOrphans: number;
  deletedOrphans: number;
  failedDeletions: number;
  orphanFileIds: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Summary of a full cleanup run across all users
 */
export interface CleanupJobSummary {
  startedAt: Date;
  completedAt: Date;
  totalUsers: number;
  totalOrphans: number;
  totalDeleted: number;
  totalFailed: number;
  userResults: OrphanCleanupResult[];
}

/**
 * Dependencies for OrphanCleanupJob (for testing)
 */
export interface OrphanCleanupJobDependencies {
  vectorSearchService?: VectorSearchService;
  executeQuery?: typeof executeQuery;
}

/**
 * Job to detect and cleanup orphaned documents in Azure AI Search
 */
export class OrphanCleanupJob {
  private vectorSearchService: VectorSearchService;
  private executeQueryFn: typeof executeQuery;
  private log = createChildLogger({ service: 'OrphanCleanupJob' });

  constructor(deps?: OrphanCleanupJobDependencies) {
    this.vectorSearchService = deps?.vectorSearchService ?? VectorSearchService.getInstance();
    this.executeQueryFn = deps?.executeQuery ?? executeQuery;
  }

  /**
   * Clean orphaned documents for a specific user
   *
   * Logic:
   * 1. Get all fileIds from Azure AI Search for the user
   * 2. Get all fileIds from SQL database for the user
   * 3. Find orphans (in AI Search but not in SQL)
   * 4. Delete orphaned documents from AI Search
   *
   * @param userId - User ID to clean orphans for
   * @returns Cleanup result with statistics
   */
  async cleanOrphansForUser(userId: string): Promise<OrphanCleanupResult> {
    const startTime = Date.now();
    const result: OrphanCleanupResult = {
      userId,
      totalOrphans: 0,
      deletedOrphans: 0,
      failedDeletions: 0,
      orphanFileIds: [],
      errors: [],
      durationMs: 0,
    };

    try {
      // 1. Get fileIds from Azure AI Search
      const searchFileIds = await this.vectorSearchService.getUniqueFileIds(userId);
      this.log.info(
        { userId, searchFileIdCount: searchFileIds.length },
        'Retrieved fileIds from AI Search'
      );

      if (searchFileIds.length === 0) {
        result.durationMs = Date.now() - startTime;
        this.log.info({ userId }, 'No documents in AI Search - nothing to clean');
        return result;
      }

      // 2. Get fileIds from SQL database
      const dbFileIds = await this.getFileIdsFromDb(userId);
      const dbFileIdSet = new Set(dbFileIds.map((id) => id.toLowerCase()));
      this.log.info({ userId, dbFileIdCount: dbFileIds.length }, 'Retrieved fileIds from database');

      // 3. Find orphans (in AI Search but not in SQL)
      // Use case-insensitive comparison
      const orphanFileIds = searchFileIds.filter(
        (id) => !dbFileIdSet.has(id.toLowerCase())
      );
      result.totalOrphans = orphanFileIds.length;
      result.orphanFileIds = orphanFileIds;

      if (orphanFileIds.length === 0) {
        this.log.info({ userId }, 'No orphaned documents found');
        result.durationMs = Date.now() - startTime;
        return result;
      }

      this.log.info(
        { userId, orphanCount: orphanFileIds.length, orphanFileIds },
        'Found orphaned documents'
      );

      // 4. Delete orphaned documents
      for (const fileId of orphanFileIds) {
        try {
          await this.vectorSearchService.deleteChunksForFile(fileId, userId);
          result.deletedOrphans++;
          this.log.debug({ userId, fileId }, 'Deleted orphaned document');
        } catch (error) {
          result.failedDeletions++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to delete fileId ${fileId}: ${errorMsg}`);
          this.log.warn({ userId, fileId, error: errorMsg }, 'Failed to delete orphan');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);
      this.log.error({ userId, error: errorMsg }, 'Orphan cleanup failed');
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * Run cleanup for all users with documents in AI Search
   *
   * @returns Summary of all cleanup operations
   */
  async runFullCleanup(): Promise<CleanupJobSummary> {
    const startedAt = new Date();
    const summary: CleanupJobSummary = {
      startedAt,
      completedAt: new Date(),
      totalUsers: 0,
      totalOrphans: 0,
      totalDeleted: 0,
      totalFailed: 0,
      userResults: [],
    };

    try {
      // Get all users with files
      const users = await this.getUsersWithFiles();
      summary.totalUsers = users.length;

      this.log.info({ userCount: users.length }, 'Starting full orphan cleanup');

      for (const userId of users) {
        const result = await this.cleanOrphansForUser(userId);
        summary.userResults.push(result);
        summary.totalOrphans += result.totalOrphans;
        summary.totalDeleted += result.deletedOrphans;
        summary.totalFailed += result.failedDeletions;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error({ error: errorMsg }, 'Full cleanup failed');
    }

    summary.completedAt = new Date();
    this.log.info(
      {
        totalUsers: summary.totalUsers,
        totalOrphans: summary.totalOrphans,
        totalDeleted: summary.totalDeleted,
        totalFailed: summary.totalFailed,
        durationMs: summary.completedAt.getTime() - startedAt.getTime(),
      },
      'Orphan cleanup completed'
    );

    return summary;
  }

  /**
   * Get file IDs from database for a user
   * Only returns non-folder files (files that could have embeddings)
   */
  private async getFileIdsFromDb(userId: string): Promise<string[]> {
    const result = await this.executeQueryFn<{ id: string }>(
      `SELECT id FROM files WHERE user_id = @userId AND is_folder = 0`,
      { userId }
    );
    return result.recordset.map((r) => r.id);
  }

  /**
   * Get all users who have files in the database
   */
  private async getUsersWithFiles(): Promise<string[]> {
    const result = await this.executeQueryFn<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM files WHERE is_folder = 0`
    );
    return result.recordset.map((r) => r.user_id);
  }
}

// Singleton instance
let instance: OrphanCleanupJob | null = null;

/**
 * Get the singleton OrphanCleanupJob instance
 */
export function getOrphanCleanupJob(): OrphanCleanupJob {
  if (!instance) {
    instance = new OrphanCleanupJob();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetOrphanCleanupJob(): void {
  instance = null;
}
