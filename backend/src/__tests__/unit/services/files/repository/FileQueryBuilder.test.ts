/**
 * FileQueryBuilder Unit Tests
 *
 * Tests for SQL query construction with proper NULL handling and parameterization.
 * These tests verify the query builder produces correct SQL without executing queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FileQueryBuilder,
  getFileQueryBuilder,
  __resetFileQueryBuilder,
} from '@/services/files/repository/FileQueryBuilder';
import type { FileSortBy } from '@/types/file.types';

describe('FileQueryBuilder', () => {
  let queryBuilder: FileQueryBuilder;

  beforeEach(() => {
    __resetFileQueryBuilder();
    queryBuilder = getFileQueryBuilder();
  });

  // ========================================================================
  // SINGLETON PATTERN
  // ========================================================================
  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = getFileQueryBuilder();
      const instance2 = getFileQueryBuilder();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================================================
  // buildGetFilesQuery()
  // ========================================================================
  describe('buildGetFilesQuery()', () => {
    describe('WHERE clause - user_id filter', () => {
      it('always includes user_id in WHERE clause', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user-123',
        });

        expect(result.query).toContain('WHERE user_id = @user_id');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params.user_id).toBe('test-user-123');
      });
    });

    describe('WHERE clause - IS NULL handling', () => {
      it('uses IS NULL when folderId is undefined', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          // folderId not provided
        });

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.query).not.toContain('parent_folder_id = @parent_folder_id');
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses IS NULL when folderId is explicitly null', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          folderId: null,
        });

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses parameterized query when folderId is provided', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          folderId: 'folder-123',
        });

        expect(result.query).toContain('parent_folder_id = @parent_folder_id');
        expect(result.query).not.toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params.parent_folder_id).toBe('folder-123');
      });
    });

    describe('WHERE clause - favoritesFirst mode', () => {
      it('at root with favoritesFirst: includes favorites OR root items', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          favoritesFirst: true,
          // folderId undefined = root
        });

        expect(result.query).toContain('(is_favorite = 1 OR parent_folder_id IS NULL)');
      });

      it('in folder with favoritesFirst: filters by folder only', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          folderId: 'folder-123',
          favoritesFirst: true,
        });

        expect(result.query).toContain('parent_folder_id = @parent_folder_id');
        expect(result.params.parent_folder_id).toBe('folder-123');
      });
    });

    describe('ORDER BY clause - sorting', () => {
      it('sorts by name ASC when sortBy=name', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          sortBy: 'name' as FileSortBy,
        });

        expect(result.query).toMatch(/ORDER BY.*is_folder DESC.*name ASC/);
      });

      it('sorts by size DESC when sortBy=size', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          sortBy: 'size' as FileSortBy,
        });

        expect(result.query).toMatch(/ORDER BY.*is_folder DESC.*size_bytes DESC/);
      });

      it('sorts by date DESC when sortBy=date (default)', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          sortBy: 'date' as FileSortBy,
        });

        expect(result.query).toMatch(/ORDER BY.*is_folder DESC.*created_at DESC/);
      });

      it('defaults to date sorting when sortBy not provided', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
        });

        expect(result.query).toContain('created_at DESC');
      });

      it('includes favorites sorting when favoritesFirst=true', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          favoritesFirst: true,
        });

        expect(result.query).toMatch(/ORDER BY.*is_favorite DESC.*is_folder DESC/);
      });

      it('always sorts folders before files', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
        });

        expect(result.query).toContain('is_folder DESC');
      });
    });

    describe('PAGINATION', () => {
      it('includes OFFSET and FETCH clauses', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
          limit: 50,
          offset: 20,
        });

        expect(result.query).toContain('OFFSET @offset ROWS');
        expect(result.query).toContain('FETCH NEXT @limit ROWS ONLY');
        expect(result.params.offset).toBe(20);
        expect(result.params.limit).toBe(50);
      });

      it('uses default limit=50 and offset=0 when not provided', () => {
        const result = queryBuilder.buildGetFilesQuery({
          userId: 'test-user',
        });

        expect(result.params.limit).toBe(50);
        expect(result.params.offset).toBe(0);
      });
    });
  });

  // ========================================================================
  // buildGetFileCountQuery()
  // ========================================================================
  describe('buildGetFileCountQuery()', () => {
    it('includes user_id filter', () => {
      const result = queryBuilder.buildGetFileCountQuery('test-user');

      expect(result.query).toContain('WHERE user_id = @user_id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.user_id).toBe('test-user');
    });

    it('selects COUNT(*)', () => {
      const result = queryBuilder.buildGetFileCountQuery('test-user');

      expect(result.query).toContain('SELECT COUNT(*) as count');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
    });

    describe('IS NULL handling', () => {
      it('uses IS NULL when folderId is undefined', () => {
        const result = queryBuilder.buildGetFileCountQuery('test-user');

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses IS NULL when folderId is explicitly null', () => {
        const result = queryBuilder.buildGetFileCountQuery('test-user', null);

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses parameterized query when folderId provided', () => {
        const result = queryBuilder.buildGetFileCountQuery('test-user', 'folder-123');

        expect(result.query).toContain('parent_folder_id = @parent_folder_id');
        expect(result.query).not.toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params.parent_folder_id).toBe('folder-123');
      });
    });

    describe('favoritesFirst option', () => {
      it('at root: counts favorites from any folder + root items', () => {
        const result = queryBuilder.buildGetFileCountQuery('test-user', undefined, {
          favoritesFirst: true,
        });

        expect(result.query).toContain('(is_favorite = 1 OR parent_folder_id IS NULL)');
      });

      it('in folder: counts all items in folder', () => {
        const result = queryBuilder.buildGetFileCountQuery('test-user', 'folder-123', {
          favoritesFirst: true,
        });

        expect(result.query).toContain('parent_folder_id = @parent_folder_id');
        expect(result.params.parent_folder_id).toBe('folder-123');
      });
    });
  });

  // ========================================================================
  // buildCheckDuplicateQuery()
  // ========================================================================
  describe('buildCheckDuplicateQuery()', () => {
    it('includes user_id filter', () => {
      const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'test.pdf');

      expect(result.query).toContain('WHERE user_id = @user_id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.user_id).toBe('test-user');
    });

    it('includes fileName filter', () => {
      const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'invoice.pdf');

      expect(result.query).toContain('name = @name');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.name).toBe('invoice.pdf');
    });

    it('only checks files (is_folder = 0)', () => {
      const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'test.pdf');

      expect(result.query).toContain('is_folder = 0');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
    });

    describe('IS NULL handling', () => {
      it('uses IS NULL when folderId is undefined', () => {
        const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'test.pdf');

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses IS NULL when folderId is explicitly null', () => {
        const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'test.pdf', null);

        expect(result.query).toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params).not.toHaveProperty('parent_folder_id');
      });

      it('uses parameterized query when folderId provided', () => {
        const result = queryBuilder.buildCheckDuplicateQuery('test-user', 'test.pdf', 'folder-123');

        expect(result.query).toContain('parent_folder_id = @parent_folder_id');
        expect(result.query).not.toContain('parent_folder_id IS NULL');
        expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
        expect(result.params.parent_folder_id).toBe('folder-123');
      });
    });
  });

  // ========================================================================
  // buildInClause()
  // ========================================================================
  describe('buildInClause()', () => {
    it('generates parameterized IN clause for multiple IDs', () => {
      const result = queryBuilder.buildInClause(['id-1', 'id-2', 'id-3'], 'file_id');

      expect(result.placeholders).toBe('@file_id0, @file_id1, @file_id2');
      expect(result.params).toEqual({
        file_id0: 'id-1',
        file_id1: 'id-2',
        file_id2: 'id-3',
      });
    });

    it('handles single ID', () => {
      const result = queryBuilder.buildInClause(['single-id'], 'id');

      expect(result.placeholders).toBe('@id0');
      expect(result.params).toEqual({ id0: 'single-id' });
    });

    it('returns empty for empty array', () => {
      const result = queryBuilder.buildInClause([], 'prefix');

      expect(result.placeholders).toBe('');
      expect(result.params).toEqual({});
    });

    it('uses custom param prefix', () => {
      const result = queryBuilder.buildInClause(['a', 'b'], 'custom_');

      expect(result.placeholders).toBe('@custom_0, @custom_1');
      expect(result.params).toEqual({
        custom_0: 'a',
        custom_1: 'b',
      });
    });
  });

  // ========================================================================
  // buildFindByContentHashQuery()
  // ========================================================================
  describe('buildFindByContentHashQuery()', () => {
    it('includes user_id filter for multi-tenant isolation', () => {
      const result = queryBuilder.buildFindByContentHashQuery('test-user', 'hash123');

      expect(result.query).toContain('WHERE user_id = @user_id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.user_id).toBe('test-user');
    });

    it('includes content_hash filter', () => {
      const result = queryBuilder.buildFindByContentHashQuery('test-user', 'abc123hash');

      expect(result.query).toContain('content_hash = @content_hash');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.content_hash).toBe('abc123hash');
    });

    it('only searches files (not folders)', () => {
      const result = queryBuilder.buildFindByContentHashQuery('test-user', 'hash123');

      expect(result.query).toContain('is_folder = 0');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
    });
  });

  // ========================================================================
  // buildGetFileByIdQuery()
  // ========================================================================
  describe('buildGetFileByIdQuery()', () => {
    it('includes user_id for multi-tenant isolation', () => {
      const result = queryBuilder.buildGetFileByIdQuery('test-user', 'file-123');

      expect(result.query).toContain('WHERE id = @id AND user_id = @user_id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.user_id).toBe('test-user');
    });

    it('includes file id filter', () => {
      const result = queryBuilder.buildGetFileByIdQuery('test-user', 'file-123');

      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.id).toBe('file-123');
    });

    it('selects all columns', () => {
      const result = queryBuilder.buildGetFileByIdQuery('test-user', 'file-123');

      expect(result.query).toContain('SELECT *');
      expect(result.query).toContain('FROM files');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
    });
  });

  // ========================================================================
  // buildVerifyOwnershipQuery()
  // ========================================================================
  describe('buildVerifyOwnershipQuery()', () => {
    it('includes user_id filter', () => {
      const result = queryBuilder.buildVerifyOwnershipQuery('test-user', ['id-1', 'id-2']);

      expect(result.query).toContain('WHERE user_id = @user_id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.user_id).toBe('test-user');
    });

    it('uses IN clause for file IDs', () => {
      const result = queryBuilder.buildVerifyOwnershipQuery('test-user', ['id-1', 'id-2']);

      expect(result.query).toContain('id IN (@id0, @id1)');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
      expect(result.params.id0).toBe('id-1');
      expect(result.params.id1).toBe('id-2');
    });

    it('only selects id column', () => {
      const result = queryBuilder.buildVerifyOwnershipQuery('test-user', ['id-1']);

      expect(result.query).toContain('SELECT id');
      expect(result.query).toContain('deletion_status IS NULL'); // Soft delete filter
    });
  });
});
