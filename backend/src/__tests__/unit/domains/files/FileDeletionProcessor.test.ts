/**
 * FileDeletionProcessor Unit Tests
 *
 * Tests for the file deletion processor that handles BullMQ queue jobs.
 * This processor deletes files from database, blob storage, and emits
 * WebSocket events for status updates.
 *
 * Pattern: vi.hoisted() + DI constructor injection
 *
 * Methods covered:
 * - processJob()
 * - Singleton pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileDeletionJobData } from '@bc-agent/shared';
import { FILE_WS_EVENTS } from '@bc-agent/shared';

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

// ===== MOCK FILE SERVICE =====
const mockDeleteFile = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['blob/path/to/file.pdf'])
);

vi.mock('@/services/files/FileService', () => ({
  getFileService: vi.fn(() => ({
    deleteFile: mockDeleteFile,
  })),
}));

// ===== MOCK FILE UPLOAD SERVICE =====
const mockDeleteFromBlob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    deleteFromBlob: mockDeleteFromBlob,
  })),
}));

// ===== MOCK SOCKET SERVICE =====
const mockIsSocketReady = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockEmit = vi.hoisted(() => vi.fn());
const mockTo = vi.hoisted(() => vi.fn().mockReturnValue({ emit: mockEmit }));
const mockGetIO = vi.hoisted(() => vi.fn().mockReturnValue({ to: mockTo }));

vi.mock('@/services/websocket/SocketService', () => ({
  isSocketServiceInitialized: mockIsSocketReady,
  getSocketIO: mockGetIO,
}));

// Import after mocks
import {
  FileDeletionProcessor,
  getFileDeletionProcessor,
  __resetFileDeletionProcessor,
} from '@/domains/files/deletion';

describe('FileDeletionProcessor', () => {
  let processor: FileDeletionProcessor;

  const testUserId = 'TEST-USER-DELETION-123';
  const testFileId = 'TEST-FILE-DELETION-456';
  const testBatchId = 'TEST-BATCH-789';

  const createJobData = (overrides?: Partial<FileDeletionJobData>): FileDeletionJobData => ({
    fileId: testFileId,
    userId: testUserId,
    batchId: testBatchId,
    deletionReason: 'user_request',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations
    mockDeleteFile.mockResolvedValue(['blob/path/to/file.pdf']);
    mockDeleteFromBlob.mockResolvedValue(undefined);
    mockIsSocketReady.mockReturnValue(true);
    mockTo.mockReturnValue({ emit: mockEmit });
    mockGetIO.mockReturnValue({ to: mockTo });

    // Reset singleton
    __resetFileDeletionProcessor();
    processor = getFileDeletionProcessor();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getFileDeletionProcessor();
      const instance2 = getFileDeletionProcessor();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getFileDeletionProcessor();
      __resetFileDeletionProcessor();
      const instance2 = getFileDeletionProcessor();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: processJob - Success Cases ==========
  describe('processJob() - Success Cases', () => {
    it('should delete file from database', async () => {
      const jobData = createJobData();

      await processor.processJob(jobData);

      expect(mockDeleteFile).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { deletionReason: 'user_request' }
      );
    });

    it('should delete blob from storage', async () => {
      mockDeleteFile.mockResolvedValue(['blob/path/file.pdf']);
      const jobData = createJobData();

      await processor.processJob(jobData);

      expect(mockDeleteFromBlob).toHaveBeenCalledWith('blob/path/file.pdf');
    });

    it('should delete multiple blobs when file has multiple chunks', async () => {
      mockDeleteFile.mockResolvedValue([
        'blob/path/chunk-1.pdf',
        'blob/path/chunk-2.pdf',
        'blob/path/chunk-3.pdf',
      ]);
      const jobData = createJobData();

      await processor.processJob(jobData);

      expect(mockDeleteFromBlob).toHaveBeenCalledTimes(3);
      expect(mockDeleteFromBlob).toHaveBeenCalledWith('blob/path/chunk-1.pdf');
      expect(mockDeleteFromBlob).toHaveBeenCalledWith('blob/path/chunk-2.pdf');
      expect(mockDeleteFromBlob).toHaveBeenCalledWith('blob/path/chunk-3.pdf');
    });

    it('should emit success event via WebSocket', async () => {
      const jobData = createJobData();

      await processor.processJob(jobData);

      expect(mockTo).toHaveBeenCalledWith(`user:${testUserId}`);
      expect(mockEmit).toHaveBeenCalledWith(
        'file:status',
        expect.objectContaining({
          type: FILE_WS_EVENTS.DELETED,
          fileId: testFileId,
          batchId: testBatchId,
          success: true,
        })
      );
    });

    it('should return success result with blob count', async () => {
      mockDeleteFile.mockResolvedValue(['blob1.pdf', 'blob2.pdf']);
      const jobData = createJobData();

      const result = await processor.processJob(jobData);

      expect(result).toEqual({
        fileId: testFileId,
        success: true,
        blobPathsDeleted: 2,
      });
    });

    it('should handle file with no blobs', async () => {
      mockDeleteFile.mockResolvedValue([]);
      const jobData = createJobData();

      const result = await processor.processJob(jobData);

      expect(result.blobPathsDeleted).toBe(0);
      expect(mockDeleteFromBlob).not.toHaveBeenCalled();
    });

    it('should pass deletionReason to FileService', async () => {
      const jobData = createJobData({ deletionReason: 'gdpr_erasure' });

      await processor.processJob(jobData);

      expect(mockDeleteFile).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        { deletionReason: 'gdpr_erasure' }
      );
    });
  });

  // ========== SUITE 2: processJob - Error Handling ==========
  describe('processJob() - Error Handling', () => {
    it('should emit failure event when database deletion fails', async () => {
      mockDeleteFile.mockRejectedValue(new Error('DB connection lost'));
      const jobData = createJobData();

      await expect(processor.processJob(jobData)).rejects.toThrow('DB connection lost');

      expect(mockEmit).toHaveBeenCalledWith(
        'file:status',
        expect.objectContaining({
          type: FILE_WS_EVENTS.DELETED,
          fileId: testFileId,
          success: false,
          error: 'DB connection lost',
        })
      );
    });

    it('should rethrow error for BullMQ retry', async () => {
      mockDeleteFile.mockRejectedValue(new Error('Transaction deadlock'));
      const jobData = createJobData();

      await expect(processor.processJob(jobData)).rejects.toThrow('Transaction deadlock');
    });

    it('should continue if blob deletion fails (eventual consistency)', async () => {
      mockDeleteFile.mockResolvedValue(['blob/path.pdf']);
      mockDeleteFromBlob.mockRejectedValue(new Error('Blob not found'));
      const jobData = createJobData();

      // Should NOT throw - blob errors are logged but don't fail the job
      const result = await processor.processJob(jobData);

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: testFileId,
          blobPath: 'blob/path.pdf',
        }),
        expect.stringContaining('eventual consistency')
      );
    });

    it('should log and continue on partial blob deletion failure', async () => {
      mockDeleteFile.mockResolvedValue(['blob1.pdf', 'blob2.pdf', 'blob3.pdf']);
      mockDeleteFromBlob
        .mockResolvedValueOnce(undefined) // blob1 succeeds
        .mockRejectedValueOnce(new Error('Azure timeout')) // blob2 fails
        .mockResolvedValueOnce(undefined); // blob3 succeeds

      const jobData = createJobData();
      const result = await processor.processJob(jobData);

      // Job should succeed overall
      expect(result.success).toBe(true);
      expect(result.blobPathsDeleted).toBe(3); // Attempted count
      // Warning should be logged
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  // ========== SUITE 3: WebSocket Handling ==========
  describe('WebSocket Handling', () => {
    it('should skip emission when Socket.IO not ready', async () => {
      mockIsSocketReady.mockReturnValue(false);
      const jobData = createJobData();

      await processor.processJob(jobData);

      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        expect.stringContaining('Socket.IO not ready')
      );
    });

    it('should not fail if WebSocket emission throws', async () => {
      mockEmit.mockImplementation(() => {
        throw new Error('Socket error');
      });
      const jobData = createJobData();

      // Should complete successfully despite WebSocket error
      const result = await processor.processJob(jobData);

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        expect.stringContaining('Failed to emit')
      );
    });

    it('should emit to user-specific room for multi-tenant isolation', async () => {
      const jobData = createJobData({ userId: 'OTHER-USER-999' });

      await processor.processJob(jobData);

      expect(mockTo).toHaveBeenCalledWith('user:OTHER-USER-999');
    });
  });

  // ========== SUITE 4: Dependency Injection ==========
  describe('Dependency Injection', () => {
    it('should accept injected dependencies', async () => {
      const mockInjectedFileService = {
        deleteFile: vi.fn().mockResolvedValue(['injected-blob.pdf']),
      };
      const mockInjectedUploadService = {
        deleteFromBlob: vi.fn().mockResolvedValue(undefined),
      };

      __resetFileDeletionProcessor();
      const injectedProcessor = new FileDeletionProcessor({
        fileService: mockInjectedFileService,
        fileUploadService: mockInjectedUploadService,
        logger: mockLogger,
        isSocketReady: () => true,
        getIO: mockGetIO,
      });

      await injectedProcessor.processJob(createJobData());

      expect(mockInjectedFileService.deleteFile).toHaveBeenCalled();
      expect(mockInjectedUploadService.deleteFromBlob).toHaveBeenCalledWith('injected-blob.pdf');
    });

    it('should use default services when not injected', () => {
      __resetFileDeletionProcessor();
      // Simply instantiating should not throw
      const defaultProcessor = new FileDeletionProcessor();
      expect(defaultProcessor).toBeInstanceOf(FileDeletionProcessor);
    });
  });

  // ========== SUITE 5: Multi-Tenant Isolation ==========
  describe('Multi-Tenant Isolation', () => {
    it('should enforce userId in file deletion', async () => {
      const jobData = createJobData({ userId: 'TENANT-A-USER' });

      await processor.processJob(jobData);

      expect(mockDeleteFile).toHaveBeenCalledWith(
        'TENANT-A-USER',
        testFileId,
        expect.any(Object)
      );
    });

    it('should emit events only to owning user room', async () => {
      const jobData = createJobData({ userId: 'TENANT-B-USER' });

      await processor.processJob(jobData);

      expect(mockTo).toHaveBeenCalledWith('user:TENANT-B-USER');
      // Verify it was called exactly once (not to other rooms)
      expect(mockTo).toHaveBeenCalledTimes(1);
    });
  });
});
