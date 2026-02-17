/**
 * Unit tests for DLQService (PRD-04)
 *
 * Tests:
 * 1. listEntries: Returns paginated failed files
 * 2. retryFile success: Transitions to queued, reads file, creates flow
 * 3. retryFile - transition fails: Returns error
 * 4. retryFile - file not found: Returns error
 * 5. retryAll: Retries multiple files
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PIPELINE_STATUS } from '@bc-agent/shared';

// ============================================================================
// Mocks
// ============================================================================

// Hoisted mocks - available before module evaluation
const {
  mockTransitionStatus,
  mockFindMany,
  mockFindFirst,
  mockCount,
  mockAddFileProcessingFlow,
  mockLogger,
} = vi.hoisted(() => {
  const mockLoggerInstance = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(function(this: typeof mockLoggerInstance) { return this; }),
  };

  return {
    mockTransitionStatus: vi.fn(),
    mockFindMany: vi.fn(),
    mockFindFirst: vi.fn(),
    mockCount: vi.fn(),
    mockAddFileProcessingFlow: vi.fn(),
    mockLogger: mockLoggerInstance,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

vi.mock('@/services/files/repository/FileRepositoryV2', () => ({
  getFileRepositoryV2: vi.fn(() => ({
    transitionStatus: mockTransitionStatus,
  })),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      count: mockCount,
    },
  },
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addFileProcessingFlow: mockAddFileProcessingFlow,
    queueManager: {
      getQueue: vi.fn(() => ({
        add: vi.fn().mockResolvedValue({ id: 'dlq-job-123' }),
      })),
    },
  })),
  QueueName: { V2_DLQ: 'v2-dead-letter-queue' },
}));

import { DLQService } from '@/services/queue/DLQService';

describe('DLQService', () => {
  let service: DLQService;

  const TEST_USER_ID = 'USER-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
  const TEST_FILE_ID = 'FILE-11111111-2222-3333-4444-555555555555';
  const TEST_BATCH_ID = 'BATCH-99999999-8888-7777-6666-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DLQService();
  });

  describe('listEntries', () => {
    it('should return paginated list of failed files', async () => {
      const mockFiles = [
        {
          id: TEST_FILE_ID,
          name: 'test-document.pdf',
          batch_id: TEST_BATCH_ID,
          pipeline_status: PIPELINE_STATUS.FAILED,
          created_at: new Date('2025-01-15T10:00:00Z'),
          updated_at: new Date('2025-01-15T10:30:00Z'),
        },
      ];

      mockFindMany.mockResolvedValue(mockFiles);
      mockCount.mockResolvedValue(1);

      const result = await service.listEntries(TEST_USER_ID, 1, 20);

      // Verify query parameters
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          user_id: TEST_USER_ID,
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
        },
        select: {
          id: true,
          name: true,
          batch_id: true,
          pipeline_status: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { updated_at: 'desc' },
        skip: 0,
        take: 20,
      });

      expect(mockCount).toHaveBeenCalledWith({
        where: {
          user_id: TEST_USER_ID,
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
        },
      });

      // Verify response structure
      expect(result).toEqual({
        entries: [
          {
            fileId: TEST_FILE_ID.toUpperCase(),
            batchId: TEST_BATCH_ID.toUpperCase(),
            userId: TEST_USER_ID,
            stage: 'extract',
            error: 'Processing failed',
            attempts: 0,
            failedAt: expect.any(String),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('should handle pagination correctly', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(45);

      await service.listEntries(TEST_USER_ID, 3, 20);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // (page 3 - 1) * 20
          take: 20,
        }),
      );
    });
  });

  describe('retryFile', () => {
    it('should successfully retry a failed file', async () => {
      const mockFile = {
        id: TEST_FILE_ID,
        name: 'document.pdf',
        mime_type: 'application/pdf',
        blob_path: `users/${TEST_USER_ID}/files/document.pdf`,
        batch_id: TEST_BATCH_ID,
      };

      mockTransitionStatus.mockResolvedValue({ success: true });
      mockFindFirst.mockResolvedValue(mockFile);

      const result = await service.retryFile(TEST_FILE_ID, TEST_USER_ID);

      // Verify status transition
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
      );

      // Verify file details query
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { id: TEST_FILE_ID, user_id: TEST_USER_ID },
        select: { id: true, name: true, mime_type: true, blob_path: true, batch_id: true },
      });

      // Verify flow creation
      expect(mockAddFileProcessingFlow).toHaveBeenCalledWith({
        fileId: TEST_FILE_ID,
        userId: TEST_USER_ID,
        batchId: TEST_BATCH_ID.toUpperCase(),
        mimeType: mockFile.mime_type,
        blobPath: mockFile.blob_path,
        fileName: mockFile.name,
      });

      expect(result).toEqual({ success: true });
    });

    it('should return error when status transition fails', async () => {
      mockTransitionStatus.mockResolvedValue({
        success: false,
        error: 'Invalid status transition',
      });

      const result = await service.retryFile(TEST_FILE_ID, TEST_USER_ID);

      expect(result).toEqual({
        success: false,
        error: 'Invalid status transition',
      });

      // Verify no flow was created
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
    });

    it('should return error when file is not found', async () => {
      mockTransitionStatus.mockResolvedValue({ success: true });
      mockFindFirst.mockResolvedValue(null);

      const result = await service.retryFile(TEST_FILE_ID, TEST_USER_ID);

      expect(result).toEqual({
        success: false,
        error: 'File not found',
      });

      // Verify no flow was created
      expect(mockAddFileProcessingFlow).not.toHaveBeenCalled();
    });
  });

  describe('retryAll', () => {
    it('should retry all failed files for a user', async () => {
      const mockFailedFiles = [
        { id: 'FILE-00000001-0000-0000-0000-000000000001' },
        { id: 'FILE-00000002-0000-0000-0000-000000000002' },
        { id: 'FILE-00000003-0000-0000-0000-000000000003' },
      ];

      mockFindMany.mockResolvedValue(mockFailedFiles);

      // Mock retryFile via service spy
      const retryFileSpy = vi.spyOn(service, 'retryFile');
      retryFileSpy
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Transition failed' });

      const result = await service.retryAll(TEST_USER_ID);

      // Verify query for failed files
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          user_id: TEST_USER_ID,
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
        },
        select: { id: true },
        take: 100,
      });

      // Verify each file was retried
      expect(retryFileSpy).toHaveBeenCalledTimes(3);
      expect(retryFileSpy).toHaveBeenCalledWith('FILE-00000001-0000-0000-0000-000000000001', TEST_USER_ID);
      expect(retryFileSpy).toHaveBeenCalledWith('FILE-00000002-0000-0000-0000-000000000002', TEST_USER_ID);
      expect(retryFileSpy).toHaveBeenCalledWith('FILE-00000003-0000-0000-0000-000000000003', TEST_USER_ID);

      // Verify result counts
      expect(result).toEqual({
        retried: 2,
        failed: 1,
      });

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          retried: 2,
          failed: 1,
        }),
        'Bulk retry completed',
      );

      retryFileSpy.mockRestore();
    });

    it('should handle empty failed files list', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await service.retryAll(TEST_USER_ID);

      expect(result).toEqual({
        retried: 0,
        failed: 0,
      });
    });
  });
});
