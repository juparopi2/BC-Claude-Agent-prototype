import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getFileService } from '@services/files/FileService';
import { executeQuery } from '@config/database';
import { setupDatabaseForTests } from './helpers/TestDatabaseSetup';
import type { SqlParams } from '@config/database';

describe('Unicode File Upload Integration', () => {
  setupDatabaseForTests({ skipRedis: true }); // Redis not needed for FileService

  const fileService = getFileService();
  let testUserId: string;
  let createdFileIds: string[] = [];
  let createdUserIds: string[] = [];

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

  beforeEach(async () => {
    testUserId = randomUUID();
    createdFileIds = [];

    // Create test user (required for FK constraint)
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
    // Cleanup: Delete test files in reverse order
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

  it('should store original Unicode filename in database', async () => {
    const originalName = 'Test – æøå • 🎉.pdf';
    const blobPath = `users/${testUserId}/files/1234567890123-Test-.pdf`;

    // Create file record
    const fileId = await fileService.createFileRecord({
      userId: testUserId,
      name: originalName,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      blobPath,
      parentFolderId: null,
    });
    createdFileIds.push(fileId);

    // Retrieve and verify
    const file = await fileService.getFile(testUserId, fileId);

    expect(file).toBeDefined();
    expect(file?.name).toBe(originalName); // Unicode preserved in database
    expect(file?.blobPath).toBe(blobPath); // ASCII-only blob path
  });

  it('should preserve Danish characters (æ, ø, å)', async () => {
    const originalName = 'Rapport – æøå ÆØÅ.pdf';
    const blobPath = `users/${testUserId}/files/1234567890124-Rapport-.pdf`;

    const fileId = await fileService.createFileRecord({
      userId: testUserId,
      name: originalName,
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      blobPath,
      parentFolderId: null,
    });
    createdFileIds.push(fileId);

    const file = await fileService.getFile(testUserId, fileId);

    expect(file?.name).toBe(originalName);
    expect(file?.name).toContain('æ');
    expect(file?.name).toContain('ø');
    expect(file?.name).toContain('å');
  });

  it('should preserve emoji and special symbols', async () => {
    const originalName = 'Report 🎉 ✨ – Status • Update.pdf';
    const blobPath = `users/${testUserId}/files/1234567890125-Report-.pdf`;

    const fileId = await fileService.createFileRecord({
      userId: testUserId,
      name: originalName,
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      blobPath,
      parentFolderId: null,
    });
    createdFileIds.push(fileId);

    const file = await fileService.getFile(testUserId, fileId);

    expect(file?.name).toBe(originalName);
    expect(file?.name).toContain('🎉');
    expect(file?.name).toContain('✨');
    expect(file?.name).toContain('–'); // en dash
    expect(file?.name).toContain('•'); // bullet
  });

  it('should reject blob path as filename', async () => {
    const blobPathAsName = '1234567890123-test-file.pdf'; // Looks like blob path
    const actualBlobPath = `users/${testUserId}/files/${blobPathAsName}`;

    await expect(
      fileService.createFileRecord({
        userId: testUserId,
        name: blobPathAsName, // This should trigger validation error
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        blobPath: actualBlobPath,
        parentFolderId: null,
      })
    ).rejects.toThrow('File name cannot be a blob path');
  });

  it('should reject filename containing "users/" path', async () => {
    const pathAsName = 'users/test/files/document.pdf'; // Contains path
    const actualBlobPath = `users/${testUserId}/files/1234567890126-document.pdf`;

    await expect(
      fileService.createFileRecord({
        userId: testUserId,
        name: pathAsName, // This should trigger validation error
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        blobPath: actualBlobPath,
        parentFolderId: null,
      })
    ).rejects.toThrow('File name cannot be a blob path');
  });

  it('should handle long Unicode filenames', async () => {
    // Create a filename with Unicode (200 chars is safe for nvarchar(500))
    const longName = 'Test – æøå • '.repeat(15) + 'Final.pdf'; // ~200 chars
    const blobPath = `users/${testUserId}/files/1234567890127-long-name.pdf`;

    const fileId = await fileService.createFileRecord({
      userId: testUserId,
      name: longName,
      mimeType: 'application/pdf',
      sizeBytes: 8192,
      blobPath,
      parentFolderId: null,
    });
    createdFileIds.push(fileId);

    const file = await fileService.getFile(testUserId, fileId);

    expect(file?.name).toBe(longName);
    expect(file?.name.length).toBeGreaterThan(150);
  });
});
