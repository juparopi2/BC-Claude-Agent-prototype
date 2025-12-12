/**
 * DeletionAuditService Unit Tests
 *
 * Tests for GDPR-compliant deletion audit logging.
 * Covers all methods for tracking data deletion across storage locations.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DeletionAuditService,
  getDeletionAuditService,
  type CreateDeletionAuditInput,
  type StorageStatusUpdate,
  type DeletionAuditRecord,
} from '@/services/files/DeletionAuditService';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// ===== MOCK uuid (vi.hoisted pattern) =====
const mockUuid = vi.hoisted(() => vi.fn(() => 'mock-audit-uuid-123'));

vi.mock('uuid', () => ({
  v4: mockUuid,
}));

describe('DeletionAuditService', () => {
  let auditService: DeletionAuditService;

  const testUserId = 'user-123-456';
  const testResourceId = 'file-789-abc';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
    mockUuid.mockReturnValue('mock-audit-uuid-123');

    // Reset singleton instance
    DeletionAuditService.resetInstance();
    auditService = getDeletionAuditService();
  });

  afterEach(() => {
    DeletionAuditService.resetInstance();
  });

  // ========== SUITE 1: SINGLETON PATTERN ==========
  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getDeletionAuditService();
      const instance2 = getDeletionAuditService();
      const instance3 = DeletionAuditService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should create new instance after resetInstance()', () => {
      const instance1 = getDeletionAuditService();
      DeletionAuditService.resetInstance();
      const instance2 = getDeletionAuditService();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 2: LOG DELETION REQUEST ==========
  describe('logDeletionRequest()', () => {
    it('should insert audit record with correct data', async () => {
      const input: CreateDeletionAuditInput = {
        userId: testUserId,
        resourceType: 'file',
        resourceId: testResourceId,
        resourceName: 'test-document.pdf',
        deletionReason: 'user_request',
        metadata: { mimeType: 'application/pdf', sizeBytes: 1024 },
      };

      const auditId = await auditService.logDeletionRequest(input);

      expect(auditId).toBe('mock-audit-uuid-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deletion_audit_log'),
        expect.objectContaining({
          id: 'mock-audit-uuid-123',
          user_id: testUserId,
          resource_type: 'file',
          resource_id: testResourceId,
          resource_name: 'test-document.pdf',
          deletion_reason: 'user_request',
          status: 'in_progress',
        })
      );
    });

    it('should serialize metadata to JSON', async () => {
      const input: CreateDeletionAuditInput = {
        userId: testUserId,
        resourceType: 'folder',
        resourceId: testResourceId,
        metadata: { childCount: 5, totalSize: 10240 },
      };

      await auditService.logDeletionRequest(input);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: JSON.stringify({ childCount: 5, totalSize: 10240 }),
        })
      );
    });

    it('should use default deletion_reason when not provided', async () => {
      const input: CreateDeletionAuditInput = {
        userId: testUserId,
        resourceType: 'file',
        resourceId: testResourceId,
      };

      await auditService.logDeletionRequest(input);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          deletion_reason: 'user_request',
        })
      );
    });

    it('should log audit creation', async () => {
      const input: CreateDeletionAuditInput = {
        userId: testUserId,
        resourceType: 'file',
        resourceId: testResourceId,
      };

      await auditService.logDeletionRequest(input);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          auditId: 'mock-audit-uuid-123',
          userId: testUserId,
          resourceType: 'file',
          resourceId: testResourceId,
        }),
        'Logging deletion request'
      );
    });
  });

  // ========== SUITE 3: UPDATE STORAGE STATUS ==========
  describe('updateStorageStatus()', () => {
    const auditId = 'audit-123';

    it('should update deletedFromDb flag', async () => {
      const update: StorageStatusUpdate = { deletedFromDb: true };

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_from_db = @deleted_from_db'),
        expect.objectContaining({
          id: auditId,
          deleted_from_db: true,
        })
      );
    });

    it('should update deletedFromBlob flag', async () => {
      const update: StorageStatusUpdate = { deletedFromBlob: true };

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_from_blob = @deleted_from_blob'),
        expect.objectContaining({
          id: auditId,
          deleted_from_blob: true,
        })
      );
    });

    it('should update deletedFromSearch flag', async () => {
      const update: StorageStatusUpdate = { deletedFromSearch: true };

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_from_search = @deleted_from_search'),
        expect.objectContaining({
          id: auditId,
          deleted_from_search: true,
        })
      );
    });

    it('should update multiple flags at once', async () => {
      const update: StorageStatusUpdate = {
        deletedFromDb: true,
        deletedFromBlob: true,
        deletedFromSearch: true,
        childFilesDeleted: 5,
      };

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/deleted_from_db.*deleted_from_blob.*deleted_from_search.*child_files_deleted/s),
        expect.objectContaining({
          id: auditId,
          deleted_from_db: true,
          deleted_from_blob: true,
          deleted_from_search: true,
          child_files_deleted: 5,
        })
      );
    });

    it('should not execute query when no updates provided', async () => {
      const update: StorageStatusUpdate = {};

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should update errorDetails', async () => {
      const update: StorageStatusUpdate = {
        errorDetails: 'AI Search connection failed',
      };

      await auditService.updateStorageStatus(auditId, update);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('error_details = @error_details'),
        expect.objectContaining({
          error_details: 'AI Search connection failed',
        })
      );
    });
  });

  // ========== SUITE 4: MARK COMPLETED ==========
  describe('markCompleted()', () => {
    const auditId = 'audit-456';

    it('should mark deletion as completed', async () => {
      await auditService.markCompleted(auditId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('status = @status'),
        expect.objectContaining({
          id: auditId,
          status: 'completed',
        })
      );
    });

    it('should mark deletion as partial with error details', async () => {
      await auditService.markCompleted(auditId, 'partial', 'AI Search cleanup failed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('completed_at = GETUTCDATE()'),
        expect.objectContaining({
          id: auditId,
          status: 'partial',
          error_details: 'AI Search cleanup failed',
        })
      );
    });

    it('should mark deletion as failed', async () => {
      await auditService.markCompleted(auditId, 'failed', 'Database error');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          error_details: 'Database error',
        })
      );
    });

    it('should default to completed status', async () => {
      await auditService.markCompleted(auditId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    it('should log completion', async () => {
      await auditService.markCompleted(auditId, 'completed');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ auditId, status: 'completed' }),
        'Marking deletion as completed'
      );
    });
  });

  // ========== SUITE 5: GET DELETION HISTORY ==========
  describe('getDeletionHistory()', () => {
    it('should return parsed deletion records', async () => {
      const mockDbRecord = {
        id: 'audit-1',
        user_id: testUserId,
        resource_type: 'file',
        resource_id: testResourceId,
        resource_name: 'test.pdf',
        deletion_reason: 'user_request',
        requested_by: testUserId,
        deleted_from_db: true,
        deleted_from_blob: true,
        deleted_from_search: false,
        deleted_from_cache: false,
        child_files_deleted: 0,
        child_chunks_deleted: 0,
        requested_at: new Date('2025-01-01'),
        completed_at: new Date('2025-01-01'),
        status: 'partial',
        error_details: null,
        metadata: '{"test": true}',
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockDbRecord] });

      const records = await auditService.getDeletionHistory(testUserId);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: 'audit-1',
        userId: testUserId,
        resourceType: 'file',
        resourceId: testResourceId,
        deletedFromDb: true,
        deletedFromBlob: true,
        deletedFromSearch: false,
        status: 'partial',
        metadata: { test: true },
      });
    });

    it('should apply pagination', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getDeletionHistory(testUserId, 25, 50);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET @offset ROWS'),
        expect.objectContaining({
          user_id: testUserId,
          limit: 25,
          offset: 50,
        })
      );
    });

    it('should use default pagination', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getDeletionHistory(testUserId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          limit: 50,
          offset: 0,
        })
      );
    });

    it('should order by requested_at DESC', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getDeletionHistory(testUserId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY requested_at DESC'),
        expect.any(Object)
      );
    });
  });

  // ========== SUITE 6: GET AUDIT RECORD ==========
  describe('getAuditRecord()', () => {
    it('should return parsed record when found', async () => {
      const mockDbRecord = {
        id: 'audit-single',
        user_id: testUserId,
        resource_type: 'folder',
        resource_id: 'folder-123',
        resource_name: 'Documents',
        deletion_reason: 'gdpr_erasure',
        requested_by: 'admin',
        deleted_from_db: true,
        deleted_from_blob: true,
        deleted_from_search: true,
        deleted_from_cache: true,
        child_files_deleted: 10,
        child_chunks_deleted: 50,
        requested_at: new Date(),
        completed_at: new Date(),
        status: 'completed',
        error_details: null,
        metadata: null,
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockDbRecord] });

      const record = await auditService.getAuditRecord('audit-single');

      expect(record).not.toBeNull();
      expect(record?.id).toBe('audit-single');
      expect(record?.resourceType).toBe('folder');
      expect(record?.childFilesDeleted).toBe(10);
    });

    it('should return null when not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const record = await auditService.getAuditRecord('nonexistent');

      expect(record).toBeNull();
    });
  });

  // ========== SUITE 7: GET INCOMPLETE DELETIONS ==========
  describe('getIncompleteDeletions()', () => {
    it('should query for incomplete statuses', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getIncompleteDeletions();

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('pending', 'in_progress', 'partial', 'failed')"),
        expect.any(Object)
      );
    });

    it('should apply limit', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getIncompleteDeletions(50);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 50 })
      );
    });

    it('should order by requested_at ASC (oldest first)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await auditService.getIncompleteDeletions();

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY requested_at ASC'),
        expect.any(Object)
      );
    });
  });

  // ========== SUITE 8: GET DELETION STATS ==========
  describe('getDeletionStats()', () => {
    beforeEach(() => {
      // Setup mock responses for the 4 queries
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [{ count: 100 }] }) // total
        .mockResolvedValueOnce({ recordset: [{ count: 85 }] }) // completed
        .mockResolvedValueOnce({ recordset: [{ count: 10 }] }) // failed
        .mockResolvedValueOnce({
          recordset: [
            { resource_type: 'file', count: 70 },
            { resource_type: 'folder', count: 30 },
          ],
        }); // by type
    });

    it('should return aggregated statistics', async () => {
      const stats = await auditService.getDeletionStats(testUserId);

      expect(stats).toEqual({
        totalDeletions: 100,
        completedDeletions: 85,
        failedDeletions: 10,
        byResourceType: {
          file: 70,
          folder: 30,
        },
      });
    });

    it('should filter by userId when provided', async () => {
      await auditService.getDeletionStats(testUserId);

      // All 4 queries should have user_id filter
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({ user_id: testUserId })
      );
    });

    it('should filter by date range when provided', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');

      await auditService.getDeletionStats(testUserId, startDate, endDate);

      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('requested_at >= @start_date'),
        expect.objectContaining({
          start_date: startDate,
          end_date: endDate,
        })
      );
    });

    it('should work without filters', async () => {
      await auditService.getDeletionStats();

      // Should not have user_id filter
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        1,
        expect.not.stringContaining('user_id'),
        {}
      );
    });
  });

  // ========== SUITE 9: ERROR HANDLING ==========
  describe('Error Handling', () => {
    it('should propagate database errors from logDeletionRequest', async () => {
      const dbError = new Error('Connection failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(
        auditService.logDeletionRequest({
          userId: testUserId,
          resourceType: 'file',
          resourceId: testResourceId,
        })
      ).rejects.toThrow('Connection failed');
    });

    it('should propagate database errors from updateStorageStatus', async () => {
      const dbError = new Error('Update failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(
        auditService.updateStorageStatus('audit-1', { deletedFromDb: true })
      ).rejects.toThrow('Update failed');
    });

    it('should propagate database errors from markCompleted', async () => {
      const dbError = new Error('Mark completed failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(auditService.markCompleted('audit-1', 'completed')).rejects.toThrow(
        'Mark completed failed'
      );
    });
  });
});
