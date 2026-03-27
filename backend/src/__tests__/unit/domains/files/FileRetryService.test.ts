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
 * - incrementRetryCount()
 * - setLastError()
 * - markAsPermanentlyFailed()
 * - clearFailedStatus()
 * - updatePipelineStatus()
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

  // ========== SUITE 1: incrementRetryCount ==========
  describe('incrementRetryCount()', () => {
    it('should increment count and return new value via OUTPUT INSERTED.pipeline_retry_count', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ pipeline_retry_count: 3 }],
        rowsAffected: [1],
      });

      const result = await retryService.incrementRetryCount(testUserId, testFileId);

      expect(result).toBe(3);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OUTPUT INSERTED.pipeline_retry_count'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ pipeline_retry_count: 1 }],
        rowsAffected: [1],
      });

      await retryService.incrementRetryCount(testUserId, testFileId);

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
        retryService.incrementRetryCount(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 2: setLastError ==========
  describe('setLastError()', () => {
    it('should store error message in last_error column', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.setLastError(testUserId, testFileId, 'OCR extraction failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('last_error = @error'),
        expect.objectContaining({
          error: 'OCR extraction failed',
        })
      );
    });

    it('should truncate error message to 1000 characters', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      const longError = 'x'.repeat(1500);

      await retryService.setLastError(testUserId, testFileId, longError);

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
        retryService.setLastError(testUserId, testFileId, 'Error')
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 3: markAsPermanentlyFailed ==========
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

  // ========== SUITE 4: clearFailedStatus ==========
  describe('clearFailedStatus()', () => {
    it('should reset pipeline_retry_count to 0', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId);

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('pipeline_retry_count = 0');
    });

    it('should reset all retry fields', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId);

      const query = mockExecuteQuery.mock.calls[0]![0] as string;
      expect(query).toContain('failed_at = NULL');
      expect(query).toContain('last_error = NULL');
      expect(query).toContain('pipeline_retry_count = 0');
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.clearFailedStatus(testUserId, testFileId);

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
        retryService.clearFailedStatus(testUserId, testFileId)
      ).rejects.toThrow('File not found or unauthorized');
    });
  });

  // ========== SUITE 5: updatePipelineStatus ==========
  describe('updatePipelineStatus()', () => {
    it('should update status to "pending"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updatePipelineStatus(testUserId, testFileId, 'pending');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('pipeline_status = @status'),
        expect.objectContaining({
          status: 'pending',
        })
      );
    });

    it('should update status to "ready"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updatePipelineStatus(testUserId, testFileId, 'ready');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'ready',
        })
      );
    });

    it('should update status to "failed"', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updatePipelineStatus(testUserId, testFileId, 'failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'failed',
        })
      );
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await retryService.updatePipelineStatus(testUserId, testFileId, 'ready');

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
        retryService.updatePipelineStatus(testUserId, testFileId, 'ready')
      ).rejects.toThrow('File not found or unauthorized');
    });
  });
});
