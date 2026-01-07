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
import { executeQuery } from '@/infrastructure/database/database';
import { randomUUID } from 'crypto';
import type { SqlParams } from '@/infrastructure/database/database';

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
    it('should count root-level files when folderId=undefined (same as null)', async () => {
      // When folderId is undefined or null, getFileCount counts only ROOT items
      // (where parent_folder_id IS NULL), NOT all files in the user's account
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

      // Should count only root-level items: root-1.pdf, root-2.pdf, Folder = 3
      // child.pdf is NOT counted because it's inside Folder
      expect(count).toBe(3);
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

  describe('GDPR-Compliant Deletion Cascade', () => {
    /**
     * GDPR Article 17 - Right to Erasure
     * Tests verify cascading deletion across database tables
     * Note: AI Search cleanup is tested in unit tests (requires mocking)
     */

    it('should delete file and create audit record', async () => {
      // Create a file
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'gdpr-test-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        blobPath: `users/${testUserId}/files/gdpr-test-file.pdf`,
      });
      createdFileIds.push(fileId);

      // Delete the file
      const blobPaths = await fileService.deleteFile(testUserId, fileId);

      // Verify file is deleted
      const fileAfterDelete = await fileService.getFile(testUserId, fileId);
      expect(fileAfterDelete).toBeNull();

      // Verify blob path returned
      expect(blobPaths).toHaveLength(1);
      expect(blobPaths[0]).toContain('gdpr-test-file.pdf');

      // Verify audit record was created
      const auditResult = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM deletion_audit_log WHERE resource_id = @resourceId`,
        { resourceId: fileId }
      );
      expect(auditResult.recordset[0]?.count).toBeGreaterThanOrEqual(1);

      // Clean up audit record
      await executeQuery('DELETE FROM deletion_audit_log WHERE resource_id = @resourceId', { resourceId: fileId });
    });

    it('should cascade delete folder with children and track child count', async () => {
      // Create folder structure
      const folderId = randomUUID();
      const child1Id = randomUUID();
      const child2Id = randomUUID();

      await insertFileDirectly({
        id: folderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'GDPR-Test-Folder',
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

      // Delete the folder (should cascade to children)
      const blobPaths = await fileService.deleteFile(testUserId, folderId);

      // Verify all items deleted
      const folderAfterDelete = await fileService.getFile(testUserId, folderId);
      const child1AfterDelete = await fileService.getFile(testUserId, child1Id);
      const child2AfterDelete = await fileService.getFile(testUserId, child2Id);

      expect(folderAfterDelete).toBeNull();
      expect(child1AfterDelete).toBeNull();
      expect(child2AfterDelete).toBeNull();

      // Verify 2 blob paths returned (children only, folder has no blob)
      expect(blobPaths).toHaveLength(2);

      // Verify audit record exists for parent folder only
      const auditResult = await executeQuery<{ resource_type: string }>(
        `SELECT resource_type FROM deletion_audit_log WHERE resource_id = @resourceId`,
        { resourceId: folderId }
      );
      expect(auditResult.recordset[0]?.resource_type).toBe('folder');

      // Clean up audit records
      await executeQuery('DELETE FROM deletion_audit_log WHERE resource_id = @resourceId', { resourceId: folderId });
    });

    it('should support skipAudit option for recursive child deletions', async () => {
      // Create single file
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'skip-audit-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 512,
        blobPath: `users/${testUserId}/files/skip-audit-test.pdf`,
      });
      createdFileIds.push(fileId);

      // Delete with skipAudit=true
      await fileService.deleteFile(testUserId, fileId, { skipAudit: true });

      // Verify file deleted
      const fileAfterDelete = await fileService.getFile(testUserId, fileId);
      expect(fileAfterDelete).toBeNull();

      // Verify NO audit record was created
      const auditResult = await executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM deletion_audit_log WHERE resource_id = @resourceId`,
        { resourceId: fileId }
      );
      expect(auditResult.recordset[0]?.count).toBe(0);
    });

    it('should track deletion reason in audit', async () => {
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'gdpr-erasure-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
        blobPath: `users/${testUserId}/files/gdpr-erasure-test.pdf`,
      });
      createdFileIds.push(fileId);

      // Delete with specific reason
      await fileService.deleteFile(testUserId, fileId, { deletionReason: 'gdpr_erasure' });

      // Verify audit record has correct reason
      const auditResult = await executeQuery<{ deletion_reason: string }>(
        `SELECT deletion_reason FROM deletion_audit_log WHERE resource_id = @resourceId`,
        { resourceId: fileId }
      );
      expect(auditResult.recordset[0]?.deletion_reason).toBe('gdpr_erasure');

      // Clean up
      await executeQuery('DELETE FROM deletion_audit_log WHERE resource_id = @resourceId', { resourceId: fileId });
    });

    it('should mark audit as completed with correct status', async () => {
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'status-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128,
        blobPath: `users/${testUserId}/files/status-test.pdf`,
      });
      createdFileIds.push(fileId);

      // Delete file
      await fileService.deleteFile(testUserId, fileId);

      // Verify audit record has correct status and completion time
      const auditResult = await executeQuery<{
        status: string;
        deleted_from_db: boolean;
        completed_at: Date | null;
      }>(
        `SELECT status, deleted_from_db, completed_at FROM deletion_audit_log WHERE resource_id = @resourceId`,
        { resourceId: fileId }
      );

      expect(auditResult.recordset[0]?.status).toBe('completed');
      expect(auditResult.recordset[0]?.deleted_from_db).toBe(true);
      expect(auditResult.recordset[0]?.completed_at).not.toBeNull();

      // Clean up
      await executeQuery('DELETE FROM deletion_audit_log WHERE resource_id = @resourceId', { resourceId: fileId });
    });

    it('should return empty array for non-existent file (idempotent)', async () => {
      const nonExistentFileId = randomUUID();

      // Delete non-existent file should not throw
      const blobPaths = await fileService.deleteFile(testUserId, nonExistentFileId);

      // Verify empty array returned
      expect(blobPaths).toEqual([]);
    });
  });
});
