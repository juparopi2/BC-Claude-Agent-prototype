/**
 * Folder Upload Integration Tests
 *
 * Tests the folder-based upload session system including:
 * - Session initialization with folder batches
 * - Folder name collision detection and resolution
 * - State transitions during upload workflow
 * - Race condition handling in getSasUrls
 * - Session cancellation and cleanup
 *
 * @module __tests__/integration/files/FolderUpload
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupFullIntegrationTest } from '../helpers/TestDatabaseSetup';
import { executeQuery } from '@/infrastructure/database/database';
import { getUploadSessionManager, __resetUploadSessionManager } from '@/domains/files';
import { __resetUploadSessionStore } from '@/domains/files/upload-session/UploadSessionStore';
import { randomUUID } from 'crypto';
import type { FolderInput, UploadSession, FolderBatch } from '@bc-agent/shared';

describe('Folder Upload Integration Tests', () => {
  setupFullIntegrationTest();

  let testUserId: string;
  let createdUserIds: string[] = [];
  let createdFolderIds: string[] = [];
  let createdFileIds: string[] = [];
  let createdSessionIds: string[] = [];

  beforeEach(async () => {
    testUserId = randomUUID().toUpperCase();
    createdUserIds = [];
    createdFolderIds = [];
    createdFileIds = [];
    createdSessionIds = [];

    // Create test user
    await createTestUser(testUserId);
    createdUserIds.push(testUserId);
  });

  afterEach(async () => {
    // Reset singletons between tests
    __resetUploadSessionStore();
    __resetUploadSessionManager();

    // Cleanup: Delete test files
    for (const fileId of createdFileIds.reverse()) {
      try {
        await executeQuery('DELETE FROM files WHERE id = @id', { id: fileId });
      } catch {
        // Ignore errors
      }
    }

    // Cleanup: Delete test folders (reverse order for cascade)
    for (const folderId of createdFolderIds.reverse()) {
      try {
        await executeQuery('DELETE FROM files WHERE id = @id', { id: folderId });
      } catch {
        // Ignore errors
      }
    }

    // Cleanup: Delete test users
    for (const userId of createdUserIds) {
      try {
        await executeQuery('DELETE FROM users WHERE id = @id', { id: userId });
      } catch {
        // Ignore errors
      }
    }
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

  // Helper: Create a folder in the database
  async function createExistingFolder(userId: string, name: string, parentId: string | null = null): Promise<string> {
    const folderId = randomUUID().toUpperCase();
    await executeQuery(
      `INSERT INTO files (id, user_id, name, mime_type, is_folder, parent_folder_id, size_bytes, blob_path, created_at, updated_at)
       VALUES (@id, @userId, @name, 'application/x-folder', 1, @parentId, 0, '', GETUTCDATE(), GETUTCDATE())`,
      {
        id: folderId,
        userId,
        name,
        parentId,
      }
    );
    createdFolderIds.push(folderId);
    return folderId;
  }

  // Helper: Create folder input for session init
  function createFolderInput(name: string, files: number = 3, parentTempId: string | null = null): FolderInput {
    const tempId = `folder-${randomUUID().slice(0, 8)}`;
    return {
      tempId,
      name,
      parentTempId,
      files: Array.from({ length: files }, (_, i) => ({
        tempId: `file-${tempId}-${i}`,
        fileName: `file-${i + 1}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 1000 * (i + 1),
      })),
    };
  }

  // ============================================================================
  // BASIC UPLOAD FLOW
  // ============================================================================

  describe('Basic Upload Flow', () => {
    it('should initialize session with single folder', async () => {
      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('Documents', 3);

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      expect(result.session.id).toBeDefined();
      expect(result.session.userId).toBe(testUserId);
      expect(result.session.totalFolders).toBe(1);
      expect(result.session.folderBatches).toHaveLength(1);
      expect(result.session.folderBatches[0]?.status).toBe('pending');
      expect(result.session.folderBatches[0]?.name).toBe('Documents');
      expect(result.session.status).toBe('initializing');
    });

    it('should initialize session with multiple root folders', async () => {
      const sessionManager = getUploadSessionManager();
      const folders = [
        createFolderInput('Documents', 2),
        createFolderInput('Images', 5),
        createFolderInput('Videos', 1),
      ];

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders,
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      expect(result.session.totalFolders).toBe(3);
      expect(result.session.folderBatches).toHaveLength(3);
      expect(result.session.folderBatches.map(b => b.name)).toEqual(['Documents', 'Images', 'Videos']);
    });

    it('should initialize session with nested folder structure', async () => {
      const sessionManager = getUploadSessionManager();
      const parent = createFolderInput('Projects', 1);
      const child1 = createFolderInput('ProjectA', 2, parent.tempId);
      const child2 = createFolderInput('ProjectB', 3, parent.tempId);

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [parent, child1, child2],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      expect(result.session.totalFolders).toBe(3);
      expect(result.session.folderBatches[0]?.name).toBe('Projects');
      expect(result.session.folderBatches[1]?.parentTempId).toBe(parent.tempId);
      expect(result.session.folderBatches[2]?.parentTempId).toBe(parent.tempId);
    });

    it('should handle empty folder (folder with subfolders only)', async () => {
      const sessionManager = getUploadSessionManager();
      const parent = createFolderInput('ParentOnly', 0); // No files
      const child = createFolderInput('HasFiles', 3, parent.tempId);

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [parent, child],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      expect(result.session.totalFolders).toBe(2);
      expect(result.session.folderBatches[0]?.totalFiles).toBe(0);
      expect(result.session.folderBatches[1]?.totalFiles).toBe(3);
    });
  });

  // ============================================================================
  // FOLDER NAME COLLISION DETECTION
  // ============================================================================

  describe('Folder Name Collision Detection', () => {
    it('should detect collision with existing database folder', async () => {
      // Create existing folder in DB
      await createExistingFolder(testUserId, 'Documents');

      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('Documents', 3);

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      // Should auto-rename to "Documents (1)"
      expect(result.renamedFolderCount).toBe(1);
      expect(result.renamedFolders).toHaveLength(1);
      expect(result.renamedFolders[0]?.originalName).toBe('Documents');
      expect(result.renamedFolders[0]?.resolvedName).toBe('Documents (1)');
      expect(result.session.folderBatches[0]?.name).toBe('Documents (1)');
    });

    it('should allow same name in different parent folders', async () => {
      // Create two parent folders
      const parent1 = await createExistingFolder(testUserId, 'Parent1');
      const parent2 = await createExistingFolder(testUserId, 'Parent2');

      const sessionManager = getUploadSessionManager();

      // Create "Docs" in both parents - should NOT conflict
      const folder1 = createFolderInput('Docs', 2);
      const result1 = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder1],
        targetFolderId: parent1,
      });
      createdSessionIds.push(result1.session.id);

      // Reset for second session
      __resetUploadSessionStore();
      __resetUploadSessionManager();

      const folder2 = createFolderInput('Docs', 2);
      const result2 = await getUploadSessionManager().initializeSession({
        userId: testUserId,
        folders: [folder2],
        targetFolderId: parent2,
      });
      createdSessionIds.push(result2.session.id);

      // Neither should be renamed
      expect(result1.renamedFolderCount).toBe(0);
      expect(result2.renamedFolderCount).toBe(0);
    });

    it('should detect collision within same batch', async () => {
      const sessionManager = getUploadSessionManager();

      // Two folders with same name in same batch
      const folder1: FolderInput = {
        tempId: 'folder-1',
        name: 'SameName',
        parentTempId: null,
        files: [{ tempId: 'f1', fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: 100 }],
      };
      const folder2: FolderInput = {
        tempId: 'folder-2',
        name: 'SameName',
        parentTempId: null,
        files: [{ tempId: 'f2', fileName: 'b.txt', mimeType: 'text/plain', sizeBytes: 200 }],
      };

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder1, folder2],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      // Second folder should be renamed
      expect(result.renamedFolderCount).toBe(1);
      expect(result.session.folderBatches[0]?.name).toBe('SameName');
      expect(result.session.folderBatches[1]?.name).toBe('SameName (1)');
    });

    it('should handle multiple duplicates with incrementing suffix', async () => {
      // Create existing folders
      await createExistingFolder(testUserId, 'Report');
      await createExistingFolder(testUserId, 'Report (1)');

      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('Report', 2);

      const result = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });

      createdSessionIds.push(result.session.id);

      // Should get next available suffix
      expect(result.session.folderBatches[0]?.name).toBe('Report (2)');
    });
  });

  // ============================================================================
  // STATE MACHINE VALIDATION
  // ============================================================================

  describe('State Machine Validation', () => {
    it('should transition through correct states: pending -> creating -> registering -> uploading', async () => {
      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('TestFolder', 2);

      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      // Initial state: pending
      expect(initResult.session.folderBatches[0]?.status).toBe('pending');

      // Create folder -> creating -> ...
      const createResult = await sessionManager.createFolder(initResult.session.id, folder.tempId);
      createdFolderIds.push(createResult.folderId);

      // After createFolder, batch should be in 'registering' state
      expect(createResult.folderBatch.status).toBe('registering');
      expect(createResult.folderId).toBeDefined();

      // Register files -> uploading
      const registerResult = await sessionManager.registerFiles(
        initResult.session.id,
        folder.tempId,
        folder.files
      );

      // After registerFiles, batch should be in 'uploading' state
      expect(registerResult.folderBatch.status).toBe('uploading');
      expect(registerResult.registered).toHaveLength(2);

      // Track created files for cleanup
      for (const file of registerResult.registered) {
        createdFileIds.push(file.fileId);
      }
    });

    it('should prevent getSasUrls when in registering state (then succeed after retry)', async () => {
      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('TestFolder', 1);

      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      // Create folder but DON'T register files yet
      const createResult = await sessionManager.createFolder(initResult.session.id, folder.tempId);
      createdFolderIds.push(createResult.folderId);

      // Verify batch is in 'registering' state
      expect(createResult.folderBatch.status).toBe('registering');

      // getSasUrls should fail because files haven't been registered
      await expect(
        sessionManager.getSasUrls(initResult.session.id, folder.tempId, ['fake-file-id'])
      ).rejects.toThrow('is in registering state');
    });
  });

  // ============================================================================
  // CONCURRENT SESSIONS
  // ============================================================================

  describe('Concurrent Sessions', () => {
    it('should support multiple sessions for same user', async () => {
      const sessionManager = getUploadSessionManager();

      // Create first session
      const folder1 = createFolderInput('Session1Folder', 2);
      const result1 = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder1],
        targetFolderId: null,
      });
      createdSessionIds.push(result1.session.id);

      // Create second session (same user)
      const folder2 = createFolderInput('Session2Folder', 3);
      const result2 = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder2],
        targetFolderId: null,
      });
      createdSessionIds.push(result2.session.id);

      // Both should succeed
      expect(result1.session.id).not.toBe(result2.session.id);

      // Should have 2 active sessions
      const activeCount = await sessionManager.getActiveSessionCount(testUserId);
      expect(activeCount).toBe(2);

      const activeSessions = await sessionManager.getActiveSessions(testUserId);
      expect(activeSessions).toHaveLength(2);
    });

    it('should isolate sessions between users (multi-tenant)', async () => {
      // Create second user
      const otherUserId = randomUUID().toUpperCase();
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      const sessionManager = getUploadSessionManager();

      // Create session for each user
      const folder1 = createFolderInput('MyDocs', 2);
      const result1 = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder1],
        targetFolderId: null,
      });
      createdSessionIds.push(result1.session.id);

      const folder2 = createFolderInput('MyDocs', 2);
      const result2 = await sessionManager.initializeSession({
        userId: otherUserId,
        folders: [folder2],
        targetFolderId: null,
      });
      createdSessionIds.push(result2.session.id);

      // Each user should only see their own session
      const user1Sessions = await sessionManager.getActiveSessions(testUserId);
      const user2Sessions = await sessionManager.getActiveSessions(otherUserId);

      expect(user1Sessions).toHaveLength(1);
      expect(user2Sessions).toHaveLength(1);
      expect(user1Sessions[0]?.id).toBe(result1.session.id);
      expect(user2Sessions[0]?.id).toBe(result2.session.id);
    });
  });

  // ============================================================================
  // SESSION COMPLETION
  // ============================================================================

  describe('Session Completion', () => {
    it('should complete session when all folders are done', async () => {
      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('QuickFolder', 1);

      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      // Create folder
      const createResult = await sessionManager.createFolder(initResult.session.id, folder.tempId);
      createdFolderIds.push(createResult.folderId);

      // Register files
      const registerResult = await sessionManager.registerFiles(
        initResult.session.id,
        folder.tempId,
        folder.files
      );
      for (const file of registerResult.registered) {
        createdFileIds.push(file.fileId);
      }

      // Complete folder batch
      const completeResult = await sessionManager.completeFolderBatch(
        initResult.session.id,
        folder.tempId
      );

      expect(completeResult.folderBatch.status).toBe('processing');
      expect(completeResult.hasNextFolder).toBe(false);

      // Complete session
      const finalSession = await sessionManager.completeSession(initResult.session.id);
      expect(finalSession.status).toBe('completed');
    });

    it('should increment completedFolders counter correctly', async () => {
      const sessionManager = getUploadSessionManager();
      const folders = [
        createFolderInput('Folder1', 1),
        createFolderInput('Folder2', 1),
      ];

      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders,
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      expect(initResult.session.completedFolders).toBe(0);

      // Complete first folder
      const create1 = await sessionManager.createFolder(initResult.session.id, folders[0]!.tempId);
      createdFolderIds.push(create1.folderId);

      const reg1 = await sessionManager.registerFiles(initResult.session.id, folders[0]!.tempId, folders[0]!.files);
      for (const f of reg1.registered) createdFileIds.push(f.fileId);

      const complete1 = await sessionManager.completeFolderBatch(initResult.session.id, folders[0]!.tempId);
      expect(complete1.session.completedFolders).toBe(1);

      // Complete second folder
      const create2 = await sessionManager.createFolder(initResult.session.id, folders[1]!.tempId);
      createdFolderIds.push(create2.folderId);

      const reg2 = await sessionManager.registerFiles(initResult.session.id, folders[1]!.tempId, folders[1]!.files);
      for (const f of reg2.registered) createdFileIds.push(f.fileId);

      const complete2 = await sessionManager.completeFolderBatch(initResult.session.id, folders[1]!.tempId);
      expect(complete2.session.completedFolders).toBe(2);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should fail batch and continue session on folder creation error', async () => {
      const sessionManager = getUploadSessionManager();
      const folders = [
        createFolderInput('GoodFolder', 1),
        createFolderInput('BadFolder', 1),
      ];

      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders,
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      // Fail the first folder explicitly
      const failedSession = await sessionManager.failFolderBatch(
        initResult.session.id,
        folders[0]!.tempId,
        'Simulated creation failure'
      );

      expect(failedSession.failedFolders).toBe(1);
      expect(failedSession.status).toBe('active'); // Session continues

      // Second folder should still be processable
      const batch2 = failedSession.folderBatches.find(b => b.tempId === folders[1]!.tempId);
      expect(batch2?.status).toBe('pending');
    });

    it('should validate session ownership', async () => {
      // Create second user
      const otherUserId = randomUUID().toUpperCase();
      await createTestUser(otherUserId);
      createdUserIds.push(otherUserId);

      const sessionManager = getUploadSessionManager();
      const folder = createFolderInput('MyFolder', 1);

      // Create session as testUserId
      const initResult = await sessionManager.initializeSession({
        userId: testUserId,
        folders: [folder],
        targetFolderId: null,
      });
      createdSessionIds.push(initResult.session.id);

      // Get session as different user should work but verify ownership
      const session = await sessionManager.getSession(initResult.session.id);
      expect(session?.userId).toBe(testUserId);
      expect(session?.userId).not.toBe(otherUserId);
    });
  });
});
