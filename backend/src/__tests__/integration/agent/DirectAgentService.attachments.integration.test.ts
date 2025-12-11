
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DirectAgentService } from '../../../services/agent/DirectAgentService';
import { FileFixture } from '../../fixtures/FileFixture';
import { getFileService } from '../../../services/files/FileService';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { createTestSessionFactory } from '../helpers/TestSessionFactory';
import { IAnthropicClient } from '../../../services/agent/IAnthropicClient';
import { initRedisClient, closeRedisClient } from '../../../config/redis-client';
import crypto from 'crypto';

// Mock Anthropic Client to avoid real API calls
const mockAnthropicClient = {
  createMessage: vi.fn(),
  createMessageStream: vi.fn(),
  createChatCompletion: vi.fn(),
  createChatCompletionStream: vi.fn().mockReturnValue((async function* () {
    yield { type: 'message_start', message: { id: 'msg_123', model: 'claude-3-5-sonnet', usage: { input_tokens: 10, output_tokens: 10 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_stop' };
  })()),
} as unknown as IAnthropicClient;

describe('DirectAgentService Attachments Integration', () => {
  setupDatabaseForTests({ skipRedis: true }); // We init redis-client manually below
  
  beforeAll(async () => {
    await initRedisClient();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  let agentService: DirectAgentService;
  let testFactory: ReturnType<typeof createTestSessionFactory>;
  let userId: string;
  let fileId: string;
  let otherUserFileId: string;
  let sessionId: string;

  beforeEach(async () => {
    testFactory = createTestSessionFactory();
    
    // Create test user
    const user = await testFactory.createTestUser();
    userId = user.id;

    // Create another user
    const otherUser = await testFactory.createTestUser({ prefix: 'other_' });

    // Create valid file for user
    const file = FileFixture.createFileDbRecord({ user_id: userId });
    await getFileService().createFileRecord({
      userId,
      name: file.name,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes!,
      blobPath: file.blob_path!,
      parentFolderId: null
    });
    fileId = file.id;

    // Wait, FileService.createFileRecord returns a new ID and ignores the input ID if not careful?
    // Let's check FileService.ts. It calls randomUUID(). 
    // So my fileId variable needs to be updated with the result of createFileRecord.
    // Re-doing creation logic below correctly.

    const id1 = await getFileService().createFileRecord({
      userId,
      name: 'test-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      blobPath: `users/${userId}/files/test-file.pdf`,
      parentFolderId: undefined
    });
    fileId = id1;

    const id2 = await getFileService().createFileRecord({
      userId: otherUser.id,
      name: 'other-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      blobPath: `users/${otherUser.id}/files/other-file.pdf`,
      parentFolderId: undefined
    });
    otherUserFileId = id2;

    // Initialize service with mock client
    agentService = new DirectAgentService(undefined, undefined, mockAnthropicClient);
    
    // Create session
    const session = await testFactory.createChatSession(userId);
    sessionId = session.id; 
  });

  afterEach(async () => {
    await testFactory.cleanup();
  });

  describe('executeQueryStreaming with attachments', () => {
    it('should accept valid attachments owned by the user', async () => {
      // Act
      const result = await agentService.executeQueryStreaming(
        'Analyze this file',
        sessionId,
        undefined,
        userId,
        {
          attachments: [fileId] // This triggers the new logic
        }
      );

      // Assert
      expect(result).toBeDefined();
    });

    it('should return error if attachment belongs to another user', async () => {
      // Act
      const result = await agentService.executeQueryStreaming(
        'Analyze this stolen file',
        sessionId,
        undefined,
        userId,
        {
          attachments: [otherUserFileId]
        }
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Access denied/i);
    });

    it('should return error if attachment does not exist', async () => {
      // Act
      const result = await agentService.executeQueryStreaming(
        'Analyze this ghost file',
        sessionId,
        undefined,
        userId,
        {
          attachments: [crypto.randomUUID()]
        }
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });
});
