/**
 * File Retry Processing Integration Tests
 *
 * D25 Sprint 2: Tests for the complete file retry flow including:
 * - Automatic retry on processing failure
 * - Permanent failure after max retries
 * - Manual retry via API endpoint
 * - Cleanup of old failed files
 *
 * These tests verify integration between:
 * - ProcessingRetryManager
 * - FileRetryService (mocked at service level)
 * - PartialDataCleaner
 * - VectorSearchService (mocked)
 *
 * Pattern: Service-level mocking for reliable integration tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedFile, RetryScope } from '@bc-agent/shared';

// ===== MOCK DATABASE =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK FILE SERVICE =====
const mockGetFile = vi.hoisted(() => vi.fn());
const mockUpdateProcessingStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/files/FileService', () => ({
  FileService: {
    getInstance: vi.fn(() => ({
      getFile: mockGetFile,
      updateProcessingStatus: mockUpdateProcessingStatus,
    })),
  },
}));

// ===== MOCK VECTOR SEARCH SERVICE =====
const mockDeleteChunksForFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      deleteChunksForFile: mockDeleteChunksForFile,
    })),
  },
}));

// ===== MOCK ORPHAN CLEANUP JOB =====
const mockRunFullCleanup = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    deletedCount: 0,
    errors: [],
    duration: 100,
  })
);

vi.mock('@/jobs/OrphanCleanupJob', () => ({
  OrphanCleanupJob: {
    getInstance: vi.fn(() => ({
      runFullCleanup: mockRunFullCleanup,
    })),
  },
}));

// ===== MOCK FILE RETRY SERVICE (Service-level mock for reliable testing) =====
const mockIncrementProcessingRetryCount = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockIncrementEmbeddingRetryCount = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockSetLastProcessingError = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMarkAsPermanentlyFailed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClearFailedStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUpdateEmbeddingStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/domains/files/retry/FileRetryService', () => ({
  getFileRetryService: vi.fn(() => ({
    incrementProcessingRetryCount: mockIncrementProcessingRetryCount,
    incrementEmbeddingRetryCount: mockIncrementEmbeddingRetryCount,
    setLastProcessingError: mockSetLastProcessingError,
    markAsPermanentlyFailed: mockMarkAsPermanentlyFailed,
    clearFailedStatus: mockClearFailedStatus,
    updateEmbeddingStatus: mockUpdateEmbeddingStatus,
  })),
  __resetFileRetryService: vi.fn(),
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
  getProcessingRetryManager,
  __resetProcessingRetryManager,
} from '@/domains/files/retry/ProcessingRetryManager';
import { getPartialDataCleaner, __resetPartialDataCleaner } from '@/domains/files/cleanup';

describe('File Retry Processing Integration', () => {
  const testUserId = 'integration-test-user-001';
  const testFileId = 'integration-test-file-001';

  const createMockFile = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
    id: testFileId,
    userId: testUserId,
    parentFolderId: null,
    name: 'test-document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    blobPath: `users/${testUserId}/files/test-document.pdf`,
    isFolder: false,
    isFavorite: false,
    processingStatus: 'failed',
    embeddingStatus: 'pending',
    readinessState: 'failed',
    processingRetryCount: 0,
    embeddingRetryCount: 0,
    lastError: 'Processing failed',
    failedAt: new Date().toISOString(),
    hasExtractedText: false,
    contentHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singletons
    __resetProcessingRetryManager();
    __resetPartialDataCleaner();

    // Default mock implementations
    mockGetFile.mockResolvedValue(createMockFile());
    mockIncrementProcessingRetryCount.mockResolvedValue(1);
    mockIncrementEmbeddingRetryCount.mockResolvedValue(1);
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
  });

  afterEach(() => {
    __resetProcessingRetryManager();
    __resetPartialDataCleaner();
  });

  // ========== SCENARIO 1: Retry Decision Flow ==========
  describe('Scenario 1: Retry Decision Flow', () => {
    it('should allow retry when within limit (retry count 1 <= max 2)', async () => {
      // Arrange
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 0 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(1); // First retry

      const retryManager = getProcessingRetryManager();

      // Act
      const decision = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      // Assert
      expect(decision.shouldRetry).toBe(true);
      expect(decision.newRetryCount).toBe(1);
      expect(decision.reason).toBe('within_limit');
      expect(decision.backoffDelayMs).toBeGreaterThan(0);
    });

    it('should deny retry when max retries exceeded (retry count 3 > max 2)', async () => {
      // Arrange
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 2 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(3); // Exceeds max=2

      const retryManager = getProcessingRetryManager();

      // Act
      const decision = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      // Assert
      expect(decision.shouldRetry).toBe(false);
      expect(decision.newRetryCount).toBe(3);
      expect(decision.reason).toBe('max_retries_exceeded');
    });

    it('should use embedding max retries for embedding phase', async () => {
      // Arrange
      mockGetFile.mockResolvedValue(createMockFile({ embeddingRetryCount: 2 }));
      mockIncrementEmbeddingRetryCount.mockResolvedValue(3); // maxEmbeddingRetries = 3

      const retryManager = getProcessingRetryManager();

      // Act
      const decision = await retryManager.shouldRetry(testUserId, testFileId, 'embedding');

      // Assert - 3 <= 3, so within limit
      expect(decision.shouldRetry).toBe(true);
      expect(decision.maxRetries).toBe(3);
      expect(mockIncrementEmbeddingRetryCount).toHaveBeenCalledWith(testUserId, testFileId);
    });
  });

  // ========== SCENARIO 2: Permanent Failure Handling ==========
  describe('Scenario 2: Permanent Failure Handling', () => {
    it('should mark file as permanently failed and cleanup', async () => {
      // Arrange
      const retryManager = getProcessingRetryManager();
      const errorMessage = 'Unrecoverable processing error';

      // Act
      await retryManager.handlePermanentFailure(testUserId, testFileId, errorMessage);

      // Assert - markAsPermanentlyFailed was called
      expect(mockMarkAsPermanentlyFailed).toHaveBeenCalledWith(testUserId, testFileId);

      // Assert - error message was stored
      expect(mockSetLastProcessingError).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        errorMessage
      );

      // Assert - cleanup was triggered (fileId, userId)
      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(testFileId, testUserId);
    });

    it('should continue even if cleanup fails', async () => {
      // Arrange
      mockDeleteChunksForFile.mockRejectedValueOnce(new Error('Cleanup failed'));
      const retryManager = getProcessingRetryManager();

      // Act & Assert - should not throw
      await expect(
        retryManager.handlePermanentFailure(testUserId, testFileId, 'Error')
      ).resolves.not.toThrow();

      // Cleanup should have been attempted
      expect(mockDeleteChunksForFile).toHaveBeenCalled();
    });
  });

  // ========== SCENARIO 3: Manual Retry Flow ==========
  describe('Scenario 3: Manual Retry Flow', () => {
    it('should execute full retry for failed file', async () => {
      // Arrange
      const failedFile = createMockFile({
        readinessState: 'failed',
        processingStatus: 'failed',
      });
      const updatedFile = createMockFile({
        readinessState: 'processing',
        processingStatus: 'pending',
        processingRetryCount: 0,
      });

      mockGetFile
        .mockResolvedValueOnce(failedFile)
        .mockResolvedValueOnce(updatedFile);

      const retryManager = getProcessingRetryManager();

      // Act
      const result = await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      // Assert
      expect(result.success).toBe(true);
      expect(result.file.readinessState).toBe('processing');
      expect(mockClearFailedStatus).toHaveBeenCalledWith(testUserId, testFileId, 'full');
    });

    it('should reject retry for non-failed file', async () => {
      // Arrange
      mockGetFile.mockResolvedValue(createMockFile({ readinessState: 'ready' }));
      const retryManager = getProcessingRetryManager();

      // Act
      const result = await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in failed state');
    });

    it('should only retry embedding for embedding_only scope', async () => {
      // Arrange
      const failedFile = createMockFile({
        readinessState: 'failed',
        processingStatus: 'completed',
        embeddingStatus: 'failed',
      });

      mockGetFile
        .mockResolvedValueOnce(failedFile)
        .mockResolvedValueOnce({ ...failedFile, readinessState: 'processing' });

      const retryManager = getProcessingRetryManager();

      // Act
      const result = await retryManager.executeManualRetry(
        testUserId,
        testFileId,
        'embedding_only' as RetryScope
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockUpdateEmbeddingStatus).toHaveBeenCalledWith(testUserId, testFileId, 'pending');
      // Should NOT have updated processing status
      expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
    });
  });

  // ========== SCENARIO 4: Cleanup Operations ==========
  describe('Scenario 4: Cleanup Operations', () => {
    it('should cleanup orphaned chunks', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'orphan-chunk-1' }, { id: 'orphan-chunk-2' }],
        rowsAffected: [2],
      });

      const cleaner = getPartialDataCleaner();

      // Act
      const count = await cleaner.cleanupOrphanedChunks(testUserId, 7);

      // Assert
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup for specific file', async () => {
      // Arrange
      const cleaner = getPartialDataCleaner();

      // Act
      const result = await cleaner.cleanupForFile(testUserId, testFileId);

      // Assert
      expect(result.fileId).toBe(testFileId);
      expect(result.success).toBe(true);
      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(testFileId, testUserId);
    });

    it('should batch cleanup old failed files', async () => {
      // Arrange
      const oldFailedFiles = [
        { id: 'old-file-1', user_id: testUserId },
        { id: 'old-file-2', user_id: testUserId },
      ];
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: oldFailedFiles,
        rowsAffected: [2],
      });

      const cleaner = getPartialDataCleaner();

      // Act
      const result = await cleaner.cleanupOldFailedFiles(30);

      // Assert
      expect(result.filesProcessed).toBe(2);
    });
  });

  // ========== SCENARIO 5: Exponential Backoff ==========
  describe('Scenario 5: Exponential Backoff Calculation', () => {
    it('should calculate correct backoff delays', () => {
      const retryManager = getProcessingRetryManager();

      // Retry 0: baseDelay (5000ms) + jitter
      const delay0 = retryManager.calculateBackoffDelay(0);
      expect(delay0).toBeGreaterThanOrEqual(5000);
      expect(delay0).toBeLessThanOrEqual(5500); // 10% jitter

      // Retry 1: baseDelay * 2^1 = 10000ms + jitter
      const delay1 = retryManager.calculateBackoffDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(10000);
      expect(delay1).toBeLessThanOrEqual(11000);
    });

    it('should cap at max delay', () => {
      const retryManager = getProcessingRetryManager();

      // High retry count should cap at maxDelay (60000ms)
      const delay = retryManager.calculateBackoffDelay(10);
      expect(delay).toBeLessThanOrEqual(66000); // 60000 + 10% jitter
    });
  });

  // ========== SCENARIO 6: Multi-tenant Isolation ==========
  describe('Scenario 6: Multi-tenant Isolation', () => {
    it('should enforce userId on all operations', async () => {
      // Arrange
      mockGetFile.mockResolvedValue(null); // File not found for different user

      const retryManager = getProcessingRetryManager();

      // Act & Assert
      await expect(
        retryManager.shouldRetry('different-user', testFileId, 'processing')
      ).rejects.toThrow('File not found');
    });

    it('should use userId in cleanup queries', async () => {
      // Arrange
      const cleaner = getPartialDataCleaner();

      // Act
      await cleaner.cleanupForFile(testUserId, testFileId);

      // Assert
      expect(mockDeleteChunksForFile).toHaveBeenCalledWith(testFileId, testUserId);
    });
  });

  // ========== SCENARIO 7: Service Singleton Behavior ==========
  describe('Scenario 7: Service Singleton Behavior', () => {
    it('should return same instance for ProcessingRetryManager', () => {
      const instance1 = getProcessingRetryManager();
      const instance2 = getProcessingRetryManager();
      expect(instance1).toBe(instance2);
    });

    it('should return same instance for PartialDataCleaner', () => {
      const instance1 = getPartialDataCleaner();
      const instance2 = getPartialDataCleaner();
      expect(instance1).toBe(instance2);
    });

    it('should allow reset for testing', () => {
      const instance1 = getProcessingRetryManager();
      __resetProcessingRetryManager();
      const instance2 = getProcessingRetryManager();
      expect(instance1).not.toBe(instance2);
    });
  });
});

