/**
 * FileService Integration Tests
 *
 * Tests FileService with real Azure SQL database to verify:
 * - SQL NULL comparison handling (IS NULL vs = NULL)
 * - Foreign key constraint enforcement
 * - Multi-tenant isolation with real queries
 * - Transaction integrity
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFileService } from '@/services/files/FileService';
import { setupDatabaseForTests } from '../../helpers/TestDatabaseSetup';
import { executeQuery } from '@/config/database';
import { randomUUID } from 'crypto';
import type { SqlParams } from '@/config/database';

describe('FileService - SQL NULL Comparison Integration', () => {
  setupDatabaseForTests({ skipRedis: true }); // Redis not needed for FileService

  let fileService: ReturnType<typeof getFileService>;
  let testUserId: string;
  let createdFileIds: string[] = [];
  let createdUserIds: string[] = [];

  beforeEach(async () => {
    fileService = getFileService();
    testUserId = randomUUID(); // Use plain UUID (database expects uniqueidentifier type)
    createdFileIds = [];

    // Create test user (required for FK constraint)
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
    // Cleanup: Delete test files in reverse order (children before parents)
    for (const fileId of createdFileIds.reverse()) {
      try {
        await executeQuery('DELETE FROM files WHERE id = @id', { id: fileId });
      } catch {
        // Ignore errors (file may not exist)
      }
    }
    createdFileIds = [];

    // Cleanup: Delete test users
    for (const userId of createdUserIds) {
      try {
        await executeQuery('DELETE FROM users WHERE id = @id', { id: userId });
      } catch {
        // Ignore errors (user may not exist)
      }
    }
    createdUserIds = [];
  });

  /**
   * Helper: Create test user (required for FK constraint)
   */
  async function createTestUser(userId: string): Promise<void> {
    const query = `
      INSERT INTO users (
        id, email, full_name, microsoft_id, is_active, is_admin, role,
        created_at, updated_at
      )
      VALUES (
        @id, @email, @full_name, @microsoft_id, @is_active, @is_admin, @role,
        GETUTCDATE(), GETUTCDATE()
      )
    `;

    const params: SqlParams = {
      id: userId,
      email: `test-${userId}@example.com`,
      full_name: `Test User ${userId.substring(0, 8)}`,
      microsoft_id: randomUUID(),
      is_active: true,
      is_admin: false,
      role: 'viewer', // Valid roles: 'admin', 'editor', 'viewer'
    };

    await executeQuery(query, params);
  }

  /**
   * Helper: Insert file directly via SQL (bypassing FileService)
   */
  async function insertFileDirectly(file: {
    id: string;
    user_id: string;
    parent_folder_id: string | null;
    name: string;
    is_folder: boolean;
  }): Promise<void> {
    const query = `
      INSERT INTO files (
        id, user_id, parent_folder_id, name, mime_type, size_bytes, blob_path,
        is_folder, is_favorite, processing_status, embedding_status, extracted_text,
        created_at, updated_at
      )
      VALUES (
        @id, @user_id, @parent_folder_id, @name, @mime_type, @size_bytes, @blob_path,
        @is_folder, @is_favorite, @processing_status, @embedding_status, @extracted_text,
        GETUTCDATE(), GETUTCDATE()
      )
    `;

    const params: SqlParams = {
      id: file.id,
      user_id: file.user_id,
      parent_folder_id: file.parent_folder_id,
      name: file.name,
      mime_type: file.is_folder ? 'inode/directory' : 'application/pdf',
      size_bytes: file.is_folder ? 0 : 1024000,
      blob_path: file.is_folder ? '' : `users/${file.user_id}/files/${file.name}`,
      is_folder: file.is_folder,
      is_favorite: false,
      processing_status: 'completed',
      embedding_status: file.is_folder ? 'completed' : 'pending',
      extracted_text: null,
    };

    await executeQuery(query, params);
    createdFileIds.push(file.id);
  }

  describe('getFiles() - SQL NULL Handling', () => {
    it('should retrieve root-level files when folderId=undefined (IS NULL)', async () => {
      // Setup: Create 1 root folder, 1 root file, 1 subfolder
      const rootFolderId = randomUUID();
      const rootFileId = randomUUID();
      const subFolderId = randomUUID();

      await insertFileDirectly({
        id: rootFolderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Root Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: rootFileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-file.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: subFolderId,
        user_id: testUserId,
        parent_folder_id: rootFolderId,
        name: 'Subfolder',
        is_folder: true,
      });

      // Test: getFiles() with folderId=undefined should return ONLY root items
      const files = await fileService.getFiles({ userId: testUserId });

      // Verify: Returns only root-level items (not subfolder)
      expect(files).toHaveLength(2);
      // SQL Server returns UUIDs in uppercase, normalize for comparison
      expect(files.map(f => f.id.toLowerCase()).sort()).toEqual([rootFolderId.toLowerCase(), rootFileId.toLowerCase()].sort());

      const rootFolder = files.find(f => f.id.toLowerCase() === rootFolderId.toLowerCase());
      expect(rootFolder?.parentFolderId).toBeNull();
    });

    it('should retrieve root-level files when folderId=null (IS NULL)', async () => {
      const rootFileId = randomUUID();
      await insertFileDirectly({
        id: rootFileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-explicit-null.pdf',
        is_folder: false,
      });

      const files = await fileService.getFiles({
        userId: testUserId,
        folderId: null
      });

      expect(files).toHaveLength(1);
      expect(files[0]?.id.toLowerCase()).toBe(rootFileId.toLowerCase());
      expect(files[0]?.parentFolderId).toBeNull();
    });

    it('should retrieve folder contents when folderId=UUID (parameterized)', async () => {
      const parentFolderId = randomUUID();
      const child1Id = randomUUID();
      const child2Id = randomUUID();

      await insertFileDirectly({
        id: parentFolderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Parent Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: child1Id,
        user_id: testUserId,
        parent_folder_id: parentFolderId,
        name: 'child-1.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: child2Id,
        user_id: testUserId,
        parent_folder_id: parentFolderId,
        name: 'child-2.pdf',
        is_folder: false,
      });

      const files = await fileService.getFiles({
        userId: testUserId,
        folderId: parentFolderId,
      });

      expect(files).toHaveLength(2);
      expect(files.map(f => f.id.toLowerCase()).sort()).toEqual([child1Id.toLowerCase(), child2Id.toLowerCase()].sort());
      expect(files.every(f => f.parentFolderId?.toLowerCase() === parentFolderId.toLowerCase())).toBe(true);
    });

    it('should enforce multi-tenant isolation (no cross-user access)', async () => {
      const otherUserId = randomUUID(); // Use plain UUID (database expects uniqueidentifier type)
      const otherFileId = randomUUID();

      // Create second test user
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      await insertFileDirectly({
        id: otherFileId,
        user_id: otherUserId,
        parent_folder_id: null,
        name: 'other-user-file.pdf',
        is_folder: false,
      });

      const files = await fileService.getFiles({ userId: testUserId });

      expect(files).toHaveLength(0);
      expect(files.find(f => f.id.toLowerCase() === otherFileId.toLowerCase())).toBeUndefined();
    });
  });

  describe('getFileCount() - SQL NULL Handling', () => {
    it('should count all user files when folderId=undefined', async () => {
      const rootFile1Id = randomUUID();
      const rootFile2Id = randomUUID();
      const folderId = randomUUID();
      const childFileId = randomUUID();

      await insertFileDirectly({
        id: rootFile1Id,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-1.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: rootFile2Id,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-2.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: folderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: childFileId,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'child.pdf',
        is_folder: false,
      });

      const count = await fileService.getFileCount(testUserId);

      expect(count).toBe(4);
    });

    it('should count root-level files when folderId=null (IS NULL)', async () => {
      const rootFile1Id = randomUUID();
      const rootFile2Id = randomUUID();
      const folderId = randomUUID();
      const childFileId = randomUUID();

      await insertFileDirectly({
        id: rootFile1Id,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-1.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: rootFile2Id,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'root-2.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: folderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: childFileId,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'child.pdf',
        is_folder: false,
      });

      // This test verifies the bug fix - should use IS NULL
      const count = await fileService.getFileCount(testUserId, null);

      expect(count).toBe(3); // 2 files + 1 folder at root
    });

    it('should count folder contents when folderId=UUID', async () => {
      const folderId = randomUUID();
      const child1Id = randomUUID();
      const child2Id = randomUUID();

      await insertFileDirectly({
        id: folderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: child1Id,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'child-1.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: child2Id,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'child-2.pdf',
        is_folder: false,
      });

      const count = await fileService.getFileCount(testUserId, folderId);

      expect(count).toBe(2);
    });
  });

  describe('Foreign Key Constraint Enforcement', () => {
    it('should reject invalid parent_folder_id (referential integrity)', async () => {
      const invalidParentId = randomUUID();

      await expect(
        fileService.createFileRecord({
          userId: testUserId,
          name: 'orphan-file.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          blobPath: `users/${testUserId}/files/orphan-file.pdf`,
          parentFolderId: invalidParentId,
        })
      ).rejects.toThrow();

      const files = await fileService.getFiles({ userId: testUserId });
      expect(files).toHaveLength(0);
    });

    it('should allow NULL parent_folder_id (root level)', async () => {
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'root-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        blobPath: `users/${testUserId}/files/root-file.pdf`,
        parentFolderId: undefined,
      });

      createdFileIds.push(fileId);

      const files = await fileService.getFiles({ userId: testUserId });
      expect(files).toHaveLength(1);
      expect(files[0]?.id.toLowerCase()).toBe(fileId.toLowerCase());
      expect(files[0]?.parentFolderId).toBeNull();
    });
  });

  describe('Complex Folder Hierarchies', () => {
    it('should handle 3-level folder nesting', async () => {
      const rootFolderId = randomUUID();
      const level1FolderId = randomUUID();
      const level2FolderId = randomUUID();
      const deepFileId = randomUUID();

      await insertFileDirectly({
        id: rootFolderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'Root',
        is_folder: true,
      });

      await insertFileDirectly({
        id: level1FolderId,
        user_id: testUserId,
        parent_folder_id: rootFolderId,
        name: 'Level1',
        is_folder: true,
      });

      await insertFileDirectly({
        id: level2FolderId,
        user_id: testUserId,
        parent_folder_id: level1FolderId,
        name: 'Level2',
        is_folder: true,
      });

      await insertFileDirectly({
        id: deepFileId,
        user_id: testUserId,
        parent_folder_id: level2FolderId,
        name: 'deep-file.pdf',
        is_folder: false,
      });

      // Navigate through hierarchy
      const rootFiles = await fileService.getFiles({ userId: testUserId });
      expect(rootFiles).toHaveLength(1);
      expect(rootFiles[0]?.id.toLowerCase()).toBe(rootFolderId.toLowerCase());

      const level1Files = await fileService.getFiles({
        userId: testUserId,
        folderId: rootFolderId,
      });
      expect(level1Files).toHaveLength(1);
      expect(level1Files[0]?.id.toLowerCase()).toBe(level1FolderId.toLowerCase());

      const level2Files = await fileService.getFiles({
        userId: testUserId,
        folderId: level1FolderId,
      });
      expect(level2Files).toHaveLength(1);
      expect(level2Files[0]?.id.toLowerCase()).toBe(level2FolderId.toLowerCase());

      const deepFiles = await fileService.getFiles({
        userId: testUserId,
        folderId: level2FolderId,
      });
      expect(deepFiles).toHaveLength(1);
      expect(deepFiles[0]?.id.toLowerCase()).toBe(deepFileId.toLowerCase());
    });
  });
});
