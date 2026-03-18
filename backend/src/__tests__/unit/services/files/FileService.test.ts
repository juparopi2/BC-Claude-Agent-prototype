/**
 * FileService Unit Tests
 *
 * Tests FileService facade which delegates to FileRepository,
 * FileDeletionService, FileDuplicateService, and FileMetadataService.
 *
 * Mock strategy: vi.fn() repository methods. Sub-services are real
 * implementations that use the mocked repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService } from '@/services/files/FileService';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';

// ===== MOCK PRISMA (prevent module-level DB config error) =====
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
  disconnectPrisma: vi.fn(),
}));

// ===== MOCK FileRepository with vi.fn() methods =====
const mockRepo = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  findByIdIncludingDeleted: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockResolvedValue(0),
  create: vi.fn().mockResolvedValue('MOCK-UUID-1'),
  createFolder: vi.fn().mockResolvedValue('MOCK-UUID-1'),
  findIdsByOwner: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue(undefined),
  updateProcessingStatus: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  getFileMetadata: vi.fn().mockResolvedValue(null),
  getChildrenIds: vi.fn().mockResolvedValue([]),
  findByName: vi.fn().mockResolvedValue(null),
  findByContentHash: vi.fn().mockResolvedValue([]),
  markForDeletion: vi.fn().mockResolvedValue({ markedIds: [], markedCount: 0 }),
  updateDeletionStatus: vi.fn().mockResolvedValue(undefined),
  isFileActiveForProcessing: vi.fn().mockResolvedValue(true),
  transitionStatus: vi.fn().mockResolvedValue({ success: true }),
  getPipelineStatus: vi.fn().mockResolvedValue(null),
  findByStatus: vi.fn().mockResolvedValue([]),
  getStatusDistribution: vi.fn().mockResolvedValue({}),
  transitionStatusWithRetry: vi.fn().mockResolvedValue({ success: true }),
  findStuckFiles: vi.fn().mockResolvedValue([]),
  findAbandonedFiles: vi.fn().mockResolvedValue([]),
  forceStatus: vi.fn().mockResolvedValue({ success: true }),
  checkFolderExists: vi.fn().mockResolvedValue(false),
  findFoldersByNamePattern: vi.fn().mockResolvedValue([]),
  findFolderIdByName: vi.fn().mockResolvedValue(null),
  getFilesPendingProcessing: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => mockRepo),
  __resetFileRepository: vi.fn(),
  FileRepository: vi.fn(),
}));

// ===== MOCK domains/files/retry (prevent cascade) =====
vi.mock('@/domains/files/retry', () => ({
  getFileRetryService: vi.fn(() => ({
    incrementProcessingRetryCount: vi.fn().mockResolvedValue(1),
    incrementEmbeddingRetryCount: vi.fn().mockResolvedValue(1),
    setLastProcessingError: vi.fn().mockResolvedValue(undefined),
    setLastEmbeddingError: vi.fn().mockResolvedValue(undefined),
    markAsPermanentlyFailed: vi.fn().mockResolvedValue(undefined),
    clearFailedStatus: vi.fn().mockResolvedValue(undefined),
    updateEmbeddingStatus: vi.fn().mockResolvedValue(undefined),
  })),
  getProcessingRetryManager: vi.fn(() => ({ executeManualRetry: vi.fn() })),
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

// ===== MOCK DELETION AUDIT SERVICE =====
const mockAuditService = vi.hoisted(() => ({
  logDeletionRequest: vi.fn().mockResolvedValue('audit-id-123'),
  updateStorageStatus: vi.fn().mockResolvedValue(undefined),
  markCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/files/DeletionAuditService', () => ({
  getDeletionAuditService: vi.fn(() => mockAuditService),
}));

// ===== MOCK VECTOR SEARCH SERVICE =====
const mockVectorSearchService = vi.hoisted(() => ({
  deleteChunksForFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => mockVectorSearchService),
    isConfigured: vi.fn().mockReturnValue(true),
  },
}));

describe('FileService', () => {
  let fileService: FileService;

  const testUserId = 'test-user-456';
  const testFileId = 'test-file-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup default mock implementations after clearAllMocks
    mockRepo.findMany.mockResolvedValue([]);
    mockRepo.findById.mockResolvedValue(null);
    mockRepo.findByIdIncludingDeleted.mockResolvedValue(null);
    mockRepo.count.mockResolvedValue(0);
    mockRepo.create.mockResolvedValue('MOCK-UUID-1');
    mockRepo.createFolder.mockResolvedValue('MOCK-UUID-1');
    mockRepo.findIdsByOwner.mockResolvedValue([]);
    mockRepo.update.mockResolvedValue(undefined);
    mockRepo.updateProcessingStatus.mockResolvedValue(undefined);
    mockRepo.delete.mockResolvedValue(undefined);
    mockRepo.getFileMetadata.mockResolvedValue(null);
    mockRepo.getChildrenIds.mockResolvedValue([]);
    mockRepo.findByName.mockResolvedValue(null);
    mockRepo.findByContentHash.mockResolvedValue([]);
    mockRepo.markForDeletion.mockResolvedValue({ markedIds: [], markedCount: 0 });
    mockRepo.updateDeletionStatus.mockResolvedValue(undefined);
    mockRepo.isFileActiveForProcessing.mockResolvedValue(true);
    mockRepo.transitionStatus.mockResolvedValue({ success: true });
    mockRepo.getPipelineStatus.mockResolvedValue(null);
    mockRepo.findByStatus.mockResolvedValue([]);
    mockRepo.getStatusDistribution.mockResolvedValue({});
    mockRepo.transitionStatusWithRetry.mockResolvedValue({ success: true });
    mockRepo.findStuckFiles.mockResolvedValue([]);
    mockRepo.findAbandonedFiles.mockResolvedValue([]);
    mockRepo.forceStatus.mockResolvedValue({ success: true });
    mockRepo.checkFolderExists.mockResolvedValue(false);
    mockRepo.findFoldersByNamePattern.mockResolvedValue([]);
    mockRepo.findFolderIdByName.mockResolvedValue(null);
    mockRepo.getFilesPendingProcessing.mockResolvedValue([]);

    // Re-setup audit service mocks
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockAuditService.updateStorageStatus.mockResolvedValue(undefined);
    mockAuditService.markCompleted.mockResolvedValue(undefined);

    // Re-setup vector search service mocks
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    // Reset FileService singleton
    (FileService as unknown as { instance: FileService | null }).instance = null;
    fileService = getFileService();
  });

  // ========== SUITE 1: GET FILES (8 TESTS) ==========
  describe('getFiles()', () => {
    it('should enforce multi-tenant isolation by passing userId to findMany', async () => {
      const parsedFile = FileFixture.createParsedFile({ userId: testUserId });
      mockRepo.findMany.mockResolvedValueOnce([parsedFile]);

      const files = await fileService.getFiles({ userId: testUserId });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId })
      );
      expect(files).toHaveLength(1);
      expect(files[0]!.userId).toBe(testUserId);
    });

    it('should filter by folderId when provided', async () => {
      const folderId = 'folder-123';
      mockRepo.findMany.mockResolvedValueOnce([]);

      await fileService.getFiles({ userId: testUserId, folderId });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, folderId })
      );
    });

    it('should pass favoritesOnly option to findMany', async () => {
      mockRepo.findMany.mockResolvedValueOnce([]);

      await fileService.getFiles({ userId: testUserId, favoritesOnly: true });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, favoritesOnly: true })
      );
    });

    it('should pass sortBy=name to findMany', async () => {
      mockRepo.findMany.mockResolvedValueOnce([]);

      await fileService.getFiles({ userId: testUserId, sortBy: 'name' });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, sortBy: 'name' })
      );
    });

    it('should pass sortBy=size to findMany', async () => {
      mockRepo.findMany.mockResolvedValueOnce([]);

      await fileService.getFiles({ userId: testUserId, sortBy: 'size' });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, sortBy: 'size' })
      );
    });

    it('should pass sortBy=date to findMany', async () => {
      mockRepo.findMany.mockResolvedValueOnce([]);

      await fileService.getFiles({ userId: testUserId, sortBy: 'date' });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, sortBy: 'date' })
      );
    });

    it('should apply pagination options to findMany', async () => {
      const parsedFiles = Array.from({ length: 5 }, (_, i) =>
        FileFixture.createParsedFile({ userId: testUserId, name: `file-${i + 1}.pdf` })
      );
      mockRepo.findMany.mockResolvedValueOnce(parsedFiles);

      const files = await fileService.getFiles({
        userId: testUserId,
        limit: 10,
        offset: 20,
      });

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          limit: 10,
          offset: 20,
        })
      );
      expect(files).toHaveLength(5);
      expect(files[0]!.userId).toBe(testUserId);
    });

    it('should propagate error when findMany rejects', async () => {
      const testError = new Error('Database error');
      mockRepo.findMany.mockRejectedValueOnce(testError);

      await expect(fileService.getFiles({ userId: testUserId })).rejects.toThrow(
        'Database error'
      );
    });
  });

  // ========== SUITE 2: GET FILE (3 TESTS) ==========
  describe('getFile()', () => {
    it('should return parsed file when found', async () => {
      const parsedFile = FileFixture.createParsedFile({
        id: testFileId,
        userId: testUserId,
      });
      mockRepo.findById.mockResolvedValueOnce(parsedFile);

      const file = await fileService.getFile(testUserId, testFileId);

      expect(file).toBeDefined();
      expect(file?.id).toBe(testFileId);
      expect(file?.userId).toBe(testUserId);
      expect(mockRepo.findById).toHaveBeenCalledWith(testUserId, testFileId);
    });

    it('should return null when file not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);

      const file = await fileService.getFile(testUserId, 'nonexistent');

      expect(file).toBeNull();
      expect(mockRepo.findById).toHaveBeenCalledWith(testUserId, 'nonexistent');
    });

    it('should enforce multi-tenant isolation by passing userId to findById', async () => {
      const differentUserId = 'other-user-789';
      mockRepo.findById.mockResolvedValueOnce(null);

      const file = await fileService.getFile(differentUserId, testFileId);

      expect(file).toBeNull();
      expect(mockRepo.findById).toHaveBeenCalledWith(differentUserId, testFileId);
    });
  });

  // ========== SUITE 3: CREATE FOLDER (2 TESTS) ==========
  describe('createFolder()', () => {
    it('should create root folder when parentId not provided', async () => {
      mockRepo.createFolder.mockResolvedValueOnce('MOCK-UUID-1');

      const folderId = await fileService.createFolder(testUserId, 'Documents');

      expect(folderId).toBe('MOCK-UUID-1');
      expect(mockRepo.createFolder).toHaveBeenCalledWith(testUserId, 'Documents', undefined);
    });

    it('should create subfolder when parentId provided', async () => {
      const parentFolderId = 'parent-folder-456';
      mockRepo.createFolder.mockResolvedValueOnce('MOCK-UUID-1');

      const folderId = await fileService.createFolder(
        testUserId,
        'Invoices',
        parentFolderId
      );

      expect(folderId).toBe('MOCK-UUID-1');
      expect(mockRepo.createFolder).toHaveBeenCalledWith(testUserId, 'Invoices', parentFolderId);
    });
  });

  // ========== SUITE 4: CREATE FILE RECORD (2 TESTS) ==========
  describe('createFileRecord()', () => {
    it('should create file record and return generated ID', async () => {
      mockRepo.create.mockResolvedValueOnce('MOCK-UUID-1');

      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512000,
        blobPath: 'users/test-user/files/invoice.pdf',
      });

      expect(fileId).toBe('MOCK-UUID-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 512000,
          blobPath: 'users/test-user/files/invoice.pdf',
        })
      );
    });

    it('should create file record with parent folder', async () => {
      const parentFolderId = 'folder-789';
      mockRepo.create.mockResolvedValueOnce('MOCK-UUID-1');

      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024000,
        blobPath: 'users/test-user/files/report.pdf',
        parentFolderId,
      });

      expect(fileId).toBe('MOCK-UUID-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentFolderId })
      );
    });
  });

  // ========== SUITE 5: UPDATE FILE (4 TESTS) ==========
  describe('updateFile()', () => {
    it('should update file name via FileMetadataService', async () => {
      mockRepo.update.mockResolvedValueOnce(undefined);

      await fileService.updateFile(testUserId, testFileId, {
        name: 'renamed-file.pdf',
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ name: 'renamed-file.pdf' })
      );
    });

    it('should update parent folder via FileMetadataService', async () => {
      const newParentId = 'new-parent-789';
      mockRepo.update.mockResolvedValueOnce(undefined);

      await fileService.updateFile(testUserId, testFileId, {
        parentFolderId: newParentId,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ parentFolderId: newParentId })
      );
    });

    it('should update favorite status via FileMetadataService', async () => {
      mockRepo.update.mockResolvedValueOnce(undefined);

      await fileService.updateFile(testUserId, testFileId, {
        isFavorite: true,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ isFavorite: true })
      );
    });

    it('should throw and log error when update rejects', async () => {
      mockRepo.update.mockRejectedValueOnce(new Error('File not found or unauthorized'));

      await expect(
        fileService.updateFile(testUserId, testFileId, { name: 'new-name.pdf' })
      ).rejects.toThrow('File not found or unauthorized');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
        }),
        'Failed to update file metadata'
      );
    });
  });

  // ========== SUITE 6: TOGGLE FAVORITE (2 TESTS) ==========
  describe('toggleFavorite()', () => {
    it('should toggle favorite from false to true', async () => {
      const parsedFile = FileFixture.createParsedFile({
        id: testFileId,
        userId: testUserId,
        isFavorite: false,
      });

      // findById call for current status
      mockRepo.findById.mockResolvedValueOnce(parsedFile);
      // update call with toggled status
      mockRepo.update.mockResolvedValueOnce(undefined);

      const newStatus = await fileService.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ isFavorite: true })
      );
    });

    it('should toggle favorite from true to false', async () => {
      const parsedFile = FileFixture.createParsedFile({
        id: testFileId,
        userId: testUserId,
        isFavorite: true,
      });

      // findById call for current status
      mockRepo.findById.mockResolvedValueOnce(parsedFile);
      // update call with toggled status
      mockRepo.update.mockResolvedValueOnce(undefined);

      const newStatus = await fileService.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(false);
      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ isFavorite: false })
      );
    });
  });

  // ========== SUITE 7: MOVE FILE (2 TESTS) ==========
  describe('moveFile()', () => {
    it('should move file to different folder', async () => {
      const newParentId = 'folder-999';
      mockRepo.update.mockResolvedValueOnce(undefined);

      await fileService.moveFile(testUserId, testFileId, newParentId);

      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ parentFolderId: newParentId })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId, newParentId }),
        'File moved'
      );
    });

    it('should move file to root (null parent)', async () => {
      mockRepo.update.mockResolvedValueOnce(undefined);

      await fileService.moveFile(testUserId, testFileId, null);

      expect(mockRepo.update).toHaveBeenCalledWith(
        testUserId,
        testFileId,
        expect.objectContaining({ parentFolderId: null })
      );
    });
  });

  // ========== SUITE 8: DELETE FILE (2 TESTS) ==========
  describe('deleteFile()', () => {
    it('should return blob_path array for file deletion', async () => {
      const blobPath = 'users/test-user/files/invoice.pdf';

      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath,
        isFolder: false,
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
      mockRepo.delete.mockResolvedValueOnce(undefined);

      const returnedBlobPaths = await fileService.deleteFile(testUserId, testFileId);

      expect(returnedBlobPaths).toEqual([blobPath]);
      expect(mockRepo.getFileMetadata).toHaveBeenCalledWith(testUserId, testFileId);
      expect(mockRepo.delete).toHaveBeenCalledWith(testUserId, testFileId);
    });

    it('should return empty array for empty folder deletion', async () => {
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath: '',
        isFolder: true,
        name: 'Documents',
        mimeType: 'inode/directory',
        sizeBytes: 0,
      });
      mockRepo.getChildrenIds.mockResolvedValueOnce([]);
      mockRepo.delete.mockResolvedValueOnce(undefined);

      const returnedBlobPaths = await fileService.deleteFile(testUserId, testFileId);

      expect(returnedBlobPaths).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId, isFolder: true }),
        'Record deleted from DB'
      );
    });
  });

  // ========== SUITE 9: GET FILE COUNT (3 TESTS) ==========
  describe('getFileCount()', () => {
    it('should get root file count when folderId not provided', async () => {
      mockRepo.count.mockResolvedValueOnce(42);

      const count = await fileService.getFileCount(testUserId);

      expect(count).toBe(42);
      expect(mockRepo.count).toHaveBeenCalledWith(testUserId, undefined, undefined);
    });

    it('should get folder file count when folderId provided', async () => {
      const folderId = 'folder-123';
      mockRepo.count.mockResolvedValueOnce(15);

      const count = await fileService.getFileCount(testUserId, folderId);

      expect(count).toBe(15);
      expect(mockRepo.count).toHaveBeenCalledWith(testUserId, folderId, undefined);
    });

    it('should return 0 for empty folder', async () => {
      mockRepo.count.mockResolvedValueOnce(0);

      const count = await fileService.getFileCount(testUserId, 'empty-folder');

      expect(count).toBe(0);
    });
  });

  // ========== SUITE 10: SINGLETON PATTERN (1 TEST) ==========
  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getFileService();
      const instance2 = getFileService();
      const instance3 = FileService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  // ========== SUITE 11: ERROR HANDLING (2 TESTS) ==========
  describe('Error Handling', () => {
    it('should propagate error on createFolder failure', async () => {
      const testError = new Error('Database connection failed');
      mockRepo.createFolder.mockRejectedValueOnce(testError);

      await expect(fileService.createFolder(testUserId, 'TestFolder')).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should propagate error on getFileCount failure', async () => {
      const testError = new Error('Query timeout');
      mockRepo.count.mockRejectedValueOnce(testError);

      await expect(fileService.getFileCount(testUserId)).rejects.toThrow('Query timeout');
    });
  });

  // ========== SUITE 12: GDPR-COMPLIANT DELETION CASCADE (15 TESTS) ==========
  describe('GDPR-Compliant Deletion Cascade', () => {
    /**
     * GDPR Article 17 - Right to Erasure
     * Tests for cascading deletion across all storage locations:
     * - Database (files, file_chunks via CASCADE)
     * - Azure Blob Storage (returned paths)
     * - Azure AI Search (vector embeddings)
     * - Audit logging for compliance
     */

    describe('Audit Logging', () => {
      it('should create audit record before deletion', async () => {
        const blobPath = 'users/test-user/files/invoice.pdf';

        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath,
          isFolder: false,
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith({
          userId: testUserId,
          resourceType: 'file',
          resourceId: testFileId,
          resourceName: 'invoice.pdf',
          deletionReason: 'user_request',
          metadata: {
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            isFolder: false,
          },
        });
      });

      it('should create audit record with folder resourceType for folders', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Documents',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });
        mockRepo.getChildrenIds.mockResolvedValueOnce([]);
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceType: 'folder',
          })
        );
      });

      it('should use custom deletionReason when provided', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId, { deletionReason: 'gdpr_erasure' });

        expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            deletionReason: 'gdpr_erasure',
          })
        );
      });

      it('should skip audit when skipAudit option is true', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId, { skipAudit: true });

        expect(mockAuditService.logDeletionRequest).not.toHaveBeenCalled();
      });

      it('should update audit record after DB deletion success', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.updateStorageStatus).toHaveBeenCalledWith(
          'audit-id-123',
          expect.objectContaining({
            deletedFromDb: true,
          })
        );
      });

      it('should mark audit as completed after successful deletion', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.markCompleted).toHaveBeenCalledWith('audit-id-123', 'completed');
      });

      it('should mark audit as partial if AI Search cleanup fails', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        mockVectorSearchService.deleteChunksForFile.mockRejectedValueOnce(
          new Error('AI Search unavailable')
        );

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.markCompleted).toHaveBeenCalledWith('audit-id-123', 'partial');
      });

      it('should continue deletion even if audit logging fails', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        mockAuditService.logDeletionRequest.mockRejectedValueOnce(new Error('Audit DB error'));

        const blobPaths = await fileService.deleteFile(testUserId, testFileId);

        // Deletion should still succeed
        expect(blobPaths).toEqual(['test.pdf']);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ fileId: testFileId }),
          'Failed to create deletion audit record'
        );
      });
    });

    describe('AI Search Cleanup', () => {
      it('should delete AI Search embeddings for file', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
          testFileId,
          testUserId
        );
      });

      it('should NOT call AI Search for folder deletion', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Documents',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });
        mockRepo.getChildrenIds.mockResolvedValueOnce([]);
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockVectorSearchService.deleteChunksForFile).not.toHaveBeenCalled();
      });

      it('should continue deletion if AI Search cleanup fails (eventual consistency)', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'important.pdf',
          isFolder: false,
          name: 'important.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 5000,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        mockVectorSearchService.deleteChunksForFile.mockRejectedValueOnce(
          new Error('AI Search timeout')
        );

        const blobPaths = await fileService.deleteFile(testUserId, testFileId);

        // Deletion succeeds despite AI Search failure
        expect(blobPaths).toEqual(['important.pdf']);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ fileId: testFileId }),
          'Failed to delete AI Search embeddings (will be cleaned by orphan cleanup job)'
        );
      });

      it('should log success when AI Search embeddings deleted', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ userId: testUserId, fileId: testFileId }),
          'AI Search embeddings deleted'
        );
      });
    });

    describe('Recursive Folder Deletion', () => {
      it('should delete child files with AI Search cleanup', async () => {
        const childFileId = 'child-file-456';
        const childBlobPath = 'users/test-user/files/child.pdf';

        // Parent folder metadata
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Documents',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });

        // Children: one child file
        mockRepo.getChildrenIds.mockResolvedValueOnce([childFileId]);

        // Child file metadata (recursive call)
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: childBlobPath,
          isFolder: false,
          name: 'child.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2000,
        });

        // delete calls: child then parent
        mockRepo.delete.mockResolvedValueOnce(undefined); // child
        mockRepo.delete.mockResolvedValueOnce(undefined); // parent

        const blobPaths = await fileService.deleteFile(testUserId, testFileId);

        expect(blobPaths).toContain(childBlobPath);
        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
          childFileId,
          testUserId
        );
      });

      it('should skip audit for recursive child deletions', async () => {
        const childFileId = 'child-file-789';

        // Parent folder metadata
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Parent',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });

        // Children: one child
        mockRepo.getChildrenIds.mockResolvedValueOnce([childFileId]);

        // Child file metadata
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'child.pdf',
          isFolder: false,
          name: 'child.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 500,
        });

        mockRepo.delete.mockResolvedValueOnce(undefined); // child
        mockRepo.delete.mockResolvedValueOnce(undefined); // parent

        await fileService.deleteFile(testUserId, testFileId);

        // Only ONE audit record for parent folder (not for child)
        expect(mockAuditService.logDeletionRequest).toHaveBeenCalledTimes(1);
        expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceId: testFileId, // Parent ID, not child
            resourceType: 'folder',
          })
        );
      });

      it('should track childFilesDeleted count in audit', async () => {
        // Parent folder metadata
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'Folder',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });

        // 3 children
        mockRepo.getChildrenIds.mockResolvedValueOnce(['child-1', 'child-2', 'child-3']);

        // Child 1 metadata + delete
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'c1.pdf',
          isFolder: false,
          name: 'c1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        // Child 2 metadata + delete
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'c2.pdf',
          isFolder: false,
          name: 'c2.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 200,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        // Child 3 metadata + delete
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'c3.pdf',
          isFolder: false,
          name: 'c3.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 300,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        // Parent delete
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockAuditService.updateStorageStatus).toHaveBeenCalledWith(
          'audit-id-123',
          expect.objectContaining({
            deletedFromDb: true,
            childFilesDeleted: 3,
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('should mark audit as failed when deletion throws', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });

        // DELETE fails
        mockRepo.delete.mockRejectedValueOnce(new Error('FK violation'));

        await expect(fileService.deleteFile(testUserId, testFileId)).rejects.toThrow('FK violation');

        expect(mockAuditService.markCompleted).toHaveBeenCalledWith(
          'audit-id-123',
          'failed',
          'Error: FK violation'
        );
      });
    });

    // ========== Post-Delete Verification ==========
    describe('Post-Delete Verification', () => {
      it('should call VectorSearchService.deleteChunksForFile after DB deletion', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'cascade-test.pdf',
          isFolder: false,
          name: 'cascade-test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
          testFileId,
          testUserId
        );
        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledTimes(1);
      });

      it('should call deleteChunksForFile for each child file in folder', async () => {
        const childFileId1 = 'child-cascade-1';
        const childFileId2 = 'child-cascade-2';

        // Parent folder metadata
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: '',
          isFolder: true,
          name: 'CascadeFolder',
          mimeType: 'inode/directory',
          sizeBytes: 0,
        });
        // Children
        mockRepo.getChildrenIds.mockResolvedValueOnce([childFileId1, childFileId2]);
        // Child 1 metadata + delete
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'c1.pdf',
          isFolder: false,
          name: 'c1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);
        // Child 2 metadata + delete
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'c2.pdf',
          isFolder: false,
          name: 'c2.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 200,
        });
        mockRepo.delete.mockResolvedValueOnce(undefined);
        // Parent folder delete
        mockRepo.delete.mockResolvedValueOnce(undefined);

        await fileService.deleteFile(testUserId, testFileId);

        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledTimes(2);
        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(childFileId1, testUserId);
        expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(childFileId2, testUserId);
      });

      it('should not call deleteChunksForFile when file not found (idempotent)', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce(null);

        const result = await fileService.deleteFile(testUserId, 'non-existent-file');

        expect(result).toEqual([]);
        expect(mockVectorSearchService.deleteChunksForFile).not.toHaveBeenCalled();
      });
    });
  });

  // ========== SUITE 13: DUPLICATE FILE DETECTION ==========
  describe('Duplicate File Detection', () => {
    describe('checkDuplicate()', () => {
      it('should return isDuplicate=false when no matching file exists', async () => {
        mockRepo.findByName.mockResolvedValueOnce(null);

        const result = await fileService.checkDuplicate(testUserId, 'new-file.pdf');

        expect(result.isDuplicate).toBe(false);
        expect(result.existingFile).toBeUndefined();
      });

      it('should return isDuplicate=true with existing file when match found', async () => {
        const existingFile = FileFixture.createParsedFile({
          id: 'existing-123',
          userId: testUserId,
          name: 'duplicate.pdf',
        });
        mockRepo.findByName.mockResolvedValueOnce(existingFile);

        const result = await fileService.checkDuplicate(testUserId, 'duplicate.pdf');

        expect(result.isDuplicate).toBe(true);
        expect(result.existingFile?.id).toBe('existing-123');
        expect(result.existingFile?.name).toBe('duplicate.pdf');
      });

      it('should check in specific folder when folderId provided', async () => {
        mockRepo.findByName.mockResolvedValueOnce(null);

        await fileService.checkDuplicate(testUserId, 'file.pdf', 'folder-123');

        expect(mockRepo.findByName).toHaveBeenCalledWith(testUserId, 'file.pdf', 'folder-123');
      });

      it('should check in root when folderId is null', async () => {
        mockRepo.findByName.mockResolvedValueOnce(null);

        await fileService.checkDuplicate(testUserId, 'file.pdf', null);

        expect(mockRepo.findByName).toHaveBeenCalledWith(testUserId, 'file.pdf', null);
      });

      it('should check in root when folderId is undefined', async () => {
        mockRepo.findByName.mockResolvedValueOnce(null);

        await fileService.checkDuplicate(testUserId, 'root-file.pdf');

        expect(mockRepo.findByName).toHaveBeenCalledWith(testUserId, 'root-file.pdf', null);
      });

      it('should enforce multi-tenant isolation by passing userId to findByName', async () => {
        mockRepo.findByName.mockResolvedValueOnce(null);

        await fileService.checkDuplicate(testUserId, 'secure-file.pdf');

        // Verify that userId is the first argument (multi-tenant isolation)
        expect(mockRepo.findByName).toHaveBeenCalledWith(
          testUserId,
          'secure-file.pdf',
          null
        );
      });

      it('should throw error on database failure', async () => {
        const dbError = new Error('Connection timeout');
        mockRepo.findByName.mockRejectedValueOnce(dbError);

        await expect(
          fileService.checkDuplicate(testUserId, 'error-file.pdf')
        ).rejects.toThrow('Connection timeout');
      });
    });

    describe('checkDuplicatesBatch()', () => {
      it('should check multiple files sequentially', async () => {
        // First check - no duplicate
        mockRepo.findByName.mockResolvedValueOnce(null);
        // Second check - duplicate found
        const existingFile = FileFixture.createParsedFile({
          id: 'dup-batch-123',
          userId: testUserId,
          name: 'existing.pdf',
        });
        mockRepo.findByName.mockResolvedValueOnce(existingFile);

        const results = await fileService.checkDuplicatesBatch(testUserId, [
          { name: 'new.pdf' },
          { name: 'existing.pdf' },
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]!.name).toBe('new.pdf');
        expect(results[0]!.isDuplicate).toBe(false);
        expect(results[1]!.name).toBe('existing.pdf');
        expect(results[1]!.isDuplicate).toBe(true);
        expect(results[1]!.existingFile?.id).toBe('dup-batch-123');
      });

      it('should handle mixed folderId values', async () => {
        mockRepo.findByName.mockResolvedValue(null);

        await fileService.checkDuplicatesBatch(testUserId, [
          { name: 'root.pdf' },                    // Root (undefined → null)
          { name: 'folder.pdf', folderId: 'f1' }, // In folder f1
          { name: 'root2.pdf', folderId: null },  // Root (explicit null)
        ]);

        expect(mockRepo.findByName).toHaveBeenCalledTimes(3);
        expect(mockRepo.findByName).toHaveBeenNthCalledWith(1, testUserId, 'root.pdf', null);
        expect(mockRepo.findByName).toHaveBeenNthCalledWith(2, testUserId, 'folder.pdf', 'f1');
        expect(mockRepo.findByName).toHaveBeenNthCalledWith(3, testUserId, 'root2.pdf', null);
      });

      it('should return empty array for empty input', async () => {
        const results = await fileService.checkDuplicatesBatch(testUserId, []);

        expect(results).toEqual([]);
        expect(mockRepo.findByName).not.toHaveBeenCalled();
      });
    });
  });
});
