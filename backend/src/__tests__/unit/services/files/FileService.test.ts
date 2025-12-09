/**
 * FileService Unit Tests
 *
 * Comprehensive tests for FileService which provides CRUD operations for files
 * and folders with multi-tenant isolation.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: MessageService.test.ts (passing pattern)
 *
 * Coverage Target: >90% (FileService.ts is 504 lines)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, getFileService } from '@/services/files/FileService';
import { FileFixture } from '@/__tests__/fixtures/FileFixture';
import type { FileDbRecord } from '@/types/file.types';

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

// ===== MOCK crypto.randomUUID (vi.hoisted pattern) =====
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

describe('FileService', () => {
  let fileService: FileService;

  const testUserId = 'test-user-456';
  const testFileId = 'test-file-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidCounter = 0; // Reset UUID counter

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Reset singleton instance
    (FileService as any).instance = null;
    fileService = getFileService();
  });

  // ========== SUITE 1: GET FILES (6 TESTS) ==========
  describe('getFiles()', () => {
    it('should enforce multi-tenant isolation with user_id filter', async () => {
      const mockFiles = [FileFixture.createFileDbRecord({ user_id: testUserId })];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

      await fileService.getFiles({ userId: testUserId });

      // Verify WHERE clause includes user_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('should filter by folderId when provided', async () => {
      const folderId = 'folder-123';
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await fileService.getFiles({ userId: testUserId, folderId });

      // Verify WHERE clause includes parent_folder_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND parent_folder_id = @parent_folder_id'),
        expect.objectContaining({
          user_id: testUserId,
          parent_folder_id: folderId,
        })
      );
    });

    it('should filter favorites when favorites=true', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await fileService.getFiles({ userId: testUserId, favorites: true });

      // Verify WHERE clause includes is_favorite
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND is_favorite = 1'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('should sort by name when sortBy=name', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await fileService.getFiles({ userId: testUserId, sortBy: 'name' });

      // Verify ORDER BY clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY name ASC'),
        expect.anything()
      );
    });

    it('should sort by size when sortBy=size', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await fileService.getFiles({ userId: testUserId, sortBy: 'size' });

      // Verify ORDER BY clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY size_bytes DESC'),
        expect.anything()
      );
    });

    it('should sort by date (default) when sortBy=date', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await fileService.getFiles({ userId: testUserId, sortBy: 'date' });

      // Verify ORDER BY clause (default)
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.anything()
      );
    });

    it('should apply pagination with limit and offset', async () => {
      const mockFiles = FileFixture.createMultipleFiles(5, { user_id: testUserId });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

      const files = await fileService.getFiles({
        userId: testUserId,
        limit: 10,
        offset: 20,
      });

      // Verify pagination parameters
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET @offset ROWS'),
        expect.objectContaining({
          user_id: testUserId,
          offset: 20,
          limit: 10,
        })
      );

      // Verify parsed files returned
      expect(files).toHaveLength(5);
      expect(files[0]!.userId).toBe(testUserId);
    });

    it('should log error when query fails', async () => {
      const testError = new Error('Database error');
      mockExecuteQuery.mockRejectedValueOnce(testError);

      await expect(fileService.getFiles({ userId: testUserId })).rejects.toThrow(
        'Database error'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: testError, userId: testUserId }),
        'Failed to get files'
      );
    });
  });

  // ========== SUITE 12: SQL NULL COMPARISON SAFETY (5 TESTS) ==========
  describe('SQL NULL Comparison Safety', () => {
    /**
     * CRITICAL: Test SQL NULL handling pattern
     *
     * SQL Behavior:
     * - `column = NULL` → always FALSE (incorrect)
     * - `column IS NULL` → correct
     *
     * This suite verifies that FileService constructs queries correctly
     * when filtering by NULL parent_folder_id (root-level files).
     */

    describe('getFiles() with NULL parent_folder_id', () => {
      it('should use IS NULL when folderId is undefined (all files)', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId });

        // Verify query uses IS NULL operator (NOT "= @parent_folder_id")
        const queryCall = mockExecuteQuery.mock.calls[0];
        const query = queryCall?.[0] as string;
        const params = queryCall?.[1] as Record<string, unknown>;

        // Critical assertions:
        expect(query).toContain('AND parent_folder_id IS NULL');
        expect(query).not.toContain('parent_folder_id = @parent_folder_id');
        expect(params).not.toHaveProperty('parent_folder_id');
      });

      it('should use IS NULL when folderId is explicitly null (root files)', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId, folderId: null });

        const queryCall = mockExecuteQuery.mock.calls[0];
        const query = queryCall?.[0] as string;
        const params = queryCall?.[1] as Record<string, unknown>;

        expect(query).toContain('AND parent_folder_id IS NULL');
        expect(query).not.toContain('parent_folder_id = @parent_folder_id');
        expect(params).not.toHaveProperty('parent_folder_id');
      });

      it('should use parameterized query when folderId is UUID string', async () => {
        const folderId = 'folder-uuid-123';
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

        await fileService.getFiles({ userId: testUserId, folderId });

        const queryCall = mockExecuteQuery.mock.calls[0];
        const query = queryCall?.[0] as string;
        const params = queryCall?.[1] as Record<string, unknown>;

        expect(query).toContain('AND parent_folder_id = @parent_folder_id');
        expect(query).not.toContain('IS NULL');
        expect(params).toHaveProperty('parent_folder_id', folderId);
      });
    });

    describe('getFileCount() with NULL parent_folder_id', () => {
      it('should exclude parent_folder_id filter when folderId is undefined', async () => {
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 42 }] });

        const count = await fileService.getFileCount(testUserId);

        const queryCall = mockExecuteQuery.mock.calls[0];
        const query = queryCall?.[0] as string;
        const params = queryCall?.[1] as Record<string, unknown>;

        expect(query).not.toContain('parent_folder_id');
        expect(params).not.toHaveProperty('parent_folder_id');
        expect(count).toBe(42);
      });

      it('should use IS NULL when folderId is explicitly null', async () => {
        // BUG DETECTION: This test will FAIL with current implementation
        // Current code at line 471-474 uses `folderId !== undefined`,
        // which is TRUE when folderId=null, causing params.parent_folder_id = null
        mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 15 }] });

        const count = await fileService.getFileCount(testUserId, null);

        const queryCall = mockExecuteQuery.mock.calls[0];
        const query = queryCall?.[0] as string;
        const params = queryCall?.[1] as Record<string, unknown>;

        // These assertions will FAIL with current buggy implementation:
        expect(query).toContain('AND parent_folder_id IS NULL');
        expect(query).not.toContain('parent_folder_id = @parent_folder_id');
        expect(params).not.toHaveProperty('parent_folder_id');
        expect(count).toBe(15);
      });
    });
  });

  // ========== SUITE 2: GET FILE (3 TESTS) ==========
  describe('getFile()', () => {
    it('should return parsed file when found', async () => {
      const mockFile = FileFixture.createFileDbRecord({
        id: testFileId,
        user_id: testUserId,
      });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });

      const file = await fileService.getFile(testUserId, testFileId);

      expect(file).toBeDefined();
      expect(file?.id).toBe(testFileId);
      expect(file?.userId).toBe(testUserId);

      // Verify ownership validation
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
        })
      );
    });

    it('should return null when file not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const file = await fileService.getFile(testUserId, 'nonexistent');

      expect(file).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, fileId: 'nonexistent' }),
        'File not found'
      );
    });

    it('should enforce multi-tenant isolation with user_id', async () => {
      const differentUserId = 'other-user-789';
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const file = await fileService.getFile(differentUserId, testFileId);

      expect(file).toBeNull();

      // Verify user_id filter prevents cross-user access
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testFileId,
          user_id: differentUserId,
        })
      );
    });
  });

  // ========== SUITE 3: CREATE FOLDER (2 TESTS) ==========
  describe('createFolder()', () => {
    it('should create root folder when parentId not provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const folderId = await fileService.createFolder(testUserId, 'Documents');

      expect(folderId).toBe('mock-uuid-1');

      // Verify INSERT with folder-specific values
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          id: 'mock-uuid-1',
          user_id: testUserId,
          parent_folder_id: null, // Root folder
          name: 'Documents',
          mime_type: 'inode/directory',
          size_bytes: 0,
          blob_path: '',
          is_folder: true,
          is_favorite: false,
          processing_status: 'completed',
          embedding_status: 'completed',
        })
      );
    });

    it('should create subfolder when parentId provided', async () => {
      const parentFolderId = 'parent-folder-456';
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const folderId = await fileService.createFolder(
        testUserId,
        'Invoices',
        parentFolderId
      );

      expect(folderId).toBe('mock-uuid-1');

      // Verify parent_folder_id is set
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          parent_folder_id: parentFolderId,
          name: 'Invoices',
          is_folder: true,
        })
      );
    });
  });

  // ========== SUITE 4: CREATE FILE RECORD (2 TESTS) ==========
  describe('createFileRecord()', () => {
    it('should create file record with generated UUID', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512000,
        blobPath: 'users/test-user/files/invoice.pdf',
      });

      expect(fileId).toBe('mock-uuid-1');

      // Verify INSERT with file-specific values
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          id: 'mock-uuid-1',
          user_id: testUserId,
          parent_folder_id: null,
          name: 'invoice.pdf',
          mime_type: 'application/pdf',
          size_bytes: 512000,
          blob_path: 'users/test-user/files/invoice.pdf',
          is_folder: false,
          is_favorite: false,
          processing_status: 'pending',
          embedding_status: 'pending',
        })
      );
    });

    it('should create file record with parent folder', async () => {
      const parentFolderId = 'folder-789';
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024000,
        blobPath: 'users/test-user/files/report.pdf',
        parentFolderId,
      });

      expect(fileId).toBe('mock-uuid-1');

      // Verify parent_folder_id is set
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.objectContaining({
          parent_folder_id: parentFolderId,
        })
      );
    });
  });

  // ========== SUITE 5: UPDATE FILE (4 TESTS) ==========
  describe('updateFile()', () => {
    it('should update file name with dynamic SET clause', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.updateFile(testUserId, testFileId, {
        name: 'renamed-file.pdf',
      });

      // Verify dynamic SET clause (updated_at is always first)
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET updated_at = GETUTCDATE\(\).*name = @name/),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
          name: 'renamed-file.pdf',
        })
      );
    });

    it('should update parent folder with dynamic SET clause', async () => {
      const newParentId = 'new-parent-789';
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.updateFile(testUserId, testFileId, {
        parentFolderId: newParentId,
      });

      // Verify dynamic SET clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET.*parent_folder_id = @parent_folder_id/),
        expect.objectContaining({
          parent_folder_id: newParentId,
        })
      );
    });

    it('should update favorite status with dynamic SET clause', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.updateFile(testUserId, testFileId, {
        isFavorite: true,
      });

      // Verify dynamic SET clause
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/SET.*is_favorite = @is_favorite/),
        expect.objectContaining({
          is_favorite: true,
        })
      );
    });

    it('should throw error when file not found or unauthorized', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      await expect(
        fileService.updateFile(testUserId, testFileId, { name: 'new-name.pdf' })
      ).rejects.toThrow('File not found or unauthorized');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          fileId: testFileId,
        }),
        'Failed to update file'
      );
    });
  });

  // ========== SUITE 6: TOGGLE FAVORITE (2 TESTS) ==========
  describe('toggleFavorite()', () => {
    it('should toggle favorite from false to true', async () => {
      const mockFile = FileFixture.createFileDbRecord({
        id: testFileId,
        user_id: testUserId,
        is_favorite: false,
      });

      // First getFile() call
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });
      // Then UPDATE call
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const newStatus = await fileService.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(true);

      // Verify UPDATE with new status
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE files'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
          is_favorite: true, // Toggled
        })
      );
    });

    it('should toggle favorite from true to false', async () => {
      const mockFile = FileFixture.createFileDbRecord({
        id: testFileId,
        user_id: testUserId,
        is_favorite: true,
      });

      // First getFile() call
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockFile] });
      // Then UPDATE call
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const newStatus = await fileService.toggleFavorite(testUserId, testFileId);

      expect(newStatus).toBe(false);

      // Verify UPDATE with new status
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE files'),
        expect.objectContaining({
          is_favorite: false, // Toggled
        })
      );
    });
  });

  // ========== SUITE 7: MOVE FILE (2 TESTS) ==========
  describe('moveFile()', () => {
    it('should move file to different folder', async () => {
      const newParentId = 'folder-999';
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.moveFile(testUserId, testFileId, newParentId);

      // Verify UPDATE with new parent_folder_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE files'),
        expect.objectContaining({
          id: testFileId,
          user_id: testUserId,
          parent_folder_id: newParentId,
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId, newParentId }),
        'File moved'
      );
    });

    it('should move file to root (null parent)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await fileService.moveFile(testUserId, testFileId, null);

      // Verify UPDATE with null parent_folder_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE files'),
        expect.objectContaining({
          parent_folder_id: null, // Move to root
        })
      );
    });
  });

  // ========== SUITE 8: DELETE FILE (2 TESTS) ==========
  describe('deleteFile()', () => {
    it('should return blob_path for file deletion', async () => {
      const blobPath = 'users/test-user/files/invoice.pdf';

      // First SELECT to get blob_path
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ blob_path: blobPath, is_folder: false }],
      });
      // Then DELETE
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const returnedBlobPath = await fileService.deleteFile(testUserId, testFileId);

      expect(returnedBlobPath).toBe(blobPath);

      // Verify SELECT and DELETE queries
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT blob_path, is_folder'),
        expect.objectContaining({ id: testFileId, user_id: testUserId })
      );

      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('DELETE FROM files'),
        expect.objectContaining({ id: testFileId, user_id: testUserId })
      );
    });

    it('should return null blob_path for folder deletion', async () => {
      // First SELECT to get blob_path
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ blob_path: '', is_folder: true }],
      });
      // Then DELETE
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const returnedBlobPath = await fileService.deleteFile(testUserId, testFileId);

      expect(returnedBlobPath).toBeNull(); // No blob to clean up

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: testFileId, isFolder: true }),
        'File deleted from DB'
      );
    });
  });

  // ========== SUITE 9: GET FILE COUNT (3 TESTS) ==========
  describe('getFileCount()', () => {
    it('should get root file count when folderId not provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 42 }] });

      const count = await fileService.getFileCount(testUserId);

      expect(count).toBe(42);

      // Verify WHERE clause only includes user_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE user_id = @user_id\s+$/),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('should get folder file count when folderId provided', async () => {
      const folderId = 'folder-123';
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 15 }] });

      const count = await fileService.getFileCount(testUserId, folderId);

      expect(count).toBe(15);

      // Verify WHERE clause includes parent_folder_id
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND parent_folder_id = @parent_folder_id'),
        expect.objectContaining({
          user_id: testUserId,
          parent_folder_id: folderId,
        })
      );
    });

    it('should return 0 for empty folder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ count: 0 }] });

      const count = await fileService.getFileCount(testUserId, 'empty-folder');

      expect(count).toBe(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: testUserId, folderId: 'empty-folder', count: 0 }),
        'File count retrieved'
      );
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
    it('should log error and rethrow on createFolder failure', async () => {
      const testError = new Error('Database connection failed');
      mockExecuteQuery.mockRejectedValueOnce(testError);

      await expect(fileService.createFolder(testUserId, 'TestFolder')).rejects.toThrow(
        'Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: testError,
          userId: testUserId,
          name: 'TestFolder',
        }),
        'Failed to create folder'
      );
    });

    it('should log error and rethrow on getFileCount failure', async () => {
      const testError = new Error('Query timeout');
      mockExecuteQuery.mockRejectedValueOnce(testError);

      await expect(fileService.getFileCount(testUserId)).rejects.toThrow('Query timeout');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: testError,
          userId: testUserId,
        }),
        'Failed to get file count'
      );
    });
  });
});
