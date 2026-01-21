/**
 * FileDuplicateService Unit Tests
 *
 * Tests for duplicate file detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FileDuplicateService,
  getFileDuplicateService,
  __resetFileDuplicateService,
} from '@/services/files/operations/FileDuplicateService';
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

describe('FileDuplicateService', () => {
  let service: FileDuplicateService;

  const testUserId = 'TEST-USER-DUP-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    __resetFileDuplicateService();
    service = getFileDuplicateService();
  });

  // ========================================================================
  // SINGLETON PATTERN
  // ========================================================================
  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = getFileDuplicateService();
      const instance2 = getFileDuplicateService();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================================================
  // checkByName()
  // ========================================================================
  describe('checkByName()', () => {
    it('returns isDuplicate=false when no match', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await service.checkByName(testUserId, 'new-file.pdf');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingFile).toBeUndefined();
    });

    it('returns isDuplicate=true with existingFile when match found', async () => {
      const existingFile = FileFixture.createFileDbRecord({
        id: 'existing-123',
        user_id: testUserId,
        name: 'duplicate.pdf',
      });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [existingFile] });

      const result = await service.checkByName(testUserId, 'duplicate.pdf');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingFile?.id).toBe('existing-123');
    });

    it('checks in specific folder when folderId provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.checkByName(testUserId, 'file.pdf', 'folder-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('parent_folder_id = @parent_folder_id'),
        expect.objectContaining({
          user_id: testUserId,
          name: 'file.pdf',
          parent_folder_id: 'folder-123',
        })
      );
    });

    it('uses IS NULL for root folder', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.checkByName(testUserId, 'file.pdf', null);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('parent_folder_id IS NULL'),
        expect.anything()
      );
    });

    it('only checks files (not folders)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.checkByName(testUserId, 'Documents');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_folder = 0'),
        expect.anything()
      );
    });

    it('enforces multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.checkByName(testUserId, 'file.pdf');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });
  });

  // ========================================================================
  // checkByNameBatch()
  // ========================================================================
  describe('checkByNameBatch()', () => {
    it('checks multiple files', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });
      const existingFile = FileFixture.createFileDbRecord({
        id: 'dup-123',
        user_id: testUserId,
        name: 'existing.pdf',
      });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [existingFile] });

      const results = await service.checkByNameBatch(testUserId, [
        { name: 'new.pdf' },
        { name: 'existing.pdf' },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe('new.pdf');
      expect(results[0]!.isDuplicate).toBe(false);
      expect(results[1]!.name).toBe('existing.pdf');
      expect(results[1]!.isDuplicate).toBe(true);
    });

    it('handles mixed folderId values', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] });

      await service.checkByNameBatch(testUserId, [
        { name: 'root.pdf' },
        { name: 'folder.pdf', folderId: 'f1' },
        { name: 'root2.pdf', folderId: null },
      ]);

      expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
    });

    it('returns empty array for empty input', async () => {
      const results = await service.checkByNameBatch(testUserId, []);

      expect(results).toEqual([]);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // findByContentHash()
  // ========================================================================
  describe('findByContentHash()', () => {
    it('returns matching files', async () => {
      const mockFiles = [
        FileFixture.createFileDbRecord({ user_id: testUserId, content_hash: 'hash-123' }),
        FileFixture.createFileDbRecord({ user_id: testUserId, content_hash: 'hash-123' }),
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockFiles });

      const results = await service.findByContentHash(testUserId, 'hash-123');

      expect(results).toHaveLength(2);
    });

    it('returns empty array when no matches', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const results = await service.findByContentHash(testUserId, 'nonexistent-hash');

      expect(results).toEqual([]);
    });

    it('enforces multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.findByContentHash(testUserId, 'hash-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('only searches files (not folders)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.findByContentHash(testUserId, 'hash-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_folder = 0'),
        expect.anything()
      );
    });
  });

  // ========================================================================
  // checkByHashBatch()
  // ========================================================================
  describe('checkByHashBatch()', () => {
    it('returns correct structure', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });
      const existingFile = FileFixture.createFileDbRecord({
        id: 'existing-456',
        user_id: testUserId,
        content_hash: 'hash-dup',
      });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [existingFile] });

      const results = await service.checkByHashBatch(testUserId, [
        { tempId: 'temp-1', contentHash: 'hash-new', fileName: 'new.pdf' },
        { tempId: 'temp-2', contentHash: 'hash-dup', fileName: 'dup.pdf' },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        tempId: 'temp-1',
        isDuplicate: false,
      });
      expect(results[1]).toMatchObject({
        tempId: 'temp-2',
        isDuplicate: true,
      });
      expect(results[1]!.existingFile?.id).toBe('existing-456');
    });

    it('returns first match when multiple exist', async () => {
      const files = [
        FileFixture.createFileDbRecord({ id: 'first', user_id: testUserId }),
        FileFixture.createFileDbRecord({ id: 'second', user_id: testUserId }),
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: files });

      const results = await service.checkByHashBatch(testUserId, [
        { tempId: 't1', contentHash: 'same-hash', fileName: 'file.pdf' },
      ]);

      expect(results[0]!.existingFile?.id).toBe('first');
    });
  });

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================
  describe('Error Handling', () => {
    it('throws and logs on database error', async () => {
      const dbError = new Error('Connection timeout');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(service.checkByName(testUserId, 'file.pdf')).rejects.toThrow('Connection timeout');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
