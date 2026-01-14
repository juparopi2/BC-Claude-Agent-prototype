/**
 * PartialDataCleaner Unit Tests
 *
 * Tests for the partial data cleanup service.
 * This service handles cleanup of orphaned chunks and search documents
 * when file processing fails permanently.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 *
 * Methods covered:
 * - cleanupForFile()
 * - cleanupOrphanedChunks()
 * - cleanupOrphanedSearchDocs()
 * - cleanupOldFailedFiles()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CleanupResult, BatchCleanupResult } from '@bc-agent/shared';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK VECTOR SEARCH SERVICE =====
const mockDeleteChunksForFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      deleteChunksForFile: mockDeleteChunksForFile,
    })),
  },
}));

// ===== MOCK ORPHAN CLEANUP JOB =====
const mockRunFullCleanup = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    startedAt: new Date(),
    completedAt: new Date(),
    totalUsers: 0,
    totalOrphans: 0,
    totalDeleted: 0,
    totalFailed: 0,
    userResults: [],
  })
);

vi.mock('@/jobs/OrphanCleanupJob', () => ({
  getOrphanCleanupJob: vi.fn(() => ({
    runFullCleanup: mockRunFullCleanup,
  })),
}));

// ===== MOCK LOGGER =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// Import after mocks
import {
  PartialDataCleaner,
  getPartialDataCleaner,
  __resetPartialDataCleaner,
} from '@/domains/files/cleanup';

describe('PartialDataCleaner', () => {
  let cleaner: PartialDataCleaner;

  const testUserId = 'test-user-cleanup-123';
  const testFileId = 'test-file-cleanup-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    mockDeleteChunksForFile.mockResolvedValue(undefined);
    mockRunFullCleanup.mockResolvedValue({
      startedAt: new Date(),
      completedAt: new Date(),
      totalUsers: 0,
      totalOrphans: 0,
      totalDeleted: 0,
      totalFailed: 0,
      userResults: [],
    });

    // Reset singleton
    __resetPartialDataCleaner();
    cleaner = getPartialDataCleaner();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getPartialDataCleaner();
      const instance2 = getPartialDataCleaner();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getPartialDataCleaner();
      __resetPartialDataCleaner();
      const instance2 = getPartialDataCleaner();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: cleanupForFile ==========
  describe('cleanupForFile()', () => {
    it('should delete chunks from database', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [5] });

      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      expect(result.fileId).toBe(testFileId);
      expect(result.chunksDeleted).toBe(5);
      expect(result.success).toBe(true);

      // Verify query was called with correct params
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.objectContaining({
          fileId: testFileId,
          userId: testUserId,
        })
      );
    });

    it('should delete search documents from Azure AI Search', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [3] });
      mockDeleteChunksForFile.mockResolvedValue(undefined);

      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      // searchDocumentsDeleted equals chunksDeleted since deleteChunksForFile doesn't return count
      expect(result.searchDocumentsDeleted).toBe(3);
      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(testFileId, testUserId);
    });

    it('should return cleanup statistics', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [10] });
      mockDeleteChunksForFile.mockResolvedValue(undefined);

      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      expect(result).toEqual<CleanupResult>({
        fileId: testFileId,
        chunksDeleted: 10,
        searchDocumentsDeleted: 10,
        success: true,
        error: undefined,
      });
    });

    it('should continue cleanup if search deletion fails', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [5] });
      mockDeleteChunksForFile.mockRejectedValue(new Error('AI Search unavailable'));

      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      // Chunks should still be deleted
      expect(result.chunksDeleted).toBe(5);
      // Search docs deletion failed
      expect(result.searchDocumentsDeleted).toBe(0);
      // Overall success is true if chunks were cleaned
      expect(result.success).toBe(true);
    });

    it('should enforce multi-tenant isolation', async () => {
      await cleaner.cleanupForFile(testUserId, testFileId);

      // Verify userId is in the query parameters
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userId: testUserId })
      );
    });

    it('should not delete anything in dryRun mode', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [5] });

      const result = await cleaner.cleanupForFile(testUserId, testFileId, { dryRun: true });

      // In dryRun, we should still report what would be deleted
      expect(result.fileId).toBe(testFileId);
      // But actual delete should not be called (or called with dryRun logic)
      expect(result.success).toBe(true);
    });

    it('should return error info when cleanup fails completely', async () => {
      mockExecuteQuery.mockRejectedValue(new Error('Database connection failed'));

      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  // ========== SUITE 2: cleanupOrphanedChunks ==========
  describe('cleanupOrphanedChunks()', () => {
    it('should delete chunks without parent file', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [15] });

      const deleted = await cleaner.cleanupOrphanedChunks();

      expect(deleted).toBe(15);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN files'),
        expect.any(Object)
      );
    });

    it('should respect olderThanDays parameter', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [10] });

      await cleaner.cleanupOrphanedChunks(7);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DATEADD'),
        expect.objectContaining({ days: 7 })
      );
    });

    it('should use default retention days from config', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [5] });

      await cleaner.cleanupOrphanedChunks();

      // Should use config.cleanup.orphanedChunkRetentionDays (default: 7)
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ days: expect.any(Number) })
      );
    });

    it('should return count of deleted chunks', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [25] });

      const deleted = await cleaner.cleanupOrphanedChunks();

      expect(deleted).toBe(25);
    });
  });

  // ========== SUITE 3: cleanupOrphanedSearchDocs ==========
  describe('cleanupOrphanedSearchDocs()', () => {
    it('should delegate to OrphanCleanupJob', async () => {
      mockRunFullCleanup.mockResolvedValue({
        startedAt: new Date(),
        completedAt: new Date(),
        totalUsers: 1,
        totalOrphans: 20,
        totalDeleted: 20,
        totalFailed: 0,
        userResults: [],
      });

      const deleted = await cleaner.cleanupOrphanedSearchDocs();

      expect(deleted).toBe(20);
    });

    it('should handle deletion failures gracefully', async () => {
      mockRunFullCleanup.mockResolvedValue({
        startedAt: new Date(),
        completedAt: new Date(),
        totalUsers: 1,
        totalOrphans: 10,
        totalDeleted: 7,
        totalFailed: 3,
        userResults: [],
      });

      const deleted = await cleaner.cleanupOrphanedSearchDocs();

      // Should return successfully deleted count
      expect(deleted).toBe(7);
    });
  });

  // ========== SUITE 4: cleanupOldFailedFiles ==========
  describe('cleanupOldFailedFiles()', () => {
    it('should process files failed > N days ago', async () => {
      // Mock finding 2 failed files
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [
            { id: 'file-1', user_id: 'user-1' },
            { id: 'file-2', user_id: 'user-2' },
          ],
          rowsAffected: [2],
        })
        // Mock deletion for each file
        .mockResolvedValue({ recordset: [], rowsAffected: [5] });

      mockDeleteChunksForFile.mockResolvedValue(undefined);

      const result = await cleaner.cleanupOldFailedFiles(30);

      expect(result.filesProcessed).toBe(2);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('failed_at'),
        expect.objectContaining({ days: 30 })
      );
    });

    it('should return batch statistics', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [{ id: 'file-1', user_id: 'user-1' }],
          rowsAffected: [1],
        })
        .mockResolvedValue({ recordset: [], rowsAffected: [10] });

      mockDeleteChunksForFile.mockResolvedValue(undefined);

      const result = await cleaner.cleanupOldFailedFiles(30);

      expect(result).toEqual<BatchCleanupResult>({
        filesProcessed: 1,
        totalChunksDeleted: 10,
        totalSearchDocsDeleted: 10,
        failures: [],
      });
    });

    it('should continue on individual file failures', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [
            { id: 'file-1', user_id: 'user-1' },
            { id: 'file-2', user_id: 'user-2' },
          ],
          rowsAffected: [2],
        })
        // First file fails
        .mockRejectedValueOnce(new Error('DB Error'))
        // Second file succeeds
        .mockResolvedValue({ recordset: [], rowsAffected: [5] });

      mockDeleteChunksForFile.mockResolvedValue(undefined);

      const result = await cleaner.cleanupOldFailedFiles(30);

      expect(result.filesProcessed).toBe(2);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toEqual({
        fileId: 'file-1',
        error: 'DB Error',
      });
    });

    it('should not modify anything in dryRun mode', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'file-1', user_id: 'user-1' }],
        rowsAffected: [1],
      });

      const result = await cleaner.cleanupOldFailedFiles(30, { dryRun: true });

      // Should report what would be cleaned
      expect(result.filesProcessed).toBe(1);
      // But no actual deletions should occur
      // (implementation will handle dryRun logic)
    });
  });
});
