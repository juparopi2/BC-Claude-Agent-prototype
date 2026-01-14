/**
 * OrphanCleanupJob Unit Tests (D22)
 *
 * Tests orphan detection and cleanup logic with mocked dependencies.
 *
 * @module __tests__/unit/jobs/OrphanCleanupJob
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrphanCleanupJob,
  getOrphanCleanupJob,
  __resetOrphanCleanupJob,
} from '@/jobs/OrphanCleanupJob';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('OrphanCleanupJob (D22)', () => {
  let job: OrphanCleanupJob;
  let mockVectorSearchService: {
    getUniqueFileIds: ReturnType<typeof vi.fn>;
    deleteChunksForFile: ReturnType<typeof vi.fn>;
  };
  let mockExecuteQuery: ReturnType<typeof vi.fn>;

  const testUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetOrphanCleanupJob();

    mockVectorSearchService = {
      getUniqueFileIds: vi.fn(),
      deleteChunksForFile: vi.fn(),
    };

    mockExecuteQuery = vi.fn();

    job = new OrphanCleanupJob({
      vectorSearchService: mockVectorSearchService as any,
      executeQuery: mockExecuteQuery,
    });
  });

  describe('cleanOrphansForUser()', () => {
    it('should return empty result when AI Search has no documents', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue([]);

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(0);
      expect(result.deletedOrphans).toBe(0);
      expect(result.orphanFileIds).toEqual([]);
      expect(result.userId).toBe(testUserId);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect orphans when AI Search has files not in DB', async () => {
      // AI Search has 3 files
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue([
        'file-1',
        'file-2',
        'file-3',
      ]);

      // DB only has 1 file
      mockExecuteQuery.mockResolvedValue({
        recordset: [{ id: 'file-1' }],
      });

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(2);
      expect(result.orphanFileIds).toContain('file-2');
      expect(result.orphanFileIds).toContain('file-3');
      expect(result.orphanFileIds).not.toContain('file-1');
    });

    it('should delete orphaned documents from AI Search', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue(['orphan-file']);
      mockExecuteQuery.mockResolvedValue({ recordset: [] });
      mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

      const result = await job.cleanOrphansForUser(testUserId);

      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
        'orphan-file',
        testUserId
      );
      expect(result.deletedOrphans).toBe(1);
      expect(result.failedDeletions).toBe(0);
    });

    it('should handle deletion failures gracefully', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue(['failing-file']);
      mockExecuteQuery.mockResolvedValue({ recordset: [] });
      mockVectorSearchService.deleteChunksForFile.mockRejectedValue(
        new Error('AI Search unavailable')
      );

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(1);
      expect(result.deletedOrphans).toBe(0);
      expect(result.failedDeletions).toBe(1);
      expect(result.errors).toContain(
        'Failed to delete fileId failing-file: AI Search unavailable'
      );
    });

    it('should handle case-insensitive fileId comparison', async () => {
      // AI Search has uppercase fileId
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue(['ABC123-FILE']);

      // DB has lowercase fileId (same file)
      mockExecuteQuery.mockResolvedValue({
        recordset: [{ id: 'abc123-file' }],
      });

      const result = await job.cleanOrphansForUser(testUserId);

      // Should NOT detect as orphan (same file, different case)
      expect(result.totalOrphans).toBe(0);
    });

    it('should delete all orphans when DB is empty', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue([
        'orphan-1',
        'orphan-2',
        'orphan-3',
      ]);
      mockExecuteQuery.mockResolvedValue({ recordset: [] });
      mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(3);
      expect(result.deletedOrphans).toBe(3);
      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledTimes(3);
    });

    it('should handle partial deletion failures', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue([
        'success-1',
        'failure-1',
        'success-2',
      ]);
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      // First and third succeed, second fails
      mockVectorSearchService.deleteChunksForFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(3);
      expect(result.deletedOrphans).toBe(2);
      expect(result.failedDeletions).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should handle VectorSearchService initialization errors', async () => {
      mockVectorSearchService.getUniqueFileIds.mockRejectedValue(
        new Error('Failed to initialize search client')
      );

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.totalOrphans).toBe(0);
      expect(result.errors).toContain('Failed to initialize search client');
    });

    it('should handle database query errors', async () => {
      mockVectorSearchService.getUniqueFileIds.mockResolvedValue(['file-1']);
      mockExecuteQuery.mockRejectedValue(new Error('Database connection failed'));

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.errors).toContain('Database connection failed');
    });

    it('should return correct duration in milliseconds', async () => {
      mockVectorSearchService.getUniqueFileIds.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 50))
      );

      const result = await job.cleanOrphansForUser(testUserId);

      expect(result.durationMs).toBeGreaterThanOrEqual(40); // Allow some variance
    });
  });

  describe('runFullCleanup()', () => {
    it('should cleanup orphans for all users with files', async () => {
      // Two users in DB
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ user_id: 'user-1' }, { user_id: 'user-2' }] })
        // user-1 DB files
        .mockResolvedValueOnce({ recordset: [{ id: 'file-1' }] })
        // user-2 DB files
        .mockResolvedValueOnce({ recordset: [] });

      // user-1 AI Search has matching file
      mockVectorSearchService.getUniqueFileIds
        .mockResolvedValueOnce(['file-1'])
        // user-2 AI Search has orphan
        .mockResolvedValueOnce(['orphan-file']);

      mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

      const summary = await job.runFullCleanup();

      expect(summary.totalUsers).toBe(2);
      expect(summary.totalOrphans).toBe(1); // Only user-2 has orphan
      expect(summary.totalDeleted).toBe(1);
      expect(summary.userResults).toHaveLength(2);
    });

    it('should return empty summary when no users have files', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      const summary = await job.runFullCleanup();

      expect(summary.totalUsers).toBe(0);
      expect(summary.totalOrphans).toBe(0);
      expect(summary.userResults).toHaveLength(0);
    });

    it('should aggregate totals across all users', async () => {
      // Three users
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: 'user-1' }, { user_id: 'user-2' }, { user_id: 'user-3' }],
      });

      // All users have no files in DB
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      // Each user has orphans
      mockVectorSearchService.getUniqueFileIds
        .mockResolvedValueOnce(['o1', 'o2']) // user-1: 2 orphans
        .mockResolvedValueOnce(['o3']) // user-2: 1 orphan
        .mockResolvedValueOnce(['o4', 'o5', 'o6']); // user-3: 3 orphans

      mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

      const summary = await job.runFullCleanup();

      expect(summary.totalOrphans).toBe(6);
      expect(summary.totalDeleted).toBe(6);
      expect(summary.totalFailed).toBe(0);
    });

    it('should track completion timestamps', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      const beforeRun = new Date();
      const summary = await job.runFullCleanup();
      const afterRun = new Date();

      expect(summary.startedAt.getTime()).toBeGreaterThanOrEqual(beforeRun.getTime());
      expect(summary.completedAt.getTime()).toBeLessThanOrEqual(afterRun.getTime());
      expect(summary.completedAt.getTime()).toBeGreaterThanOrEqual(summary.startedAt.getTime());
    });

    it('should handle user query errors', async () => {
      mockExecuteQuery.mockRejectedValue(new Error('Database error'));

      const summary = await job.runFullCleanup();

      expect(summary.totalUsers).toBe(0);
      expect(summary.userResults).toHaveLength(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getOrphanCleanupJob();
      const instance2 = getOrphanCleanupJob();

      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getOrphanCleanupJob();
      __resetOrphanCleanupJob();
      const instance2 = getOrphanCleanupJob();

      expect(instance1).not.toBe(instance2);
    });
  });
});
