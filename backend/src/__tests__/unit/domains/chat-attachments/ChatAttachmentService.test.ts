/**
 * ChatAttachmentService Unit Tests
 *
 * TDD tests for the ephemeral chat attachment service.
 * Tests are written BEFORE implementation following TDD methodology.
 *
 * Methods covered:
 * - uploadAttachment(): Create attachment record with TTL
 * - getAttachment(): Get single attachment with ownership validation
 * - getAttachmentsByIds(): Get multiple attachments for agent
 * - getAttachmentsBySession(): List attachments for a session
 * - deleteAttachment(): Soft delete attachment
 * - markExpiredForDeletion(): Mark expired attachments for cleanup
 * - hardDeleteMarkedAttachments(): Remove soft-deleted records
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatAttachmentDbRecord } from '@bc-agent/shared';
import { CHAT_ATTACHMENT_CONFIG } from '@bc-agent/shared';
import { ChatAttachmentFixture } from '../../../fixtures/ChatAttachmentFixture';

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
const mockUploadToBlob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDownloadFromBlob = vi.hoisted(() => vi.fn().mockResolvedValue(Buffer.from('test content')));
const mockDeleteFromBlob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGenerateBlobPath = vi.hoisted(() => vi.fn().mockReturnValue('chat-attachments/user/session/file.pdf'));

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    uploadToBlob: mockUploadToBlob,
    downloadFromBlob: mockDownloadFromBlob,
    deleteFromBlob: mockDeleteFromBlob,
    generateBlobPath: mockGenerateBlobPath,
  })),
}));

// Import service after mocks
import {
  ChatAttachmentService,
  getChatAttachmentService,
  __resetChatAttachmentService,
} from '@/domains/chat-attachments/ChatAttachmentService';

describe('ChatAttachmentService', () => {
  let service: ChatAttachmentService;

  const testUserId = 'USER-TEST-123';
  const testSessionId = 'SESSION-TEST-456';
  const testAttachmentId = 'ATTACHMENT-TEST-789';

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Reset singleton instance
    __resetChatAttachmentService();
    service = getChatAttachmentService();
  });

  // ========== SUITE 0: Singleton Pattern ==========
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getChatAttachmentService();
      const instance2 = getChatAttachmentService();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getChatAttachmentService();
      __resetChatAttachmentService();
      const instance2 = getChatAttachmentService();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 1: uploadAttachment ==========
  describe('uploadAttachment()', () => {
    const testBuffer = Buffer.from('test file content');
    const testFileName = 'document.pdf';
    const testMimeType = 'application/pdf';

    it('should create attachment record with default TTL (24 hours)', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord({
        user_id: testUserId,
        session_id: testSessionId,
        name: testFileName,
        mime_type: testMimeType,
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      const result = await service.uploadAttachment({
        userId: testUserId,
        sessionId: testSessionId,
        fileName: testFileName,
        mimeType: testMimeType,
        sizeBytes: testBuffer.length,
        buffer: testBuffer,
      });

      expect(result).toBeDefined();
      expect(result.userId).toBe(testUserId);
      expect(result.sessionId).toBe(testSessionId);
      expect(result.name).toBe(testFileName);
      expect(result.mimeType).toBe(testMimeType);
    });

    it('should create attachment record with custom TTL', async () => {
      const customTtlHours = 48;
      const mockRecord = ChatAttachmentFixture.createDbRecord({
        user_id: testUserId,
        session_id: testSessionId,
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      await service.uploadAttachment({
        userId: testUserId,
        sessionId: testSessionId,
        fileName: testFileName,
        mimeType: testMimeType,
        sizeBytes: testBuffer.length,
        buffer: testBuffer,
        ttlHours: customTtlHours,
      });

      // Verify TTL was passed to query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('expires_at'),
        expect.objectContaining({
          ttl_hours: customTtlHours,
        })
      );
    });

    it('should reject unsupported MIME types', async () => {
      await expect(
        service.uploadAttachment({
          userId: testUserId,
          sessionId: testSessionId,
          fileName: 'test.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
          buffer: Buffer.from('test'),
        })
      ).rejects.toThrow(/MIME type.*not supported/);
    });

    it('should reject documents exceeding 32MB', async () => {
      const largeBuffer = Buffer.alloc(33 * 1024 * 1024); // 33 MB

      await expect(
        service.uploadAttachment({
          userId: testUserId,
          sessionId: testSessionId,
          fileName: 'large.pdf',
          mimeType: 'application/pdf',
          sizeBytes: largeBuffer.length,
          buffer: largeBuffer,
        })
      ).rejects.toThrow(/exceeds maximum/);
    });

    it('should reject images exceeding 20MB', async () => {
      const largeBuffer = Buffer.alloc(21 * 1024 * 1024); // 21 MB

      await expect(
        service.uploadAttachment({
          userId: testUserId,
          sessionId: testSessionId,
          fileName: 'large.png',
          mimeType: 'image/png',
          sizeBytes: largeBuffer.length,
          buffer: largeBuffer,
        })
      ).rejects.toThrow(/exceeds maximum/);
    });

    it('should upload to blob storage before creating DB record', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord();

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      await service.uploadAttachment({
        userId: testUserId,
        sessionId: testSessionId,
        fileName: testFileName,
        mimeType: testMimeType,
        sizeBytes: testBuffer.length,
        buffer: testBuffer,
      });

      expect(mockUploadToBlob).toHaveBeenCalledWith(
        testBuffer,
        expect.any(String), // blob path
        testMimeType
      );
    });

    it('should generate UPPERCASE ID for new attachments', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord();

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      await service.uploadAttachment({
        userId: testUserId,
        sessionId: testSessionId,
        fileName: testFileName,
        mimeType: testMimeType,
        sizeBytes: testBuffer.length,
        buffer: testBuffer,
      });

      // Verify ID is uppercase in the query params
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: expect.stringMatching(/^[A-F0-9-]+$/),
        })
      );
    });
  });

  // ========== SUITE 2: getAttachment ==========
  describe('getAttachment()', () => {
    it('should return attachment when found and user is owner', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
        session_id: testSessionId,
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      const result = await service.getAttachment(testUserId, testAttachmentId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(testAttachmentId);
      expect(result!.userId).toBe(testUserId);
    });

    it('should return null when attachment not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      const result = await service.getAttachment(testUserId, 'NON-EXISTENT-ID');

      expect(result).toBeNull();
    });

    it('should enforce multi-tenant isolation with user_id filter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachment(testUserId, testAttachmentId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testAttachmentId,
          user_id: testUserId,
        })
      );
    });

    it('should exclude soft-deleted attachments', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachment(testUserId, testAttachmentId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = 0'),
        expect.anything()
      );
    });
  });

  // ========== SUITE 3: getAttachmentsByIds ==========
  describe('getAttachmentsByIds()', () => {
    it('should return multiple attachments for valid IDs', async () => {
      const mockRecords = [
        ChatAttachmentFixture.createDbRecord({ id: 'ID-1', user_id: testUserId }),
        ChatAttachmentFixture.createDbRecord({ id: 'ID-2', user_id: testUserId }),
      ];

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: mockRecords,
        rowsAffected: [2],
      });

      const result = await service.getAttachmentsByIds(testUserId, ['ID-1', 'ID-2']);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('ID-1');
      expect(result[1]!.id).toBe('ID-2');
    });

    it('should filter out expired attachments', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachmentsByIds(testUserId, ['ID-1', 'ID-2']);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should enforce multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachmentsByIds(testUserId, ['ID-1', 'ID-2']);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
        })
      );
    });

    it('should return empty array when no valid attachments found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      const result = await service.getAttachmentsByIds(testUserId, ['ID-1', 'ID-2']);

      expect(result).toEqual([]);
    });

    it('should return empty array for empty ID list', async () => {
      const result = await service.getAttachmentsByIds(testUserId, []);

      expect(result).toEqual([]);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 4: getAttachmentsBySession ==========
  describe('getAttachmentsBySession()', () => {
    it('should return all non-expired attachments for a session', async () => {
      const mockRecords = ChatAttachmentFixture.Presets.sessionWithMultipleAttachments(
        testUserId,
        testSessionId
      );

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: mockRecords,
        rowsAffected: [3],
      });

      const result = await service.getAttachmentsBySession(testUserId, testSessionId);

      expect(result).toHaveLength(3);
    });

    it('should enforce multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachmentsBySession(testUserId, testSessionId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = @user_id'),
        expect.objectContaining({
          user_id: testUserId,
          session_id: testSessionId,
        })
      );
    });

    it('should exclude soft-deleted attachments', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachmentsBySession(testUserId, testSessionId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = 0'),
        expect.anything()
      );
    });

    it('should order by created_at descending (newest first)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getAttachmentsBySession(testUserId, testSessionId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.anything()
      );
    });
  });

  // ========== SUITE 5: deleteAttachment ==========
  describe('deleteAttachment()', () => {
    it('should soft delete attachment and return blob path', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
        blob_path: 'chat-attachments/user/session/doc.pdf',
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      const result = await service.deleteAttachment(testUserId, testAttachmentId);

      expect(result).toBeDefined();
      expect(result!.blobPath).toBe('chat-attachments/user/session/doc.pdf');
    });

    it('should set is_deleted = 1 and deleted_at timestamp', async () => {
      const mockRecord = ChatAttachmentFixture.createDbRecord({
        id: testAttachmentId,
        user_id: testUserId,
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [mockRecord],
        rowsAffected: [1],
      });

      await service.deleteAttachment(testUserId, testAttachmentId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = 1'),
        expect.anything()
      );
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at = GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should return null when attachment not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      const result = await service.deleteAttachment(testUserId, 'NON-EXISTENT-ID');

      expect(result).toBeNull();
    });

    it('should enforce multi-tenant isolation', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.deleteAttachment(testUserId, testAttachmentId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @id AND user_id = @user_id'),
        expect.objectContaining({
          id: testAttachmentId,
          user_id: testUserId,
        })
      );
    });
  });

  // ========== SUITE 6: markExpiredForDeletion ==========
  describe('markExpiredForDeletion()', () => {
    it('should mark all expired attachments as deleted', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [5],
      });

      const count = await service.markExpiredForDeletion();

      expect(count).toBe(5);
    });

    it('should use GETUTCDATE() for expiration check', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.markExpiredForDeletion();

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('expires_at < GETUTCDATE()'),
        expect.anything()
      );
    });

    it('should only mark non-deleted attachments', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.markExpiredForDeletion();

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = 0'),
        expect.anything()
      );
    });

    it('should return 0 when no expired attachments', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      const count = await service.markExpiredForDeletion();

      expect(count).toBe(0);
    });
  });

  // ========== SUITE 7: getDeletedAttachments ==========
  describe('getDeletedAttachments()', () => {
    it('should return soft-deleted attachments for blob cleanup', async () => {
      const deletedRecords = [
        ChatAttachmentFixture.Presets.deletedAttachment(),
        ChatAttachmentFixture.Presets.deletedAttachment(),
      ];

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: deletedRecords,
        rowsAffected: [2],
      });

      const result = await service.getDeletedAttachments(100);

      expect(result).toHaveLength(2);
      expect(result[0]!.is_deleted).toBe(true);
    });

    it('should respect batch limit', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getDeletedAttachments(50);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('TOP (@limit)'),
        expect.objectContaining({
          limit: 50,
        })
      );
    });

    it('should only return records deleted beyond grace period', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      await service.getDeletedAttachments(100);

      // Should check deleted_at is older than grace period (24 hours)
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at < DATEADD'),
        expect.anything()
      );
    });
  });

  // ========== SUITE 8: hardDeleteAttachments ==========
  describe('hardDeleteAttachments()', () => {
    it('should permanently delete attachment records', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [3],
      });

      const count = await service.hardDeleteAttachments(['ID-1', 'ID-2', 'ID-3']);

      expect(count).toBe(3);
    });

    it('should delete from database (not soft delete)', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [1],
      });

      await service.hardDeleteAttachments(['ID-1']);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM chat_attachments'),
        expect.anything()
      );
    });

    it('should return 0 for empty ID list', async () => {
      const count = await service.hardDeleteAttachments([]);

      expect(count).toBe(0);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });
  });
});
