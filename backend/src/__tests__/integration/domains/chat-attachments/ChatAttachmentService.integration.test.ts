/**
 * Chat Attachment Service Integration Tests
 *
 * Tests ChatAttachmentService against real database and blob storage.
 * Validates CRUD operations, multi-tenant isolation, and TTL behavior.
 *
 * Requirements:
 * - Database connection (SQL Server or Azurite)
 * - Blob storage (Azurite or Azure Storage)
 *
 * @module __tests__/integration/domains/chat-attachments/ChatAttachmentService.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  setupDatabaseForTests,
  createTestSessionFactory,
  TestSessionFactory,
  cleanupAllTestData,
  TEST_TIMEOUTS,
} from '../../helpers';
import {
  ChatAttachmentService,
  getChatAttachmentService,
  __resetChatAttachmentService,
} from '@/domains/chat-attachments';
import { executeQuery } from '@/infrastructure/database/database';
import { getFileUploadService, __resetFileUploadService } from '@/services/files/FileUploadService';
import { CHAT_ATTACHMENT_CONFIG } from '@bc-agent/shared';

// Azurite connection for tests
const TEST_CONNECTION_STRING =
  process.env.STORAGE_CONNECTION_STRING_TEST ||
  process.env.STORAGE_CONNECTION_STRING ||
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

const TEST_CONTAINER = 'chat-attachments-test';

describe('ChatAttachmentService Integration', () => {
  setupDatabaseForTests();

  let factory: TestSessionFactory;
  let service: ChatAttachmentService;
  const createdAttachmentIds: string[] = [];

  beforeAll(async () => {
    factory = createTestSessionFactory();

    // Initialize file upload service with test container
    __resetFileUploadService();
    getFileUploadService(TEST_CONTAINER, TEST_CONNECTION_STRING);

    // Reset chat attachment service
    __resetChatAttachmentService();
    service = getChatAttachmentService();
  }, TEST_TIMEOUTS.BEFORE_ALL);

  afterAll(async () => {
    // Clean up all test attachments from database
    for (const attachmentId of createdAttachmentIds) {
      try {
        await executeQuery('DELETE FROM chat_attachments WHERE id = @id', { id: attachmentId });
      } catch {
        // Ignore cleanup errors
      }
    }

    await cleanupAllTestData();
    __resetChatAttachmentService();
    __resetFileUploadService();
  }, TEST_TIMEOUTS.AFTER_ALL);

  beforeEach(() => {
    __resetChatAttachmentService();
    service = getChatAttachmentService();
  });

  afterEach(async () => {
    // Clean up attachments created in each test
    for (const attachmentId of createdAttachmentIds) {
      try {
        await executeQuery('DELETE FROM chat_attachments WHERE id = @id', { id: attachmentId });
      } catch {
        // Ignore cleanup errors
      }
    }
    createdAttachmentIds.length = 0;
  });

  describe('uploadAttachment', () => {
    it('should upload a PDF attachment and persist to database', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_upload_' });
      const session = await factory.createChatSession(user.id, { title: 'Test Session' });

      const pdfContent = Buffer.from('%PDF-1.4\ntest content');
      const result = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'test-document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfContent.length,
        buffer: pdfContent,
      });

      createdAttachmentIds.push(result.id);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('test-document.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.sizeBytes).toBe(pdfContent.length);
      expect(result.status).toBe('ready');
      expect(result.sessionId).toBe(session.id);
      expect(result.userId).toBe(user.id);
      expect(result.expiresAt).toBeDefined();

      // Verify in database
      const dbResult = await executeQuery<{ id: string; name: string }>(
        'SELECT id, name FROM chat_attachments WHERE id = @id',
        { id: result.id }
      );
      expect(dbResult.recordset.length).toBe(1);
      expect(dbResult.recordset[0].name).toBe('test-document.pdf');
    });

    it('should upload an image attachment', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_img_' });
      const session = await factory.createChatSession(user.id, { title: 'Image Test' });

      // Minimal PNG content
      const pngContent = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

      const result = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'test-image.png',
        mimeType: 'image/png',
        sizeBytes: pngContent.length,
        buffer: pngContent,
      });

      createdAttachmentIds.push(result.id);

      expect(result.mimeType).toBe('image/png');
      expect(result.status).toBe('ready');
    });

    it('should set correct expiration time based on TTL', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_ttl_' });
      const session = await factory.createChatSession(user.id, { title: 'TTL Test' });

      const content = Buffer.from('%PDF-1.4\nttl test');
      const customTtlHours = 48;

      const result = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'ttl-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
        ttlHours: customTtlHours,
      });

      createdAttachmentIds.push(result.id);

      const expiresAt = new Date(result.expiresAt);
      const now = new Date();
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Should be approximately 48 hours (allow 1 minute tolerance)
      expect(diffHours).toBeGreaterThan(customTtlHours - 0.02);
      expect(diffHours).toBeLessThan(customTtlHours + 0.02);
    });
  });

  describe('getAttachment', () => {
    it('should retrieve an attachment by ID', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_get_' });
      const session = await factory.createChatSession(user.id, { title: 'Get Test' });

      const content = Buffer.from('%PDF-1.4\nget test');
      const uploaded = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'get-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded.id);

      const result = await service.getAttachment(user.id, uploaded.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(uploaded.id);
      expect(result!.name).toBe('get-test.pdf');
    });

    it('should return null for non-existent attachment', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_get_none_' });
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const result = await service.getAttachment(user.id, fakeId);

      expect(result).toBeNull();
    });

    it('should enforce multi-tenant isolation (user cannot access other user attachments)', async () => {
      // Create two users
      const user1 = await factory.createTestUser({ prefix: 'chat_attach_iso1_' });
      const user2 = await factory.createTestUser({ prefix: 'chat_attach_iso2_' });
      const session1 = await factory.createChatSession(user1.id, { title: 'User1 Session' });

      // User1 uploads an attachment
      const content = Buffer.from('%PDF-1.4\nisolation test');
      const uploaded = await service.uploadAttachment({
        userId: user1.id,
        sessionId: session1.id,
        fileName: 'user1-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded.id);

      // User1 can access it
      const resultUser1 = await service.getAttachment(user1.id, uploaded.id);
      expect(resultUser1).not.toBeNull();

      // User2 cannot access it
      const resultUser2 = await service.getAttachment(user2.id, uploaded.id);
      expect(resultUser2).toBeNull();
    });
  });

  describe('getAttachmentsBySession', () => {
    it('should list all attachments for a session', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_list_' });
      const session = await factory.createChatSession(user.id, { title: 'List Test' });

      // Upload multiple attachments
      const content1 = Buffer.from('%PDF-1.4\nfile 1');
      const content2 = Buffer.from('%PDF-1.4\nfile 2');

      const uploaded1 = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'file1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content1.length,
        buffer: content1,
      });

      const uploaded2 = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'file2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content2.length,
        buffer: content2,
      });

      createdAttachmentIds.push(uploaded1.id, uploaded2.id);

      const result = await service.getAttachmentsBySession(user.id, session.id);

      expect(result.length).toBe(2);
      const names = result.map((a) => a.name);
      expect(names).toContain('file1.pdf');
      expect(names).toContain('file2.pdf');
    });

    it('should return empty array for session with no attachments', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_empty_' });
      const session = await factory.createChatSession(user.id, { title: 'Empty Session' });

      const result = await service.getAttachmentsBySession(user.id, session.id);

      expect(result).toEqual([]);
    });
  });

  describe('getAttachmentsByIds', () => {
    it('should retrieve multiple attachments by IDs', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_ids_' });
      const session = await factory.createChatSession(user.id, { title: 'IDs Test' });

      const content = Buffer.from('%PDF-1.4\nids test');

      const uploaded1 = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'ids1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      const uploaded2 = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'ids2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded1.id, uploaded2.id);

      const result = await service.getAttachmentsByIds(user.id, [uploaded1.id, uploaded2.id]);

      expect(result.length).toBe(2);
    });

    it('should filter out non-existent IDs', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_filter_' });
      const session = await factory.createChatSession(user.id, { title: 'Filter Test' });

      const content = Buffer.from('%PDF-1.4\nfilter test');

      const uploaded = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'filter.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded.id);

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const result = await service.getAttachmentsByIds(user.id, [uploaded.id, fakeId]);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe(uploaded.id);
    });
  });

  describe('deleteAttachment', () => {
    it('should soft delete an attachment', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_del_' });
      const session = await factory.createChatSession(user.id, { title: 'Delete Test' });

      const content = Buffer.from('%PDF-1.4\ndelete test');

      const uploaded = await service.uploadAttachment({
        userId: user.id,
        sessionId: session.id,
        fileName: 'delete.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded.id);

      // Delete it
      const deleteResult = await service.deleteAttachment(user.id, uploaded.id);
      expect(deleteResult).not.toBeNull();

      // Should not be retrievable anymore
      const getResult = await service.getAttachment(user.id, uploaded.id);
      expect(getResult).toBeNull();

      // But should still exist in DB with is_deleted = 1
      const dbResult = await executeQuery<{ is_deleted: boolean }>(
        'SELECT is_deleted FROM chat_attachments WHERE id = @id',
        { id: uploaded.id }
      );
      expect(dbResult.recordset.length).toBe(1);
      expect(dbResult.recordset[0].is_deleted).toBe(true);
    });

    it('should return null when deleting non-existent attachment', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_del_none_' });
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const result = await service.deleteAttachment(user.id, fakeId);

      expect(result).toBeNull();
    });

    it('should enforce multi-tenant isolation on delete', async () => {
      const user1 = await factory.createTestUser({ prefix: 'chat_attach_del_iso1_' });
      const user2 = await factory.createTestUser({ prefix: 'chat_attach_del_iso2_' });
      const session1 = await factory.createChatSession(user1.id, { title: 'Del Isolation' });

      const content = Buffer.from('%PDF-1.4\ndel isolation');

      const uploaded = await service.uploadAttachment({
        userId: user1.id,
        sessionId: session1.id,
        fileName: 'del-iso.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        buffer: content,
      });

      createdAttachmentIds.push(uploaded.id);

      // User2 tries to delete User1's attachment
      const result = await service.deleteAttachment(user2.id, uploaded.id);
      expect(result).toBeNull();

      // Attachment should still exist for User1
      const stillExists = await service.getAttachment(user1.id, uploaded.id);
      expect(stillExists).not.toBeNull();
    });
  });

  describe('markExpiredForDeletion', () => {
    it('should mark expired attachments as deleted', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_exp_' });
      const session = await factory.createChatSession(user.id, { title: 'Expiration Test' });

      // Manually insert an expired attachment (expires_at in the past)
      const attachmentId = crypto.randomUUID().toUpperCase();
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

      await executeQuery(
        `INSERT INTO chat_attachments
         (id, user_id, session_id, name, mime_type, size_bytes, blob_path, expires_at, is_deleted)
         VALUES (@id, @userId, @sessionId, @name, @mimeType, @sizeBytes, @blobPath, @expiresAt, 0)`,
        {
          id: attachmentId,
          userId: user.id,
          sessionId: session.id,
          name: 'expired.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          blobPath: 'test/expired.pdf',
          expiresAt: pastDate,
        }
      );

      createdAttachmentIds.push(attachmentId);

      // Mark expired
      const markedCount = await service.markExpiredForDeletion();

      // Should have marked at least 1
      expect(markedCount).toBeGreaterThanOrEqual(1);

      // Verify it's marked as deleted
      const dbResult = await executeQuery<{ is_deleted: boolean }>(
        'SELECT is_deleted FROM chat_attachments WHERE id = @id',
        { id: attachmentId }
      );
      expect(dbResult.recordset[0].is_deleted).toBe(true);
    });
  });

  describe('hardDeleteAttachments', () => {
    it('should permanently delete attachment records', async () => {
      const user = await factory.createTestUser({ prefix: 'chat_attach_hard_' });
      const session = await factory.createChatSession(user.id, { title: 'Hard Delete Test' });

      // Insert a soft-deleted attachment
      const attachmentId = crypto.randomUUID().toUpperCase();
      const pastDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago

      await executeQuery(
        `INSERT INTO chat_attachments
         (id, user_id, session_id, name, mime_type, size_bytes, blob_path, expires_at, is_deleted, deleted_at)
         VALUES (@id, @userId, @sessionId, @name, @mimeType, @sizeBytes, @blobPath, @expiresAt, 1, @deletedAt)`,
        {
          id: attachmentId,
          userId: user.id,
          sessionId: session.id,
          name: 'hard-delete.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          blobPath: 'test/hard-delete.pdf',
          expiresAt: pastDate,
          deletedAt: pastDate,
        }
      );

      // Don't add to createdAttachmentIds since we're hard deleting

      // Hard delete
      const deletedCount = await service.hardDeleteAttachments([attachmentId]);

      expect(deletedCount).toBe(1);

      // Verify it's completely gone
      const dbResult = await executeQuery(
        'SELECT id FROM chat_attachments WHERE id = @id',
        { id: attachmentId }
      );
      expect(dbResult.recordset.length).toBe(0);
    });
  });
});
