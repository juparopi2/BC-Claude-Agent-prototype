/**
 * FileService Retry Tracking Unit Tests
 *
 * Tests for retry tracking methods (15-21) added in D25 Sprint 1.
 * These tests serve as a safety net before extracting FileRetryService.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.test.ts (existing pattern)
 *
 * Methods covered:
 * - 15. incrementProcessingRetryCount()
 * - 16. incrementEmbeddingRetryCount()
 * - 17. setLastProcessingError()
 * - 18. setLastEmbeddingError()
 * - 19. markAsPermanentlyFailed()
 * - 20. clearFailedStatus()
 * - 21. updateEmbeddingStatus()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService } from '@/services/files/FileService';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
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

// ===== MOCK DELETION AUDIT SERVICE (vi.hoisted pattern) =====
const mockAuditService = vi.hoisted(() => ({
  logDeletionRequest: vi.fn().mockResolvedValue('audit-id-123'),
  updateStorageStatus: vi.fn().mockResolvedValue(undefined),
  markCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/files/DeletionAuditService', () => ({
  getDeletionAuditService: vi.fn(() => mockAuditService),
}));

// ===== MOCK VECTOR SEARCH SERVICE (vi.hoisted pattern) =====
const mockVectorSearchService = vi.hoisted(() => ({
  deleteChunksForFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => mockVectorSearchService),
  },
}));

// ===== MOCK crypto.randomUUID (vi.hoisted pattern) =====
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-retry-test'),
}));

describe('FileService - Retry Tracking Methods', () => {
  let fileService: FileService;

  const testUserId = 'test-user-retry-456';
  const testFileId = 'test-file-retry-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Re-setup audit service mocks
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockAuditService.updateStorageStatus.mockResolvedValue(undefined);
    mockAuditService.markCompleted.mockResolvedValue(undefined);

    // Re-setup vector search service mocks
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    // Reset singleton instance
    (FileService as any).instance = null;
    fileService = getFileService();
  });

  // ========== SUITE 1: incrementProcessingRetryCount (Method 15) ==========
  describe('incrementProcessingRetryCount()', () => {
    it('should increment count and return new value via OUTPUT INSERTED', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ processing_retry_count: 3 }],
        rowsAffected: [1],
      });

      const result = await fileService.incrementProcessingRetryCount(testUserId, testFileId);

      expect(result).toBe(3);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OUTPUT INSERTED.processing_retry_count'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ processing_retry_count: 1 }],
        rowsAffected: [1],
      });

      await fileService.incrementProcessingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should increment processing_retry_count by 1', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ processing_retry_count: 2 }],
        rowsAffected: [1],
      });

      await fileService.incrementProcessingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('processing_retry_count = processing_retry_count + 1'),
        expect.anything()
      );
    });

    it('should throw error when file not found (empty recordset)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await expect(
        fileService.incrementProcessingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log error and re-throw on database error', async () => {
      const dbError = new Error('Database connection failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(
        fileService.incrementProcessingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('Database connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        'Failed to increment processing retry count'
      );
    });
  });

  // ========== SUITE 2: incrementEmbeddingRetryCount (Method 16) ==========
  describe('incrementEmbeddingRetryCount()', () => {
    it('should increment count and return new value via OUTPUT INSERTED', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ embedding_retry_count: 5 }],
        rowsAffected: [1],
      });

      const result = await fileService.incrementEmbeddingRetryCount(testUserId, testFileId);

      expect(result).toBe(5);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OUTPUT INSERTED.embedding_retry_count'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ embedding_retry_count: 1 }],
        rowsAffected: [1],
      });

      await fileService.incrementEmbeddingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should increment embedding_retry_count by 1', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ embedding_retry_count: 1 }],
        rowsAffected: [1],
      });

      await fileService.incrementEmbeddingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('embedding_retry_count = embedding_retry_count + 1'),
        expect.anything()
      );
    });

    it('should throw error when file not found (empty recordset)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await expect(
        fileService.incrementEmbeddingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log error and re-throw on database error', async () => {
      const dbError = new Error('Connection timeout');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(
        fileService.incrementEmbeddingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('Connection timeout');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        'Failed to increment embedding retry count'
      );
    });
  });

  // ========== SUITE 3: setLastProcessingError (Method 17) ==========
  describe('setLastProcessingError()', () => {
    it('should store error message in database', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastProcessingError(testUserId, testFileId, 'OCR extraction failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_processing_error = @error'),
        expect.objectContaining({
          error: 'OCR extraction failed',
        })
      );
    });

    it('should truncate error message to 1000 characters', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      const longError = 'x'.repeat(1500); // Exceeds 1000 char limit

      await fileService.setLastProcessingError(testUserId, testFileId, longError);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          error: expect.stringMatching(/^x{1000}$/), // Exactly 1000 chars
        })
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastProcessingError(testUserId, testFileId, 'Error');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        fileService.setLastProcessingError(testUserId, testFileId, 'Error')
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log error storage operation with error length', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastProcessingError(testUserId, testFileId, 'Test error');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
          errorLength: 10, // 'Test error'.length
        }),
        'Setting last processing error'
      );
    });
  });

  // ========== SUITE 4: setLastEmbeddingError (Method 18) ==========
  describe('setLastEmbeddingError()', () => {
    it('should store error message in database', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastEmbeddingError(testUserId, testFileId, 'Embedding API timeout');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_embedding_error = @error'),
        expect.objectContaining({
          error: 'Embedding API timeout',
        })
      );
    });

    it('should truncate error message to 1000 characters', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      const longError = 'y'.repeat(1500); // Exceeds 1000 char limit

      await fileService.setLastEmbeddingError(testUserId, testFileId, longError);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          error: expect.stringMatching(/^y{1000}$/), // Exactly 1000 chars
        })
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastEmbeddingError(testUserId, testFileId, 'Error');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        fileService.setLastEmbeddingError(testUserId, testFileId, 'Error')
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log error storage operation with error length', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.setLastEmbeddingError(testUserId, testFileId, 'API failed');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
          errorLength: 10, // 'API failed'.length
        }),
        'Setting last embedding error'
      );
    });
  });

  // ========== SUITE 5: markAsPermanentlyFailed (Method 19) ==========
  describe('markAsPermanentlyFailed()', () => {
    it('should set failed_at timestamp using GETUTCDATE()', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.markAsPermanentlyFailed(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('failed_at = GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.markAsPermanentlyFailed(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should also update updated_at timestamp', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.markAsPermanentlyFailed(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('updated_at = GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        fileService.markAsPermanentlyFailed(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log failure marking operation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.markAsPermanentlyFailed(testUserId, testFileId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
        }),
        'Marking file as permanently failed'
      );
    });
  });

  // ========== SUITE 6: clearFailedStatus (Method 20) ==========
  describe('clearFailedStatus()', () => {
    it('should clear all retry fields with scope="full"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.clearFailedStatus(testUserId, testFileId, 'full');

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('failed_at = NULL');
      expect(query).toContain('last_embedding_error = NULL');
      expect(query).toContain('embedding_retry_count = 0');
      expect(query).toContain('last_processing_error = NULL');
      expect(query).toContain('processing_retry_count = 0');
    });

    it('should clear only embedding fields with scope="embedding_only"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.clearFailedStatus(testUserId, testFileId, 'embedding_only');

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('failed_at = NULL');
      expect(query).toContain('last_embedding_error = NULL');
      expect(query).toContain('embedding_retry_count = 0');
      // Should NOT contain processing fields
      expect(query).not.toContain('last_processing_error');
      expect(query).not.toContain('processing_retry_count');
    });

    it('should default to scope="full" when scope not provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.clearFailedStatus(testUserId, testFileId);

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      // Should have all fields (full scope)
      expect(query).toContain('processing_retry_count = 0');
      expect(query).toContain('last_processing_error = NULL');
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.clearFailedStatus(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        fileService.clearFailedStatus(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log clear operation with scope', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.clearFailedStatus(testUserId, testFileId, 'embedding_only');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
          scope: 'embedding_only',
        }),
        'Clearing failed status for retry'
      );
    });
  });

  // ========== SUITE 7: updateEmbeddingStatus (Method 21) ==========
  describe('updateEmbeddingStatus()', () => {
    it('should update status to "pending"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'pending');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('embedding_status = @status'),
        expect.objectContaining({
          status: 'pending',
        })
      );
    });

    it('should update status to "processing"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'processing');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'processing',
        })
      );
    });

    it('should update status to "completed"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    it('should update status to "failed"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'failed',
        })
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        fileService.updateEmbeddingStatus(testUserId, testFileId, 'completed')
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('should log status update operation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await fileService.updateEmbeddingStatus(testUserId, testFileId, 'completed');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
          status: 'completed',
        }),
        'Updating embedding status'
      );
    });
  });
});
