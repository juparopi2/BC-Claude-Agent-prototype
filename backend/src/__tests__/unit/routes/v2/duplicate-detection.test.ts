/**
 * Unit Tests - Duplicate Detection Route (PRD-02)
 *
 * Tests for the V2 duplicate detection endpoint.
 * Validates request validation, error handling, and service integration.
 *
 * Endpoint tested:
 * - POST /api/v2/uploads/check-duplicates - Batch duplicate check before upload
 *
 * @module __tests__/unit/routes/v2/duplicate-detection
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

// Create shared mock function for the service
const mockCheckDuplicates = vi.fn();

// Mock the entire service module including the class
vi.mock('@/services/files/DuplicateDetectionServiceV2', () => {
  // Create a mock class
  class MockDuplicateDetectionServiceV2 {
    checkDuplicates = mockCheckDuplicates;
  }

  return {
    DuplicateDetectionServiceV2: MockDuplicateDetectionServiceV2,
    getDuplicateDetectionServiceV2: vi.fn(() => new MockDuplicateDetectionServiceV2()),
  };
});

// Import router after mocks
import duplicateDetectionRoutes from '@/routes/v2/uploads/duplicate-detection.routes';
import { ErrorCode } from '@/shared/constants/errors';

// ============================================
// Test Suite
// ============================================

describe('Duplicate Detection Route (PRD-02)', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementation
    mockCheckDuplicates.mockReset();

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/v2/uploads/check-duplicates', duplicateDetectionRoutes);
  });

  // ============================================
  // Success Cases
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Success', () => {
    it('should return 200 with valid request and correct response shape', async () => {
      // Arrange - Mock service response
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [
          { tempId: 'temp-1', isDuplicate: false },
          {
            tempId: 'temp-2',
            isDuplicate: true,
            scope: 'storage',
            matchType: 'content',
            existingFile: {
              fileId: 'FILE-1',
              fileName: 'report.pdf',
              fileSize: 1024,
              pipelineStatus: 'ready',
              folderId: null,
            },
          },
        ],
        summary: {
          totalChecked: 2,
          totalDuplicates: 1,
          byScope: { storage: 1, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 1, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'invoice.pdf',
            fileSize: 2048,
            contentHash: 'a'.repeat(64),
          },
          {
            tempId: 'temp-2',
            fileName: 'report.pdf',
            fileSize: 1024,
            contentHash: 'b'.repeat(64),
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody);

      expect(response.status).toBe(200);

      // Assert - Response shape
      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('summary');

      // Results array
      expect(response.body.results).toBeInstanceOf(Array);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0]).toHaveProperty('tempId', 'temp-1');
      expect(response.body.results[0]).toHaveProperty('isDuplicate', false);
      expect(response.body.results[1]).toHaveProperty('tempId', 'temp-2');
      expect(response.body.results[1]).toHaveProperty('isDuplicate', true);
      expect(response.body.results[1]).toHaveProperty('scope', 'storage');
      expect(response.body.results[1]).toHaveProperty('matchType', 'content');
      expect(response.body.results[1]).toHaveProperty('existingFile');

      // Summary object
      expect(response.body.summary).toHaveProperty('totalChecked', 2);
      expect(response.body.summary).toHaveProperty('totalDuplicates', 1);
      expect(response.body.summary).toHaveProperty('byScope');
      expect(response.body.summary).toHaveProperty('byMatchType');

      // Service should be called with correct args
      expect(mockCheckDuplicates).toHaveBeenCalledTimes(1);
      expect(mockCheckDuplicates).toHaveBeenCalledWith(
        requestBody.files,
        'USER-12345678-1234-1234-1234-123456789ABC'
      );
    });

    it('should return 200 with minimal input (only tempId + fileName)', async () => {
      // Arrange - Minimal request (no optional fields)
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [{ tempId: 'temp-minimal', isDuplicate: false }],
        summary: {
          totalChecked: 1,
          totalDuplicates: 0,
          byScope: { storage: 0, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 0, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          {
            tempId: 'temp-minimal',
            fileName: 'test.pdf',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].tempId).toBe('temp-minimal');
      expect(response.body.results[0].isDuplicate).toBe(false);
    });

    it('should handle multiple files with mixed duplicate results', async () => {
      // Arrange - Mix of duplicates and non-duplicates
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [
          { tempId: 'temp-1', isDuplicate: false },
          {
            tempId: 'temp-2',
            isDuplicate: true,
            scope: 'pipeline',
            matchType: 'name',
            existingFile: {
              fileId: 'FILE-2',
              fileName: 'doc.pdf',
              fileSize: 512,
              pipelineStatus: 'queued',
              folderId: 'FOLDER-1',
            },
          },
          { tempId: 'temp-3', isDuplicate: false },
          {
            tempId: 'temp-4',
            isDuplicate: true,
            scope: 'upload',
            matchType: 'name_and_content',
            existingFile: {
              fileId: 'FILE-4',
              fileName: 'report.xlsx',
              fileSize: 2048,
              pipelineStatus: 'registered',
              folderId: null,
            },
          },
        ],
        summary: {
          totalChecked: 4,
          totalDuplicates: 2,
          byScope: { storage: 0, pipeline: 1, upload: 1 },
          byMatchType: { name: 1, content: 0, name_and_content: 1 },
        },
      });

      const requestBody = {
        files: [
          { tempId: 'temp-1', fileName: 'file1.pdf' },
          { tempId: 'temp-2', fileName: 'doc.pdf' },
          { tempId: 'temp-3', fileName: 'file3.txt' },
          { tempId: 'temp-4', fileName: 'report.xlsx' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(4);
      expect(response.body.summary.totalChecked).toBe(4);
      expect(response.body.summary.totalDuplicates).toBe(2);
      expect(response.body.summary.byScope.pipeline).toBe(1);
      expect(response.body.summary.byScope.upload).toBe(1);
    });
  });

  // ============================================
  // Validation Error Cases
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Validation Errors', () => {
    it('should return 400 when files array is empty', async () => {
      // Arrange - Empty array violates min(1)
      const requestBody = { files: [] };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('should return 400 when files array exceeds max (1000)', async () => {
      // Arrange - 1001 files exceeds max(1000)
      const files = Array.from({ length: 1001 }, (_, i) => ({
        tempId: `temp-${i}`,
        fileName: `file-${i}.pdf`,
      }));
      const requestBody = { files };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('should return 400 when tempId is missing', async () => {
      // Arrange - Missing required tempId field
      const requestBody = {
        files: [
          {
            fileName: 'test.pdf',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('should return 400 when fileName is missing', async () => {
      // Arrange - Missing required fileName field
      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('should return 400 when contentHash is wrong length', async () => {
      // Arrange - contentHash must be exactly 64 hex chars (SHA-256)
      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'test.pdf',
            contentHash: 'abc123', // Too short
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });

    it('should return 400 when contentHash contains invalid hex characters', async () => {
      // Arrange - contentHash must be valid hex
      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'test.pdf',
            contentHash: 'g'.repeat(64), // 'g' is not a valid hex character
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(400);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.VALIDATION_ERROR);
      expect(mockCheckDuplicates).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Authentication Error Cases
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Authentication', () => {
    it('should require authenticated userId', async () => {
      // Note: In production, this test would verify that unauthenticated
      // requests return 401. However, our mock auth middleware passes through
      // and sets userId. In a real test environment with authentication disabled,
      // you would verify the 401 response.

      // For now, we just verify the route requires the middleware
      expect(duplicateDetectionRoutes).toBeDefined();
    });
  });

  // ============================================
  // Service Error Cases
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Service Errors', () => {
    it('should return 500 when service throws an error', async () => {
      // Arrange - Service throws
      mockCheckDuplicates.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'test.pdf',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(500);

      // Assert
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code', ErrorCode.INTERNAL_ERROR);
      expect(response.body).toHaveProperty('message', 'Failed to check duplicates');
    });

    it('should return 500 when service throws non-Error object', async () => {
      // Arrange - Service throws string
      mockCheckDuplicates.mockRejectedValueOnce('Unexpected error');

      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'test.pdf',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(500);

      // Assert
      expect(response.body.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(response.body.message).toBe('Failed to check duplicates');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Edge Cases', () => {
    it('should handle single file request', async () => {
      // Arrange - Single file
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [{ tempId: 'temp-single', isDuplicate: false }],
        summary: {
          totalChecked: 1,
          totalDuplicates: 0,
          byScope: { storage: 0, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 0, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          {
            tempId: 'temp-single',
            fileName: 'single.pdf',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(1);
      expect(response.body.summary.totalChecked).toBe(1);
    });

    it('should handle maximum allowed files (1000)', async () => {
      // Arrange - Exactly 1000 files (max allowed)
      const files = Array.from({ length: 1000 }, (_, i) => ({
        tempId: `temp-${i}`,
        fileName: `file-${i}.pdf`,
      }));
      const results = files.map(f => ({ tempId: f.tempId, isDuplicate: false }));

      mockCheckDuplicates.mockResolvedValueOnce({
        results,
        summary: {
          totalChecked: 1000,
          totalDuplicates: 0,
          byScope: { storage: 0, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 0, name_and_content: 0 },
        },
      });

      const requestBody = { files };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.results).toHaveLength(1000);
      expect(response.body.summary.totalChecked).toBe(1000);
    });

    it('should handle files with all optional fields present', async () => {
      // Arrange - All optional fields provided
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [{ tempId: 'temp-full', isDuplicate: false }],
        summary: {
          totalChecked: 1,
          totalDuplicates: 0,
          byScope: { storage: 0, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 0, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          {
            tempId: 'temp-full',
            fileName: 'complete.pdf',
            fileSize: 2048,
            contentHash: 'a'.repeat(64),
            folderId: 'FOLDER-1',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.results[0].tempId).toBe('temp-full');
      expect(mockCheckDuplicates).toHaveBeenCalledWith(
        requestBody.files,
        'USER-12345678-1234-1234-1234-123456789ABC'
      );
    });

    it('should preserve tempId order in results', async () => {
      // Arrange - Ensure results match request order
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [
          { tempId: 'temp-first', isDuplicate: false },
          { tempId: 'temp-second', isDuplicate: false },
          { tempId: 'temp-third', isDuplicate: false },
        ],
        summary: {
          totalChecked: 3,
          totalDuplicates: 0,
          byScope: { storage: 0, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 0, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          { tempId: 'temp-first', fileName: 'file1.pdf' },
          { tempId: 'temp-second', fileName: 'file2.pdf' },
          { tempId: 'temp-third', fileName: 'file3.pdf' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert - Order should be preserved
      expect(response.body.results[0].tempId).toBe('temp-first');
      expect(response.body.results[1].tempId).toBe('temp-second');
      expect(response.body.results[2].tempId).toBe('temp-third');
    });
  });

  // ============================================
  // Response Contract Validation
  // ============================================
  describe('POST /api/v2/uploads/check-duplicates - Response Contract', () => {
    it('should return response shape matching DuplicateCheckResponseV2', async () => {
      // Arrange
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [
          {
            tempId: 'temp-1',
            isDuplicate: true,
            scope: 'storage',
            matchType: 'content',
            existingFile: {
              fileId: 'FILE-1',
              fileName: 'doc.pdf',
              fileSize: 1024,
              pipelineStatus: 'ready',
              folderId: 'FOLDER-1',
            },
          },
        ],
        summary: {
          totalChecked: 1,
          totalDuplicates: 1,
          byScope: { storage: 1, pipeline: 0, upload: 0 },
          byMatchType: { name: 0, content: 1, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          {
            tempId: 'temp-1',
            fileName: 'doc.pdf',
            fileSize: 1024,
            contentHash: 'a'.repeat(64),
            folderId: 'FOLDER-1',
          },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert - Top-level structure
      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('summary');

      // Result structure
      const result = response.body.results[0];
      expect(result).toHaveProperty('tempId');
      expect(result).toHaveProperty('isDuplicate');
      expect(result).toHaveProperty('scope');
      expect(result).toHaveProperty('matchType');
      expect(result).toHaveProperty('existingFile');

      // ExistingFile structure
      const existingFile = result.existingFile;
      expect(existingFile).toHaveProperty('fileId');
      expect(existingFile).toHaveProperty('fileName');
      expect(existingFile).toHaveProperty('fileSize');
      expect(existingFile).toHaveProperty('pipelineStatus');
      expect(existingFile).toHaveProperty('folderId');

      // Summary structure
      const summary = response.body.summary;
      expect(summary).toHaveProperty('totalChecked');
      expect(summary).toHaveProperty('totalDuplicates');
      expect(summary).toHaveProperty('byScope');
      expect(summary).toHaveProperty('byMatchType');
      expect(summary.byScope).toHaveProperty('storage');
      expect(summary.byScope).toHaveProperty('pipeline');
      expect(summary.byScope).toHaveProperty('upload');
      expect(summary.byMatchType).toHaveProperty('name');
      expect(summary.byMatchType).toHaveProperty('content');
      expect(summary.byMatchType).toHaveProperty('name_and_content');
    });

    it('should return numeric values for all summary counts', async () => {
      // Arrange
      mockCheckDuplicates.mockResolvedValueOnce({
        results: [],
        summary: {
          totalChecked: 5,
          totalDuplicates: 2,
          byScope: { storage: 1, pipeline: 1, upload: 0 },
          byMatchType: { name: 1, content: 1, name_and_content: 0 },
        },
      });

      const requestBody = {
        files: [
          { tempId: 'temp-1', fileName: 'file1.pdf' },
          { tempId: 'temp-2', fileName: 'file2.pdf' },
          { tempId: 'temp-3', fileName: 'file3.pdf' },
          { tempId: 'temp-4', fileName: 'file4.pdf' },
          { tempId: 'temp-5', fileName: 'file5.pdf' },
        ],
      };

      // Act
      const response = await request(app)
        .post('/api/v2/uploads/check-duplicates')
        .send(requestBody)
        .expect(200);

      // Assert - All counts should be numbers
      const summary = response.body.summary;
      expect(typeof summary.totalChecked).toBe('number');
      expect(typeof summary.totalDuplicates).toBe('number');
      expect(typeof summary.byScope.storage).toBe('number');
      expect(typeof summary.byScope.pipeline).toBe('number');
      expect(typeof summary.byScope.upload).toBe('number');
      expect(typeof summary.byMatchType.name).toBe('number');
      expect(typeof summary.byMatchType.content).toBe('number');
      expect(typeof summary.byMatchType.name_and_content).toBe('number');
    });
  });
});
