/**
 * FileChunkingService Unit Tests
 *
 * Tests the file chunking service that bridges text extraction and embedding generation.
 *
 * @module __tests__/unit/services/files/FileChunkingService.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileChunkingService, getFileChunkingService } from '../../../../services/files/FileChunkingService';
import type { FileChunkingJob } from '../../../../services/queue/MessageQueue';
import { executeQuery } from '@/infrastructure/database/database';

// Mock dependencies
vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn(),
}));

const mockExecuteQuery = vi.mocked(executeQuery);

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-chunk-uuid'),
}));

// Mock ChunkingStrategyFactory
vi.mock('../../../../services/chunking/ChunkingStrategyFactory', () => ({
  ChunkingStrategyFactory: {
    createForFileType: vi.fn(() => ({
      chunk: vi.fn(() => [
        { text: 'Chunk 1 content', chunkIndex: 0, tokenCount: 100, startOffset: 0, endOffset: 100 },
        { text: 'Chunk 2 content', chunkIndex: 1, tokenCount: 120, startOffset: 80, endOffset: 200 },
      ]),
    })),
  },
}));

// Mock MessageQueue
vi.mock('../../../../services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addEmbeddingGenerationJob: vi.fn(() => Promise.resolve('mock-embedding-job-id')),
  })),
}));

describe('FileChunkingService', () => {
  let service: FileChunkingService;

  beforeEach(() => {
    // Reset singleton
    FileChunkingService.resetInstance();

    // Get fresh instance
    service = getFileChunkingService();

    // Clear mock calls
    mockExecuteQuery.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    FileChunkingService.resetInstance();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getFileChunkingService();
      const instance2 = getFileChunkingService();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = getFileChunkingService();
      FileChunkingService.resetInstance();
      const instance2 = getFileChunkingService();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('processFileChunks', () => {
    const mockJobData: FileChunkingJob = {
      fileId: 'test-file-id',
      userId: 'test-user-id',
      sessionId: 'test-session-id',
      mimeType: 'text/plain',
    };

    it('should throw error if file not found', async () => {
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow(
        'File not found: test-file-id'
      );
    });

    it('should return early if no extracted text', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'test-file-id',
          user_id: 'test-user-id',
          mime_type: 'text/plain',
          extracted_text: null,
          processing_status: 'completed',
          embedding_status: 'pending',
        }],
      });

      const result = await service.processFileChunks(mockJobData);

      expect(result).toEqual({
        fileId: 'test-file-id',
        chunkCount: 0,
        totalTokens: 0,
      });
    });

    it('should throw error if processing not completed', async () => {
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'test-file-id',
          user_id: 'test-user-id',
          mime_type: 'text/plain',
          extracted_text: 'Some text content',
          processing_status: 'processing',
          embedding_status: 'pending',
        }],
      });

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow(
        'File processing not completed: processing'
      );
    });

    it('should process file and return correct result', async () => {
      // Mock file query
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [{
            id: 'test-file-id',
            user_id: 'test-user-id',
            mime_type: 'text/plain',
            extracted_text: 'This is the extracted text content from the file.',
            processing_status: 'completed',
            embedding_status: 'pending',
          }],
        })
        // Mock update embedding status to 'processing'
        .mockResolvedValueOnce({ recordset: [] })
        // Mock insert chunk 1
        .mockResolvedValueOnce({ recordset: [] })
        // Mock insert chunk 2
        .mockResolvedValueOnce({ recordset: [] })
        // Mock update embedding status to 'queued'
        .mockResolvedValueOnce({ recordset: [] });

      const result = await service.processFileChunks(mockJobData);

      expect(result).toEqual({
        fileId: 'test-file-id',
        chunkCount: 2,
        totalTokens: 220, // 100 + 120
        embeddingJobId: 'mock-embedding-job-id',
      });
    });

    it('should update embedding status to failed on error', async () => {
      // Mock file query
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [{
            id: 'test-file-id',
            user_id: 'test-user-id',
            mime_type: 'text/plain',
            extracted_text: 'Some content',
            processing_status: 'completed',
            embedding_status: 'pending',
          }],
        })
        // Mock update embedding status to 'processing'
        .mockResolvedValueOnce({ recordset: [] })
        // Mock chunk insert failure
        .mockRejectedValueOnce(new Error('Database error'));

      // Should also update status to 'failed' on error
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow('Database error');

      // Verify status was updated to 'failed'
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('embedding_status'),
        expect.objectContaining({ status: 'failed' })
      );
    });
  });
});
