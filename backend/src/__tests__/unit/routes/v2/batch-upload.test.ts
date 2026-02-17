/**
 * Unit Tests - Batch Upload Routes V2 (PRD-03)
 *
 * Tests for the V2 batch upload endpoints.
 * Validates request validation, error handling, and orchestrator integration.
 *
 * Endpoints tested:
 * - POST   /api/v2/uploads/batches                              → createBatch
 * - POST   /api/v2/uploads/batches/:batchId/files/:fileId/confirm → confirmFile
 * - GET    /api/v2/uploads/batches/:batchId                       → getBatchStatus
 * - DELETE /api/v2/uploads/batches/:batchId                       → cancelBatch
 *
 * @module __tests__/unit/routes/v2/batch-upload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';

// ============================================
// Mock Dependencies - Must be before imports
// ============================================

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth middleware - pass through but set userId
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'USER-12345678-1234-1234-1234-123456789ABC';
    next();
  },
}));

// Create shared mock functions for the orchestrator
const mockCreateBatch = vi.fn();
const mockConfirmFile = vi.fn();
const mockGetBatchStatus = vi.fn();
const mockCancelBatch = vi.fn();

// Create a single orchestrator mock instance that will be reused
const mockOrchestrator = {
  createBatch: mockCreateBatch,
  confirmFile: mockConfirmFile,
  getBatchStatus: mockGetBatchStatus,
  cancelBatch: mockCancelBatch,
};

// Mock the batch orchestrator module with error classes
vi.mock('@/services/files/batch', () => ({
  getBatchUploadOrchestratorV2: vi.fn(() => mockOrchestrator),
  BatchNotFoundError: class extends Error {
    constructor(id: string) {
      super(`Batch not found: ${id}`);
      this.name = 'BatchNotFoundError';
    }
  },
  BatchExpiredError: class extends Error {
    constructor(id: string) {
      super(`Batch expired: ${id}`);
      this.name = 'BatchExpiredError';
    }
  },
  BatchCancelledError: class extends Error {
    constructor(id: string) {
      super(`Batch cancelled: ${id}`);
      this.name = 'BatchCancelledError';
    }
  },
  BatchAlreadyCompleteError: class extends Error {
    constructor(id: string) {
      super(`Batch complete: ${id}`);
      this.name = 'BatchAlreadyCompleteError';
    }
  },
  FileNotInBatchError: class extends Error {
    constructor(fid: string, bid: string) {
      super(`File ${fid} not in batch ${bid}`);
      this.name = 'FileNotInBatchError';
    }
  },
  FileAlreadyConfirmedError: class extends Error {
    constructor(fid: string, s: string) {
      super(`File ${fid} already confirmed (${s})`);
      this.name = 'FileAlreadyConfirmedError';
    }
  },
  BlobNotFoundError: class extends Error {
    constructor(fid: string, p: string) {
      super(`Blob not found: ${fid} at ${p}`);
      this.name = 'BlobNotFoundError';
    }
  },
  ConcurrentModificationError: class extends Error {
    constructor(fid: string) {
      super(`Concurrent modification: ${fid}`);
      this.name = 'ConcurrentModificationError';
    }
  },
  ManifestValidationError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ManifestValidationError';
    }
  },
}));

// Import mocked error classes for test assertions
import {
  BatchNotFoundError,
  BatchExpiredError,
  BatchCancelledError,
  BatchAlreadyCompleteError,
  FileNotInBatchError,
  FileAlreadyConfirmedError,
  BlobNotFoundError,
  ConcurrentModificationError,
  ManifestValidationError,
} from '@/services/files/batch';

// Import router after mocks
import batchRoutes from '@/routes/v2/uploads/batch.routes';
import { ErrorCode } from '@/shared/constants/errors';

// ============================================
// Test Suite
// ============================================

describe('Batch Upload Routes V2 (PRD-03)', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mock implementations
    mockCreateBatch.mockReset();
    mockConfirmFile.mockReset();
    mockGetBatchStatus.mockReset();
    mockCancelBatch.mockReset();

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/v2/uploads/batches', batchRoutes);
  });

  // ============================================
  // POST / (createBatch)
  // ============================================
  describe('POST /api/v2/uploads/batches - Create Batch', () => {
    it('should return 201 with valid request body', async () => {
      // Arrange - Mock successful batch creation
      mockCreateBatch.mockResolvedValueOnce({
        batchId: 'BATCH-1234-5678-9ABC-DEF012345678',
        status: 'active',
        files: [
          {
            fileId: 'FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE',
            tempId: 'f1',
            sasUrl: 'https://storage.azure.com/...',
            expiresAt: '2026-02-17T12:00:00Z',
          },
        ],
        folders: [],
        expiresAt: '2026-02-17T12:00:00Z',
      });

      const requestBody = {
        files: [
          {
            tempId: 'f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches')
        .send(requestBody);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('batchId');
      expect(response.body).toHaveProperty('status', 'active');
      expect(response.body).toHaveProperty('files');
      expect(response.body).toHaveProperty('folders');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body.files).toHaveLength(1);
      expect(response.body.files[0]).toHaveProperty('fileId');
      expect(response.body.files[0]).toHaveProperty('tempId', 'f1');
      expect(response.body.files[0]).toHaveProperty('sasUrl');

      // Verify service was called correctly
      expect(mockCreateBatch).toHaveBeenCalledTimes(1);
      expect(mockCreateBatch).toHaveBeenCalledWith(
        'USER-12345678-1234-1234-1234-123456789ABC',
        requestBody
      );
    });

    it('should return 400 with empty request body', async () => {
      // Arrange - Invalid request body
      const requestBody = {};

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCreateBatch).not.toHaveBeenCalled();
    });

    it('should return 400 when manifest validation fails', async () => {
      // Arrange - Orchestrator throws ManifestValidationError
      mockCreateBatch.mockRejectedValueOnce(
        new ManifestValidationError('Duplicate tempId: f1')
      );

      const requestBody = {
        files: [
          {
            tempId: 'f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(response.body.message).toContain('Duplicate tempId');
    });
  });

  // ============================================
  // POST /:batchId/files/:fileId/confirm (confirmFile)
  // ============================================
  describe('POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm - Confirm File', () => {
    it('should return 200 on successful file confirmation', async () => {
      // Arrange - Mock successful confirmation
      mockConfirmFile.mockResolvedValueOnce({
        fileId: 'FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE',
        pipelineStatus: 'queued',
        batchProgress: {
          total: 3,
          confirmed: 1,
          isComplete: false,
        },
      });

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('fileId', 'FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE');
      expect(response.body).toHaveProperty('pipelineStatus', 'queued');
      expect(response.body).toHaveProperty('batchProgress');
      expect(response.body.batchProgress).toHaveProperty('total', 3);
      expect(response.body.batchProgress).toHaveProperty('confirmed', 1);
      expect(response.body.batchProgress).toHaveProperty('isComplete', false);

      // Verify service was called correctly
      expect(mockConfirmFile).toHaveBeenCalledTimes(1);
      expect(mockConfirmFile).toHaveBeenCalledWith(
        'USER-12345678-1234-1234-1234-123456789ABC',
        'BATCH-1234-5678-9ABC-DEF012345678',
        'FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE'
      );
    });

    it('should return 404 when batch not found', async () => {
      // Arrange - Orchestrator throws BatchNotFoundError
      mockConfirmFile.mockRejectedValueOnce(
        new BatchNotFoundError('BATCH-INVALID')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-INVALID/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(404);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.NOT_FOUND);
      expect(response.body.message).toContain('Batch not found');
    });

    it('should return 409 when file already confirmed', async () => {
      // Arrange - Orchestrator throws FileAlreadyConfirmedError
      mockConfirmFile.mockRejectedValueOnce(
        new FileAlreadyConfirmedError('FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE', 'queued')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(409);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.STATE_CONFLICT);
      expect(response.body.message).toContain('already confirmed');
    });

    it('should return 400 when blob not found', async () => {
      // Arrange - Orchestrator throws BlobNotFoundError
      mockConfirmFile.mockRejectedValueOnce(
        new BlobNotFoundError('FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE', 'users/test-user/temp/file.pdf')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(response.body.message).toContain('Blob not found');
    });
  });

  // ============================================
  // GET /:batchId (getBatchStatus)
  // ============================================
  describe('GET /api/v2/uploads/batches/:batchId - Get Batch Status', () => {
    it('should return 200 with batch status', async () => {
      // Arrange - Mock batch status response
      mockGetBatchStatus.mockResolvedValueOnce({
        batchId: 'BATCH-1234-5678-9ABC-DEF012345678',
        status: 'active',
        totalFiles: 3,
        confirmedCount: 2,
        createdAt: '2026-02-17T10:00:00Z',
        expiresAt: '2026-02-17T12:00:00Z',
        files: [
          {
            fileId: 'FILE-1111-1111-1111-111111111111',
            name: 'file1.pdf',
            pipelineStatus: 'queued',
          },
          {
            fileId: 'FILE-2222-2222-2222-222222222222',
            name: 'file2.pdf',
            pipelineStatus: 'queued',
          },
          {
            fileId: 'FILE-3333-3333-3333-333333333333',
            name: 'file3.pdf',
            pipelineStatus: null,
          },
        ],
      });

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678')
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('batchId', 'BATCH-1234-5678-9ABC-DEF012345678');
      expect(response.body).toHaveProperty('status', 'active');
      expect(response.body).toHaveProperty('totalFiles', 3);
      expect(response.body).toHaveProperty('confirmedCount', 2);
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body).toHaveProperty('files');
      expect(response.body.files).toHaveLength(3);
      expect(response.body.files[0]).toHaveProperty('fileId');
      expect(response.body.files[0]).toHaveProperty('name');
      expect(response.body.files[0]).toHaveProperty('pipelineStatus');

      // Verify service was called correctly
      expect(mockGetBatchStatus).toHaveBeenCalledTimes(1);
      expect(mockGetBatchStatus).toHaveBeenCalledWith(
        'USER-12345678-1234-1234-1234-123456789ABC',
        'BATCH-1234-5678-9ABC-DEF012345678'
      );
    });

    it('should return 404 when batch not found', async () => {
      // Arrange - Orchestrator throws BatchNotFoundError
      mockGetBatchStatus.mockRejectedValueOnce(
        new BatchNotFoundError('BATCH-INVALID')
      );

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/batches/BATCH-INVALID')
        .expect(404);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.NOT_FOUND);
      expect(response.body.message).toContain('Batch not found');
    });
  });

  // ============================================
  // DELETE /:batchId (cancelBatch)
  // ============================================
  describe('DELETE /api/v2/uploads/batches/:batchId - Cancel Batch', () => {
    it('should return 200 on successful batch cancellation', async () => {
      // Arrange - Mock successful cancellation
      mockCancelBatch.mockResolvedValueOnce({
        batchId: 'BATCH-1234-5678-9ABC-DEF012345678',
        status: 'cancelled',
        filesAffected: 2,
      });

      // Act
      const response = await request(app)
        .delete('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678')
        .expect(200);

      // Assert
      expect(response.body).toHaveProperty('batchId', 'BATCH-1234-5678-9ABC-DEF012345678');
      expect(response.body).toHaveProperty('status', 'cancelled');
      expect(response.body).toHaveProperty('filesAffected', 2);

      // Verify service was called correctly
      expect(mockCancelBatch).toHaveBeenCalledTimes(1);
      expect(mockCancelBatch).toHaveBeenCalledWith(
        'USER-12345678-1234-1234-1234-123456789ABC',
        'BATCH-1234-5678-9ABC-DEF012345678'
      );
    });

    it('should return 404 when batch not found', async () => {
      // Arrange - Orchestrator throws BatchNotFoundError
      mockCancelBatch.mockRejectedValueOnce(
        new BatchNotFoundError('BATCH-INVALID')
      );

      // Act
      const response = await request(app)
        .delete('/api/v2/uploads/batches/BATCH-INVALID')
        .expect(404);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.NOT_FOUND);
      expect(response.body.message).toContain('Batch not found');
    });

    it('should return 409 when batch already completed', async () => {
      // Arrange - Orchestrator throws BatchAlreadyCompleteError
      mockCancelBatch.mockRejectedValueOnce(
        new BatchAlreadyCompleteError('BATCH-1234-5678-9ABC-DEF012345678')
      );

      // Act
      const response = await request(app)
        .delete('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678')
        .expect(409);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.STATE_CONFLICT);
      expect(response.body.message).toContain('Batch complete');
    });
  });

  // ============================================
  // Additional Error Cases
  // ============================================
  describe('Error Handling - Additional Cases', () => {
    it('should return 409 for BatchCancelledError', async () => {
      // Arrange - Orchestrator throws BatchCancelledError
      mockConfirmFile.mockRejectedValueOnce(
        new BatchCancelledError('BATCH-1234-5678-9ABC-DEF012345678')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(409);

      // Assert
      expect(response.body).toHaveProperty('code', ErrorCode.STATE_CONFLICT);
      expect(response.body.message).toContain('Batch cancelled');
    });

    it('should return 410 for BatchExpiredError', async () => {
      // Arrange - Orchestrator throws BatchExpiredError
      mockGetBatchStatus.mockRejectedValueOnce(
        new BatchExpiredError('BATCH-1234-5678-9ABC-DEF012345678')
      );

      // Act
      const response = await request(app)
        .get('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678')
        .expect(410);

      // Assert
      expect(response.body).toHaveProperty('code', ErrorCode.EXPIRED);
      expect(response.body.message).toContain('Batch expired');
    });

    it('should return 409 for ConcurrentModificationError', async () => {
      // Arrange - Orchestrator throws ConcurrentModificationError
      mockConfirmFile.mockRejectedValueOnce(
        new ConcurrentModificationError('FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(409);

      // Assert
      expect(response.body).toHaveProperty('code', ErrorCode.STATE_CONFLICT);
      expect(response.body.message).toContain('Concurrent modification');
    });

    it('should return 404 for FileNotInBatchError', async () => {
      // Arrange - Orchestrator throws FileNotInBatchError
      mockConfirmFile.mockRejectedValueOnce(
        new FileNotInBatchError('FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE', 'BATCH-1234-5678-9ABC-DEF012345678')
      );

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches/BATCH-1234-5678-9ABC-DEF012345678/files/FILE-AAAA-BBBB-CCCC-DDDDEEEEEEEE/confirm')
        .expect(404);

      // Assert
      expect(response.body).toHaveProperty('code', ErrorCode.NOT_FOUND);
      expect(response.body.message).toContain('not in batch');
    });

    it('should return 500 for unknown errors', async () => {
      // Arrange - Orchestrator throws generic Error
      mockCreateBatch.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const requestBody = {
        files: [
          {
            tempId: 'f1',
            fileName: 'test.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/batches')
        .send(requestBody)
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code', ErrorCode.INTERNAL_ERROR);
      expect(response.body.message).toContain('internal error');
    });
  });
});
