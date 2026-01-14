/**
 * FileRetryService Unit Tests
 *
 * Tests for the file retry tracking service extracted from FileService.
 * This service handles all retry-related state mutations following SRP.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.retry.test.ts (same tests, different service)
 *
 * Methods covered:
 * - incrementProcessingRetryCount()
 * - incrementEmbeddingRetryCount()
 * - setLastProcessingError()
 * - setLastEmbeddingError()
 * - markAsPermanentlyFailed()
 * - clearFailedStatus()
 * - updateEmbeddingStatus()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileRetryService,
  getFileRetryService,
  __resetFileRetryService,
} from '@/domains/files/retry';

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

describe('FileRetryService', () => {
  let retryService: FileRetryService;

  const testUserId = 'test-user-retry-789';
  const testFileId = 'test-file-retry-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Reset singleton instance
    __resetFileRetryService();
    retryService = getFileRetryService();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getFileRetryService();
      const instance2 = getFileRetryService();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getFileRetryService();
      __resetFileRetryService();
      const instance2 = getFileRetryService();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: incrementProcessingRetryCount ==========
  describe('incrementProcessingRetryCount()', () => {
    it('should increment count and return new value via OUTPUT INSERTED', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ processing_retry_count: 3 }],
        rowsAffected: [1],
      });

      const result = await retryService.incrementProcessingRetryCount(testUserId, testFileId);

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

      await retryService.incrementProcessingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (empty recordset)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await expect(
        retryService.incrementProcessingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 2: incrementEmbeddingRetryCount ==========
  describe('incrementEmbeddingRetryCount()', () => {
    it('should increment count and return new value via OUTPUT INSERTED', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ embedding_retry_count: 5 }],
        rowsAffected: [1],
      });

      const result = await retryService.incrementEmbeddingRetryCount(testUserId, testFileId);

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

      await retryService.incrementEmbeddingRetryCount(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should throw error when file not found (empty recordset)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await expect(
        retryService.incrementEmbeddingRetryCount(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 3: setLastProcessingError ==========
  describe('setLastProcessingError()', () => {
    it('should store error message in database', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.setLastProcessingError(testUserId, testFileId, 'OCR extraction failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_processing_error = @error'),
        expect.objectContaining({
          error: 'OCR extraction failed',
        })
      );
    });

    it('should truncate error message to 1000 characters', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      const longError = 'x'.repeat(1500);

      await retryService.setLastProcessingError(testUserId, testFileId, longError);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          error: expect.stringMatching(/^x{1000}$/),
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        retryService.setLastProcessingError(testUserId, testFileId, 'Error')
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 4: setLastEmbeddingError ==========
  describe('setLastEmbeddingError()', () => {
    it('should store error message in database', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.setLastEmbeddingError(testUserId, testFileId, 'Embedding API timeout');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_embedding_error = @error'),
        expect.objectContaining({
          error: 'Embedding API timeout',
        })
      );
    });

    it('should truncate error message to 1000 characters', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      const longError = 'y'.repeat(1500);

      await retryService.setLastEmbeddingError(testUserId, testFileId, longError);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          error: expect.stringMatching(/^y{1000}$/),
        })
      );
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        retryService.setLastEmbeddingError(testUserId, testFileId, 'Error')
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 5: markAsPermanentlyFailed ==========
  describe('markAsPermanentlyFailed()', () => {
    it('should set failed_at timestamp using GETUTCDATE()', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.markAsPermanentlyFailed(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('failed_at = GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.markAsPermanentlyFailed(testUserId, testFileId);

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
        retryService.markAsPermanentlyFailed(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 6: clearFailedStatus ==========
  describe('clearFailedStatus()', () => {
    it('should clear all retry fields with scope="full"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId, 'full');

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('failed_at = NULL');
      expect(query).toContain('last_embedding_error = NULL');
      expect(query).toContain('embedding_retry_count = 0');
      expect(query).toContain('last_processing_error = NULL');
      expect(query).toContain('processing_retry_count = 0');
    });

    it('should clear only embedding fields with scope="embedding_only"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId, 'embedding_only');

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('failed_at = NULL');
      expect(query).toContain('last_embedding_error = NULL');
      expect(query).toContain('embedding_retry_count = 0');
      expect(query).not.toContain('last_processing_error');
      expect(query).not.toContain('processing_retry_count');
    });

    it('should default to scope="full" when scope not provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId);

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('processing_retry_count = 0');
      expect(query).toContain('last_processing_error = NULL');
    });

    it('should throw error when file not found (rowsAffected = 0)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      await expect(
        retryService.clearFailedStatus(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 7: updateEmbeddingStatus ==========
  describe('updateEmbeddingStatus()', () => {
    it('should update status to "pending"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updateEmbeddingStatus(testUserId, testFileId, 'pending');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('embedding_status = @status'),
        expect.objectContaining({
          status: 'pending',
        })
      );
    });

    it('should update status to "completed"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updateEmbeddingStatus(testUserId, testFileId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    it('should update status to "failed"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updateEmbeddingStatus(testUserId, testFileId, 'failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'failed',
        })
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updateEmbeddingStatus(testUserId, testFileId, 'completed');

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
        retryService.updateEmbeddingStatus(testUserId, testFileId, 'completed')
      ).rejects.toThrow('File not found or unauthorized');
    });
  });
});
