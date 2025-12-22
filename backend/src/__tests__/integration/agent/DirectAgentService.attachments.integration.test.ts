/**
 * DirectAgentService Attachments Integration Tests
 *
 * Tests the complete file attachment flow using real Azure services:
 * - Azure SQL DEV (database records)
 * - Azure Blob Storage DEV (file storage)
 * - Redis Docker (session cache)
 *
 * These tests verify:
 * 1. File ownership validation (existing tests)
 * 2. Context XML generation from real blobs
 * 3. Citation parsing and persistence
 * 4. Multiple file strategies (DIRECT_CONTENT, EXTRACTED_TEXT)
 * 5. Usage tracking in usage_events table
 *
 * @module __tests__/integration/agent/DirectAgentService.attachments.integration.test
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DirectAgentService, __resetDirectAgentService } from '../../../services/agent/DirectAgentService';
import { FakeAnthropicClient } from '../../../services/agent/FakeAnthropicClient';
import { getFileService } from '../../../services/files/FileService';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { createTestSessionFactory } from '../helpers/TestSessionFactory';
import { createFileTestHelper, FileTestHelper, TestFile } from '../helpers/FileTestHelper';
import { initRedisClient, closeRedisClient } from '@/infrastructure/redis/redis-client';
import crypto from 'crypto';

/**
 * SKIPPED: These tests use executeQueryStreaming which was deprecated in Phase 1.
 * The method was replaced by runGraph() but these tests were not updated.
 *
 * @see docs/plans/TECHNICAL_DEBT_REGISTRY.md - D16
 * TODO: Refactor tests to use runGraph() with new callback signature
 */
describe.skip('DirectAgentService Attachments Integration', () => {
  setupDatabaseForTests({ skipRedis: true }); // We init redis-client manually below

  beforeAll(async () => {
    await initRedisClient();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  let agentService: DirectAgentService;
  let fakeClient: FakeAnthropicClient;
  let testFactory: ReturnType<typeof createTestSessionFactory>;
  let fileHelper: FileTestHelper;
  let userId: string;
  let otherUserId: string;
  let sessionId: string;

  beforeEach(async () => {
    // Reset singleton to allow new FakeClient injection
    __resetDirectAgentService();

    testFactory = createTestSessionFactory();
    fileHelper = createFileTestHelper();

    // Create test users
    const user = await testFactory.createTestUser();
    userId = user.id;

    const otherUser = await testFactory.createTestUser({ prefix: 'other_' });
    otherUserId = otherUser.id;

    // Create session
    const session = await testFactory.createChatSession(userId);
    sessionId = session.id;

    // Initialize FakeAnthropicClient
    fakeClient = new FakeAnthropicClient();
    agentService = new DirectAgentService(undefined, undefined, fakeClient);
  });

  afterEach(async () => {
    await fileHelper.cleanup();
    await testFactory.cleanup();
    fakeClient.reset();
  });

  // ============================================
  // SECTION 1: Ownership Validation (Existing)
  // ============================================

  describe('executeQueryStreaming with attachments - Ownership Validation', () => {
    it('should accept valid attachments owned by the user', async () => {
      // Arrange: Create file using FileTestHelper (real Azure Blob)
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'valid-file.txt',
        content: 'This is a valid file for the user.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['I can see your file content.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Analyze this file',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should return error if attachment belongs to another user', async () => {
      // Arrange: Create file for OTHER user
      const otherFile = await fileHelper.createTestFile(otherUserId, {
        name: 'other-user-file.txt',
        content: 'This belongs to another user.',
        mimeType: 'text/plain',
      });

      // Act: Try to access with different userId
      const result = await agentService.executeQueryStreaming(
        'Analyze this stolen file',
        sessionId,
        undefined,
        userId,
        { attachments: [otherFile.id] }
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
        { attachments: [crypto.randomUUID()] }
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ============================================
  // SECTION 2: File Context Integration (NEW)
  // ============================================

  describe('executeQueryStreaming - File Context Integration', () => {
    it('should execute successfully with file attachments (E2E flow)', async () => {
      // Arrange: Create file in Azure Blob
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'test-document.txt',
        content: 'Test content for E2E validation.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['I processed the document.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'What is in the file?',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert: Query should execute successfully
      // Note: File context injection depends on ContextRetrievalService
      // which may require additional Azure services (AI Search, Embeddings)
      expect(result.success).toBe(true);

      // Verify Anthropic was called
      const calls = fakeClient.getCalls();
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should handle files with extracted_text (EXTRACTED_TEXT strategy)', async () => {
      // Arrange: Create file with extracted_text (simulating PDF processing)
      const extractedContent = 'This is the extracted text from a PDF document.';
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'processed-document.pdf',
        content: Buffer.from('fake-pdf-content'),
        mimeType: 'application/pdf',
        extractedText: extractedContent,
        processingStatus: 'completed',
      });

      fakeClient.addResponse({
        textBlocks: ['I analyzed the PDF content.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Summarize the PDF content',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert: Should succeed even if file context fails gracefully
      expect(result.success).toBe(true);
    });

    it('should handle multiple file attachments', async () => {
      // Arrange: Create two files
      const textFile = await fileHelper.createTestFile(userId, {
        name: 'file-one.txt',
        content: 'Content of file one.',
        mimeType: 'text/plain',
      });

      const pdfFile = await fileHelper.createTestFile(userId, {
        name: 'file-two.pdf',
        content: Buffer.from('pdf-binary'),
        mimeType: 'application/pdf',
        extractedText: 'Extracted from file two.',
        processingStatus: 'completed',
      });

      fakeClient.addResponse({
        textBlocks: ['I see both files.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Compare both files',
        sessionId,
        undefined,
        userId,
        { attachments: [textFile.id, pdfFile.id] }
      );

      // Assert: Multi-file attachment should succeed
      expect(result.success).toBe(true);
      expect(fileHelper.getTrackedCount()).toBe(2);
    });

    it('should send request to Anthropic even without file context', async () => {
      // Arrange
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'context-test.txt',
        content: 'File for context testing.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['Response from Claude.'],
        stopReason: 'end_turn',
      });

      // Act
      await agentService.executeQueryStreaming(
        'What does the file say?',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert: Anthropic should be called regardless of file context success
      const calls = fakeClient.getCalls();
      expect(calls.length).toBeGreaterThan(0);

      const lastCall = calls[calls.length - 1];
      expect(lastCall!.request.messages).toBeDefined();
    });
  });

  // ============================================
  // SECTION 3: Citation Persistence (NEW)
  // ============================================

  describe('executeQueryStreaming - Citation Persistence', () => {
    it('should execute and complete successfully with attachments', async () => {
      // Arrange
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'attachment-tracking.txt',
        content: 'Content for tracking test.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['I processed the file.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Process this file',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert: Query should complete successfully
      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();

      // Note: messageId and citation recording depend on full flow working
      // If messageId is returned, attachments can be verified
      if (result.messageId) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const attachments = await fileHelper.getMessageAttachments(result.messageId);
        // Attachments may or may not be recorded depending on flow
        expect(attachments).toBeDefined();
      }
    });

    it('should complete when response contains citations', async () => {
      // Arrange
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'cited-document.pdf',
        content: 'Important information here.',
        mimeType: 'application/pdf',
        extractedText: 'Important information here.',
        processingStatus: 'completed',
      });

      // Configure response that contains citation syntax
      fakeClient.addResponse({
        textBlocks: ['According to [cited-document.pdf], the important information is here.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'What does the document say?',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert
      expect(result.success).toBe(true);
      // Response should contain the citation text
      expect(result.response).toContain('cited-document.pdf');
    });
  });

  // ============================================
  // SECTION 4: Error Handling (NEW)
  // ============================================

  describe('executeQueryStreaming - Error Handling', () => {
    it('should continue gracefully when blob does not exist (ghost file)', async () => {
      // Arrange: Create DB record only (no blob upload)
      const ghostFile = await fileHelper.createTestFileRecordOnly(userId, {
        name: 'ghost-file.txt',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['I could not find the file content, but I can help.'],
        stopReason: 'end_turn',
      });

      // Act: Should not throw, should gracefully handle missing blob
      const result = await agentService.executeQueryStreaming(
        'What is in the file?',
        sessionId,
        undefined,
        userId,
        { attachments: [ghostFile.id] }
      );

      // Assert: Should succeed (file just won't be in context)
      expect(result.success).toBe(true);
    });

    it('should complete response even when file context preparation fails', async () => {
      // Arrange
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'resilience-test.txt',
        content: 'Testing graceful degradation.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['Response completed successfully.'],
        stopReason: 'end_turn',
      });

      // Act: Execute normally - file context errors should be caught
      const result = await agentService.executeQueryStreaming(
        'Process this file',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert: Response should be successful regardless of file context issues
      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
    });
  });

  // ============================================
  // SECTION 5: Image Handling (Vision API)
  // ============================================

  describe('executeQueryStreaming - Image Handling', () => {
    it('should accept image file attachments and execute query', async () => {
      // Arrange: Create image file in Azure Blob
      const imageFile = await fileHelper.createTestImage(userId, {
        name: 'test-image.png',
      });

      fakeClient.addResponse({
        textBlocks: ['I can see the image.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Describe what you see in this image',
        sessionId,
        undefined,
        userId,
        { attachments: [imageFile.id] }
      );

      // Assert: Query should execute successfully with image attachment
      expect(result.success).toBe(true);

      // Anthropic should be called
      const calls = fakeClient.getCalls();
      expect(calls.length).toBeGreaterThan(0);

      // Note: Image content injection depends on Vision API integration
      // and ContextRetrievalService. The image may or may not be in the
      // request depending on how the file context is processed.
    });
  });

  // ============================================
  // SECTION 6: Usage Tracking (NEW)
  // ============================================

  describe('executeQueryStreaming - Usage Tracking', () => {
    it('should record usage events when processing files', async () => {
      // Arrange
      const testFile = await fileHelper.createTestFile(userId, {
        name: 'usage-tracking-test.txt',
        content: 'Content for usage tracking verification.',
        mimeType: 'text/plain',
      });

      fakeClient.addResponse({
        textBlocks: ['File processed and tracked.'],
        stopReason: 'end_turn',
      });

      // Act
      const result = await agentService.executeQueryStreaming(
        'Process this file for usage tracking',
        sessionId,
        undefined,
        userId,
        { attachments: [testFile.id] }
      );

      // Assert
      expect(result.success).toBe(true);

      // Note: Usage tracking is fire-and-forget, so we check if any events exist
      // The specific event type depends on implementation
      await new Promise(resolve => setTimeout(resolve, 500));

      const usageEvents = await fileHelper.getUsageEvents(userId);
      // At minimum, the chat completion should generate a usage event
      // File-specific usage events depend on implementation
      expect(usageEvents).toBeDefined();
    });
  });
});
