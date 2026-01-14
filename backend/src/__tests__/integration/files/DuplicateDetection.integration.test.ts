/**
 * Duplicate File Detection Integration Tests (D20)
 *
 * Tests the content hash-based duplicate detection system:
 * - findByContentHash - Find files matching a SHA-256 hash
 * - checkDuplicatesByHash - Batch check for duplicates
 * - createFileRecord with content_hash
 *
 * @module __tests__/integration/files/DuplicateDetection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFileService } from '@/services/files/FileService';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { executeQuery } from '@/infrastructure/database/database';
import { randomUUID } from 'crypto';
import crypto from 'crypto';

describe('Duplicate File Detection Integration (D20)', () => {
  setupDatabaseForTests({ skipRedis: true });

  let fileService: ReturnType<typeof getFileService>;
  let testUserId: string;
  let createdFileIds: string[] = [];
  let createdUserIds: string[] = [];

  beforeEach(async () => {
    fileService = getFileService();
    testUserId = randomUUID();
    createdFileIds = [];

    // Create test user
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
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

  // Helper: Compute SHA-256 hash
  function computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Helper: Create file with content hash
  async function createFileWithHash(
    userId: string,
    fileName: string,
    contentHash: string
  ): Promise<string> {
    const fileId = await fileService.createFileRecord({
      userId,
      name: fileName,
      mimeType: 'text/plain',
      sizeBytes: 100,
      blobPath: `users/${userId}/files/${Date.now()}-${fileName}`,
      contentHash,
    });
    createdFileIds.push(fileId);
    return fileId;
  }

  describe('createFileRecord with content_hash', () => {
    it('should store content_hash when provided', async () => {
      const content = 'Hello, this is test content!';
      const hash = computeHash(content);

      const fileId = await createFileWithHash(testUserId, 'test-file.txt', hash);

      // Verify hash is stored
      const result = await executeQuery<{ content_hash: string }>(
        'SELECT content_hash FROM files WHERE id = @id',
        { id: fileId }
      );

      expect(result.recordset[0]?.content_hash).toBe(hash);
      expect(result.recordset[0]?.content_hash).toHaveLength(64);
    });

    it('should allow null content_hash for legacy files', async () => {
      // Create file without hash (simulating legacy file)
      const fileId = await fileService.createFileRecord({
        userId: testUserId,
        name: 'legacy-file.txt',
        mimeType: 'text/plain',
        sizeBytes: 50,
        blobPath: `users/${testUserId}/files/${Date.now()}-legacy.txt`,
        // contentHash not provided
      });
      createdFileIds.push(fileId);

      const result = await executeQuery<{ content_hash: string | null }>(
        'SELECT content_hash FROM files WHERE id = @id',
        { id: fileId }
      );

      expect(result.recordset[0]?.content_hash).toBeNull();
    });
  });

  describe('findByContentHash', () => {
    it('should find files with matching content hash', async () => {
      const content = 'Unique content for testing';
      const hash = computeHash(content);

      // Create file with hash
      const fileId = await createFileWithHash(testUserId, 'original.txt', hash);

      // Search by hash
      const matches = await fileService.findByContentHash(testUserId, hash);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.id.toLowerCase()).toBe(fileId.toLowerCase());
      expect(matches[0]?.name).toBe('original.txt');
    });

    it('should return empty array when no matches', async () => {
      const hash = computeHash('Non-existent content');

      const matches = await fileService.findByContentHash(testUserId, hash);

      expect(matches).toHaveLength(0);
    });

    it('should not return files from other users (multi-tenant isolation)', async () => {
      // Create second user
      const otherUserId = randomUUID();
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      // Create file with hash for other user
      const content = 'Shared content between users';
      const hash = computeHash(content);
      await createFileWithHash(otherUserId, 'other-user-file.txt', hash);

      // Search as testUserId - should NOT find other user's file
      const matches = await fileService.findByContentHash(testUserId, hash);

      expect(matches).toHaveLength(0);
    });

    it('should return multiple files with same hash', async () => {
      const content = 'Content uploaded multiple times';
      const hash = computeHash(content);

      // Create multiple files with same hash
      await createFileWithHash(testUserId, 'file1.txt', hash);
      await createFileWithHash(testUserId, 'file2.txt', hash);
      await createFileWithHash(testUserId, 'file3.txt', hash);

      const matches = await fileService.findByContentHash(testUserId, hash);

      expect(matches).toHaveLength(3);
    });
  });

  describe('checkDuplicatesByHash (batch)', () => {
    it('should detect duplicate when hash exists', async () => {
      const existingContent = 'Existing file content';
      const existingHash = computeHash(existingContent);

      // Create existing file
      const existingFileId = await createFileWithHash(
        testUserId,
        'existing.txt',
        existingHash
      );

      // Check for duplicate
      const results = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'temp1', contentHash: existingHash, fileName: 'new-upload.txt' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]?.isDuplicate).toBe(true);
      expect(results[0]?.existingFile?.id.toLowerCase()).toBe(existingFileId.toLowerCase());
    });

    it('should report no duplicate for new content', async () => {
      const newContent = 'Brand new unique content';
      const newHash = computeHash(newContent);

      const results = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'temp1', contentHash: newHash, fileName: 'brand-new.txt' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]?.isDuplicate).toBe(false);
      expect(results[0]?.existingFile).toBeUndefined();
    });

    it('should handle batch of mixed duplicates and new files', async () => {
      // Create existing file
      const existingHash = computeHash('Existing');
      await createFileWithHash(testUserId, 'existing.txt', existingHash);

      // Check batch with both duplicate and new
      const newHash = computeHash('Brand new');
      const results = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'dup1', contentHash: existingHash, fileName: 'dup.txt' },
        { tempId: 'new1', contentHash: newHash, fileName: 'new.txt' },
      ]);

      expect(results).toHaveLength(2);

      const dupResult = results.find((r) => r.tempId === 'dup1');
      const newResult = results.find((r) => r.tempId === 'new1');

      expect(dupResult?.isDuplicate).toBe(true);
      expect(newResult?.isDuplicate).toBe(false);
    });

    it('should preserve tempId for correlation', async () => {
      const results = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'file-abc-123', contentHash: computeHash('a'), fileName: 'a.txt' },
        { tempId: 'file-xyz-456', contentHash: computeHash('b'), fileName: 'b.txt' },
      ]);

      expect(results[0]?.tempId).toBe('file-abc-123');
      expect(results[1]?.tempId).toBe('file-xyz-456');
    });
  });

  describe('End-to-end duplicate workflow', () => {
    it('should detect duplicate when uploading same content twice', async () => {
      const content = 'Document content for duplicate test';
      const hash = computeHash(content);

      // First upload
      const file1Id = await createFileWithHash(testUserId, 'document-v1.pdf', hash);

      // Second upload - check duplicate
      const check = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'upload2', contentHash: hash, fileName: 'document-v2.pdf' },
      ]);

      expect(check[0]?.isDuplicate).toBe(true);
      expect(check[0]?.existingFile?.id.toLowerCase()).toBe(file1Id.toLowerCase());
      expect(check[0]?.existingFile?.name).toBe('document-v1.pdf');
    });

    it('should not detect duplicate with different content', async () => {
      const content1 = 'Original document content';
      const content2 = 'Modified document content';

      // Upload first file
      await createFileWithHash(testUserId, 'document.pdf', computeHash(content1));

      // Check second file (different content)
      const check = await fileService.checkDuplicatesByHash(testUserId, [
        { tempId: 'upload2', contentHash: computeHash(content2), fileName: 'document.pdf' },
      ]);

      expect(check[0]?.isDuplicate).toBe(false);
    });
  });
});
