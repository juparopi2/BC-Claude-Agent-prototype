/**
 * FileService Contract Tests
 *
 * These tests freeze the current behavior of FileService public API.
 * They serve as a safety net during the refactoring process.
 *
 * Contract tests focus on:
 * 1. Public API signatures and return types
 * 2. Multi-tenant isolation (CRITICAL - security)
 * 3. GDPR deletion cascade behavior
 *
 * DO NOT modify these tests during refactoring. If a test fails,
 * the refactored code has broken backward compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService, __resetFileService } from '@/services/files/FileService';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';
import type { ParsedFile } from '@/types/file.types';

// ===== MOCK REPOSITORY (vi.hoisted pattern) =====
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

// ===== MOCK domains/files/retry (prevent cascade) =====
vi.mock('@/domains/files/retry', () => ({
  getFileRetryService: vi.fn(() => ({
    incrementProcessingRetryCount: vi.fn().mockResolvedValue(1),
    incrementEmbeddingRetryCount: vi.fn().mockResolvedValue(1),
    setLastProcessingError: vi.fn().mockResolvedValue(undefined),
    setLastEmbeddingError: vi.fn().mockResolvedValue(undefined),
    markAsPermanentlyFailed: vi.fn().mockResolvedValue(undefined),
    clearFailedStatus: vi.fn().mockResolvedValue(undefined),
    updatePipelineStatus: vi.fn().mockResolvedValue(undefined),
  })),
  getProcessingRetryManager: vi.fn(() => ({ executeManualRetry: vi.fn() })),
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

describe('FileService Contract Tests', () => {
  let fileService: FileService;

  const testUserId = 'TEST-USER-CONTRACT-456';
  const testFileId = 'TEST-FILE-CONTRACT-123';
  const differentUserId = 'OTHER-USER-CONTRACT-789';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-setup mock defaults after clearAllMocks
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

    // Re-setup audit and vector search mocks
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockAuditService.updateStorageStatus.mockResolvedValue(undefined);
    mockAuditService.markCompleted.mockResolvedValue(undefined);
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    // Reset singleton instances
    await __resetFileService();
    fileService = getFileService();
  });

  // ========================================================================
  // PUBLIC API SIGNATURES (11 critical methods)
  // These tests verify that the public API contracts are maintained
  // ========================================================================
  describe('Public API', () => {
    describe('getFile(userId, fileId)', () => {
      it('returns ParsedFile when file exists and user owns it', async () => {
        const parsedFile = FileFixture.createParsedFile({
          id: testFileId,
          userId: testUserId,
          name: 'contract-test.pdf',
        });
        mockRepo.findById.mockResolvedValueOnce(parsedFile);

        const result = await fileService.getFile(testUserId, testFileId);

        expect(result).not.toBeNull();
        expect(result?.id).toBe(testFileId);
        expect(result?.userId).toBe(testUserId);
        expect(result?.name).toBe('contract-test.pdf');
        // Verify camelCase API format
        expect(result).toHaveProperty('userId');
        expect(result).toHaveProperty('parentFolderId');
        expect(result).toHaveProperty('mimeType');
        expect(result).toHaveProperty('sizeBytes');
        expect(result).toHaveProperty('blobPath');
        expect(result).toHaveProperty('isFolder');
        expect(result).toHaveProperty('isFavorite');
        expect(result).toHaveProperty('pipelineStatus');
        expect(result).toHaveProperty('readinessState');
        expect(result).toHaveProperty('createdAt');
        expect(result).toHaveProperty('updatedAt');
      });

      it('returns null when file not found', async () => {
        // mockRepo.findById returns null by default

        const result = await fileService.getFile(testUserId, 'nonexistent-id');

        expect(result).toBeNull();
      });
    });

    describe('getFiles(options)', () => {
      it('returns ParsedFile[] array', async () => {
        const parsedFiles = Array.from({ length: 3 }, (_, i) =>
          FileFixture.createParsedFile({ userId: testUserId, name: `file-${i + 1}.pdf` })
        );
        mockRepo.findMany.mockResolvedValueOnce(parsedFiles);

        const result = await fileService.getFiles({ userId: testUserId });

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3);
        result.forEach((file: ParsedFile) => {
          expect(file).toHaveProperty('id');
          expect(file).toHaveProperty('userId');
          expect(file).toHaveProperty('name');
        });
      });

      it('returns empty array when no files', async () => {
        // mockRepo.findMany returns [] by default

        const result = await fileService.getFiles({ userId: testUserId });

        expect(result).toEqual([]);
      });

      it('accepts all option parameters', async () => {
        // Should not throw — all options are valid
        await fileService.getFiles({
          userId: testUserId,
          folderId: 'folder-123',
          sortBy: 'name',
          favoritesFirst: true,
          limit: 50,
          offset: 10,
        });

        expect(mockRepo.findMany).toHaveBeenCalled();
      });
    });

    describe('createFileRecord(options)', () => {
      it('returns string fileId', async () => {
        mockRepo.create.mockResolvedValueOnce('MOCK-UUID-1');

        const fileId = await fileService.createFileRecord({
          userId: testUserId,
          name: 'new-file.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          blobPath: 'users/test/files/new-file.pdf',
        });

        expect(typeof fileId).toBe('string');
        expect(fileId.length).toBeGreaterThan(0);
      });

      it('returns UPPERCASE UUID', async () => {
        mockRepo.create.mockResolvedValueOnce('MOCK-UUID-UPPER');

        const fileId = await fileService.createFileRecord({
          userId: testUserId,
          name: 'new-file.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          blobPath: 'users/test/files/new-file.pdf',
        });

        // All IDs must be UPPERCASE per CLAUDE.md
        expect(fileId).toBe(fileId.toUpperCase());
      });
    });

    describe('deleteFile(userId, fileId, options?)', () => {
      it('returns string[] blobPaths for file', async () => {
        const blobPath = 'users/test-user/files/test.pdf';
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath,
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });

        const result = await fileService.deleteFile(testUserId, testFileId);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toContain(blobPath);
      });

      it('returns empty array when file not found (idempotent)', async () => {
        // mockRepo.getFileMetadata returns null by default

        const result = await fileService.deleteFile(testUserId, 'nonexistent-id');

        expect(result).toEqual([]);
      });

      it('accepts optional options parameter', async () => {
        mockRepo.getFileMetadata.mockResolvedValueOnce({
          blobPath: 'test.pdf',
          isFolder: false,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        });

        // This should not throw
        await fileService.deleteFile(testUserId, testFileId, {
          skipAudit: true,
          deletionReason: 'gdpr_erasure',
        });

        expect(mockRepo.delete).toHaveBeenCalled();
      });
    });

    describe('updateFile(userId, fileId, updates)', () => {
      it('returns void on success', async () => {
        // mockRepo.update resolves by default

        const result = await fileService.updateFile(testUserId, testFileId, {
          name: 'renamed.pdf',
        });

        expect(result).toBeUndefined();
      });

      it('throws error when file not found', async () => {
        mockRepo.update.mockRejectedValueOnce(new Error('File not found or unauthorized'));

        await expect(
          fileService.updateFile(testUserId, testFileId, { name: 'new-name.pdf' })
        ).rejects.toThrow('File not found or unauthorized');
      });
    });

    describe('updateProcessingStatus(userId, fileId, status, text?)', () => {
      it('returns void on success', async () => {
        // mockRepo.updateProcessingStatus resolves by default

        const result = await fileService.updateProcessingStatus(
          testUserId,
          testFileId,
          'completed',
          'Extracted text content'
        );

        expect(result).toBeUndefined();
      });

      it('accepts optional extractedText parameter', async () => {
        // Without extractedText
        await fileService.updateProcessingStatus(testUserId, testFileId, 'processing');

        expect(mockRepo.updateProcessingStatus).toHaveBeenCalled();
      });
    });

    describe('verifyOwnership(userId, fileIds)', () => {
      it('returns string[] of owned fileIds', async () => {
        mockRepo.findIdsByOwner.mockResolvedValueOnce(['file-1', 'file-2']);

        const result = await fileService.verifyOwnership(testUserId, ['file-1', 'file-2', 'file-3']);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual(['file-1', 'file-2']);
      });

      it('returns empty array for empty input', async () => {
        mockRepo.findIdsByOwner.mockResolvedValueOnce([]);

        const result = await fileService.verifyOwnership(testUserId, []);

        expect(result).toEqual([]);
      });
    });

    describe('getFileCount(userId, folderId?, options?)', () => {
      it('returns number', async () => {
        mockRepo.count.mockResolvedValueOnce(42);

        const result = await fileService.getFileCount(testUserId);

        expect(typeof result).toBe('number');
        expect(result).toBe(42);
      });

      it('accepts optional folderId and options', async () => {
        mockRepo.count.mockResolvedValueOnce(10);

        const result = await fileService.getFileCount(testUserId, 'folder-123', {
          favoritesFirst: true,
        });

        expect(result).toBe(10);
      });
    });

    describe('checkDuplicatesByHash(userId, items)', () => {
      it('returns correct structure with tempId, isDuplicate, existingFile?', async () => {
        // First item — no duplicate
        mockRepo.findByContentHash.mockResolvedValueOnce([]);
        // Second item — duplicate found
        const existingFile = FileFixture.createParsedFile({
          id: 'existing-123',
          userId: testUserId,
          contentHash: 'abc123hash',
        });
        mockRepo.findByContentHash.mockResolvedValueOnce([existingFile]);

        const result = await fileService.checkDuplicatesByHash(testUserId, [
          { tempId: 'temp-1', contentHash: 'hash1', fileName: 'file1.pdf' },
          { tempId: 'temp-2', contentHash: 'abc123hash', fileName: 'file2.pdf' },
        ]);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);

        expect(result[0]).toMatchObject({
          tempId: 'temp-1',
          isDuplicate: false,
        });
        expect(result[0]!.existingFile).toBeUndefined();

        expect(result[1]).toMatchObject({
          tempId: 'temp-2',
          isDuplicate: true,
        });
        expect(result[1]!.existingFile).toBeDefined();
        expect(result[1]!.existingFile?.id).toBe('existing-123');
      });
    });

    describe('findByContentHash(userId, hash)', () => {
      it('returns ParsedFile[] array', async () => {
        const mockFiles = [
          FileFixture.createParsedFile({ userId: testUserId, contentHash: 'same-hash-123' }),
          FileFixture.createParsedFile({ userId: testUserId, contentHash: 'same-hash-123' }),
        ];
        mockRepo.findByContentHash.mockResolvedValueOnce(mockFiles);

        const result = await fileService.findByContentHash(testUserId, 'same-hash-123');

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
      });

      it('returns empty array when no matches', async () => {
        // mockRepo.findByContentHash returns [] by default

        const result = await fileService.findByContentHash(testUserId, 'nonexistent-hash');

        expect(result).toEqual([]);
      });
    });

    describe('getFileService() singleton', () => {
      it('returns same instance on multiple calls', () => {
        const instance1 = getFileService();
        const instance2 = getFileService();
        const instance3 = FileService.getInstance();

        expect(instance1).toBe(instance2);
        expect(instance2).toBe(instance3);
      });
    });
  });

  // ========================================================================
  // MULTI-TENANT ISOLATION (CRITICAL - security)
  // These tests verify that users can NEVER access other users' files
  // ========================================================================
  describe('Multi-tenant Isolation', () => {
    it('getFile NEVER returns file for wrong userId', async () => {
      // When User B tries to access User A's file, repo returns null
      // (because findById includes userId in WHERE clause)
      // mockRepo.findById returns null by default

      const result = await fileService.getFile(differentUserId, testFileId);

      // CRITICAL: Must return null, not the file
      expect(result).toBeNull();

      // Verify repo was called with the correct (different) userId
      expect(mockRepo.findById).toHaveBeenCalledWith(
        differentUserId,
        testFileId
      );
    });

    it('deleteFile NEVER deletes file for wrong userId', async () => {
      // File exists but owned by different user — getFileMetadata returns null
      // mockRepo.getFileMetadata returns null by default

      const result = await fileService.deleteFile(differentUserId, testFileId);

      // Should return empty array (idempotent behavior)
      expect(result).toEqual([]);

      // Verify getFileMetadata was called with the correct (different) userId
      expect(mockRepo.getFileMetadata).toHaveBeenCalledWith(
        differentUserId,
        testFileId
      );
    });

    it('getFiles NEVER includes other users files', async () => {
      const userFiles = [
        FileFixture.createParsedFile({ userId: testUserId }),
        FileFixture.createParsedFile({ userId: testUserId }),
      ];
      mockRepo.findMany.mockResolvedValueOnce(userFiles);

      const result = await fileService.getFiles({ userId: testUserId });

      // Verify findMany was called with the correct userId
      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId })
      );

      // All returned files should belong to requesting user
      result.forEach((file: ParsedFile) => {
        expect(file.userId).toBe(testUserId);
      });
    });

    it('updateFile NEVER updates file for wrong userId', async () => {
      mockRepo.update.mockRejectedValueOnce(new Error('File not found or unauthorized'));

      await expect(
        fileService.updateFile(differentUserId, testFileId, { name: 'hacked.pdf' })
      ).rejects.toThrow('File not found or unauthorized');

      // Verify update was called with the correct (different) userId
      expect(mockRepo.update).toHaveBeenCalledWith(
        differentUserId,
        testFileId,
        expect.objectContaining({ name: 'hacked.pdf' })
      );
    });

    it('verifyOwnership returns only files owned by user', async () => {
      // User owns file-1 but not file-2
      mockRepo.findIdsByOwner.mockResolvedValueOnce(['file-1']);

      const result = await fileService.verifyOwnership(testUserId, ['file-1', 'file-2']);

      expect(result).toEqual(['file-1']);
      expect(result).not.toContain('file-2');
    });
  });

  // ========================================================================
  // GDPR DELETION CASCADE
  // These tests verify proper cleanup across all storage locations
  // ========================================================================
  describe('GDPR Deletion', () => {
    it('deleteFile creates audit record', async () => {
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      await fileService.deleteFile(testUserId, testFileId);

      expect(mockAuditService.logDeletionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          resourceType: 'file',
          resourceId: testFileId,
        })
      );
    });

    it('deleteFile recursively deletes folder children', async () => {
      const childFileId = 'child-file-123';
      const childBlobPath = 'users/test/child.pdf';

      // Parent folder metadata
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath: '',
        isFolder: true,
        name: 'TestFolder',
        mimeType: 'inode/directory',
        sizeBytes: 0,
      });

      // Children of the folder
      mockRepo.getChildrenIds.mockResolvedValueOnce([childFileId]);

      // Child file metadata (recursive call)
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath: childBlobPath,
        isFolder: false,
        name: 'child.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500,
      });

      // mockRepo.delete resolves by default for both parent and child

      const blobPaths = await fileService.deleteFile(testUserId, testFileId);

      // Should include child blob paths
      expect(blobPaths).toContain(childBlobPath);
    });

    it('deleteFile cleans up AI Search embeddings', async () => {
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath: 'test.pdf',
        isFolder: false,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      await fileService.deleteFile(testUserId, testFileId);

      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
        testFileId,
        testUserId
      );
    });

    it('deleteFile returns blob paths for cleanup', async () => {
      const blobPath = 'users/test-user/files/important.pdf';
      mockRepo.getFileMetadata.mockResolvedValueOnce({
        blobPath,
        isFolder: false,
        name: 'important.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5000,
      });

      const result = await fileService.deleteFile(testUserId, testFileId);

      expect(result).toEqual([blobPath]);
    });
  });

  // ========================================================================
  // ADDITIONAL CONTRACT TESTS
  // These verify other critical behaviors
  // ========================================================================
  describe('Additional Contracts', () => {
    describe('createFolder', () => {
      it('creates folder with correct attributes', async () => {
        mockRepo.createFolder.mockResolvedValueOnce('MOCK-FOLDER-UUID-1');

        const folderId = await fileService.createFolder(testUserId, 'NewFolder');

        expect(mockRepo.createFolder).toHaveBeenCalledWith(
          testUserId,
          'NewFolder',
          undefined
        );

        expect(typeof folderId).toBe('string');
      });
    });

    describe('toggleFavorite', () => {
      it('returns new boolean status', async () => {
        const parsedFile = FileFixture.createParsedFile({
          id: testFileId,
          userId: testUserId,
          isFavorite: false,
        });
        mockRepo.findById.mockResolvedValueOnce(parsedFile);
        // mockRepo.update resolves by default

        const result = await fileService.toggleFavorite(testUserId, testFileId);

        expect(typeof result).toBe('boolean');
        expect(result).toBe(true); // toggled from false to true
      });

      it('calls repo.update with toggled isFavorite value', async () => {
        const parsedFile = FileFixture.createParsedFile({
          id: testFileId,
          userId: testUserId,
          isFavorite: false,
        });
        mockRepo.findById.mockResolvedValueOnce(parsedFile);

        await fileService.toggleFavorite(testUserId, testFileId);

        expect(mockRepo.update).toHaveBeenCalledWith(
          testUserId,
          testFileId,
          { isFavorite: true }
        );
      });
    });

    describe('moveFile', () => {
      it('returns void on success', async () => {
        // mockRepo.update resolves by default

        const result = await fileService.moveFile(testUserId, testFileId, 'new-folder-id');

        expect(result).toBeUndefined();
      });

      it('accepts null for moving to root', async () => {
        await fileService.moveFile(testUserId, testFileId, null);

        expect(mockRepo.update).toHaveBeenCalledWith(
          testUserId,
          testFileId,
          { parentFolderId: null }
        );
      });
    });

    describe('checkDuplicate', () => {
      it('returns { isDuplicate: boolean, existingFile?: ParsedFile }', async () => {
        // mockRepo.findByName returns null by default

        const result = await fileService.checkDuplicate(testUserId, 'test.pdf');

        expect(result).toHaveProperty('isDuplicate');
        expect(typeof result.isDuplicate).toBe('boolean');
        expect(result.isDuplicate).toBe(false);
      });

      it('returns isDuplicate: true with existingFile when duplicate found', async () => {
        const existingFile = FileFixture.createParsedFile({
          userId: testUserId,
          name: 'test.pdf',
        });
        mockRepo.findByName.mockResolvedValueOnce(existingFile);

        const result = await fileService.checkDuplicate(testUserId, 'test.pdf');

        expect(result.isDuplicate).toBe(true);
        expect(result.existingFile).toBeDefined();
      });

      it('calls repo.findByName with correct arguments', async () => {
        await fileService.checkDuplicate(testUserId, 'test.pdf', 'folder-123');

        expect(mockRepo.findByName).toHaveBeenCalledWith(
          testUserId,
          'test.pdf',
          'folder-123'
        );
      });

      it('passes null folderId for root-level check', async () => {
        await fileService.checkDuplicate(testUserId, 'test.pdf');

        expect(mockRepo.findByName).toHaveBeenCalledWith(
          testUserId,
          'test.pdf',
          null
        );
      });
    });

    describe('checkDuplicatesBatch', () => {
      it('returns array with results for each input', async () => {
        // mockRepo.findByName returns null by default for all calls

        const result = await fileService.checkDuplicatesBatch(testUserId, [
          { name: 'file1.pdf' },
          { name: 'file2.pdf', folderId: 'folder-1' },
          { name: 'file3.pdf', folderId: null },
        ]);

        expect(result).toHaveLength(3);
        expect(result[0]!.name).toBe('file1.pdf');
        expect(result[1]!.name).toBe('file2.pdf');
        expect(result[2]!.name).toBe('file3.pdf');
      });

      it('calls repo.findByName for each item', async () => {
        await fileService.checkDuplicatesBatch(testUserId, [
          { name: 'file1.pdf' },
          { name: 'file2.pdf', folderId: 'folder-1' },
        ]);

        expect(mockRepo.findByName).toHaveBeenCalledTimes(2);
        expect(mockRepo.findByName).toHaveBeenCalledWith(testUserId, 'file1.pdf', null);
        expect(mockRepo.findByName).toHaveBeenCalledWith(testUserId, 'file2.pdf', 'folder-1');
      });
    });
  });
});
