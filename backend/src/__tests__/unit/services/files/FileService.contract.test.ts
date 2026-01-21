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
 * 4. SQL NULL handling (prevents bugs)
 *
 * DO NOT modify these tests during refactoring. If a test fails,
 * the refactored code has broken backward compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService, __resetFileService } from '@/services/files/FileService';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';
import type { ParsedFile } from '@/types/file.types';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
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

// ===== MOCK crypto.randomUUID (vi.hoisted pattern) =====
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

describe('FileService Contract Tests', () => {
  let fileService: FileService;

  const testUserId = 'TEST-USER-CONTRACT-456';
  const testFileId = 'TEST-FILE-CONTRACT-123';
  const differentUserId = 'OTHER-USER-CONTRACT-789';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUuidCounter = 0;

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
    mockAuditService.logDeletionRequest.mockResolvedValue('audit-id-123');
    mockAuditService.updateStorageStatus.mockResolvedValue(undefined);
    mockAuditService.markCompleted.mockResolvedValue(undefined);
    mockVectorSearchService.deleteChunksForFile.mockResolvedValue(undefined);

    // Reset singleton instance
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
        const mockFile = FileFixture.createFileDbRecord({
          id: testFileId,
          user_id: testUserId,
          name: 'contract-test.pdf',
        });
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });

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
        expect(result).toHaveProperty('processingStatus');
        expect(result).toHaveProperty('embeddingStatus');
        expect(result).toHaveProperty('createdAt');
        expect(result).toHaveProperty('updatedAt');
      });

      it('returns null when file not found', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        const result = await fileService.getFile(testUserId, 'nonexistent-id');

        expect(result).toBeNull();
      });
    });

    describe('getFiles(options)', () => {
      it('returns ParsedFile[] array', async () => {
        const mockFiles = FileFixture.createMultipleFiles(3, { user_id: testUserId });
        mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

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
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        const result = await fileService.getFiles({ userId: testUserId });

        expect(result).toEqual([]);
      });

      it('accepts all option parameters', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        // This should not throw - all options are valid
        await fileService.getFiles({
          userId: testUserId,
          folderId: 'folder-123',
          sortBy: 'name',
          favoritesFirst: true,
          limit: 50,
          offset: 10,
        });

        expect(mockExecuteQuery).toHaveBeenCalled();
      });
    });

    describe('createFileRecord(options)', () => {
      it('returns string fileId', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

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
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

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
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [{
            blob_path: blobPath,
            is_folder: false,
            name: 'test.pdf',
            mime_type: 'application/pdf',
            size_bytes: 1024,
          }],
        });
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const result = await fileService.deleteFile(testUserId, testFileId);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toContain(blobPath);
      });

      it('returns empty array when file not found (idempotent)', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        const result = await fileService.deleteFile(testUserId, 'nonexistent-id');

        expect(result).toEqual([]);
      });

      it('accepts optional options parameter', async () => {
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [{
            blob_path: 'test.pdf',
            is_folder: false,
            name: 'test.pdf',
            mime_type: 'application/pdf',
            size_bytes: 100,
          }],
        });
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        // This should not throw
        await fileService.deleteFile(testUserId, testFileId, {
          skipAudit: true,
          deletionReason: 'gdpr_erasure',
        });

        expect(mockExecuteQuery).toHaveBeenCalled();
      });
    });

    describe('updateFile(userId, fileId, updates)', () => {
      it('returns void on success', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const result = await fileService.updateFile(testUserId, testFileId, {
          name: 'renamed.pdf',
        });

        expect(result).toBeUndefined();
      });

      it('throws error when file not found', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

        await expect(
          fileService.updateFile(testUserId, testFileId, { name: 'new-name.pdf' })
        ).rejects.toThrow('File not found or unauthorized');
      });
    });

    describe('updateProcessingStatus(userId, fileId, status, text?)', () => {
      it('returns void on success', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const result = await fileService.updateProcessingStatus(
          testUserId,
          testFileId,
          'completed',
          'Extracted text content'
        );

        expect(result).toBeUndefined();
      });

      it('accepts optional extractedText parameter', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        // Without extractedText
        await fileService.updateProcessingStatus(testUserId, testFileId, 'processing');

        expect(mockExecuteQuery).toHaveBeenCalled();
      });
    });

    describe('verifyOwnership(userId, fileIds)', () => {
      it('returns string[] of owned fileIds', async () => {
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [{ id: 'file-1' }, { id: 'file-2' }],
        });

        const result = await fileService.verifyOwnership(testUserId, ['file-1', 'file-2', 'file-3']);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual(['file-1', 'file-2']);
      });

      it('returns empty array for empty input', async () => {
        const result = await fileService.verifyOwnership(testUserId, []);

        expect(result).toEqual([]);
        expect(mockExecuteQuery).not.toHaveBeenCalled();
      });
    });

    describe('getFileCount(userId, folderId?, options?)', () => {
      it('returns number', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 42 }] });

        const result = await fileService.getFileCount(testUserId);

        expect(typeof result).toBe('number');
        expect(result).toBe(42);
      });

      it('accepts optional folderId and options', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 10 }] });

        const result = await fileService.getFileCount(testUserId, 'folder-123', {
          favoritesFirst: true,
        });

        expect(result).toBe(10);
      });
    });

    describe('checkDuplicatesByHash(userId, items)', () => {
      it('returns correct structure with tempId, isDuplicate, existingFile?', async () => {
        // First item - no duplicate
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });
        // Second item - duplicate found
        const existingFile = FileFixture.createFileDbRecord({
          id: 'existing-123',
          user_id: testUserId,
          content_hash: 'abc123hash',
        });
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [existingFile] });

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
          FileFixture.createFileDbRecord({
            user_id: testUserId,
            content_hash: 'same-hash-123',
          }),
          FileFixture.createFileDbRecord({
            user_id: testUserId,
            content_hash: 'same-hash-123',
          }),
        ];
        mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

        const result = await fileService.findByContentHash(testUserId, 'same-hash-123');

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
      });

      it('returns empty array when no matches', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

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
      // User A owns a file
      const userAFile = FileFixture.createFileDbRecord({
        id: testFileId,
        user_id: testUserId,
      });

      // When User B tries to access User A's file, query returns empty
      // (because WHERE clause includes user_id)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await fileService.getFile(differentUserId, testFileId);

      // CRITICAL: Must return null, not the file
      expect(result).toBeNull();

      // Verify query includes user_id filter
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: differentUserId,
        })
      );
    });

    it('deleteFile NEVER deletes file for wrong userId', async () => {
      // File exists but owned by different user - query returns empty
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await fileService.deleteFile(differentUserId, testFileId);

      // Should return empty array (idempotent behavior)
      expect(result).toEqual([]);

      // Verify query includes user_id filter
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: differentUserId,
        })
      );
    });

    it('getFiles NEVER includes other users files', async () => {
      // Only return files matching the requesting user
      const userFiles = FileFixture.createMultipleFiles(2, { user_id: testUserId });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: userFiles });

      const result = await fileService.getFiles({ userId: testUserId });

      // Verify query includes user_id filter
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );

      // All returned files should belong to requesting user
      result.forEach((file: ParsedFile) => {
        expect(file.userId).toBe(testUserId);
      });
    });

    it('updateFile NEVER updates file for wrong userId', async () => {
      // Query returns 0 rows affected (file not found for this user)
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      await expect(
        fileService.updateFile(differentUserId, testFileId, { name: 'hacked.pdf' })
      ).rejects.toThrow('File not found or unauthorized');

      // Verify query includes user_id filter
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: differentUserId,
        })
      );
    });

    it('verifyOwnership returns only files owned by user', async () => {
      // User owns file-1 but not file-2
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'file-1' }],
      });

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
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: 'test.pdf',
          is_folder: false,
          name: 'test.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1024,
        }],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

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

      // Parent folder query
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: '',
          is_folder: true,
          name: 'TestFolder',
          mime_type: 'inode/directory',
          size_bytes: 0,
        }],
      });

      // Children query
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: childFileId }],
      });

      // Child file query (recursive)
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: childBlobPath,
          is_folder: false,
          name: 'child.pdf',
          mime_type: 'application/pdf',
          size_bytes: 500,
        }],
      });

      // Child delete
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Parent delete
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const blobPaths = await fileService.deleteFile(testUserId, testFileId);

      // Should include child blob paths
      expect(blobPaths).toContain(childBlobPath);
    });

    it('deleteFile cleans up AI Search embeddings', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: 'test.pdf',
          is_folder: false,
          name: 'test.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1024,
        }],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.deleteFile(testUserId, testFileId);

      expect(mockVectorSearchService.deleteChunksForFile).toHaveBeenCalledWith(
        testFileId,
        testUserId
      );
    });

    it('deleteFile returns blob paths for cleanup', async () => {
      const blobPath = 'users/test-user/files/important.pdf';
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: blobPath,
          is_folder: false,
          name: 'important.pdf',
          mime_type: 'application/pdf',
          size_bytes: 5000,
        }],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const result = await fileService.deleteFile(testUserId, testFileId);

      expect(result).toEqual([blobPath]);
    });
  });

  // ========================================================================
  // SQL NULL HANDLING (prevents bugs)
  // These tests verify correct IS NULL vs = NULL handling
  // ========================================================================
  describe('SQL NULL Handling', () => {
    describe('getFiles uses IS NULL for root folder', () => {
      it('when folderId is undefined', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId });

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;
        const params = mockExecuteQuery.mock.calls[0]?.[1] as Record<string, unknown>;

        // CRITICAL: Must use IS NULL, not = @parent_folder_id with NULL value
        expect(query).toContain('parent_folder_id IS NULL');
        expect(query).not.toMatch(/parent_folder_id\s*=\s*@parent_folder_id/);
        expect(params).not.toHaveProperty('parent_folder_id');
      });

      it('when folderId is explicitly null', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId, folderId: null });

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;
        const params = mockExecuteQuery.mock.calls[0]?.[1] as Record<string, unknown>;

        expect(query).toContain('parent_folder_id IS NULL');
        expect(params).not.toHaveProperty('parent_folder_id');
      });

      it('uses parameterized query when folderId is provided', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId, folderId: 'folder-123' });

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;
        const params = mockExecuteQuery.mock.calls[0]?.[1] as Record<string, unknown>;

        expect(query).toContain('parent_folder_id = @parent_folder_id');
        expect(params).toHaveProperty('parent_folder_id', 'folder-123');
      });
    });

    describe('getFileCount uses IS NULL for root folder', () => {
      it('when folderId is undefined', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 5 }] });

        await fileService.getFileCount(testUserId);

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;
        const params = mockExecuteQuery.mock.calls[0]?.[1] as Record<string, unknown>;

        expect(query).toContain('parent_folder_id IS NULL');
        expect(params).not.toHaveProperty('parent_folder_id');
      });

      it('when folderId is explicitly null', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 3 }] });

        await fileService.getFileCount(testUserId, null);

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;
        const params = mockExecuteQuery.mock.calls[0]?.[1] as Record<string, unknown>;

        expect(query).toContain('parent_folder_id IS NULL');
        expect(params).not.toHaveProperty('parent_folder_id');
      });
    });

    describe('checkDuplicate uses IS NULL for root folder', () => {
      it('when folderId is undefined', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.checkDuplicate(testUserId, 'test.pdf');

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;

        expect(query).toContain('parent_folder_id IS NULL');
      });

      it('when folderId is explicitly null', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.checkDuplicate(testUserId, 'test.pdf', null);

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;

        expect(query).toContain('parent_folder_id IS NULL');
      });
    });
  });

  // ========================================================================
  // ADDITIONAL CONTRACT TESTS
  // These verify other critical behaviors
  // ========================================================================
  describe('Additional Contracts', () => {
    describe('createFolder', () => {
      it('creates folder with correct attributes', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const folderId = await fileService.createFolder(testUserId, 'NewFolder');

        expect(mockExecuteQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO files'),
          expect.objectContaining({
            user_id: testUserId,
            name: 'NewFolder',
            mime_type: 'inode/directory',
            size_bytes: 0,
            blob_path: '',
            is_folder: true,
            processing_status: 'completed',
            embedding_status: 'completed',
          })
        );

        expect(typeof folderId).toBe('string');
      });
    });

    describe('toggleFavorite', () => {
      it('returns new boolean status', async () => {
        const mockFile = FileFixture.createFileDbRecord({
          id: testFileId,
          user_id: testUserId,
          is_favorite: false,
        });
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const result = await fileService.toggleFavorite(testUserId, testFileId);

        expect(typeof result).toBe('boolean');
        expect(result).toBe(true); // toggled from false to true
      });
    });

    describe('moveFile', () => {
      it('returns void on success', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        const result = await fileService.moveFile(testUserId, testFileId, 'new-folder-id');

        expect(result).toBeUndefined();
      });

      it('accepts null for moving to root', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        await fileService.moveFile(testUserId, testFileId, null);

        expect(mockExecuteQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE files'),
          expect.objectContaining({
            parent_folder_id: null,
          })
        );
      });
    });

    describe('checkDuplicate', () => {
      it('returns { isDuplicate: boolean, existingFile?: ParsedFile }', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        const result = await fileService.checkDuplicate(testUserId, 'test.pdf');

        expect(result).toHaveProperty('isDuplicate');
        expect(typeof result.isDuplicate).toBe('boolean');
      });

      it('only checks files, not folders', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.checkDuplicate(testUserId, 'Documents');

        const query = mockExecuteQuery.mock.calls[0]?.[0] as string;

        expect(query).toContain('is_folder = 0');
      });
    });

    describe('checkDuplicatesBatch', () => {
      it('returns array with results for each input', async () => {
        mockExecuteQuery.mockResolvedValue({ recordset: [] });

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
    });
  });
});
