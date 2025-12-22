/**
 * Unit Tests - GDPR Compliance Routes
 *
 * Tests for GDPR data subject request endpoints.
 * Validates authentication, pagination, error handling, and data inventory.
 *
 * Endpoints tested:
 * - GET /api/gdpr/deletion-audit - Get deletion history for authenticated user
 * - GET /api/gdpr/deletion-audit/stats - Get deletion statistics
 * - GET /api/gdpr/data-inventory - Get all data locations for user
 *
 * @module __tests__/unit/routes/gdpr.routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import gdprRouter from '@/routes/gdpr';

// ============================================
// Mock Dependencies
// ============================================

// Mock deletion audit service
const mockAuditService = {
  getDeletionHistory: vi.fn(),
  getDeletionStats: vi.fn(),
};

vi.mock('@services/files/DeletionAuditService', () => ({
  getDeletionAuditService: () => mockAuditService,
}));

// Mock database
const mockExecuteQuery = vi.fn();
vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth middleware - inject userId via header for testing
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, res: Response, next: NextFunction) => {
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

// ============================================
// Test Helpers
// ============================================

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/gdpr', gdprRouter);
  return app;
}

// ============================================
// Test Suite
// ============================================

describe('GDPR Compliance Routes', () => {
  let app: Application;
  const testUserId = 'test-user-gdpr-123';

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();

    // Default mock implementations
    mockAuditService.getDeletionHistory.mockResolvedValue([]);
    mockAuditService.getDeletionStats.mockResolvedValue({
      totalDeletions: 0,
      completedDeletions: 0,
      failedDeletions: 0,
      partialDeletions: 0,
    });
    mockExecuteQuery.mockResolvedValue({ recordset: [{ count: 0 }] });
  });

  // ============================================
  // GET /api/gdpr/deletion-audit
  // ============================================
  describe('GET /api/gdpr/deletion-audit', () => {
    it('should return deletion history for authenticated user', async () => {
      // Arrange
      const mockRecords = [
        {
          id: 'audit-1',
          userId: testUserId,
          resourceType: 'file',
          resourceId: 'file-123',
          resourceName: 'test.pdf',
          status: 'completed',
          requestedAt: '2024-01-15T10:00:00Z',
        },
        {
          id: 'audit-2',
          userId: testUserId,
          resourceType: 'folder',
          resourceId: 'folder-456',
          resourceName: 'Documents',
          status: 'completed',
          requestedAt: '2024-01-14T09:00:00Z',
        },
      ];
      mockAuditService.getDeletionHistory.mockResolvedValueOnce(mockRecords);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data.records).toEqual(mockRecords);
      expect(response.body.data.pagination).toBeDefined();
      expect(mockAuditService.getDeletionHistory).toHaveBeenCalledWith(testUserId, 50, 0);
    });

    it('should apply pagination parameters', async () => {
      // Arrange
      mockAuditService.getDeletionHistory.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=10&offset=20')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.data.pagination.limit).toBe(10);
      expect(response.body.data.pagination.offset).toBe(20);
      expect(mockAuditService.getDeletionHistory).toHaveBeenCalledWith(testUserId, 10, 20);
    });

    it('should return hasMore=true when result equals limit', async () => {
      // Arrange
      const mockRecords = Array(10).fill({
        id: 'audit-x',
        userId: testUserId,
        status: 'completed',
      });
      mockAuditService.getDeletionHistory.mockResolvedValueOnce(mockRecords);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=10')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.data.pagination.hasMore).toBe(true);
    });

    it('should return hasMore=false when result is less than limit', async () => {
      // Arrange
      const mockRecords = [{ id: 'audit-1', status: 'completed' }];
      mockAuditService.getDeletionHistory.mockResolvedValueOnce(mockRecords);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=50')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.data.pagination.hasMore).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 400 for invalid limit (> 100)', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=200')
        .set('x-test-user-id', testUserId)
        .expect(400);

      // Assert
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid limit (< 1)', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=0')
        .set('x-test-user-id', testUserId)
        .expect(400);

      // Assert
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for negative offset', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?offset=-1')
        .set('x-test-user-id', testUserId)
        .expect(400);

      // Assert
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 500 on service error', async () => {
      // Arrange
      mockAuditService.getDeletionHistory.mockRejectedValueOnce(new Error('Database error'));

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit')
        .set('x-test-user-id', testUserId)
        .expect(500);

      // Assert
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================
  // GET /api/gdpr/deletion-audit/stats
  // ============================================
  describe('GET /api/gdpr/deletion-audit/stats', () => {
    it('should return deletion statistics for authenticated user', async () => {
      // Arrange
      const mockStats = {
        totalDeletions: 25,
        completedDeletions: 20,
        failedDeletions: 2,
        partialDeletions: 3,
        byResourceType: {
          file: 18,
          folder: 7,
        },
      };
      mockAuditService.getDeletionStats.mockResolvedValueOnce(mockStats);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit/stats')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
      expect(mockAuditService.getDeletionStats).toHaveBeenCalledWith(
        testUserId,
        undefined,
        undefined
      );
    });

    it('should filter by date range when provided', async () => {
      // Arrange
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-31T23:59:59.999Z';
      mockAuditService.getDeletionStats.mockResolvedValueOnce({ totalDeletions: 5 });

      // Act
      const response = await request(app)
        .get(`/api/gdpr/deletion-audit/stats?startDate=${startDate}&endDate=${endDate}`)
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(mockAuditService.getDeletionStats).toHaveBeenCalledWith(
        testUserId,
        new Date(startDate),
        new Date(endDate)
      );
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit/stats')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on service error', async () => {
      // Arrange
      mockAuditService.getDeletionStats.mockRejectedValueOnce(new Error('Query timeout'));

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit/stats')
        .set('x-test-user-id', testUserId)
        .expect(500);

      // Assert
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================
  // GET /api/gdpr/data-inventory
  // ============================================
  describe('GET /api/gdpr/data-inventory', () => {
    it('should return complete data inventory for authenticated user', async () => {
      // Arrange - mock all database queries in order
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ count: 10 }] })  // files
        .mockResolvedValueOnce({ recordset: [{ count: 2 }] })   // folders
        .mockResolvedValueOnce({ recordset: [{ count: 50 }] })  // chunks
        .mockResolvedValueOnce({ recordset: [{ count: 5 }] })   // sessions
        .mockResolvedValueOnce({ recordset: [{ count: 100 }] }) // messages
        .mockResolvedValueOnce({ recordset: [{ total_bytes: 5242880 }] }) // storage
        .mockResolvedValueOnce({ recordset: [{ count: 3 }] });  // audit records

      // Act
      const response = await request(app)
        .get('/api/gdpr/data-inventory')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe(testUserId);
      expect(response.body.data.generatedAt).toBeDefined();

      // Database locations
      expect(response.body.data.dataLocations.database.files).toBe(8);  // 10 - 2 folders
      expect(response.body.data.dataLocations.database.folders).toBe(2);
      expect(response.body.data.dataLocations.database.fileChunks).toBe(50);
      expect(response.body.data.dataLocations.database.sessions).toBe(5);
      expect(response.body.data.dataLocations.database.messages).toBe(100);
      expect(response.body.data.dataLocations.database.deletionAuditRecords).toBe(3);

      // Blob storage
      expect(response.body.data.dataLocations.blobStorage.totalFiles).toBe(8);
      expect(response.body.data.dataLocations.blobStorage.totalBytes).toBe(5242880);
      expect(response.body.data.dataLocations.blobStorage.totalBytesFormatted).toBe('5 MB');
      expect(response.body.data.dataLocations.blobStorage.containerPath).toBe(`users/${testUserId}/files/`);

      // AI Search
      expect(response.body.data.dataLocations.aiSearch.estimatedDocuments).toBe(50);
      expect(response.body.data.dataLocations.aiSearch.indexName).toBe('file-chunks-index');

      // Redis cache
      expect(response.body.data.dataLocations.redisCache.sessionData).toBe(true);
      expect(response.body.data.dataLocations.redisCache.embeddingCache).toBe(true);

      // Summary
      expect(response.body.data.summary.totalRecords).toBe(165); // 10 + 50 + 5 + 100
      expect(response.body.data.summary.totalStorageBytes).toBe(5242880);
      expect(response.body.data.summary.hasActiveData).toBe(true);
    });

    it('should handle user with no data', async () => {
      // Arrange - all queries return 0
      mockExecuteQuery.mockResolvedValue({ recordset: [{ count: 0, total_bytes: 0 }] });

      // Act
      const response = await request(app)
        .get('/api/gdpr/data-inventory')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.data.summary.hasActiveData).toBe(false);
      expect(response.body.data.dataLocations.redisCache.sessionData).toBe(false);
      expect(response.body.data.dataLocations.redisCache.embeddingCache).toBe(false);
    });

    it('should format bytes correctly', async () => {
      // Test various byte sizes
      const testCases = [
        { bytes: 0, expected: '0 Bytes' },
        { bytes: 500, expected: '500 Bytes' },
        { bytes: 1024, expected: '1 KB' },
        { bytes: 1536, expected: '1.5 KB' },
        { bytes: 1048576, expected: '1 MB' },
        { bytes: 1073741824, expected: '1 GB' },
      ];

      for (const tc of testCases) {
        vi.clearAllMocks();
        mockExecuteQuery
          .mockResolvedValueOnce({ recordset: [{ count: 1 }] })
          .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
          .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
          .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
          .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
          .mockResolvedValueOnce({ recordset: [{ total_bytes: tc.bytes }] })
          .mockResolvedValueOnce({ recordset: [{ count: 0 }] });

        const response = await request(app)
          .get('/api/gdpr/data-inventory')
          .set('x-test-user-id', testUserId)
          .expect(200);

        expect(response.body.data.dataLocations.blobStorage.totalBytesFormatted).toBe(tc.expected);
      }
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/data-inventory')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on database error', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Connection timeout'));

      // Act
      const response = await request(app)
        .get('/api/gdpr/data-inventory')
        .set('x-test-user-id', testUserId)
        .expect(500);

      // Assert
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should handle null values from database gracefully', async () => {
      // Arrange - simulate null results
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{}] })           // files - no count
        .mockResolvedValueOnce({ recordset: [] })              // folders - empty
        .mockResolvedValueOnce({ recordset: [{ count: null }] }) // chunks - null
        .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
        .mockResolvedValueOnce({ recordset: [{ count: 0 }] })
        .mockResolvedValueOnce({ recordset: [{ total_bytes: null }] })
        .mockResolvedValueOnce({ recordset: [{ count: 0 }] });

      // Act
      const response = await request(app)
        .get('/api/gdpr/data-inventory')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert - should default to 0 for null values
      expect(response.body.data.dataLocations.database.files).toBe(0);
      expect(response.body.data.dataLocations.blobStorage.totalBytes).toBe(0);
    });
  });

  // ============================================
  // Multi-Tenant Security Tests
  // ============================================
  describe('Multi-Tenant Security', () => {
    it('should only return data for authenticated user', async () => {
      // Arrange
      const userId1 = 'user-1';
      const userId2 = 'user-2';

      mockAuditService.getDeletionHistory.mockResolvedValue([
        { id: 'audit-1', userId: userId1 },
      ]);

      // Act - user1 requests their own data
      const response = await request(app)
        .get('/api/gdpr/deletion-audit')
        .set('x-test-user-id', userId1)
        .expect(200);

      // Assert - service should be called with user1's ID
      expect(mockAuditService.getDeletionHistory).toHaveBeenCalledWith(userId1, 50, 0);
    });

    it('should pass userId to all database queries', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValue({ recordset: [{ count: 0, total_bytes: 0 }] });

      // Act
      await request(app)
        .get('/api/gdpr/data-inventory')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert - verify all queries include userId
      expect(mockExecuteQuery).toHaveBeenCalledTimes(7);
      for (const call of mockExecuteQuery.mock.calls) {
        const params = call[1] as { userId?: string };
        expect(params.userId).toBe(testUserId);
      }
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle very large offset values', async () => {
      // Arrange
      mockAuditService.getDeletionHistory.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?offset=999999')
        .set('x-test-user-id', testUserId)
        .expect(200);

      // Assert
      expect(response.body.data.records).toEqual([]);
      expect(mockAuditService.getDeletionHistory).toHaveBeenCalledWith(testUserId, 50, 999999);
    });

    it('should handle special characters in userId', async () => {
      // Arrange
      const specialUserId = 'user-with+special@chars.test';
      mockAuditService.getDeletionHistory.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit')
        .set('x-test-user-id', specialUserId)
        .expect(200);

      // Assert
      expect(mockAuditService.getDeletionHistory).toHaveBeenCalledWith(specialUserId, 50, 0);
    });

    it('should handle concurrent requests', async () => {
      // Arrange
      mockAuditService.getDeletionHistory.mockResolvedValue([{ id: 'test' }]);

      // Act
      const requests = [
        request(app).get('/api/gdpr/deletion-audit').set('x-test-user-id', testUserId),
        request(app).get('/api/gdpr/deletion-audit').set('x-test-user-id', testUserId),
        request(app).get('/api/gdpr/deletion-audit').set('x-test-user-id', testUserId),
      ];

      const responses = await Promise.all(requests);

      // Assert - all should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should return 400 when query params are empty strings', async () => {
      // Note: Zod coerces empty strings to NaN which fails validation
      // This is correct behavior - empty strings are not valid numbers

      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=&offset=')
        .set('x-test-user-id', testUserId)
        .expect(400);

      // Assert
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle non-numeric pagination params', async () => {
      // Act
      const response = await request(app)
        .get('/api/gdpr/deletion-audit?limit=abc&offset=xyz')
        .set('x-test-user-id', testUserId)
        .expect(400);

      // Assert
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
