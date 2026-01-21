/**
 * FileDeletionService Unit Tests
 *
 * Tests for GDPR-compliant cascading deletion.
 * Verifies proper cleanup across all storage locations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileDeletionService,
  getFileDeletionService,
  __resetFileDeletionService,
} from '@/services/files/operations/FileDeletionService';

// ===== MOCK REPOSITORY (vi.hoisted pattern) =====
const mockRepository = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  getChildrenIds: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => mockRepository),
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

// ===== MOCK DELETION AUDIT SERVICE (vi.hoisted pattern) =====
const mockAuditService = vi.hoisted(() => ({
  logDeletionRequest: vi.fn().mockResolvedValue('audit-id-123'),
  updateStorageStatus: vi.fn().mockResolvedValue(undefined),
  markCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/files/DeletionAuditService', () => ({
  getDeletionAuditService: vi.fn(() => mockAuditService),
}));

// ===== MOCK VECTOR SEARCH SERVICE (vi.hoisted pattern) =====
const mockVectorSearchService = vi.hoisted(() => ({
  deleteChunksForFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => mockVectorSearchService),
  },
}));

describe('FileDeletionService', () => {
  let service: FileDeletionService;

  const testUserId = 'TEST-USER-DEL-123';
  const testFileId = 'TEST-FILE-DEL-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockRepository.getFileMetadata.mockResolvedValue(null);
    mockRepository.getChildrenIds.mockResolvedValue([]);
    mockRepository.delete.mockResolvedValue(undefined);
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockAuditService.updateStorageStatus.mockResolvedValue(undefined);
    mockAuditService.markCompleted.mockResolvedValue(undefined);
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    // Reset singleton
    __resetFileDeletionService();
    service = getFileDeletionService();
  });

  // ========================================================================
  // SINGLETON PATTERN
  // ========================================================================
  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = getFileDeletionService();
      const instance2 = getFileDeletionService();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================================================
  // DELETE FILE
  // ========================================================================
  describe('delete()', () => {
    it('returns empty array when file not found (idempotent)', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce(null);

      const result = await service.delete(testUserId, testFileId);

      expect(result).toEqual([]);
    });

    it('returns blob paths for file deletion', async () => {
      const blobPath = 'users/test/files/doc.pdf';
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath,
        isFolder: false,
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      const result = await service.delete(testUserId, testFileId);

      expect(result).toContain(blobPath);
    });

    it('calls repository.delete with correct params', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId);

      expect(mockRepository.delete).toHaveBeenCalledWith(testUserId, testFileId);
    });
  });

  // ========================================================================
  // AUDIT LOGGING
  // ========================================================================
  describe('Audit Logging', () => {
    it('creates audit record before deletion', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith({
        userId: testUserId,
        resourceType: 'file',
        resourceId: testFileId,
        resourceName: 'invoice.pdf',
        deletionReason: 'user_request',
        metadata: {
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          isFolder: false,
        },
      });
    });

    it('creates audit record with folder resourceType', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: '',
        isFolder: true,
        name: 'Documents',
        mimeType: 'inode/directory',
        sizeBytes: 0,
      });

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'folder',
        })
      );
    });

    it('uses custom deletionReason when provided', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId, { deletionReason: 'gdpr_erasure' });

      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          deletionReason: 'gdpr_erasure',
        })
      );
    });

    it('skips audit when skipAudit=true', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId, { skipAudit: true });

      expect(mockAuditService.logDeletionRequest).not.toHaveBeenCalled();
    });

    it('updates audit record after DB deletion', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.updateStorageStatus).toHaveBeenCalledWith(
        'audit-id-123',
        expect.objectContaining({
          deletedFromDb: true,
        })
      );
    });

    it('marks audit as completed after successful deletion', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.markCompleted).toHaveBeenCalledWith('audit-id-123', 'completed');
    });

    it('continues deletion even if audit logging fails', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      mockAuditService.logDeletionRequest.mockRejectedValueOnce(new Error('Audit DB error'));

      const blobPaths = await service.delete(testUserId, testFileId);

      expect(blobPaths).toEqual(['test.pdf']);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId }),
        'Failed to create deletion audit record'
      );
    });
  });

  // ========================================================================
  // AI SEARCH CLEANUP
  // ========================================================================
  describe('AI Search Cleanup', () => {
    it('deletes AI Search embeddings for file', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });

      await service.delete(testUserId, testFileId);

      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
        testFileId,
        testUserId
      );
    });

    it('does NOT call AI Search for folder deletion', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: '',
        isFolder: true,
        name: 'Documents',
        mimeType: 'inode/directory',
        sizeBytes: 0,
      });

      await service.delete(testUserId, testFileId);

      expect(mockVectorSearchService.deleteChunksForFile).not.toHaveBeenCalled();
    });

    it('continues deletion if AI Search cleanup fails (eventual consistency)', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'important.pdf',
        isFolder: false,
        name: 'important.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5000,
      });
      mockVectorSearchService.deleteChunksForFile.mockRejectedValueOnce(
        new Error('AI Search timeout')
      );

      const blobPaths = await service.delete(testUserId, testFileId);

      expect(blobPaths).toEqual(['important.pdf']);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId }),
        'Failed to delete AI Search embeddings (will be cleaned by orphan cleanup job)'
      );
    });

    it('marks audit as partial if AI Search cleanup fails', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      mockVectorSearchService.deleteChunksForFile.mockRejectedValueOnce(
        new Error('AI Search unavailable')
      );

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.markCompleted).toHaveBeenCalledWith('audit-id-123', 'partial');
    });
  });

  // ========================================================================
  // RECURSIVE FOLDER DELETION
  // ========================================================================
  describe('Recursive Folder Deletion', () => {
    it('deletes child files recursively', async () => {
      const childFileId = 'child-file-123';
      const childBlobPath = 'users/test/child.pdf';

      // Parent folder
      mockRepository.getFileMetadata
        .mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Documents',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        })
        // Child file
        .mockResolvedValueOnce({
          blobPath: childBlobPath,
          isFolder: false,
          name: 'child.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2000,
        });

      mockRepository.getChildrenIds.mockResolvedValueOnce([childFileId]);

      const blobPaths = await service.delete(testUserId, testFileId);

      expect(blobPaths).toContain(childBlobPath);
    });

    it('skips audit for recursive child deletions', async () => {
      const childFileId = 'child-file-456';

      // Parent folder
      mockRepository.getFileMetadata
        .mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Parent',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        })
        // Child file
        .mockResolvedValueOnce({
          blobPath: 'child.pdf',
          isFolder: false,
          name: 'child.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 500,
        });

      mockRepository.getChildrenIds.mockResolvedValueOnce([childFileId]);

      await service.delete(testUserId, testFileId);

      // Only ONE audit record for parent (not for child)
      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: testFileId, // Parent ID
          resourceType: 'folder',
        })
      );
    });

    it('tracks childFilesDeleted count in audit', async () => {
      // Parent folder with 3 children
      mockRepository.getFileMetadata
        .mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Folder',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        })
        .mockResolvedValueOnce({
          blobPath: 'c1.pdf', isFolder: false, name: 'c1.pdf', mimeType: 'application/pdf', sizeBytes: 100,
        })
        .mockResolvedValueOnce({
          blobPath: 'c2.pdf', isFolder: false, name: 'c2.pdf', mimeType: 'application/pdf', sizeBytes: 200,
        })
        .mockResolvedValueOnce({
          blobPath: 'c3.pdf', isFolder: false, name: 'c3.pdf', mimeType: 'application/pdf', sizeBytes: 300,
        });

      mockRepository.getChildrenIds.mockResolvedValueOnce(['child-1', 'child-2', 'child-3']);

      await service.delete(testUserId, testFileId);

      expect(mockAuditService.updateStorageStatus).toHaveBeenCalledWith(
        'audit-id-123',
        expect.objectContaining({
          deletedFromDb: true,
          childFilesDeleted: 3,
        })
      );
    });

    it('calls AI Search cleanup for each child file', async () => {
      const childFileId1 = 'child-1';
      const childFileId2 = 'child-2';

      mockRepository.getFileMetadata
        .mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Folder',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        })
        .mockResolvedValueOnce({
          blobPath: 'c1.pdf', isFolder: false, name: 'c1.pdf', mimeType: 'application/pdf', sizeBytes: 100,
        })
        .mockResolvedValueOnce({
          blobPath: 'c2.pdf', isFolder: false, name: 'c2.pdf', mimeType: 'application/pdf', sizeBytes: 200,
        });

      mockRepository.getChildrenIds.mockResolvedValueOnce([childFileId1, childFileId2]);

      await service.delete(testUserId, testFileId);

      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(childFileId1, testUserId);
      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(childFileId2, testUserId);
    });
  });

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================
  describe('Error Handling', () => {
    it('marks audit as failed when deletion throws', async () => {
      mockRepository.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      mockRepository.delete.mockRejectedValueOnce(new Error('FK violation'));

      await expect(service.delete(testUserId, testFileId)).rejects.toThrow('FK violation');

      expect(mockAuditService.markCompleted).toHaveBeenCalledWith(
        'audit-id-123',
        'failed',
        'Error: FK violation'
      );
    });
  });
});
