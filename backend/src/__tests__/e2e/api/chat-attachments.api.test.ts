/**
 * E2E API Tests: Chat Attachments Endpoints
 *
 * Tests the ephemeral chat attachment endpoints:
 * - POST /api/chat/attachments - Upload chat attachment
 * - GET /api/chat/attachments - List attachments for a session
 * - GET /api/chat/attachments/:id - Get single attachment
 * - DELETE /api/chat/attachments/:id - Delete attachment
 *
 * Chat attachments are ephemeral files sent directly to Anthropic
 * (not processed through RAG/embeddings like Knowledge Base files).
 *
 * @module __tests__/e2e/api/chat-attachments.api.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  createE2ETestClient,
  createTestSessionFactory,
  type E2ETestClient,
  type TestSessionFactory,
  type TestUser,
} from '../helpers';
import type { ParsedChatAttachment } from '@bc-agent/shared';

describe('E2E API: Chat Attachments Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;
  let testSessionId: string;

  beforeAll(async () => {
    // Create test user
    testUser = await factory.createTestUser({ prefix: 'chat_attach_' });

    // Create a session for the user
    const session = await factory.createSession(testUser.id, {
      title: 'Chat Attachments Test Session',
    });
    testSessionId = session.id;
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  // ============================================================================
  // POST /api/chat/attachments - Upload
  // ============================================================================

  describe('POST /api/chat/attachments', () => {
    it('should upload a PDF file successfully', async () => {
      // Create a minimal PDF buffer (simplified for testing)
      const pdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

      const response = await client.uploadFile(
        '/api/chat/attachments',
        pdfContent,
        'test-document.pdf',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(201);
      expect(response.ok).toBe(true);

      const body = response.body as { attachment: ParsedChatAttachment };
      expect(body.attachment).toBeDefined();
      expect(body.attachment.id).toBeDefined();
      expect(body.attachment.name).toBe('test-document.pdf');
      expect(body.attachment.mimeType).toBe('application/pdf');
      expect(body.attachment.status).toBe('ready');
      expect(body.attachment.sessionId).toBe(testSessionId);
    });

    it('should upload an image file successfully', async () => {
      // Create a minimal PNG buffer (1x1 pixel)
      const pngContent = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
        0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
        0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
        0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);

      const response = await client.uploadFile(
        '/api/chat/attachments',
        pngContent,
        'test-image.png',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(201);
      expect(response.ok).toBe(true);

      const body = response.body as { attachment: ParsedChatAttachment };
      expect(body.attachment).toBeDefined();
      expect(body.attachment.name).toBe('test-image.png');
      expect(body.attachment.mimeType).toBe('image/png');
    });

    it('should reject unsupported MIME types', async () => {
      const exeContent = Buffer.from('MZ'); // Minimal EXE header

      const response = await client.uploadFile(
        '/api/chat/attachments',
        exeContent,
        'malware.exe',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(400);
      expect(response.ok).toBe(false);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const content = Buffer.from('test content');

      const response = await unauthClient.uploadFile(
        '/api/chat/attachments',
        content,
        'test.txt',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(401);
    });

    it('should require sessionId', async () => {
      const content = Buffer.from('test content');

      const response = await client.uploadFile(
        '/api/chat/attachments',
        content,
        'test.pdf',
        {} // No sessionId
      );

      expect(response.status).toBe(400);
    });

    it('should validate sessionId format', async () => {
      const content = Buffer.from('%PDF-1.4\ntest');

      const response = await client.uploadFile(
        '/api/chat/attachments',
        content,
        'test.pdf',
        { sessionId: 'invalid-uuid' }
      );

      expect(response.status).toBe(400);
    });

    it('should respect custom TTL', async () => {
      const content = Buffer.from('%PDF-1.4\ntest');

      const response = await client.uploadFile(
        '/api/chat/attachments',
        content,
        'short-lived.pdf',
        { sessionId: testSessionId, ttlHours: '1' }
      );

      expect(response.status).toBe(201);

      const body = response.body as { attachment: ParsedChatAttachment };
      // Verify expiresAt is approximately 1 hour from now
      const expiresAt = new Date(body.attachment.expiresAt);
      const now = new Date();
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(0.9);
      expect(diffHours).toBeLessThan(1.1);
    });
  });

  // ============================================================================
  // GET /api/chat/attachments - List
  // ============================================================================

  describe('GET /api/chat/attachments', () => {
    let uploadedAttachmentId: string;

    beforeAll(async () => {
      // Upload an attachment to list
      const tempClient = createE2ETestClient();
      tempClient.setSessionCookie(testUser.sessionCookie);

      const content = Buffer.from('%PDF-1.4\nlist-test');
      const response = await tempClient.uploadFile(
        '/api/chat/attachments',
        content,
        'list-test.pdf',
        { sessionId: testSessionId }
      );

      const body = response.body as { attachment: ParsedChatAttachment };
      uploadedAttachmentId = body.attachment.id;
    });

    it('should list attachments for a session', async () => {
      const response = await client.get<{ attachments: ParsedChatAttachment[] }>(
        '/api/chat/attachments',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body.attachments)).toBe(true);
      expect(response.body.attachments.length).toBeGreaterThan(0);

      // Find our uploaded attachment
      const found = response.body.attachments.find(a => a.id === uploadedAttachmentId);
      expect(found).toBeDefined();
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();

      const response = await unauthClient.get(
        '/api/chat/attachments',
        { sessionId: testSessionId }
      );

      expect(response.status).toBe(401);
    });

    it('should require sessionId query parameter', async () => {
      const response = await client.get('/api/chat/attachments');

      expect(response.status).toBe(400);
    });

    it('should return empty array for session with no attachments', async () => {
      // Create a new session without attachments
      const emptySession = await factory.createSession(testUser.id, {
        title: 'Empty Session',
      });

      const response = await client.get<{ attachments: ParsedChatAttachment[] }>(
        '/api/chat/attachments',
        { sessionId: emptySession.id }
      );

      expect(response.status).toBe(200);
      expect(response.body.attachments).toEqual([]);
    });
  });

  // ============================================================================
  // GET /api/chat/attachments/:id - Get Single
  // ============================================================================

  describe('GET /api/chat/attachments/:id', () => {
    let attachmentId: string;

    beforeAll(async () => {
      const tempClient = createE2ETestClient();
      tempClient.setSessionCookie(testUser.sessionCookie);

      const content = Buffer.from('%PDF-1.4\nget-single-test');
      const response = await tempClient.uploadFile(
        '/api/chat/attachments',
        content,
        'get-single-test.pdf',
        { sessionId: testSessionId }
      );

      const body = response.body as { attachment: ParsedChatAttachment };
      attachmentId = body.attachment.id;
    });

    it('should get a single attachment by ID', async () => {
      const response = await client.get<{ attachment: ParsedChatAttachment }>(
        `/api/chat/attachments/${attachmentId}`
      );

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      expect(response.body.attachment.id).toBe(attachmentId);
      expect(response.body.attachment.name).toBe('get-single-test.pdf');
    });

    it('should return 404 for non-existent attachment', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await client.get(`/api/chat/attachments/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();

      const response = await unauthClient.get(`/api/chat/attachments/${attachmentId}`);

      expect(response.status).toBe(401);
    });

    it('should validate attachment ID format', async () => {
      const response = await client.get('/api/chat/attachments/invalid-uuid');

      expect(response.status).toBe(400);
    });

    it('should enforce multi-tenant isolation (cannot access other user attachments)', async () => {
      // Create another user
      const otherUser = await factory.createTestUser({ prefix: 'other_user_' });
      const otherSession = await factory.createSession(otherUser.id, {
        title: 'Other User Session',
      });

      // Upload attachment as other user
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      const content = Buffer.from('%PDF-1.4\nother-user-doc');
      const uploadResponse = await otherClient.uploadFile(
        '/api/chat/attachments',
        content,
        'other-user.pdf',
        { sessionId: otherSession.id }
      );

      const otherAttachmentId = (uploadResponse.body as { attachment: ParsedChatAttachment }).attachment.id;

      // Try to access other user's attachment with original client
      const response = await client.get(`/api/chat/attachments/${otherAttachmentId}`);

      // Should return 404 (not 403) to avoid leaking info about existence
      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // DELETE /api/chat/attachments/:id - Delete
  // ============================================================================

  describe('DELETE /api/chat/attachments/:id', () => {
    it('should delete an attachment', async () => {
      // First upload an attachment
      const content = Buffer.from('%PDF-1.4\ndelete-test');
      const uploadResponse = await client.uploadFile(
        '/api/chat/attachments',
        content,
        'delete-test.pdf',
        { sessionId: testSessionId }
      );

      const attachmentId = (uploadResponse.body as { attachment: ParsedChatAttachment }).attachment.id;

      // Delete it
      const deleteResponse = await client.delete(`/api/chat/attachments/${attachmentId}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.ok).toBe(true);

      // Verify it's gone
      const getResponse = await client.get(`/api/chat/attachments/${attachmentId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should return 404 for non-existent attachment', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000001';

      const response = await client.delete(`/api/chat/attachments/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const fakeId = '00000000-0000-0000-0000-000000000002';

      const response = await unauthClient.delete(`/api/chat/attachments/${fakeId}`);

      expect(response.status).toBe(401);
    });

    it('should enforce multi-tenant isolation (cannot delete other user attachments)', async () => {
      // Create another user and their attachment
      const otherUser = await factory.createTestUser({ prefix: 'delete_test_' });
      const otherSession = await factory.createSession(otherUser.id, {
        title: 'Delete Test Session',
      });

      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      const content = Buffer.from('%PDF-1.4\nother-user-delete');
      const uploadResponse = await otherClient.uploadFile(
        '/api/chat/attachments',
        content,
        'other-user-delete.pdf',
        { sessionId: otherSession.id }
      );

      const otherAttachmentId = (uploadResponse.body as { attachment: ParsedChatAttachment }).attachment.id;

      // Try to delete with original client
      const response = await client.delete(`/api/chat/attachments/${otherAttachmentId}`);

      // Should return 404 (not 403) to avoid leaking info
      expect(response.status).toBe(404);

      // Verify it wasn't deleted (other user can still access it)
      const verifyResponse = await otherClient.get(`/api/chat/attachments/${otherAttachmentId}`);
      expect(verifyResponse.status).toBe(200);
    });
  });
});
