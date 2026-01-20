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

vi.mock('@/domains/chat-attachments/ChatAttachmentService', () => ({
  getChatAttachmentService: vi.fn(() => ({
    getAttachmentRecord: mockGetAttachmentRecord,
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

    it('should resolve CSV files to document content blocks', async () => {
      const csvRecord = ChatAttachmentFixture.Presets.csvAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(csvRecord);

      const results = await resolver.resolve(testUserId, [csvRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[0]!.contentBlock.source.media_type).toBe('text/csv');
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

  // ========== SUITE 5: resolve() - Word/Excel documents ==========
  describe('resolve() - Word/Excel documents', () => {
    it('should resolve Word documents to document content blocks', async () => {
      const wordRecord = ChatAttachmentFixture.Presets.wordAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(wordRecord);

      const results = await resolver.resolve(testUserId, [wordRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[0]!.contentBlock.source.media_type).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });

    it('should resolve Excel spreadsheets to document content blocks', async () => {
      const excelRecord = ChatAttachmentFixture.Presets.excelAttachment(testUserId);
      mockGetAttachmentRecord.mockResolvedValueOnce(excelRecord);

      const results = await resolver.resolve(testUserId, [excelRecord.id]);

      expect(results).toHaveLength(1);
      expect(results[0]!.contentBlock.type).toBe('document');
      expect(results[0]!.contentBlock.source.media_type).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    });
  });
});
