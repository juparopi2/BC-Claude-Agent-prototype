/**
 * ProcessingRetryManager Unit Tests
 *
 * Tests for the processing retry orchestration service.
 * This service handles retry decisions, manual retry execution,
 * and permanent failure handling.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 *
 * Methods covered:
 * - shouldRetry()
 * - executeManualRetry()
 * - handlePermanentFailure()
 * - calculateBackoffDelay()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetryDecisionResult, ManualRetryResult, ParsedFile } from '@bc-agent/shared';

// ===== MOCK DATABASE =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK FILE RETRY SERVICE =====
const mockIncrementProcessingRetryCount = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockIncrementEmbeddingRetryCount = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockSetLastProcessingError = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetLastEmbeddingError = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMarkAsPermanentlyFailed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClearFailedStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUpdateEmbeddingStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/domains/files/retry/FileRetryService', () => ({
  getFileRetryService: vi.fn(() => ({
    incrementProcessingRetryCount: mockIncrementProcessingRetryCount,
    incrementEmbeddingRetryCount: mockIncrementEmbeddingRetryCount,
    setLastProcessingError: mockSetLastProcessingError,
    setLastEmbeddingError: mockSetLastEmbeddingError,
    markAsPermanentlyFailed: mockMarkAsPermanentlyFailed,
    clearFailedStatus: mockClearFailedStatus,
    updateEmbeddingStatus: mockUpdateEmbeddingStatus,
  })),
  __resetFileRetryService: vi.fn(),
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

// ===== MOCK PARTIAL DATA CLEANER =====
const mockCleanupForFile = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    fileId: 'test-file',
    chunksDeleted: 0,
    searchDocumentsDeleted: 0,
    success: true,
  })
);

vi.mock('@/domains/files/cleanup', () => ({
  getPartialDataCleaner: vi.fn(() => ({
    cleanupForFile: mockCleanupForFile,
  })),
}));

// ===== MOCK CONFIG =====
vi.mock('@/domains/files/config', () => ({
  getFileProcessingConfig: vi.fn(() => ({
    retry: {
      maxProcessingRetries: 2,
      maxEmbeddingRetries: 3,
      baseDelayMs: 5000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    },
    cleanup: {
      failedFileRetentionDays: 30,
      orphanedChunkRetentionDays: 7,
      cleanupBatchSize: 100,
    },
    rateLimit: {
      maxManualRetriesPerHour: 10,
    },
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
  ProcessingRetryManager,
  getProcessingRetryManager,
  __resetProcessingRetryManager,
} from '@/domains/files/retry/ProcessingRetryManager';

describe('ProcessingRetryManager', () => {
  let retryManager: ProcessingRetryManager;

  const testUserId = 'test-user-retry-123';
  const testFileId = 'test-file-retry-456';

  const createMockFile = (overrides: Partial<ParsedFile> = {}): ParsedFile => ({
    id: testFileId,
    userId: testUserId,
    parentFolderId: null,
    name: 'test-file.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    blobPath: 'users/test-user/files/test.pdf',
    isFolder: false,
    isFavorite: false,
    processingStatus: 'failed',
    embeddingStatus: 'pending',
    readinessState: 'failed',
    processingRetryCount: 0,
    embeddingRetryCount: 0,
    lastError: null,
    failedAt: new Date().toISOString(),
    hasExtractedText: false,
    contentHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations
    mockIncrementProcessingRetryCount.mockResolvedValue(1);
    mockIncrementEmbeddingRetryCount.mockResolvedValue(1);
    mockGetFile.mockResolvedValue(createMockFile());
    mockCleanupForFile.mockResolvedValue({
      fileId: testFileId,
      chunksDeleted: 0,
      searchDocumentsDeleted: 0,
      success: true,
    });

    // Reset singleton
    __resetProcessingRetryManager();
    retryManager = getProcessingRetryManager();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getProcessingRetryManager();
      const instance2 = getProcessingRetryManager();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getProcessingRetryManager();
      __resetProcessingRetryManager();
      const instance2 = getProcessingRetryManager();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: shouldRetry ==========
  describe('shouldRetry()', () => {
    it('should return shouldRetry=true when retryCount < maxRetries (processing)', async () => {
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 0 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(1);

      const result = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      expect(result.shouldRetry).toBe(true);
      expect(result.newRetryCount).toBe(1);
      expect(result.maxRetries).toBe(2);
      expect(result.reason).toBe('within_limit');
    });

    it('should return shouldRetry=false when retryCount >= maxRetries (processing)', async () => {
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 2 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(3);

      const result = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      expect(result.shouldRetry).toBe(false);
      expect(result.newRetryCount).toBe(3);
      expect(result.reason).toBe('max_retries_exceeded');
    });

    it('should return shouldRetry=false when retryCount equals maxRetries (boundary case)', async () => {
      // This test verifies the boundary condition: when count exactly equals max, no more retries
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 1 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(2); // equals maxRetries (2)

      const result = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      expect(result.shouldRetry).toBe(false); // 2 < 2 = false
      expect(result.newRetryCount).toBe(2);
      expect(result.maxRetries).toBe(2);
      expect(result.reason).toBe('max_retries_exceeded');
    });

    it('should return shouldRetry=true for embedding within limit', async () => {
      mockGetFile.mockResolvedValue(createMockFile({ embeddingRetryCount: 1 }));
      mockIncrementEmbeddingRetryCount.mockResolvedValue(2);

      const result = await retryManager.shouldRetry(testUserId, testFileId, 'embedding');

      expect(result.shouldRetry).toBe(true);
      expect(result.newRetryCount).toBe(2);
      expect(result.maxRetries).toBe(3); // maxEmbeddingRetries = 3
    });

    it('should increment retry count via FileRetryService', async () => {
      mockGetFile.mockResolvedValue(createMockFile());

      await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      expect(mockIncrementProcessingRetryCount).toHaveBeenCalledWith(testUserId, testFileId);
    });

    it('should calculate exponential backoff correctly', async () => {
      // Use first retry (newCount=1) where shouldRetry is true (1 < 2)
      mockGetFile.mockResolvedValue(createMockFile({ processingRetryCount: 0 }));
      mockIncrementProcessingRetryCount.mockResolvedValue(1);

      const result = await retryManager.shouldRetry(testUserId, testFileId, 'processing');

      // backoffDelayMs = baseDelay * 2^retryCount = 5000 * 2^0 = 5000 (plus jitter)
      expect(result.shouldRetry).toBe(true); // 1 < 2 = true
      expect(result.backoffDelayMs).toBeGreaterThanOrEqual(5000);
      expect(result.backoffDelayMs).toBeLessThanOrEqual(5500); // 10% jitter
    });

    it('should throw error when file not found', async () => {
      mockGetFile.mockResolvedValue(null);

      await expect(
        retryManager.shouldRetry(testUserId, testFileId, 'processing')
      ).rejects.toThrow('File not found');
    });
  });

  // ========== SUITE 2: executeManualRetry ==========
  describe('executeManualRetry()', () => {
    it('should return error when file not in failed state', async () => {
      mockGetFile.mockResolvedValue(createMockFile({ readinessState: 'ready' }));

      const result = await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in failed state');
    });

    it('should clear retry counters via FileRetryService', async () => {
      mockGetFile
        .mockResolvedValueOnce(createMockFile({ readinessState: 'failed' }))
        .mockResolvedValue(createMockFile({ readinessState: 'processing' }));

      await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      expect(mockClearFailedStatus).toHaveBeenCalledWith(testUserId, testFileId, 'full');
    });

    it('should update processing status for scope=full', async () => {
      mockGetFile
        .mockResolvedValueOnce(createMockFile({ readinessState: 'failed' }))
        .mockResolvedValue(createMockFile({ readinessState: 'processing' }));

      await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(testUserId, testFileId, 'pending');
    });

    it('should update embedding status for scope=embedding_only', async () => {
      mockGetFile
        .mockResolvedValueOnce(createMockFile({
          readinessState: 'failed',
          processingStatus: 'completed',
          embeddingStatus: 'failed',
        }))
        .mockResolvedValue(createMockFile({ readinessState: 'processing' }));

      await retryManager.executeManualRetry(testUserId, testFileId, 'embedding_only');

      expect(mockUpdateEmbeddingStatus).toHaveBeenCalledWith(testUserId, testFileId, 'pending');
    });

    it('should return updated file and success on completion', async () => {
      const updatedFile = createMockFile({ readinessState: 'processing' });
      mockGetFile
        .mockResolvedValueOnce(createMockFile({ readinessState: 'failed' }))
        .mockResolvedValue(updatedFile);

      const result = await retryManager.executeManualRetry(testUserId, testFileId, 'full');

      expect(result.success).toBe(true);
      expect(result.file.readinessState).toBe('processing');
    });
  });

  // ========== SUITE 3: handlePermanentFailure ==========
  describe('handlePermanentFailure()', () => {
    it('should mark file as permanently failed', async () => {
      await retryManager.handlePermanentFailure(testUserId, testFileId, 'Test error');

      expect(mockMarkAsPermanentlyFailed).toHaveBeenCalledWith(testUserId, testFileId);
    });

    it('should store error message', async () => {
      await retryManager.handlePermanentFailure(testUserId, testFileId, 'Processing failed');

      expect(mockSetLastProcessingError).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        'Processing failed'
      );
    });

    it('should trigger cleanup via PartialDataCleaner', async () => {
      await retryManager.handlePermanentFailure(testUserId, testFileId, 'Error');

      expect(mockCleanupForFile).toHaveBeenCalledWith(testUserId, testFileId);
    });

    it('should log but not fail if cleanup errors', async () => {
      mockCleanupForFile.mockRejectedValue(new Error('Cleanup failed'));

      // Should not throw
      await expect(
        retryManager.handlePermanentFailure(testUserId, testFileId, 'Error')
      ).resolves.not.toThrow();

      // Should log the error
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ========== SUITE 4: calculateBackoffDelay ==========
  describe('calculateBackoffDelay()', () => {
    it('should return baseDelay for retryCount=0', () => {
      // baseDelay = 5000, multiplier = 2, 5000 * 2^0 = 5000
      const delay = retryManager.calculateBackoffDelay(0);
      expect(delay).toBeGreaterThanOrEqual(5000);
      expect(delay).toBeLessThanOrEqual(5500); // 10% jitter
    });

    it('should double delay for each retry', () => {
      // retryCount=1: 5000 * 2^1 = 10000
      const delay1 = retryManager.calculateBackoffDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(10000);
      expect(delay1).toBeLessThanOrEqual(11000);

      // retryCount=2: 5000 * 2^2 = 20000
      const delay2 = retryManager.calculateBackoffDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(20000);
      expect(delay2).toBeLessThanOrEqual(22000);
    });

    it('should cap at maxDelay', () => {
      // maxDelay = 60000, 5000 * 2^10 = 5120000 > 60000, so should cap
      const delay = retryManager.calculateBackoffDelay(10);
      expect(delay).toBeLessThanOrEqual(66000); // maxDelay + 10% jitter
    });

    it('should add jitter within expected range', () => {
      // Run multiple times to verify jitter varies
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        __resetProcessingRetryManager();
        const manager = getProcessingRetryManager();
        delays.add(manager.calculateBackoffDelay(0));
      }
      // With jitter, we should see some variation
      expect(delays.size).toBeGreaterThan(1);
    });
  });
});
