/**
 * AttachmentContentResolver Unit Tests
 *
 * TDD tests for resolving chat attachments to Anthropic content blocks.
 *
 * Methods covered:
 * - resolve(): Download blobs and convert to content blocks
 * - Handles PDFs -> document blocks
 * - Handles images -> image blocks
 * - Multi-tenant isolation
 * - Error handling for missing/expired attachments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatAttachmentFixture } from '../../../fixtures/ChatAttachmentFixture';
import type { ChatAttachmentDbRecord } from '@bc-agent/shared';

// ===== MOCK DATABASE (vi.hoisted pattern) =====
const mockExecuteQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] })
);

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// ===== MOCK LOGGER (vi.hoisted pattern) =====
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// ===== MOCK FILE UPLOAD SERVICE (for blob operations) =====
const mockDownloadFromBlob = vi.hoisted(() =>
  vi.fn().mockResolvedValue(Buffer.from('test content'))
);

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    downloadFromBlob: mockDownloadFromBlob,
  })),
}));

// ===== MOCK CHAT ATTACHMENT SERVICE =====
const mockGetAttachmentRecord = vi.hoisted(() => vi.fn());
const mockEnsureAnthropicFileUpload = vi.hoisted(() => vi.fn());

vi.mock('@/domains/chat-attachments/ChatAttachmentService', () => ({
  getChatAttachmentService: vi.fn(() => ({
    getAttachmentRecord: mockGetAttachmentRecord,
    ensureAnthropicFileUpload: mockEnsureAnthropicFileUpload,
  })),
}));

// Import after mocks
import {
  AttachmentContentResolver,
  getAttachmentContentResolver,
  __resetAttachmentContentResolver,
} from '@/domains/chat-attachments/AttachmentContentResolver';

describe('AttachmentContentResolver', () => {
  let resolver: AttachmentContentResolver;

  const testUserId = 'USER-TEST-123';
  const testAttachmentId = 'ATTACHMENT-TEST-456';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singleton
    __resetAttachmentContentResolver();
    resolver = getAttachmentContentResolver();

    // Default mock implementations
    mockDownloadFromBlob.mockResolvedValue(Buffer.from('test file content'));
    mockEnsureAnthropicFileUpload.mockResolvedValue('anthropic-file-id-123');
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getAttachmentContentResolver();
      const instance2 = getAttachmentContentResolver();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getAttachmentContentResolver();
      __resetAttachmentContentResolver();
      const instance2 = getAttachmentContentResolver();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: resolve() - Basic functionality ==========
  describe('resolve() - Basic functionality', () => {
    it('should resolve a single PDF attachment to document content block', async () => {
      const pdfRecord = ChatAttachmentFixture.Presets.pdfAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(pdfRecord);

      const results = await resolver.resolve(testUserId, [pdfRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[0]!.contentBlock.source.media_type).toBe('application/pdf');
      expect(results[0]!.contentBlock.source.type).toBe('base64');
    });

    it('should resolve an image attachment to image content block', async () => {
      const imageRecord = ChatAttachmentFixture.Presets.imageAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(imageRecord);

      const results = await resolver.resolve(testUserId, [imageRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('image');
      expect(results[0]!.contentBlock.source.media_type).toBe('image/jpeg');
    });

    it('should resolve PNG images to image content blocks', async () => {
      const pngRecord = ChatAttachmentFixture.Presets.pngAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(pngRecord);

      const results = await resolver.resolve(testUserId, [pngRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('image');
      expect(results[0]!.contentBlock.source.media_type).toBe('image/png');
    });

    it('should resolve text files to document content blocks', async () => {
      const textRecord = ChatAttachmentFixture.Presets.textAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(textRecord);

      const results = await resolver.resolve(testUserId, [textRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[0]!.contentBlock.source.media_type).toBe('text/plain');
    });

    it('should resolve CSV files to container_upload blocks', async () => {
      const csvRecord = ChatAttachmentFixture.Presets.csvAttachment(testUserId);
      csvRecord.anthropic_file_id = 'file-csv-789';
      mockGetAttachmentRecord.mockResolvedValueOnce(csvRecord);

      const results = await resolver.resolve(testUserId, [csvRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('container_upload');
      expect(results[0]!.routingCategory).toBe('container_upload');
    });

    it('should encode file content as base64', async () => {
      const record = ChatAttachmentFixture.Presets.pdfAttachment(testUserId);
      const testContent = Buffer.from('Hello, World!');
      mockGetAttachmentRecord.mockResolvedValueOnce(record);
      mockDownloadFromBlob.mockResolvedValueOnce(testContent);

      const results = await resolver.resolve(testUserId, [record.id]);

      expect(results).toHaveLength(1);
      const base64Content = results[0]!.contentBlock.source.data;
      expect(Buffer.from(base64Content, 'base64').toString()).toBe('Hello, World!');
    });
  });

  // ========== SUITE 2: resolve() - Multiple attachments ==========
  describe('resolve() - Multiple attachments', () => {
    it('should resolve multiple attachments in order', async () => {
      const pdf = ChatAttachmentFixture.createDbRecord({
        id: 'PDF-ID',
        user_id: testUserId,
        name: 'document.pdf',
        mime_type: 'application/pdf',
      });
      const image = ChatAttachmentFixture.createDbRecord({
        id: 'IMAGE-ID',
        user_id: testUserId,
        name: 'photo.jpeg',
        mime_type: 'image/jpeg',
      });

      mockGetAttachmentRecord
        .mockResolvedValueOnce(pdf)
        .mockResolvedValueOnce(image);

      const results = await resolver.resolve(testUserId, ['PDF-ID', 'IMAGE-ID']);

      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('PDF-ID');
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[1]!.id).toBe('IMAGE-ID');
      expect(results[1]!.contentBlock.type).toBe('image');
    });

    it('should return empty array for empty ID list', async () => {
      const results = await resolver.resolve(testUserId, []);

      expect(results).toEqual([]);
      expect(mockGetAttachmentRecord).not.toHaveBeenCalled();
    });

    it('should skip attachments that are not found', async () => {
      const validRecord = ChatAttachmentFixture.createDbRecord({
        id: 'VALID-ID',
        user_id: testUserId,
      });

      mockGetAttachmentRecord
        .mockResolvedValueOnce(null) // First attachment not found
        .mockResolvedValueOnce(validRecord);

      const results = await resolver.resolve(testUserId, ['INVALID-ID', 'VALID-ID']);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('VALID-ID');
    });

    it('should skip attachments where download fails', async () => {
      const record1 = ChatAttachmentFixture.createDbRecord({
        id: 'ID-1',
        user_id: testUserId,
      });
      const record2 = ChatAttachmentFixture.createDbRecord({
        id: 'ID-2',
        user_id: testUserId,
      });

      mockGetAttachmentRecord
        .mockResolvedValueOnce(record1)
        .mockResolvedValueOnce(record2);

      mockDownloadFromBlob
        .mockRejectedValueOnce(new Error('Blob not found'))
        .mockResolvedValueOnce(Buffer.from('valid content'));

      const results = await resolver.resolve(testUserId, ['ID-1', 'ID-2']);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('ID-2');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: 'ID-1' }),
        expect.stringContaining('Failed to resolve')
      );
    });
  });

  // ========== SUITE 3: resolve() - Multi-tenant isolation ==========
  describe('resolve() - Multi-tenant isolation', () => {
    it('should pass userId to attachment service for ownership check', async () => {
      const record = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
      });

      mockGetAttachmentRecord.mockResolvedValueOnce(record);

      await resolver.resolve(testUserId, [testAttachmentId]);

      expect(mockGetAttachmentRecord).toHaveBeenCalledWith(testUserId, testAttachmentId);
    });

    it('should not return attachments owned by other users', async () => {
      // When service returns null (user doesn't own the attachment)
      mockGetAttachmentRecord.mockResolvedValueOnce(null);

      const results = await resolver.resolve(testUserId, [testAttachmentId]);

      expect(results).toEqual([]);
    });
  });

  // ========== SUITE 4: resolve() - Content block metadata ==========
  describe('resolve() - Content block metadata', () => {
    it('should include attachment metadata in result', async () => {
      const record = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
        name: 'report.pdf',
        mime_type: 'application/pdf',
      });

      mockGetAttachmentRecord.mockResolvedValueOnce(record);

      const results = await resolver.resolve(testUserId, [testAttachmentId]);

      expect(results[0]).toMatchObject({
        id: testAttachmentId,
        name: 'report.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('should include buffer in result for downstream use', async () => {
      const record = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
      });
      const testContent = Buffer.from('test content');

      mockGetAttachmentRecord.mockResolvedValueOnce(record);
      mockDownloadFromBlob.mockResolvedValueOnce(testContent);

      const results = await resolver.resolve(testUserId, [testAttachmentId]);

      expect(results[0]!.buffer).toEqual(testContent);
    });
  });

  // ========== SUITE 5: resolve() - Container upload routing (DOCX, XLSX, PPTX) ==========
  describe('resolve() - Container upload routing', () => {
    it('should route DOCX to container_upload block', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = 'file-docx-123';
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock).toEqual({
        type: 'container_upload',
        file_id: 'file-docx-123',
      });
      expect(results[0]!.routingCategory).toBe('container_upload');
      // Should NOT download blob for container_upload
      expect(mockDownloadFromBlob).not.toHaveBeenCalled();
    });

    it('should route XLSX to container_upload block', async () => {
      const excelRecord = ChatAttachmentFixture.Presets.excelAttachment(testUserId);
      excelRecord.anthropic_file_id = 'file-xlsx-456';
      mockGetAttachmentRecord.mockResolvedValueOnce(excelRecord);

      const results = await resolver.resolve(testUserId, [excelRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock).toEqual({
        type: 'container_upload',
        file_id: 'file-xlsx-456',
      });
      expect(results[0]!.routingCategory).toBe('container_upload');
    });

    it('should trigger ensureAnthropicFileUpload when file not yet uploaded', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = null; // Not yet uploaded
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);
      mockEnsureAnthropicFileUpload.mockResolvedValueOnce('file-new-upload-789');

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock).toEqual({
        type: 'container_upload',
        file_id: 'file-new-upload-789',
      });
      expect(mockEnsureAnthropicFileUpload).toHaveBeenCalledWith(
        wordRecord.id,
        testUserId
      );
    });

    it('should skip container_upload attachment when upload fails', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = null;
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);
      mockEnsureAnthropicFileUpload.mockRejectedValueOnce(new Error('Upload failed'));

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: wordRecord.id }),
        expect.stringContaining('Failed to upload to Anthropic Files API')
      );
    });

    it('should skip container_upload when ensureAnthropicFileUpload returns null', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = null;
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);
      mockEnsureAnthropicFileUpload.mockResolvedValueOnce(null);

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results).toHaveLength(0);
    });
  });

  // ========== SUITE 6: resolve() - Routing metadata ==========
  describe('resolve() - Routing metadata', () => {
    it('should return routing metadata when includeRoutingMetadata is true', async () => {
      const pdfRecord = ChatAttachmentFixture.Presets.pdfAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(pdfRecord);

      const result = await resolver.resolve(testUserId, [pdfRecord.id], { includeRoutingMetadata: true });

      expect(result).toHaveProperty('attachments');
      expect(result).toHaveProperty('routingMetadata');
      expect(result.routingMetadata).toEqual({
        hasContainerUploads: false,
        nonNativeTypes: [],
      });
      expect(result.attachments).toHaveLength(1);
    });

    it('should set hasContainerUploads when non-native types present', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = 'file-word-123';
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);

      const result = await resolver.resolve(testUserId, [wordRecord.id], { includeRoutingMetadata: true });

      expect(result.routingMetadata.hasContainerUploads).toBe(true);
      expect(result.routingMetadata.nonNativeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });

    it('should deduplicate nonNativeTypes', async () => {
      const word1 = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      word1.anthropic_file_id = 'file-word-1';
      const word2 = ChatAttachmentFixture.createDbRecord({
        user_id: testUserId,
        name: 'report2.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        anthropic_file_id: 'file-word-2',
      });

      mockGetAttachmentRecord
        .mockResolvedValueOnce(word1)
        .mockResolvedValueOnce(word2);

      const result = await resolver.resolve(
        testUserId,
        [word1.id, word2.id],
        { includeRoutingMetadata: true }
      );

      expect(result.routingMetadata.nonNativeTypes).toHaveLength(1);
    });

    it('should return empty metadata for empty input with includeRoutingMetadata', async () => {
      const result = await resolver.resolve(testUserId, [], { includeRoutingMetadata: true });

      expect(result).toEqual({
        attachments: [],
        routingMetadata: { hasContainerUploads: false, nonNativeTypes: [] },
      });
    });

    it('should handle mixed native and container_upload attachments', async () => {
      const pdf = ChatAttachmentFixture.Presets.pdfAttachment(testUserId);
      const word = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      word.anthropic_file_id = 'file-word-789';
      const image = ChatAttachmentFixture.Presets.imageAttachment(testUserId);

      mockGetAttachmentRecord
        .mockResolvedValueOnce(pdf)
        .mockResolvedValueOnce(word)
        .mockResolvedValueOnce(image);

      const result = await resolver.resolve(
        testUserId,
        [pdf.id, word.id, image.id],
        { includeRoutingMetadata: true }
      );

      expect(result.attachments).toHaveLength(3);
      expect(result.routingMetadata.hasContainerUploads).toBe(true);
      expect(result.routingMetadata.nonNativeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      // Verify routing categories on each attachment
      const pdfResult = result.attachments.find(a => a.name === 'document.pdf');
      const wordResult = result.attachments.find(a => a.name === 'report.docx');
      const imageResult = result.attachments.find(a => a.name === 'screenshot.jpeg');

      expect(pdfResult?.routingCategory).toBe('anthropic_native');
      expect(wordResult?.routingCategory).toBe('container_upload');
      expect(imageResult?.routingCategory).toBe('anthropic_native');
    });
  });

  // ========== SUITE 7: resolve() - routingCategory on results ==========
  describe('resolve() - routingCategory on results', () => {
    it('should set routingCategory to anthropic_native for PDF', async () => {
      const pdfRecord = ChatAttachmentFixture.Presets.pdfAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(pdfRecord);

      const results = await resolver.resolve(testUserId, [pdfRecord.id]);

      expect(results[0]!.routingCategory).toBe('anthropic_native');
    });

    it('should set routingCategory to anthropic_native for images', async () => {
      const imageRecord = ChatAttachmentFixture.Presets.imageAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(imageRecord);

      const results = await resolver.resolve(testUserId, [imageRecord.id]);

      expect(results[0]!.routingCategory).toBe('anthropic_native');
    });

    it('should set routingCategory to container_upload for DOCX', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      wordRecord.anthropic_file_id = 'file-123';
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results[0]!.routingCategory).toBe('container_upload');
    });
  });
});
