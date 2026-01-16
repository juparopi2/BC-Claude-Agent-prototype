/**
 * File Deletion Cascade Integration Tests (D23)
 *
 * Tests GDPR-compliant cascading deletion across all storage layers:
 * - Database (files table, file_chunks via FK CASCADE)
 * - Azure AI Search (vector embeddings)
 * - Audit trail
 *
 * IMPORTANT: These tests REQUIRE Azure AI Search to be configured.
 * If Azure AI Search is not available, tests will FAIL (not skip).
 * This ensures CI always validates the complete deletion cascade.
 *
 * @module __tests__/integration/files/FileDeletionCascade
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getFileService } from '@/services/files/FileService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { executeQuery } from '@/infrastructure/database/database';
import { env } from '@/infrastructure/config/environment';
import { randomUUID } from 'crypto';
import type { SqlParams } from '@/infrastructure/database/database';

/**
 * STRICT MODE: Tests FAIL if Azure AI Search is not configured
 * This ensures we always test the complete deletion cascade in CI
 */
function assertAzureSearchConfigured(): void {
  if (!env.AZURE_SEARCH_ENDPOINT || !env.AZURE_SEARCH_KEY) {
    throw new Error(
      'Azure AI Search is NOT configured.\n' +
        'D23 tests REQUIRE Azure AI Search to validate deletion cascade.\n' +
        'Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY environment variables.\n' +
        'If running locally without Azure, set SKIP_AI_SEARCH_TESTS=true to skip these tests.'
    );
  }
}

// Allow skipping only via explicit env var (for local development)
const skipTests = env.SKIP_AI_SEARCH_TESTS === 'true';

describe.skipIf(skipTests)('File Deletion Cascade Integration (D23)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let fileService: ReturnType<typeof getFileService>;
  let vectorSearchService: VectorSearchService;
  let testUserId: string;
  let createdFileIds: string[] = [];
  let createdUserIds: string[] = [];

  // Track indexed documents for cleanup
  let indexedChunkIds: string[] = [];

  beforeAll(() => {
    // STRICT: Fail immediately if Azure AI Search not configured
    assertAzureSearchConfigured();
  });

  beforeEach(async () => {
    fileService = getFileService();
    vectorSearchService = VectorSearchService.getInstance();
    testUserId = randomUUID();
    createdFileIds = [];
    indexedChunkIds = [];

    // Create test user (required for FK constraint)
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
    // Cleanup: Delete indexed chunks from AI Search
    for (const chunkId of indexedChunkIds) {
      try {
        await vectorSearchService.deleteChunk(chunkId);
      } catch {
        // Ignore errors (chunk may already be deleted)
      }
    }
    indexedChunkIds = [];

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

    // Cleanup audit records for test files
    try {
      await executeQuery(
        'DELETE FROM deletion_audit_log WHERE user_id = @userId',
        { userId: testUserId }
      );
    } catch {
      // Ignore
    }
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
      email: `test-d23-${userId}@example.com`,
      full_name: `D23 Test User ${userId.substring(0, 8)}`,
      microsoft_id: randomUUID(),
      is_active: true,
      is_admin: false,
      role: 'viewer',
    };

    await executeQuery(query, params);
  }

  /**
   * Helper: Insert file directly via SQL
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

  /**
   * Helper: Index a text chunk for a file
   */
  async function indexTestChunk(
    fileId: string,
    userId: string,
    content: string
  ): Promise<string> {
    const chunkId = `chunk_${fileId}_0`;

    await vectorSearchService.indexChunk({
      chunkId,
      fileId,
      userId,
      content,
      embedding: new Array(1536).fill(0.1), // Mock embedding
      chunkIndex: 0,
      tokenCount: content.split(' ').length,
      embeddingModel: 'text-embedding-3-small',
      createdAt: new Date(),
    });

    indexedChunkIds.push(chunkId);
    return chunkId;
  }

  /**
   * Helper: Index an image embedding for a file
   */
  async function indexTestImageEmbedding(
    fileId: string,
    userId: string,
    fileName: string
  ): Promise<string> {
    const imageDocId = `img_${fileId}`;

    await vectorSearchService.indexImageEmbedding({
      fileId,
      userId,
      embedding: new Array(1024).fill(0.15), // Mock image embedding
      fileName,
    });

    indexedChunkIds.push(imageDocId);
    return imageDocId;
  }

  /**
   * Helper: Wait for Azure AI Search eventual consistency
   */
  async function waitForIndexing(ms = 2000): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe('Database Cascade', () => {
    it('should delete file record from database', async () => {
      // Create file
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-test-file.pdf',
        is_folder: false,
      });

      // Verify file exists
      const fileBefore = await fileService.getFile(testUserId, fileId);
      expect(fileBefore).not.toBeNull();

      // Delete file
      await fileService.deleteFile(testUserId, fileId);

      // Verify file deleted
      const fileAfter = await fileService.getFile(testUserId, fileId);
      expect(fileAfter).toBeNull();
    });

    it('should cascade delete to file_chunks via FK', async () => {
      // Create file
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-chunk-test.pdf',
        is_folder: false,
      });

      // Insert file_chunk directly (using actual schema from migrations 003 + 004)
      const chunkQuery = `
        INSERT INTO file_chunks (id, file_id, user_id, chunk_index, chunk_text, chunk_tokens, created_at)
        VALUES (@id, @file_id, @user_id, @chunk_index, @chunk_text, @chunk_tokens, GETUTCDATE())
      `;
      const chunkId = randomUUID();
      await executeQuery(chunkQuery, {
        id: chunkId,
        file_id: fileId,
        user_id: testUserId,
        chunk_index: 0,
        chunk_text: 'Test chunk content',
        chunk_tokens: 3,
      });

      // Verify chunk exists
      const chunkBefore = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM file_chunks WHERE file_id = @fileId',
        { fileId }
      );
      expect(chunkBefore.recordset[0]?.count).toBe(1);

      // Delete file (should cascade to file_chunks via FK)
      await fileService.deleteFile(testUserId, fileId);

      // Verify chunk deleted by CASCADE
      const chunkAfter = await executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM file_chunks WHERE file_id = @fileId',
        { fileId }
      );
      expect(chunkAfter.recordset[0]?.count).toBe(0);
    });
  });

  describe('Audit Trail', () => {
    it('should create deletion audit record', async () => {
      // Create file
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-audit-test.pdf',
        is_folder: false,
      });

      // Delete file
      await fileService.deleteFile(testUserId, fileId);

      // Verify audit record created
      const auditResult = await executeQuery<{ status: string; deleted_from_db: boolean }>(
        'SELECT status, deleted_from_db FROM deletion_audit_log WHERE resource_id = @resourceId',
        { resourceId: fileId }
      );

      expect(auditResult.recordset).toHaveLength(1);
      expect(auditResult.recordset[0]?.status).toBe('completed');
      expect(auditResult.recordset[0]?.deleted_from_db).toBe(true);
    });
  });

  describe('Azure AI Search Cascade', () => {
    it('should delete text embeddings from AI Search after file deletion', async () => {
      // 1. Create file in DB
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-embedding-test.pdf',
        is_folder: false,
      });

      // 2. Index embeddings in AI Search
      await indexTestChunk(fileId, testUserId, 'D23 test content for deletion cascade');
      await waitForIndexing();

      // 3. Verify embeddings exist (countDocumentsForFile > 0)
      const countBefore = await vectorSearchService.countDocumentsForFile(fileId, testUserId);
      expect(countBefore).toBeGreaterThan(0);

      // 4. Delete file via FileService (triggers cascade)
      await fileService.deleteFile(testUserId, fileId);
      await waitForIndexing();

      // 5. Verify embeddings deleted (countDocumentsForFile === 0)
      const countAfter = await vectorSearchService.countDocumentsForFile(fileId, testUserId);
      expect(countAfter).toBe(0);
    });

    it('should delete image embeddings from AI Search after file deletion', async () => {
      // 1. Create file in DB
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-image-test.jpg',
        is_folder: false,
      });

      // 2. Index image embedding in AI Search
      await indexTestImageEmbedding(fileId, testUserId, 'd23-image-test.jpg');
      await waitForIndexing();

      // 3. Verify image embedding exists
      const countBefore = await vectorSearchService.countDocumentsForFile(fileId, testUserId);
      expect(countBefore).toBeGreaterThan(0);

      // 4. Delete file via FileService (triggers cascade)
      await fileService.deleteFile(testUserId, fileId);
      await waitForIndexing();

      // 5. Verify image embedding deleted
      const countAfter = await vectorSearchService.countDocumentsForFile(fileId, testUserId);
      expect(countAfter).toBe(0);
    });

    it('should delete all embeddings when folder with files is deleted', async () => {
      // 1. Create folder structure in DB
      const folderId = randomUUID();
      const childFile1Id = randomUUID();
      const childFile2Id = randomUUID();

      await insertFileDirectly({
        id: folderId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'D23-Test-Folder',
        is_folder: true,
      });

      await insertFileDirectly({
        id: childFile1Id,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'd23-child-1.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: childFile2Id,
        user_id: testUserId,
        parent_folder_id: folderId,
        name: 'd23-child-2.pdf',
        is_folder: false,
      });

      // 2. Index embeddings for both child files
      await indexTestChunk(childFile1Id, testUserId, 'Child file 1 content');
      await indexTestChunk(childFile2Id, testUserId, 'Child file 2 content');
      await waitForIndexing();

      // 3. Verify embeddings exist
      const count1Before = await vectorSearchService.countDocumentsForFile(
        childFile1Id,
        testUserId
      );
      const count2Before = await vectorSearchService.countDocumentsForFile(
        childFile2Id,
        testUserId
      );
      expect(count1Before).toBeGreaterThan(0);
      expect(count2Before).toBeGreaterThan(0);

      // 4. Delete folder (should cascade to children)
      await fileService.deleteFile(testUserId, folderId);
      await waitForIndexing();

      // 5. Verify all embeddings deleted
      const count1After = await vectorSearchService.countDocumentsForFile(childFile1Id, testUserId);
      const count2After = await vectorSearchService.countDocumentsForFile(childFile2Id, testUserId);
      expect(count1After).toBe(0);
      expect(count2After).toBe(0);
    });

    it('should handle deletion of file with no embeddings (idempotent)', async () => {
      // 1. Create file in DB (but don't index any embeddings)
      const fileId = randomUUID();
      await insertFileDirectly({
        id: fileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-no-embedding-test.pdf',
        is_folder: false,
      });

      // 2. Verify no embeddings exist
      const countBefore = await vectorSearchService.countDocumentsForFile(fileId, testUserId);
      expect(countBefore).toBe(0);

      // 3. Delete file (should not throw even though no embeddings)
      await expect(fileService.deleteFile(testUserId, fileId)).resolves.not.toThrow();

      // 4. Verify file deleted
      const fileAfter = await fileService.getFile(testUserId, fileId);
      expect(fileAfter).toBeNull();
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should only delete embeddings for the specific user (not other users)', async () => {
      // Create second test user
      const otherUserId = randomUUID();
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      // 1. Create files for both users
      const testUserFileId = randomUUID();
      const otherUserFileId = randomUUID();

      await insertFileDirectly({
        id: testUserFileId,
        user_id: testUserId,
        parent_folder_id: null,
        name: 'd23-user1-file.pdf',
        is_folder: false,
      });

      await insertFileDirectly({
        id: otherUserFileId,
        user_id: otherUserId,
        parent_folder_id: null,
        name: 'd23-user2-file.pdf',
        is_folder: false,
      });

      // 2. Index embeddings for both
      await indexTestChunk(testUserFileId, testUserId, 'Test user file content');
      await indexTestChunk(otherUserFileId, otherUserId, 'Other user file content');
      await waitForIndexing();

      // 3. Delete testUser's file
      await fileService.deleteFile(testUserId, testUserFileId);
      await waitForIndexing();

      // 4. Verify testUser's embeddings deleted
      const testUserCount = await vectorSearchService.countDocumentsForFile(
        testUserFileId,
        testUserId
      );
      expect(testUserCount).toBe(0);

      // 5. Verify otherUser's embeddings still exist
      const otherUserCount = await vectorSearchService.countDocumentsForFile(
        otherUserFileId,
        otherUserId
      );
      expect(otherUserCount).toBeGreaterThan(0);

      // Cleanup other user's file
      await fileService.deleteFile(otherUserId, otherUserFileId);
    });
  });
});
