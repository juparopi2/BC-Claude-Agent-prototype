/**
 * Unit Tests - Upload Dashboard Routes (PRD-05)
 *
 * Tests for the observability and error recovery dashboard endpoints.
 * Validates response shapes, error handling, and integration with repository/queue services.
 *
 * Endpoints tested:
 * - GET /api/v2/uploads/dashboard - Dashboard overview
 * - GET /api/v2/uploads/dashboard/stuck - List stuck files
 * - GET /api/v2/uploads/dashboard/orphans - Orphan report
 * - POST /api/v2/uploads/dashboard/stuck/:fileId/retry - Retry single file
 * - POST /api/v2/uploads/dashboard/stuck/retry-all - Bulk retry
 *
 * @module __tests__/unit/routes/v2/upload-dashboard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Application } from 'express';
import { PIPELINE_STATUS, type PipelineStatus } from '@bc-agent/shared';

// ============================================
// Mock Dependencies - Must be before imports
// ============================================

const TEST_USER_ID = 'TEST-USER-00000000-0000-0000-0000-000000000001';
const TEST_FILE_ID = 'FILE-00000000-0000-0000-0000-000000000001';
const TEST_BATCH_ID = 'BATCH-00000000-0000-0000-0000-000000000001';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Create mock FileRepositoryV2
const mockFileRepositoryV2 = {
  getStatusDistribution: vi.fn(),
  findStuckFiles: vi.fn(),
  findAbandonedFiles: vi.fn(),
  forceStatus: vi.fn(),
  transitionStatusWithRetry: vi.fn(),
};

vi.mock('@/services/files/repository/FileRepositoryV2', () => ({
  getFileRepositoryV2: () => mockFileRepositoryV2,
}));

// Create mock Prisma client
const mockPrisma = {
  files: {
    groupBy: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: mockPrisma,
}));

// Create mock MessageQueue
const mockMessageQueue = {
  getQueueStats: vi.fn(),
  addFileProcessingFlow: vi.fn(),
};

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: () => mockMessageQueue,
}));

// Mock QueueName constants
vi.mock('@/infrastructure/queue/constants', () => ({
  QueueName: {
    V2_FILE_EXTRACT: 'v2-file-extract',
    V2_FILE_CHUNK: 'v2-file-chunk',
    V2_FILE_EMBED: 'v2-file-embed',
    V2_FILE_PIPELINE_COMPLETE: 'v2-file-pipeline-complete',
    V2_DLQ: 'v2-dead-letter-queue',
    V2_MAINTENANCE: 'v2-maintenance',
  },
}));

// Import router after mocks
import dashboardRoutes from '@/routes/v2/uploads/dashboard.routes';

// ============================================
// Test Helpers
// ============================================

/**
 * Creates Express app with fake auth middleware and dashboard routes.
 */
function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Fake auth middleware that sets userId
  app.use((req, _res, next) => {
    (req as any).userId = TEST_USER_ID;
    next();
  });

  app.use('/api/v2/uploads/dashboard', dashboardRoutes);
  return app;
}

/**
 * Creates a mock status distribution for all pipeline states.
 */
function createMockDistribution(overrides: Partial<Record<PipelineStatus, number>> = {}): Record<PipelineStatus, number> {
  return {
    [PIPELINE_STATUS.REGISTERED]: 0,
    [PIPELINE_STATUS.UPLOADED]: 0,
    [PIPELINE_STATUS.QUEUED]: 0,
    [PIPELINE_STATUS.EXTRACTING]: 0,
    [PIPELINE_STATUS.CHUNKING]: 0,
    [PIPELINE_STATUS.EMBEDDING]: 0,
    [PIPELINE_STATUS.READY]: 0,
    [PIPELINE_STATUS.FAILED]: 0,
    ...overrides,
  };
}

// ============================================
// Test Suite
// ============================================

describe('Upload Dashboard Routes (PRD-05)', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ============================================
  // GET / - Dashboard Overview
  // ============================================
  describe('GET /api/v2/uploads/dashboard - Dashboard Overview', () => {
    it('should return 200 with dashboard overview including status distribution', async () => {
      // Arrange
      const mockDistribution = createMockDistribution({
        [PIPELINE_STATUS.UPLOADED]: 5,
        [PIPELINE_STATUS.QUEUED]: 10,
        [PIPELINE_STATUS.READY]: 150,
        [PIPELINE_STATUS.FAILED]: 3,
      });

      mockFileRepositoryV2.getStatusDistribution.mockResolvedValue(mockDistribution);
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);
      mockPrisma.files.groupBy.mockResolvedValue([]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('statusDistribution');
      expect(response.body).toHaveProperty('stuckCount', 0);
      expect(response.body).toHaveProperty('queueDepths');
      expect(response.body).toHaveProperty('last24h');
      expect(response.body.statusDistribution).toEqual(mockDistribution);
      expect(response.body.last24h).toEqual({ uploaded: 0, completed: 0, failed: 0 });
    });

    it('should include stuck count from findStuckFiles', async () => {
      // Arrange
      mockFileRepositoryV2.getStatusDistribution.mockResolvedValue(createMockDistribution());
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([
        { id: 'FILE-1', user_id: TEST_USER_ID, name: 'stuck1.pdf', pipeline_status: 'queued', updated_at: new Date(), pipeline_retry_count: 0 },
        { id: 'FILE-2', user_id: TEST_USER_ID, name: 'stuck2.pdf', pipeline_status: 'extracting', updated_at: new Date(), pipeline_retry_count: 1 },
      ]);
      mockPrisma.files.groupBy.mockResolvedValue([]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(200);

      // Assert
      expect(response.body.stuckCount).toBe(2);
      expect(mockFileRepositoryV2.findStuckFiles).toHaveBeenCalledWith(15 * 60 * 1000, TEST_USER_ID);
    });

    it('should include queue depths for V2 pipeline queues', async () => {
      // Arrange
      mockFileRepositoryV2.getStatusDistribution.mockResolvedValue(createMockDistribution());
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);
      mockPrisma.files.groupBy.mockResolvedValue([]);

      mockMessageQueue.getQueueStats.mockResolvedValue({
        waiting: 10,
        active: 2,
        failed: 1,
        delayed: 0,
      });

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(200);

      // Assert
      expect(response.body.queueDepths).toHaveProperty('v2-file-extract');
      expect(response.body.queueDepths).toHaveProperty('v2-file-chunk');
      expect(response.body.queueDepths).toHaveProperty('v2-file-embed');
      expect(response.body.queueDepths).toHaveProperty('v2-file-pipeline-complete');
      expect(response.body.queueDepths).toHaveProperty('v2-dead-letter-queue');
      expect(response.body.queueDepths).toHaveProperty('v2-maintenance');

      const queueDepth = response.body.queueDepths['v2-file-extract'];
      expect(queueDepth).toEqual({ waiting: 10, active: 2, failed: 1, delayed: 0 });
    });

    it('should include last24h metrics from database', async () => {
      // Arrange
      mockFileRepositoryV2.getStatusDistribution.mockResolvedValue(createMockDistribution());
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);

      // Mock groupBy to return last 24h counts
      mockPrisma.files.groupBy.mockResolvedValue([
        { pipeline_status: PIPELINE_STATUS.UPLOADED, _count: { id: 25 } },
        { pipeline_status: PIPELINE_STATUS.READY, _count: { id: 100 } },
        { pipeline_status: PIPELINE_STATUS.FAILED, _count: { id: 5 } },
      ]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(200);

      // Assert
      expect(response.body.last24h).toEqual({
        uploaded: 25,
        completed: 100,
        failed: 5,
      });

      // Verify groupBy was called with correct query
      expect(mockPrisma.files.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['pipeline_status'],
          _count: { id: true },
          where: expect.objectContaining({
            user_id: TEST_USER_ID,
            pipeline_status: { in: [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED] },
            deletion_status: null,
          }),
        })
      );
    });

    it('should return 500 on error', async () => {
      // Arrange
      mockFileRepositoryV2.getStatusDistribution.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error', 'Failed to get dashboard overview');
    });
  });

  // ============================================
  // GET /stuck - List Stuck Files
  // ============================================
  describe('GET /api/v2/uploads/dashboard/stuck - List Stuck Files', () => {
    it('should return 200 with stuck files list', async () => {
      // Arrange
      const now = Date.now();
      const updatedAt = new Date(now - 20 * 60 * 1000); // 20 minutes ago

      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([
        {
          id: 'file-123',
          user_id: 'user-456',
          name: 'stuck.pdf',
          pipeline_status: 'queued',
          updated_at: updatedAt,
          pipeline_retry_count: 0,
          created_at: new Date(now - 60 * 60 * 1000),
        },
      ]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/stuck')
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('files');
      expect(response.body).toHaveProperty('total', 1);
      expect(response.body.files).toHaveLength(1);

      const file = response.body.files[0];
      expect(file).toMatchObject({
        fileId: 'FILE-123', // Uppercase conversion
        userId: 'USER-456', // Uppercase conversion
        name: 'stuck.pdf',
        pipelineStatus: 'queued',
        pipelineRetryCount: 0,
      });
      expect(file.stuckSinceMs).toBeGreaterThan(19 * 60 * 1000); // At least 19 minutes
      expect(file.updatedAt).toBeTruthy();
      expect(file.createdAt).toBeTruthy();
    });

    it('should return empty list when no stuck files', async () => {
      // Arrange
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/stuck')
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        files: [],
        total: 0,
      });
    });

    it('should return 500 on error', async () => {
      // Arrange
      mockFileRepositoryV2.findStuckFiles.mockRejectedValue(
        new Error('Query timeout')
      );

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/stuck')
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error', 'Failed to list stuck files');
    });
  });

  // ============================================
  // GET /orphans - Orphan Report
  // ============================================
  describe('GET /api/v2/uploads/dashboard/orphans - Orphan Report', () => {
    it('should return orphan report with counts', async () => {
      // Arrange
      mockFileRepositoryV2.findAbandonedFiles.mockResolvedValue([
        { id: 'abandoned-1' },
        { id: 'abandoned-2' },
      ]);
      mockPrisma.files.count.mockResolvedValue(15);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/orphans')
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        abandonedUploads: 2,
        oldFailures: 15,
        lastScanAt: null,
      });

      expect(mockFileRepositoryV2.findAbandonedFiles).toHaveBeenCalledWith(
        24 * 60 * 60 * 1000, // 24 hours in ms
        TEST_USER_ID
      );

      expect(mockPrisma.files.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          user_id: TEST_USER_ID,
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
        }),
      });
    });

    it('should return 500 on error', async () => {
      // Arrange
      mockFileRepositoryV2.findAbandonedFiles.mockRejectedValue(
        new Error('Database error')
      );

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/orphans')
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error', 'Failed to get orphan report');
    });
  });

  // ============================================
  // POST /stuck/:fileId/retry - Retry Single File
  // ============================================
  describe('POST /api/v2/uploads/dashboard/stuck/:fileId/retry - Retry Single File', () => {
    it('should successfully retry a stuck file', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TEST_FILE_ID,
        name: 'stuck.pdf',
        mime_type: 'application/pdf',
        blob_path: '/path/to/blob',
        batch_id: TEST_BATCH_ID,
        pipeline_status: PIPELINE_STATUS.QUEUED,
      });

      mockFileRepositoryV2.forceStatus.mockResolvedValue({ success: true });
      mockFileRepositoryV2.transitionStatusWithRetry.mockResolvedValue({ success: true });
      mockMessageQueue.addFileProcessingFlow.mockResolvedValue(undefined);

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        fileId: TEST_FILE_ID,
        success: true,
      });

      expect(mockPrisma.files.findFirst).toHaveBeenCalledWith({
        where: { id: TEST_FILE_ID, user_id: TEST_USER_ID, deletion_status: null },
        select: expect.any(Object),
      });

      expect(mockFileRepositoryV2.forceStatus).toHaveBeenCalledWith(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.FAILED
      );

      expect(mockFileRepositoryV2.transitionStatusWithRetry).toHaveBeenCalledWith(
        TEST_FILE_ID,
        TEST_USER_ID,
        PIPELINE_STATUS.FAILED,
        PIPELINE_STATUS.QUEUED,
        1
      );

      expect(mockMessageQueue.addFileProcessingFlow).toHaveBeenCalledWith({
        fileId: TEST_FILE_ID,
        userId: TEST_USER_ID,
        batchId: TEST_BATCH_ID,
        mimeType: 'application/pdf',
        blobPath: '/path/to/blob',
        fileName: 'stuck.pdf',
      });
    });

    it('should return 404 for non-existent file', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockResolvedValue(null);

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(404);

      // Assert
      expect(response.body).toHaveProperty('error', 'File not found');
    });

    it('should return 409 on transition failure (forceStatus)', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TEST_FILE_ID,
        name: 'stuck.pdf',
        mime_type: 'application/pdf',
        blob_path: '/path/to/blob',
        batch_id: TEST_BATCH_ID,
        pipeline_status: PIPELINE_STATUS.EXTRACTING,
      });

      mockFileRepositoryV2.forceStatus.mockResolvedValue({
        success: false,
        error: 'Failed to force status',
      });

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(409);

      // Assert
      expect(response.body).toEqual({
        fileId: TEST_FILE_ID,
        success: false,
        error: 'Failed to force status',
      });
    });

    it('should return 409 on transition failure (transitionStatusWithRetry)', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TEST_FILE_ID,
        name: 'stuck.pdf',
        mime_type: 'application/pdf',
        blob_path: '/path/to/blob',
        batch_id: TEST_BATCH_ID,
        pipeline_status: PIPELINE_STATUS.FAILED,
      });

      mockFileRepositoryV2.transitionStatusWithRetry.mockResolvedValue({
        success: false,
        error: 'Concurrent modification',
      });

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(409);

      // Assert
      expect(response.body).toEqual({
        fileId: TEST_FILE_ID,
        success: false,
        error: 'Concurrent modification',
      });
    });

    it('should return 500 on unexpected error', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockRejectedValue(new Error('Database connection lost'));

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error', 'Failed to retry stuck file');
    });
  });

  // ============================================
  // POST /stuck/retry-all - Bulk Retry
  // ============================================
  describe('POST /api/v2/uploads/dashboard/stuck/retry-all - Bulk Retry', () => {
    it('should retry all stuck files and return metrics', async () => {
      // Arrange
      const stuckFiles = [
        {
          id: 'FILE-1',
          user_id: TEST_USER_ID,
          name: 'stuck1.pdf',
          pipeline_status: PIPELINE_STATUS.QUEUED,
          updated_at: new Date(),
          pipeline_retry_count: 0,
        },
        {
          id: 'FILE-2',
          user_id: TEST_USER_ID,
          name: 'stuck2.pdf',
          pipeline_status: PIPELINE_STATUS.EXTRACTING,
          updated_at: new Date(),
          pipeline_retry_count: 1,
        },
      ];

      mockFileRepositoryV2.findStuckFiles.mockResolvedValue(stuckFiles);
      mockFileRepositoryV2.forceStatus.mockResolvedValue({ success: true });
      mockFileRepositoryV2.transitionStatusWithRetry.mockResolvedValue({ success: true });

      mockPrisma.files.findFirst
        .mockResolvedValueOnce({
          mime_type: 'application/pdf',
          blob_path: '/path1',
          batch_id: TEST_BATCH_ID,
          name: 'stuck1.pdf',
        })
        .mockResolvedValueOnce({
          mime_type: 'application/pdf',
          blob_path: '/path2',
          batch_id: TEST_BATCH_ID,
          name: 'stuck2.pdf',
        });

      mockMessageQueue.addFileProcessingFlow.mockResolvedValue(undefined);

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/dashboard/stuck/retry-all')
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        retried: 2,
        failed: 0,
        errors: [],
      });

      expect(mockFileRepositoryV2.findStuckFiles).toHaveBeenCalledWith(
        15 * 60 * 1000,
        TEST_USER_ID
      );
      expect(mockFileRepositoryV2.forceStatus).toHaveBeenCalledTimes(2);
      expect(mockFileRepositoryV2.transitionStatusWithRetry).toHaveBeenCalledTimes(2);
      expect(mockMessageQueue.addFileProcessingFlow).toHaveBeenCalledTimes(2);
    });

    it('should handle partial failures and return error details', async () => {
      // Arrange
      const stuckFiles = [
        {
          id: 'FILE-SUCCESS',
          user_id: TEST_USER_ID,
          name: 'success.pdf',
          pipeline_status: PIPELINE_STATUS.QUEUED,
        },
        {
          id: 'FILE-FAIL-TRANSITION',
          user_id: TEST_USER_ID,
          name: 'fail-transition.pdf',
          pipeline_status: PIPELINE_STATUS.QUEUED,
        },
        {
          id: 'FILE-FAIL-NOT-FOUND',
          user_id: TEST_USER_ID,
          name: 'fail-not-found.pdf',
          pipeline_status: PIPELINE_STATUS.QUEUED,
        },
      ];

      mockFileRepositoryV2.findStuckFiles.mockResolvedValue(stuckFiles);

      // First file succeeds
      mockFileRepositoryV2.forceStatus.mockResolvedValue({ success: true });
      mockFileRepositoryV2.transitionStatusWithRetry
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Concurrent modification' })
        .mockResolvedValueOnce({ success: true });

      mockPrisma.files.findFirst
        .mockResolvedValueOnce({
          mime_type: 'application/pdf',
          blob_path: '/path1',
          batch_id: TEST_BATCH_ID,
          name: 'success.pdf',
        })
        .mockResolvedValueOnce(null); // Not found

      mockMessageQueue.addFileProcessingFlow.mockResolvedValue(undefined);

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/dashboard/stuck/retry-all')
        .expect(200);

      // Assert
      expect(response.body.retried).toBe(1);
      expect(response.body.failed).toBe(2);
      expect(response.body.errors).toHaveLength(2);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { fileId: 'FILE-FAIL-TRANSITION', error: 'Concurrent modification' },
          { fileId: 'FILE-FAIL-NOT-FOUND', error: 'File not found' },
        ])
      );
    });

    it('should return empty metrics when no stuck files', async () => {
      // Arrange
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/dashboard/stuck/retry-all')
        .expect(200);

      // Assert
      expect(response.body).toEqual({
        retried: 0,
        failed: 0,
        errors: [],
      });
    });

    it('should return 500 on unexpected error', async () => {
      // Arrange
      mockFileRepositoryV2.findStuckFiles.mockRejectedValue(
        new Error('Database connection lost')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/dashboard/stuck/retry-all')
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error', 'Failed to bulk retry stuck files');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle queue stats failures gracefully', async () => {
      // Arrange
      mockFileRepositoryV2.getStatusDistribution.mockResolvedValue(createMockDistribution());
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([]);
      mockPrisma.files.groupBy.mockResolvedValue([]);

      // Queue stats throws error
      mockMessageQueue.getQueueStats.mockRejectedValue(new Error('Queue not initialized'));

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard')
        .expect(200);

      // Assert - Should still return 200 with empty queueDepths
      expect(response.body.queueDepths).toEqual({});
    });

    it('should handle missing batch_id gracefully in retry', async () => {
      // Arrange
      mockPrisma.files.findFirst.mockResolvedValue({
        id: TEST_FILE_ID,
        name: 'stuck.pdf',
        mime_type: 'application/pdf',
        blob_path: '/path/to/blob',
        batch_id: null, // No batch ID
        pipeline_status: PIPELINE_STATUS.FAILED,
      });

      mockFileRepositoryV2.transitionStatusWithRetry.mockResolvedValue({ success: true });
      mockMessageQueue.addFileProcessingFlow.mockResolvedValue(undefined);

      // Act
      const response = await request(app)
        .post(`/api/v2/uploads/dashboard/stuck/${TEST_FILE_ID}/retry`)
        .expect(200);

      // Assert - Should use empty string for batch_id
      expect(mockMessageQueue.addFileProcessingFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: '',
        })
      );
    });

    it('should handle files with null updated_at in stuck files list', async () => {
      // Arrange
      mockFileRepositoryV2.findStuckFiles.mockResolvedValue([
        {
          id: 'file-no-update',
          user_id: TEST_USER_ID,
          name: 'no-update.pdf',
          pipeline_status: 'queued',
          updated_at: null,
          pipeline_retry_count: 0,
          created_at: null,
        },
      ]);

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/dashboard/stuck')
        .expect(200);

      // Assert
      expect(response.body.files[0]).toMatchObject({
        stuckSinceMs: 0,
        updatedAt: '',
        createdAt: '',
      });
    });
  });
});
