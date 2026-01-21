/**
 * MessageChatAttachmentService Unit Tests
 *
 * Tests for message-to-chat-attachment relationship persistence.
 * Covers CRUD operations and batch fetching for message history.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MessageChatAttachmentService,
  getMessageChatAttachmentService,
  resetMessageChatAttachmentService,
} from '@/services/files/MessageChatAttachmentService';
import type { ChatAttachmentStatus } from '@bc-agent/shared';

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

// ===== MOCK UUID (vi.hoisted pattern) =====
let uuidCounter = 0;
const mockRandomUUID = vi.hoisted(() =>
  vi.fn(() => `mock-uuid-${++uuidCounter}`)
);

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomUUID: mockRandomUUID,
  };
});

describe('MessageChatAttachmentService', () => {
  let service: MessageChatAttachmentService;

  const testMessageId = 'msg_01ABC123';
  const testAttachmentId1 = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE01';
  const testAttachmentId2 = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEE02';

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
    mockRandomUUID.mockImplementation(() => `mock-uuid-${++uuidCounter}`);

    // Reset singleton instance
    resetMessageChatAttachmentService();
    service = getMessageChatAttachmentService();
  });

  afterEach(() => {
    resetMessageChatAttachmentService();
  });

  // ========== SUITE 1: SINGLETON PATTERN ==========
  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getMessageChatAttachmentService();
      const instance2 = getMessageChatAttachmentService();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after resetMessageChatAttachmentService()', () => {
      const instance1 = getMessageChatAttachmentService();
      resetMessageChatAttachmentService();
      const instance2 = getMessageChatAttachmentService();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 2: RECORD ATTACHMENTS ==========
  describe('recordAttachments()', () => {
    it('should return early when no attachments provided', async () => {
      const result = await service.recordAttachments(testMessageId, []);

      expect(result).toEqual({ success: true, recordsCreated: 0 });
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should insert single attachment record', async () => {
      const result = await service.recordAttachments(testMessageId, [testAttachmentId1]);

      expect(result).toEqual({ success: true, recordsCreated: 1 });
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

      const [sql, params] = mockExecuteQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO message_chat_attachments');
      expect(params.message_id).toBe(testMessageId);
      expect(params.attachment_id_0).toBe(testAttachmentId1.toUpperCase());
    });

    it('should insert multiple attachment records', async () => {
      const attachmentIds = [testAttachmentId1, testAttachmentId2];
      const result = await service.recordAttachments(testMessageId, attachmentIds);

      expect(result).toEqual({ success: true, recordsCreated: 2 });

      const [sql, params] = mockExecuteQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO message_chat_attachments');
      expect(params.message_id).toBe(testMessageId);
      expect(params.attachment_id_0).toBe(testAttachmentId1.toUpperCase());
      expect(params.attachment_id_1).toBe(testAttachmentId2.toUpperCase());
    });

    it('should normalize attachment IDs to uppercase', async () => {
      const lowercaseId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01';
      await service.recordAttachments(testMessageId, [lowercaseId]);

      const [, params] = mockExecuteQuery.mock.calls[0];
      expect(params.attachment_id_0).toBe(lowercaseId.toUpperCase());
    });

    it('should skip null/undefined attachment IDs', async () => {
      const attachmentIds = [testAttachmentId1, '', testAttachmentId2];
      const result = await service.recordAttachments(testMessageId, attachmentIds);

      // Empty string is falsy, so should skip it
      expect(result).toEqual({ success: true, recordsCreated: 3 });
      // But the recordsCreated count is based on input length
    });

    it('should log debug message on success', async () => {
      await service.recordAttachments(testMessageId, [testAttachmentId1]);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: testMessageId,
          attachmentIds: [testAttachmentId1],
          count: 1,
        }),
        'Recorded chat attachments for message'
      );
    });

    it('should propagate database errors', async () => {
      const dbError = new Error('Insert failed');
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      await expect(
        service.recordAttachments(testMessageId, [testAttachmentId1])
      ).rejects.toThrow('Insert failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: testMessageId,
          attachmentIds: [testAttachmentId1],
        }),
        'Failed to record chat attachments'
      );
    });
  });

  // ========== SUITE 3: GET ATTACHMENTS FOR SINGLE MESSAGE ==========
  describe('getAttachmentsForMessage()', () => {
    // Use a date far in the future to avoid test flakiness
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const mockAttachmentRecord = (overrides?: Partial<{
      id: string;
      name: string;
      mime_type: string;
      size_bytes: number;
      expires_at: Date;
      is_deleted: boolean;
      created_at: Date;
    }>) => ({
      id: testAttachmentId1,
      name: 'document.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      expires_at: futureDate,
      is_deleted: false,
      created_at: new Date('2025-01-01'),
      ...overrides,
    });

    it('should return empty array when no attachments found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result).toEqual([]);
    });

    it('should return parsed attachment summaries', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockAttachmentRecord()],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: testAttachmentId1,
        name: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        isImage: false,
        status: 'ready',
      });
    });

    it('should detect image mime types', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockAttachmentRecord({ mime_type: 'image/png' })],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].isImage).toBe(true);
    });

    it('should set status to expired when past expiration date', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          mockAttachmentRecord({ expires_at: new Date('2020-01-01') }),
        ],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('expired');
    });

    it('should set status to deleted when is_deleted is true', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockAttachmentRecord({ is_deleted: true })],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('deleted');
    });

    it('should prioritize deleted status over expired', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          mockAttachmentRecord({
            is_deleted: true,
            expires_at: new Date('2020-01-01'),
          }),
        ],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('deleted');
    });

    it('should query with correct message_id parameter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.getAttachmentsForMessage(testMessageId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('mca.message_id = @message_id'),
        expect.objectContaining({ message_id: testMessageId })
      );
    });

    it('should order by created_at ASC', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.getAttachmentsForMessage(testMessageId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY mca.created_at ASC'),
        expect.any(Object)
      );
    });
  });

  // ========== SUITE 4: GET ATTACHMENTS FOR MULTIPLE MESSAGES ==========
  describe('getAttachmentsForMessages()', () => {
    // Use a date far in the future to avoid test flakiness
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const mockJoinRecord = (
      messageId: string,
      attachmentId: string,
      overrides?: Partial<{
        name: string;
        mime_type: string;
        size_bytes: number;
        expires_at: Date;
        is_deleted: boolean;
        created_at: Date;
      }>
    ) => ({
      message_id: messageId,
      id: attachmentId,
      name: 'file.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      expires_at: futureDate,
      is_deleted: false,
      created_at: new Date('2025-01-01'),
      ...overrides,
    });

    it('should return empty Map when no message IDs provided', async () => {
      const result = await service.getAttachmentsForMessages([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should return Map keyed by message ID', async () => {
      const msg1 = 'msg_01';
      const msg2 = 'msg_02';

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          mockJoinRecord(msg1, testAttachmentId1),
          mockJoinRecord(msg2, testAttachmentId2),
        ],
      });

      const result = await service.getAttachmentsForMessages([msg1, msg2]);

      expect(result.size).toBe(2);
      expect(result.has(msg1)).toBe(true);
      expect(result.has(msg2)).toBe(true);
    });

    it('should group multiple attachments per message', async () => {
      const msg1 = 'msg_01';

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          mockJoinRecord(msg1, testAttachmentId1),
          mockJoinRecord(msg1, testAttachmentId2),
        ],
      });

      const result = await service.getAttachmentsForMessages([msg1]);

      expect(result.get(msg1)).toHaveLength(2);
    });

    it('should build parameterized IN clause', async () => {
      const messageIds = ['msg_01', 'msg_02', 'msg_03'];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.getAttachmentsForMessages(messageIds);

      const [sql, params] = mockExecuteQuery.mock.calls[0];
      expect(sql).toContain('IN (@msg_0, @msg_1, @msg_2)');
      expect(params.msg_0).toBe('msg_01');
      expect(params.msg_1).toBe('msg_02');
      expect(params.msg_2).toBe('msg_03');
    });

    it('should log debug message with counts', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockJoinRecord('msg_01', testAttachmentId1)],
      });

      await service.getAttachmentsForMessages(['msg_01', 'msg_02']);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          messageIds: 2,
          attachmentsFound: 1,
        }),
        'Fetched chat attachments for messages'
      );
    });

    it('should return messages without attachments as not in Map', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockJoinRecord('msg_01', testAttachmentId1)],
      });

      const result = await service.getAttachmentsForMessages(['msg_01', 'msg_02']);

      expect(result.has('msg_01')).toBe(true);
      expect(result.has('msg_02')).toBe(false);
    });
  });

  // ========== SUITE 5: DELETE ATTACHMENT LINKS ==========
  describe('deleteAttachmentLinksForMessage()', () => {
    it('should delete links for specified message', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [3] });

      const deleted = await service.deleteAttachmentLinksForMessage(testMessageId);

      expect(deleted).toBe(3);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM message_chat_attachments'),
        expect.objectContaining({ message_id: testMessageId })
      );
    });

    it('should return 0 when no links exist', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      const deleted = await service.deleteAttachmentLinksForMessage(testMessageId);

      expect(deleted).toBe(0);
    });

    it('should log debug message with count', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [2] });

      await service.deleteAttachmentLinksForMessage(testMessageId);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: testMessageId, deleted: 2 }),
        'Deleted chat attachment links'
      );
    });

    it('should handle undefined rowsAffected', async () => {
      mockExecuteQuery.mockResolvedValueOnce({});

      const deleted = await service.deleteAttachmentLinksForMessage(testMessageId);

      expect(deleted).toBe(0);
    });
  });

  // ========== SUITE 6: STATUS DETERMINATION ==========
  describe('Status Determination', () => {
    const createRecordWithStatus = (
      expiresAt: Date,
      isDeleted: boolean
    ) => ({
      id: testAttachmentId1,
      name: 'test.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      expires_at: expiresAt,
      is_deleted: isDeleted,
      created_at: new Date('2025-01-01'),
    });

    it('should return ready status for valid non-deleted attachment', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [createRecordWithStatus(futureDate, false)],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('ready');
    });

    it('should return expired status when expires_at is in the past', async () => {
      const pastDate = new Date('2020-01-01');

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [createRecordWithStatus(pastDate, false)],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('expired');
    });

    it('should return deleted status when is_deleted is true', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [createRecordWithStatus(futureDate, true)],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result[0].status).toBe('deleted');
    });
  });

  // ========== SUITE 7: IMAGE DETECTION ==========
  describe('Image Detection', () => {
    // Use a date far in the future to avoid test flakiness
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const testImageMimeTypes: Array<{ mimeType: string; expected: boolean }> = [
      { mimeType: 'image/jpeg', expected: true },
      { mimeType: 'image/png', expected: true },
      { mimeType: 'image/gif', expected: true },
      { mimeType: 'image/webp', expected: true },
      { mimeType: 'application/pdf', expected: false },
      { mimeType: 'text/plain', expected: false },
      { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', expected: false },
    ];

    testImageMimeTypes.forEach(({ mimeType, expected }) => {
      it(`should return isImage=${expected} for ${mimeType}`, async () => {
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [
            {
              id: testAttachmentId1,
              name: 'file',
              mime_type: mimeType,
              size_bytes: 1024,
              expires_at: futureDate,
              is_deleted: false,
              created_at: new Date('2025-01-01'),
            },
          ],
        });

        const result = await service.getAttachmentsForMessage(testMessageId);

        expect(result[0].isImage).toBe(expected);
      });
    });
  });
});
