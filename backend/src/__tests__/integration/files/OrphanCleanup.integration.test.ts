/**
 * Orphan Cleanup Job Integration Tests (D22)
 *
 * Tests that OrphanCleanupJob correctly:
 * - Detects orphaned documents in Azure AI Search
 * - Cleans up orphans without affecting valid documents
 * - Reports no orphans when deletion cascade works correctly
 *
 * IMPORTANT: These tests REQUIRE Azure AI Search to be configured.
 *
 * @module __tests__/integration/files/OrphanCleanup
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { OrphanCleanupJob, type OrphanCleanupResult } from '@/jobs/OrphanCleanupJob';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { executeQuery } from '@/infrastructure/database/database';
import { env } from '@/infrastructure/config/environment';
import { randomUUID } from 'crypto';

/**
 * STRICT MODE: Tests FAIL if Azure AI Search is not configured
 */
function assertAzureSearchConfigured(): void {
  if (!env.AZURE_SEARCH_ENDPOINT || !env.AZURE_SEARCH_KEY) {
    throw new Error(
      'Azure AI Search is NOT configured.\n' +
        'D22 tests REQUIRE Azure AI Search to validate orphan cleanup.\n' +
        'Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY environment variables.'
    );
  }
}

// Allow skipping only via explicit env var (for local development)
const skipTests = env.SKIP_AI_SEARCH_TESTS === 'true';

describe.skipIf(skipTests)('OrphanCleanupJob Integration (D22)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let orphanCleanupJob: OrphanCleanupJob;
  let vectorSearchService: VectorSearchService;
  let fileService: ReturnType<typeof getFileService>;
  let testUserId: string;
  let createdFileIds: string[] = [];
  let createdUserIds: string[] = [];
  let indexedChunkIds: string[] = [];

  beforeAll(() => {
    assertAzureSearchConfigured();
  });

  beforeEach(async () => {
    orphanCleanupJob = new OrphanCleanupJob();
    vectorSearchService = VectorSearchService.getInstance();
    fileService = getFileService();
    testUserId = randomUUID();
    createdFileIds = [];
    indexedChunkIds = [];

    // Create test user
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
    // Cleanup: Delete indexed chunks from AI Search
    for (const chunkId of indexedChunkIds) {
      try {
        await vectorSearchService.deleteChunk(chunkId);
      } catch {
        // Ignore errors
      }
    }
    indexedChunkIds = [];

    // Cleanup: Delete test files
    for (const fileId of createdFileIds.reverse()) {
      try {
        await executeQuery('DELETE FROM files WHERE id = @id', { id: fileId });
      } catch {
        // Ignore errors
      }
    }
    createdFileIds = [];

    // Cleanup: Delete test users
    for (const userId of createdUserIds) {
      try {
        await executeQuery('DELETE FROM users WHERE id = @id', { id: userId });
      } catch {
        // Ignore errors
      }
    }
    createdUserIds = [];
  });

  // Helper: Create test user
  async function createTestUser(userId: string): Promise<void> {
    await executeQuery(
      `INSERT INTO users (id, email, full_name, microsoft_id, created_at, updated_at)
       VALUES (@id, @email, @fullName, @microsoftId, GETUTCDATE(), GETUTCDATE())`,
      {
        id: userId,
        email: `test-${userId.slice(0, 8)}@example.com`,
        fullName: `Test User ${userId.slice(0, 8)}`,
        microsoftId: `ms-${userId}`,
      }
    );
  }

  // Helper: Create file record in SQL only
  async function createTestFile(
    userId: string,
    fileName: string
  ): Promise<string> {
    const fileId = randomUUID();
    await executeQuery(
      `INSERT INTO files (id, user_id, name, mime_type, size_bytes, blob_path, is_folder, created_at, updated_at)
       VALUES (@id, @userId, @name, 'text/plain', 100, @blobPath, 0, GETUTCDATE(), GETUTCDATE())`,
      {
        id: fileId,
        userId,
        name: fileName,
        blobPath: `users/${userId}/files/${Date.now()}-${fileName}`,
      }
    );
    createdFileIds.push(fileId);
    return fileId;
  }

  // Helper: Index orphan document directly to AI Search (bypassing SQL)
  async function indexOrphanDocument(
    fileId: string,
    userId: string,
    content: string
  ): Promise<string> {
    const chunkId = `orphan_${fileId}_0`;
    await vectorSearchService.indexChunksBatch([
      {
        chunkId,
        fileId,
        userId: userId.toUpperCase(), // AI Search stores in uppercase
        content,
        embedding: new Array(1536).fill(0.1),
        chunkIndex: 0,
        tokenCount: 10,
        embeddingModel: 'test-model',
        createdAt: new Date(),
      },
    ]);
    indexedChunkIds.push(chunkId);
    return chunkId;
  }

  describe('cleanOrphansForUser', () => {
    it('should find no orphans when all AI Search docs have SQL records', async () => {
      // 1. Create file in SQL
      const fileId = await createTestFile(testUserId, 'valid-file.txt');

      // 2. Index document in AI Search for same fileId
      const chunkId = `chunk_${fileId}_0`;
      await vectorSearchService.indexChunksBatch([
        {
          chunkId,
          fileId,
          userId: testUserId.toUpperCase(),
          content: 'Valid document content',
          embedding: new Array(1536).fill(0.1),
          chunkIndex: 0,
          tokenCount: 10,
          embeddingModel: 'test-model',
          createdAt: new Date(),
        },
      ]);
      indexedChunkIds.push(chunkId);

      // 3. Run cleanup
      const result = await orphanCleanupJob.cleanOrphansForUser(testUserId);

      // 4. Verify: No orphans found
      expect(result.totalOrphans).toBe(0);
      expect(result.deletedOrphans).toBe(0);
      expect(result.orphanFileIds).toHaveLength(0);
    });

    it('should detect and delete orphan when AI Search has doc without SQL record', async () => {
      // 1. Index orphan document directly (no SQL record)
      const orphanFileId = randomUUID();
      await indexOrphanDocument(
        orphanFileId,
        testUserId,
        'Orphan content without SQL record'
      );

      // Wait for Azure AI Search to make document searchable (eventual consistency)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 2. Run cleanup
      const result = await orphanCleanupJob.cleanOrphansForUser(testUserId);

      // 3. Verify: Orphan detected and deleted
      expect(result.totalOrphans).toBe(1);
      expect(result.deletedOrphans).toBe(1);
      expect(result.orphanFileIds).toContain(orphanFileId.toLowerCase());

      // Wait for Azure AI Search to propagate deletion (eventual consistency)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 4. Verify: Document no longer in AI Search
      const remainingCount = await vectorSearchService.countDocumentsForFile(
        orphanFileId,
        testUserId
      );
      expect(remainingCount).toBe(0);

      // Remove from cleanup list since it's already deleted
      indexedChunkIds = indexedChunkIds.filter(
        (id) => !id.includes(orphanFileId)
      );
    });

    it('should not affect other users documents', async () => {
      // 1. Create second user
      const otherUserId = randomUUID();
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      // 2. Create file for other user
      const otherFileId = await createTestFile(otherUserId, 'other-user-file.txt');
      await executeQuery('UPDATE files SET user_id = @userId WHERE id = @id', {
        userId: otherUserId,
        id: otherFileId,
      });

      // 3. Index document for other user
      const otherChunkId = `chunk_${otherFileId}_0`;
      await vectorSearchService.indexChunksBatch([
        {
          chunkId: otherChunkId,
          fileId: otherFileId,
          userId: otherUserId.toUpperCase(),
          content: 'Other user content',
          embedding: new Array(1536).fill(0.1),
          chunkIndex: 0,
          tokenCount: 10,
          embeddingModel: 'test-model',
          createdAt: new Date(),
        },
      ]);
      indexedChunkIds.push(otherChunkId);

      // 4. Run cleanup for testUserId (not otherUserId)
      const result = await orphanCleanupJob.cleanOrphansForUser(testUserId);

      // 5. Verify: No orphans for testUserId
      expect(result.totalOrphans).toBe(0);

      // 6. Verify: Other user's document still exists
      const otherUserDocs = await vectorSearchService.countDocumentsForFile(
        otherFileId,
        otherUserId
      );
      expect(otherUserDocs).toBe(1);
    });

    it('should report no orphans after proper file deletion cascade', async () => {
      // 1. Create file in SQL
      const fileId = await createTestFile(testUserId, 'cascade-test.txt');

      // 2. Index document in AI Search
      const chunkId = `chunk_${fileId}_0`;
      await vectorSearchService.indexChunksBatch([
        {
          chunkId,
          fileId,
          userId: testUserId.toUpperCase(),
          content: 'Document to be cascade deleted',
          embedding: new Array(1536).fill(0.1),
          chunkIndex: 0,
          tokenCount: 10,
          embeddingModel: 'test-model',
          createdAt: new Date(),
        },
      ]);
      indexedChunkIds.push(chunkId);

      // 3. Delete file via FileService (should cascade to AI Search)
      await fileService.deleteFile(testUserId, fileId);
      createdFileIds = createdFileIds.filter((id) => id !== fileId);

      // 4. Run cleanup
      const result = await orphanCleanupJob.cleanOrphansForUser(testUserId);

      // 5. Verify: No orphans (cascade worked)
      expect(result.totalOrphans).toBe(0);
      expect(result.deletedOrphans).toBe(0);

      // Remove from cleanup since cascade already deleted
      indexedChunkIds = indexedChunkIds.filter((id) => id !== chunkId);
    });
  });

  describe('runFullCleanup', () => {
    it('should process multiple users', async () => {
      // 1. Create second user with a file (so they're included in getUsersWithFiles)
      const secondUserId = randomUUID();
      await createTestUser(secondUserId);
      createdUserIds.push(secondUserId);

      // Create a valid file for the second user so they appear in SQL query
      const validFileId = await createTestFile(secondUserId, 'valid-file.txt');

      // 2. Create orphan document (referencing a non-existent fileId)
      const orphanFileId = randomUUID();
      await indexOrphanDocument(
        orphanFileId,
        secondUserId,
        'Orphan for second user'
      );

      // Wait for Azure AI Search to make document searchable (eventual consistency)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 3. Run full cleanup
      const summary = await orphanCleanupJob.runFullCleanup();

      // 4. Verify: At least one user processed with orphan
      expect(summary.totalOrphans).toBeGreaterThanOrEqual(1);
      expect(summary.totalDeleted).toBeGreaterThanOrEqual(1);

      // Remove from cleanup since it was deleted
      indexedChunkIds = indexedChunkIds.filter(
        (id) => !id.includes(orphanFileId)
      );
    });
  });
});
