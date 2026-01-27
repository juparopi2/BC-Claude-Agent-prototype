/**
 * FileRepository Unit Tests
 *
 * Tests for database operations on files.
 * Uses mocked database to verify correct query execution and result handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileRepository,
  getFileRepository,
  __resetFileRepository,
} from '@/services/files/repository/FileRepository';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';

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

// ===== MOCK crypto.randomUUID (vi.hoisted pattern) =====
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

describe('FileRepository', () => {
  let repository: FileRepository;

  const testUserId = 'TEST-USER-REPO-123';
  const testFileId = 'TEST-FILE-REPO-456';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidCounter = 0;

    // Re-setup mock implementations
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Reset singleton
    __resetFileRepository();
    repository = getFileRepository();
  });

  // ========================================================================
  // SINGLETON PATTERN
  // ========================================================================
  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = getFileRepository();
      const instance2 = getFileRepository();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================================================
  // findById()
  // ========================================================================
  describe('findById()', () => {
    it('returns ParsedFile when file exists and user owns it', async () => {
      const mockFile = FileFixture.createFileDbRecord({
        id: testFileId,
        user_id: testUserId,
        name: 'test-doc.pdf',
      });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });

      const result = await repository.findById(testUserId, testFileId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(testFileId);
      expect(result?.userId).toBe(testUserId);
      expect(result?.name).toBe('test-doc.pdf');
    });

    it('returns null when file not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await repository.findById(testUserId, 'nonexistent-id');

      expect(result).toBeNull();
    });

    it('includes user_id in WHERE clause for multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await repository.findById(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
          id: testFileId,
        })
      );
    });

    it('logs info on success', async () => {
      const mockFile = FileFixture.createFileDbRecord({ id: testFileId, user_id: testUserId });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });

      await repository.findById(testUserId, testFileId);

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('logs and throws on database error', async () => {
      const dbError = new Error('Database connection failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(repository.findById(testUserId, testFileId)).rejects.toThrow(
        'Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // findMany()
  // ========================================================================
  describe('findMany()', () => {
    it('returns array of ParsedFile', async () => {
      const mockFiles = FileFixture.createMultipleFiles(3, { user_id: testUserId });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

      const result = await repository.findMany({ userId: testUserId });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      result.forEach((file) => {
        expect(file.userId).toBe(testUserId);
      });
    });

    it('returns empty array when no files', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await repository.findMany({ userId: testUserId });

      expect(result).toEqual([]);
    });

    it('passes all options to query builder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await repository.findMany({
        userId: testUserId,
        folderId: 'folder-123',
        sortBy: 'name',
        favoritesFirst: true,
        limit: 25,
        offset: 10,
      });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
          parent_folder_id: 'folder-123',
          limit: 25,
          offset: 10,
        })
      );
    });
  });

  // ========================================================================
  // count()
  // ========================================================================
  describe('count()', () => {
    it('returns file count for root folder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 42 }] });

      const result = await repository.count(testUserId);

      expect(result).toBe(42);
    });

    it('returns file count for specific folder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 10 }] });

      const result = await repository.count(testUserId, 'folder-123');

      expect(result).toBe(10);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('parent_folder_id = @parent_folder_id'),
        expect.objectContaining({
          parent_folder_id: 'folder-123',
        })
      );
    });

    it('uses IS NULL for root folder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 5 }] });

      await repository.count(testUserId, null);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('parent_folder_id IS NULL'),
        expect.any(Object)
      );
    });

    it('throws when count result is empty', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await expect(repository.count(testUserId)).rejects.toThrow('Failed to get file count');
    });
  });

  // ========================================================================
  // create()
  // ========================================================================
  describe('create()', () => {
    it('returns UPPERCASE UUID fileId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const fileId = await repository.create({
        userId: testUserId,
        name: 'new-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        blobPath: 'users/test/files/new-file.pdf',
      });

      expect(fileId).toBe(fileId.toUpperCase());
    });

    it('sets processing_status to pending', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.create({
        userId: testUserId,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        blobPath: 'path/to/blob',
      });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          processing_status: 'pending',
          embedding_status: 'pending',
          is_folder: false,
        })
      );
    });

    it('handles contentHash parameter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.create({
        userId: testUserId,
        name: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        blobPath: 'path/to/blob',
        contentHash: 'abc123hash',
      });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content_hash: 'abc123hash',
        })
      );
    });

    it('rejects blob paths as file names', async () => {
      await expect(
        repository.create({
          userId: testUserId,
          name: '1234567890123-somefile.pdf', // Looks like blob path
          mimeType: 'application/pdf',
          sizeBytes: 512,
          blobPath: 'path/to/blob',
        })
      ).rejects.toThrow('File name cannot be a blob path');
    });

    it('rejects file names containing users/', async () => {
      await expect(
        repository.create({
          userId: testUserId,
          name: 'users/test/files/file.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 512,
          blobPath: 'path/to/blob',
        })
      ).rejects.toThrow('File name cannot be a blob path');
    });
  });

  // ========================================================================
  // createFolder()
  // ========================================================================
  describe('createFolder()', () => {
    it('creates folder with is_folder=true', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.createFolder(testUserId, 'NewFolder');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          is_folder: true,
          mime_type: 'inode/directory',
          size_bytes: 0,
          blob_path: '',
        })
      );
    });

    it('sets folder status to completed', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.createFolder(testUserId, 'TestFolder');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          processing_status: 'completed',
          embedding_status: 'completed',
        })
      );
    });

    it('handles optional parentId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.createFolder(testUserId, 'SubFolder', 'parent-folder-id');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          parent_folder_id: 'parent-folder-id',
        })
      );
    });

    it('returns UPPERCASE UUID', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const folderId = await repository.createFolder(testUserId, 'TestFolder');

      expect(folderId).toBe(folderId.toUpperCase());
    });
  });

  // ========================================================================
  // findIdsByOwner()
  // ========================================================================
  describe('findIdsByOwner()', () => {
    it('returns array of owned file IDs', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'file-1' }, { id: 'file-2' }],
      });

      const result = await repository.findIdsByOwner(testUserId, ['file-1', 'file-2', 'file-3']);

      expect(result).toEqual(['file-1', 'file-2']);
    });

    it('returns empty array for empty input', async () => {
      const result = await repository.findIdsByOwner(testUserId, []);

      expect(result).toEqual([]);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('includes user_id in WHERE clause', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ id: 'file-1' }] });

      await repository.findIdsByOwner(testUserId, ['file-1']);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('uses parameterized IN clause', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await repository.findIdsByOwner(testUserId, ['id-1', 'id-2']);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/id IN \(@id0, @id1\)/),
        expect.objectContaining({
          id0: 'id-1',
          id1: 'id-2',
        })
      );
    });
  });

  // ========================================================================
  // update()
  // ========================================================================
  describe('update()', () => {
    it('returns void on success', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const result = await repository.update(testUserId, testFileId, { name: 'renamed.pdf' });

      expect(result).toBeUndefined();
    });

    it('builds dynamic SET clause for name', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.update(testUserId, testFileId, { name: 'new-name.pdf' });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET.*name = @name/),
        expect.objectContaining({ name: 'new-name.pdf' })
      );
    });

    it('builds dynamic SET clause for parentFolderId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.update(testUserId, testFileId, { parentFolderId: 'new-parent' });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET.*parent_folder_id = @parent_folder_id/),
        expect.objectContaining({ parent_folder_id: 'new-parent' })
      );
    });

    it('builds dynamic SET clause for isFavorite', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.update(testUserId, testFileId, { isFavorite: true });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET.*is_favorite = @is_favorite/),
        expect.objectContaining({ is_favorite: true })
      );
    });

    it('always includes updated_at in SET', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.update(testUserId, testFileId, { name: 'test.pdf' });

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('updated_at = GETUTCDATE()'),
        expect.any(Object)
      );
    });

    it('throws error when file not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      await expect(
        repository.update(testUserId, testFileId, { name: 'test.pdf' })
      ).rejects.toThrow('File not found or unauthorized');
    });

    it('no-op when no updates provided', async () => {
      await repository.update(testUserId, testFileId, {});

      // Should not execute query when no fields to update
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        'No updates to apply'
      );
    });
  });

  // ========================================================================
  // updateProcessingStatus()
  // ========================================================================
  describe('updateProcessingStatus()', () => {
    it('updates processing status', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.updateProcessingStatus(testUserId, testFileId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('processing_status = @status'),
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    it('optionally updates extracted_text', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.updateProcessingStatus(
        testUserId,
        testFileId,
        'completed',
        'Extracted content here'
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('extracted_text = @extracted_text'),
        expect.objectContaining({
          extracted_text: 'Extracted content here',
        })
      );
    });

    it('filters out files marked for deletion', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.updateProcessingStatus(testUserId, testFileId, 'completed');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deletion_status IS NULL'),
        expect.any(Object)
      );
    });

    it('returns gracefully when file not found or deleted', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Should not throw - idempotent behavior for soft delete workflow
      await repository.updateProcessingStatus(testUserId, testFileId, 'completed');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: testFileId }),
        expect.stringContaining('Processing status update skipped')
      );
    });
  });

  // ========================================================================
  // delete()
  // ========================================================================
  describe('delete()', () => {
    it('deletes file by id and userId', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.delete(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM files'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('includes user_id in WHERE for multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await repository.delete(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.any(Object)
      );
    });
  });

  // ========================================================================
  // getFileMetadata()
  // ========================================================================
  describe('getFileMetadata()', () => {
    it('returns blob_path, is_folder, name, mime_type, size_bytes', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          blob_path: 'path/to/file.pdf',
          is_folder: false,
          name: 'file.pdf',
          mime_type: 'application/pdf',
          size_bytes: 2048,
        }],
      });

      const result = await repository.getFileMetadata(testUserId, testFileId);

      expect(result).toEqual({
        blobPath: 'path/to/file.pdf',
        isFolder: false,
        name: 'file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });
    });

    it('returns null when file not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await repository.getFileMetadata(testUserId, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // getChildrenIds()
  // ========================================================================
  describe('getChildrenIds()', () => {
    it('returns array of child file IDs', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'child-1' }, { id: 'child-2' }],
      });

      const result = await repository.getChildrenIds(testUserId, testFileId);

      expect(result).toEqual(['child-1', 'child-2']);
    });

    it('returns empty array when no children', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await repository.getChildrenIds(testUserId, testFileId);

      expect(result).toEqual([]);
    });

    it('includes user_id for multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await repository.getChildrenIds(testUserId, testFileId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
          id: testFileId,
        })
      );
    });
  });
});
