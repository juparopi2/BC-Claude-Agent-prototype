/**
 * OrphanCleanupService Unit Tests
 *
 * Tests for the orphan cleanup service (PRD-05).
 * This service handles cleanup across three scopes:
 * 1. Orphan blobs — blobs in Azure Storage with no matching DB record
 * 2. Abandoned uploads — files stuck in 'registered' status beyond threshold
 * 3. Old failures — files in 'failed' status beyond retention period
 *
 * Pattern: vi.hoisted() + vi.mock() for dynamic imports
 *
 * Methods covered:
 * - run()
 * - Singleton pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrphanCleanupMetrics } from '@bc-agent/shared';
import { PIPELINE_STATUS } from '@bc-agent/shared';

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

// ===== MOCK FILE UPLOAD SERVICE =====
const mockListBlobs = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDeleteFromBlob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    listBlobs: mockListBlobs,
    deleteFromBlob: mockDeleteFromBlob,
  })),
}));

// ===== MOCK FILE REPOSITORY =====
const mockFindAbandonedFiles = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    findAbandonedFiles: mockFindAbandonedFiles,
  })),
}));

// ===== MOCK PRISMA =====
const mockFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockDeleteMany = vi.hoisted(() => vi.fn().mockResolvedValue({ count: 0 }));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    },
  },
}));

// Import after mocks
import {
  OrphanCleanupService,
  getOrphanCleanupService,
  __resetOrphanCleanupService,
} from '@/domains/files/cleanup/OrphanCleanupService';

describe('OrphanCleanupService', () => {
  let service: OrphanCleanupService;

  const TEST_USER_ID = 'TEST-USER-CLEANUP-ABC123';
  const TEST_FILE_ID_1 = 'TEST-FILE-CLEANUP-DEF456';
  const TEST_FILE_ID_2 = 'TEST-FILE-CLEANUP-GHI789';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations
    mockListBlobs.mockResolvedValue([]);
    mockDeleteFromBlob.mockResolvedValue(undefined);
    mockFindAbandonedFiles.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
    mockDeleteMany.mockResolvedValue({ count: 0 });

    // Reset singleton
    __resetOrphanCleanupService();
    service = getOrphanCleanupService();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getOrphanCleanupService();
      const instance2 = getOrphanCleanupService();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getOrphanCleanupService();
      __resetOrphanCleanupService();
      const instance2 = getOrphanCleanupService();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: run() - Empty State ==========
  describe('run() - Empty State', () => {
    it('should return zero metrics when nothing to clean', async () => {
      // All mocks return empty results by default
      const metrics = await service.run();

      expect(metrics).toEqual<OrphanCleanupMetrics>({
        orphanBlobsDeleted: 0,
        abandonedUploadsDeleted: 0,
        oldFailuresDeleted: 0,
        stuckDeletionsDeleted: 0,
      });
    });

    it('should log completion with zero metrics', async () => {
      await service.run();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: {
            orphanBlobsDeleted: 0,
            abandonedUploadsDeleted: 0,
            oldFailuresDeleted: 0,
            stuckDeletionsDeleted: 0,
          },
        }),
        'Orphan cleanup completed'
      );
    });
  });

  // ========== SUITE 2: Scope 1 - Orphan Blobs ==========
  describe('run() - Scope 1: Orphan Blobs', () => {
    it('should delete orphan blobs not in database', async () => {
      // Blobs in Azure Storage
      mockListBlobs.mockResolvedValue([
        'users/user1/file1.pdf',
        'users/user1/file2.pdf',
        'users/user2/orphan.pdf', // This one is orphan
      ]);

      // Scope 1: Only 2 blobs have DB records (query by blob_path)
      // Scope 3: No old failed files (query by pipeline_status)
      mockFindMany
        .mockResolvedValueOnce([
          { blob_path: 'users/user1/file1.pdf' },
          { blob_path: 'users/user1/file2.pdf' },
        ])
        .mockResolvedValueOnce([]); // Scope 3 query

      const metrics = await service.run();

      expect(metrics.orphanBlobsDeleted).toBe(1);
      expect(mockDeleteFromBlob).toHaveBeenCalledTimes(1);
      expect(mockDeleteFromBlob).toHaveBeenCalledWith('users/user2/orphan.pdf');
    });

    it('should preserve blobs that have matching DB records', async () => {
      mockListBlobs.mockResolvedValue([
        'users/user1/valid1.pdf',
        'users/user1/valid2.pdf',
      ]);

      // Scope 1: All blobs have DB records
      // Scope 3: No old failed files
      mockFindMany
        .mockResolvedValueOnce([
          { blob_path: 'users/user1/valid1.pdf' },
          { blob_path: 'users/user1/valid2.pdf' },
        ])
        .mockResolvedValueOnce([]);

      const metrics = await service.run();

      expect(metrics.orphanBlobsDeleted).toBe(0);
      expect(mockDeleteFromBlob).not.toHaveBeenCalled();
    });

    it('should skip orphan blob cleanup when skipOrphanBlobs is true', async () => {
      mockListBlobs.mockResolvedValue(['users/user1/orphan.pdf']);
      // Scope 3 still runs
      mockFindMany.mockResolvedValue([]);

      const metrics = await service.run({ skipOrphanBlobs: true });

      expect(mockListBlobs).not.toHaveBeenCalled();
      expect(metrics.orphanBlobsDeleted).toBe(0);
    });

    it('should handle individual blob deletion failures gracefully', async () => {
      mockListBlobs.mockResolvedValue([
        'users/user1/orphan1.pdf',
        'users/user1/orphan2.pdf',
      ]);
      // Scope 1: No DB records for these blobs
      // Scope 3: No old failed files
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // First deletion fails, second succeeds
      mockDeleteFromBlob
        .mockRejectedValueOnce(new Error('Blob not found'))
        .mockResolvedValueOnce(undefined);

      const metrics = await service.run();

      // Should delete the second one successfully
      expect(metrics.orphanBlobsDeleted).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          blobPath: 'users/user1/orphan1.pdf',
        }),
        'Failed to delete orphan blob'
      );
    });

    it('should process blobs in batches to avoid memory issues', async () => {
      // Create 1000 blob paths
      const blobPaths = Array.from({ length: 1000 }, (_, i) => `users/user1/file${i}.pdf`);
      mockListBlobs.mockResolvedValue(blobPaths);
      // Scope 1: 2 batches for 1000 blobs (BATCH_SIZE = 500)
      // Scope 3: 1 query for old failed files
      // Scope 4: 1 query for stuck deletions
      mockFindMany
        .mockResolvedValueOnce([]) // Batch 1 (items 0-499)
        .mockResolvedValueOnce([]) // Batch 2 (items 500-999)
        .mockResolvedValueOnce([]) // Scope 3
        .mockResolvedValueOnce([]); // Scope 4

      const metrics = await service.run();

      // Should query DB 4 times total (2 for scope 1, 1 for scope 3, 1 for scope 4)
      expect(mockFindMany).toHaveBeenCalledTimes(4);
      expect(metrics.orphanBlobsDeleted).toBe(1000);
    });

    it('should log info when orphan blobs are deleted', async () => {
      mockListBlobs.mockResolvedValue(['users/user1/orphan.pdf']);
      // Scope 1: No DB record
      // Scope 3: No old failed files
      mockFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.run();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: 1,
          totalBlobs: 1,
        }),
        'Orphan blobs cleaned up'
      );
    });
  });

  // ========== SUITE 3: Scope 2 - Abandoned Uploads ==========
  describe('run() - Scope 2: Abandoned Uploads', () => {
    it('should clean up abandoned uploads beyond threshold', async () => {
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned1.pdf',
        },
        {
          id: TEST_FILE_ID_2,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned2.pdf',
        },
      ];

      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.abandonedUploadsDeleted).toBe(2);
      expect(mockDeleteFromBlob).toHaveBeenCalledTimes(2);
      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
    });

    it('should use custom abandonedThresholdMs when provided', async () => {
      const customThreshold = 12 * 60 * 60 * 1000; // 12 hours

      await service.run({ abandonedThresholdMs: customThreshold });

      expect(mockFindAbandonedFiles).toHaveBeenCalledWith(customThreshold);
    });

    it('should use default threshold when not provided', async () => {
      await service.run();

      // Default is 24 hours = 24 * 60 * 60 * 1000
      expect(mockFindAbandonedFiles).toHaveBeenCalledWith(24 * 60 * 60 * 1000);
    });

    it('should handle individual file cleanup failure gracefully', async () => {
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file1.pdf',
        },
        {
          id: TEST_FILE_ID_2,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file2.pdf',
        },
      ];

      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);

      // First file deletion fails
      mockDeleteFromBlob
        .mockRejectedValueOnce(new Error('Blob service unavailable'))
        .mockResolvedValueOnce(undefined);

      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      // Should delete the second file successfully
      expect(metrics.abandonedUploadsDeleted).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: TEST_FILE_ID_1,
        }),
        'Failed to clean up abandoned upload'
      );
    });

    it('should delete blob before deleting DB record', async () => {
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file.pdf',
        },
      ];

      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);

      const callOrder: string[] = [];
      mockDeleteFromBlob.mockImplementation(async () => {
        callOrder.push('blob');
      });
      mockDeleteMany.mockImplementation(async () => {
        callOrder.push('db');
        return { count: 1 };
      });

      await service.run();

      expect(callOrder).toEqual(['blob', 'db']);
    });

    it('should enforce multi-tenant isolation in DB deletion', async () => {
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file.pdf',
        },
      ];

      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);

      await service.run();

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { id: TEST_FILE_ID_1, user_id: TEST_USER_ID },
      });
    });

    it('should log info when abandoned uploads are cleaned', async () => {
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file.pdf',
        },
      ];

      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);
      mockDeleteMany.mockResolvedValue({ count: 1 });

      await service.run();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: 1,
          total: 1,
        }),
        'Abandoned uploads cleaned up'
      );
    });
  });

  // ========== SUITE 4: Scope 3 - Old Failures ==========
  describe('run() - Scope 3: Old Failures', () => {
    it('should clean up old failed files beyond retention', async () => {
      const oldFailedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/failed1.pdf',
        },
        {
          id: TEST_FILE_ID_2,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/failed2.pdf',
        },
      ];

      mockFindMany
        .mockResolvedValueOnce(oldFailedFiles)  // Scope 3: old failures
        .mockResolvedValueOnce([]);             // Scope 4: stuck deletions
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.oldFailuresDeleted).toBe(2);
      expect(mockDeleteFromBlob).toHaveBeenCalledTimes(2);
      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
    });

    it('should use custom failureRetentionDays when provided', async () => {
      const customRetention = 14; // 14 days

      await service.run({ failureRetentionDays: customRetention });

      const cutoff = new Date(Date.now() - customRetention * 24 * 60 * 60 * 1000);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pipeline_status: PIPELINE_STATUS.FAILED,
            deletion_status: null,
            updated_at: expect.objectContaining({
              lt: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should use default retention when not provided', async () => {
      await service.run();

      // Default is 30 days
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pipeline_status: PIPELINE_STATUS.FAILED,
          }),
        })
      );
    });

    it('should query for failed files with correct criteria', async () => {
      await service.run({ failureRetentionDays: 30 });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
          updated_at: { lt: expect.any(Date) },
        },
        select: { id: true, user_id: true, blob_path: true },
        take: 500,
      });
    });

    it('should handle files without blob_path', async () => {
      const oldFailedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: null,
        },
      ];

      // Scope 3 gets the failed files; Scope 4 gets [] so stuck-deletion path is skipped
      // (avoids triggering the real VectorSearchService import which makes network calls)
      mockFindMany
        .mockResolvedValueOnce(oldFailedFiles) // Scope 3: old failures
        .mockResolvedValueOnce([]);             // Scope 4: stuck deletions
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.oldFailuresDeleted).toBe(1);
      expect(mockDeleteFromBlob).not.toHaveBeenCalled();
      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    });

    it('should handle individual file cleanup failure gracefully', async () => {
      const oldFailedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file1.pdf',
        },
        {
          id: TEST_FILE_ID_2,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file2.pdf',
        },
      ];

      // Scope 3 gets the failed files; Scope 4 gets [] so stuck-deletion path is skipped
      // (avoids triggering the real VectorSearchService import which makes network calls)
      mockFindMany
        .mockResolvedValueOnce(oldFailedFiles) // Scope 3: old failures
        .mockResolvedValueOnce([]);             // Scope 4: stuck deletions

      // First file deletion fails in DB
      mockDeleteMany
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce({ count: 1 });

      const metrics = await service.run();

      // Should delete the second file successfully
      expect(metrics.oldFailuresDeleted).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: TEST_FILE_ID_1,
        }),
        'Failed to clean up old failed file'
      );
    });

    it('should log info when old failures are cleaned', async () => {
      const oldFailedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/file.pdf',
        },
      ];

      // Scope 3 gets the failed files; Scope 4 gets [] so stuck-deletion path is skipped
      // (avoids triggering the real VectorSearchService import which makes network calls)
      mockFindMany
        .mockResolvedValueOnce(oldFailedFiles) // Scope 3: old failures
        .mockResolvedValueOnce([]);             // Scope 4: stuck deletions
      mockDeleteMany.mockResolvedValue({ count: 1 });

      await service.run({ failureRetentionDays: 30 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: 1,
          total: 1,
          retentionDays: 30,
        }),
        'Old failures cleaned up'
      );
    });
  });

  // ========== SUITE 5: Error Handling ==========
  describe('run() - Error Handling', () => {
    it('should handle error in scope 1 without affecting other scopes', async () => {
      // Scope 1 will fail
      mockListBlobs.mockRejectedValue(new Error('Azure Storage unavailable'));

      // Scope 2 and 3 should still work
      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned.pdf',
        },
      ];
      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.orphanBlobsDeleted).toBe(0);
      expect(metrics.abandonedUploadsDeleted).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Azure Storage unavailable',
          }),
        }),
        'Orphan blob cleanup failed'
      );
    });

    it('should handle error in scope 2 without affecting other scopes', async () => {
      // Scope 2 will fail
      mockFindAbandonedFiles.mockRejectedValue(new Error('Repository error'));

      // Scope 1 and 3 should still work
      mockListBlobs.mockResolvedValue(['users/user1/orphan.pdf']);
      mockFindMany
        .mockResolvedValueOnce([]) // For scope 1 blob check
        .mockResolvedValueOnce([   // For scope 3 old failures
          {
            id: TEST_FILE_ID_1,
            user_id: TEST_USER_ID,
            blob_path: 'users/test/failed.pdf',
          },
        ]);
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.orphanBlobsDeleted).toBe(1);
      expect(metrics.abandonedUploadsDeleted).toBe(0);
      expect(metrics.oldFailuresDeleted).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Repository error',
          }),
        }),
        'Abandoned upload cleanup failed'
      );
    });

    it('should handle error in scope 3 without affecting other scopes', async () => {
      // Scope 1 and 2 should still work
      mockListBlobs.mockResolvedValue(['users/user1/orphan.pdf']);
      // Scope 1: blob check succeeds
      // Scope 3: query fails
      mockFindMany
        .mockResolvedValueOnce([]) // Scope 1 blob check succeeds
        .mockRejectedValueOnce(new Error('DB query failed')); // Scope 3 fails

      const abandonedFiles = [
        {
          id: TEST_FILE_ID_1,
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned.pdf',
        },
      ];
      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics.orphanBlobsDeleted).toBe(1);
      expect(metrics.abandonedUploadsDeleted).toBe(1);
      expect(metrics.oldFailuresDeleted).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'DB query failed',
          }),
        }),
        'Old failure cleanup failed'
      );
    });

    it('should serialize Error objects properly for logging', async () => {
      const testError = new Error('Test error');
      testError.stack = 'Error: Test error\n  at test.ts:1:1';

      mockListBlobs.mockRejectedValue(testError);

      await service.run();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            message: 'Test error',
            stack: expect.stringContaining('Error: Test error'),
          },
        }),
        'Orphan blob cleanup failed'
      );
    });

    it('should handle non-Error exceptions gracefully', async () => {
      mockListBlobs.mockRejectedValue('String error');

      await service.run();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            value: 'String error',
          },
        }),
        'Orphan blob cleanup failed'
      );
    });
  });

  // ========== SUITE 6: Integration - All Scopes ==========
  describe('run() - All Scopes Integration', () => {
    it('should aggregate metrics from all three scopes', async () => {
      // Scope 1: 3 orphan blobs
      mockListBlobs.mockResolvedValue([
        'users/user1/orphan1.pdf',
        'users/user1/orphan2.pdf',
        'users/user1/orphan3.pdf',
      ]);
      mockFindMany
        .mockResolvedValueOnce([]) // For scope 1 blob check
        .mockResolvedValueOnce([   // For scope 3 old failures
          {
            id: TEST_FILE_ID_1,
            user_id: TEST_USER_ID,
            blob_path: 'users/test/failed1.pdf',
          },
          {
            id: TEST_FILE_ID_2,
            user_id: TEST_USER_ID,
            blob_path: 'users/test/failed2.pdf',
          },
        ]);

      // Scope 2: 2 abandoned uploads
      const abandonedFiles = [
        {
          id: 'ABANDONED-1',
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned1.pdf',
        },
        {
          id: 'ABANDONED-2',
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned2.pdf',
        },
      ];
      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);

      mockDeleteMany.mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      expect(metrics).toEqual<OrphanCleanupMetrics>({
        orphanBlobsDeleted: 3,
        abandonedUploadsDeleted: 2,
        oldFailuresDeleted: 2,
        stuckDeletionsDeleted: 0,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: {
            orphanBlobsDeleted: 3,
            abandonedUploadsDeleted: 2,
            oldFailuresDeleted: 2,
            stuckDeletionsDeleted: 0,
          },
        }),
        'Orphan cleanup completed'
      );
    });

    it('should complete successfully even if all scopes have partial failures', async () => {
      // Scope 1: 2 orphans, 1 fails to delete
      mockListBlobs.mockResolvedValue(['users/user1/orphan1.pdf', 'users/user1/orphan2.pdf']);
      mockFindMany
        .mockResolvedValueOnce([]) // For scope 1 blob check
        .mockResolvedValueOnce([   // For scope 3 old failures
          {
            id: TEST_FILE_ID_1,
            user_id: TEST_USER_ID,
            blob_path: 'users/test/failed.pdf',
          },
        ]);
      mockDeleteFromBlob
        .mockRejectedValueOnce(new Error('Blob delete failed'))
        .mockResolvedValue(undefined);

      // Scope 2: 2 abandoned, 1 fails
      const abandonedFiles = [
        {
          id: 'ABANDONED-1',
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned1.pdf',
        },
        {
          id: 'ABANDONED-2',
          user_id: TEST_USER_ID,
          blob_path: 'users/test/abandoned2.pdf',
        },
      ];
      mockFindAbandonedFiles.mockResolvedValue(abandonedFiles);
      mockDeleteMany
        .mockRejectedValueOnce(new Error('DB delete failed'))
        .mockResolvedValue({ count: 1 });

      const metrics = await service.run();

      // Should reflect successful deletions only
      expect(metrics.orphanBlobsDeleted).toBe(1);
      expect(metrics.abandonedUploadsDeleted).toBe(1);
      expect(metrics.oldFailuresDeleted).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });
  });
});
