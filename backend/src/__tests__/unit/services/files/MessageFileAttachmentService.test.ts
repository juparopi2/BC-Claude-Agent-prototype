/**
 * MessageFileAttachmentService Unit Tests
 *
 * Phase 5: Chat Integration with Files - Ciclo 4
 * Tests for recording and retrieving file-message attachments in the database.
 *
 * Pattern: vi.hoisted() + mock executeQuery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFileAttachmentService } from '@/services/files/MessageFileAttachmentService';
import type { FileUsageType } from '@/services/files/citations/types';

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

// ===== MOCK crypto.randomUUID =====
let mockUuidCounter = 0;
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

describe('MessageFileAttachmentService', () => {
  let service: MessageFileAttachmentService;

  const testMessageId = 'msg-123';
  const testFileIds = ['file-1', 'file-2'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidCounter = 0;

    // Re-setup mock default
    mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

    // Create fresh instance
    service = new MessageFileAttachmentService();
  });

  // ========== RECORD ATTACHMENTS TESTS ==========
  describe('recordAttachments', () => {
    it('should insert direct attachments with correct SQL', async () => {
      const result = await service.recordAttachments(testMessageId, testFileIds, 'direct');

      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(2);

      // Verify SQL contains INSERT and correct values
      expect(mockExecuteQuery).toHaveBeenCalled();
      const callArgs = mockExecuteQuery.mock.calls[0];
      const sql = callArgs?.[0] as string;

      expect(sql).toContain('INSERT INTO message_file_attachments');
      expect(sql).toContain('message_id');
      expect(sql).toContain('file_id');
      expect(sql).toContain('usage_type');
    });

    it('should insert citations with usage_type=citation', async () => {
      await service.recordAttachments(testMessageId, ['file-1'], 'citation');

      const callArgs = mockExecuteQuery.mock.calls[0];
      const params = callArgs?.[1];

      // Check params contain 'citation' usage type
      expect(params).toHaveProperty('usage_type_0', 'citation');
    });

    it('should insert semantic_match with correct usage_type', async () => {
      await service.recordAttachments(testMessageId, ['file-1'], 'semantic_match');

      const callArgs = mockExecuteQuery.mock.calls[0];
      const params = callArgs?.[1];

      expect(params).toHaveProperty('usage_type_0', 'semantic_match');
    });

    it('should handle empty fileIds array without calling database', async () => {
      const result = await service.recordAttachments(testMessageId, [], 'direct');

      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(0);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should generate unique IDs for each attachment record', async () => {
      await service.recordAttachments(testMessageId, ['f1', 'f2', 'f3'], 'direct');

      const callArgs = mockExecuteQuery.mock.calls[0];
      const params = callArgs?.[1] as Record<string, string>;

      // Each record should have its own UUID
      expect(params['id_0']).toBe('mock-uuid-1');
      expect(params['id_1']).toBe('mock-uuid-2');
      expect(params['id_2']).toBe('mock-uuid-3');
    });

    it('should include relevanceScore when provided', async () => {
      await service.recordAttachments(testMessageId, ['file-1'], 'semantic_match', 0.85);

      const callArgs = mockExecuteQuery.mock.calls[0];
      const params = callArgs?.[1];

      expect(params).toHaveProperty('relevance_score_0', 0.85);
    });

    it('should set relevanceScore to null when not provided', async () => {
      await service.recordAttachments(testMessageId, ['file-1'], 'direct');

      const callArgs = mockExecuteQuery.mock.calls[0];
      const params = callArgs?.[1];

      expect(params).toHaveProperty('relevance_score_0', null);
    });

    it('should handle database errors gracefully', async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        service.recordAttachments(testMessageId, testFileIds, 'direct')
      ).rejects.toThrow('Database connection failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ========== GET ATTACHMENTS TESTS ==========
  describe('getAttachmentsForMessage', () => {
    it('should return attachments for a message', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          { file_id: 'f1', usage_type: 'direct', relevance_score: null, created_at: new Date() },
          { file_id: 'f2', usage_type: 'citation', relevance_score: 0.9, created_at: new Date() },
        ],
      });

      const result = await service.getAttachmentsForMessage(testMessageId);

      expect(result).toHaveLength(2);
      expect(result[0]?.fileId).toBe('f1');
      expect(result[0]?.usageType).toBe('direct');
      expect(result[1]?.fileId).toBe('f2');
      expect(result[1]?.usageType).toBe('citation');
      expect(result[1]?.relevanceScore).toBe(0.9);
    });

    it('should query with correct message_id parameter', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.getAttachmentsForMessage(testMessageId);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE message_id = @message_id'),
        expect.objectContaining({ message_id: testMessageId })
      );
    });

    it('should return empty array when no attachments found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      const result = await service.getAttachmentsForMessage('non-existent-msg');

      expect(result).toEqual([]);
    });

    it('should filter by usage_type when provided', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await service.getAttachmentsForMessage(testMessageId, 'citation');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND usage_type = @usage_type'),
        expect.objectContaining({
          message_id: testMessageId,
          usage_type: 'citation',
        })
      );
    });
  });

  // ========== DELETE ATTACHMENTS TESTS ==========
  describe('deleteAttachmentsForMessage', () => {
    it('should delete all attachments for a message', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [3] });

      const result = await service.deleteAttachmentsForMessage(testMessageId);

      expect(result).toBe(3);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM message_file_attachments'),
        expect.objectContaining({ message_id: testMessageId })
      );
    });

    it('should return 0 when no attachments deleted', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      const result = await service.deleteAttachmentsForMessage('no-attachments-msg');

      expect(result).toBe(0);
    });
  });

  // ========== BULK OPERATIONS TESTS ==========
  describe('recordMultipleUsageTypes', () => {
    it('should record both direct and citation attachments in separate calls', async () => {
      const directFiles = ['f1', 'f2'];
      const citedFiles = ['f3'];

      await service.recordMultipleUsageTypes(testMessageId, {
        direct: directFiles,
        citation: citedFiles,
      });

      // Should make separate calls for each usage type
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

      // First call for direct
      const firstCall = mockExecuteQuery.mock.calls[0];
      expect(firstCall?.[1]).toHaveProperty('usage_type_0', 'direct');

      // Second call for citation
      const secondCall = mockExecuteQuery.mock.calls[1];
      expect(secondCall?.[1]).toHaveProperty('usage_type_0', 'citation');
    });

    it('should skip empty arrays in bulk operation', async () => {
      await service.recordMultipleUsageTypes(testMessageId, {
        direct: ['f1'],
        citation: [],
      });

      // Should only call once for direct (citation is empty)
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });
});
