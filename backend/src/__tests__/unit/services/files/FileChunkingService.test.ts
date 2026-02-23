/**
 * FileChunkingService Unit Tests
 *
 * Tests the file chunking service that bridges text extraction and embedding generation.
 *
 * @module __tests__/unit/services/files/FileChunkingService.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileChunkingService, getFileChunkingService } from '../../../../services/files/FileChunkingService';
import type { FileChunkingJob } from '@/infrastructure/queue/MessageQueue';
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
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
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
vi.mock('@/infrastructure/queue/MessageQueue', () => ({
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
          pipeline_status: 'chunking',
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
          pipeline_status: 'extracting',
        }],
      });

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow(
        'File not in chunking status: extracting'
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
            pipeline_status: 'chunking',
          }],
        })
        // Mock insert chunk 1
        .mockResolvedValueOnce({ recordset: [] })
        // Mock insert chunk 2
        .mockResolvedValueOnce({ recordset: [] });

      const result = await service.processFileChunks(mockJobData);

      expect(result).toEqual({
        fileId: 'test-file-id',
        chunkCount: 2,
        totalTokens: 220, // 100 + 120
        embeddingJobId: undefined,
      });
    });

    it('should rethrow error on chunk insert failure', async () => {
      // Mock file query
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [{
            id: 'test-file-id',
            user_id: 'test-user-id',
            mime_type: 'text/plain',
            extracted_text: 'Some content',
            pipeline_status: 'chunking',
          }],
        })
        // Mock chunk insert failure
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow('Database error');
    });
  });

  describe('processFileChunks - image files', () => {
    const mockImageJobData: FileChunkingJob = {
      fileId: 'test-image-id',
      userId: 'test-user-id',
      sessionId: 'test-session-id',
      mimeType: 'image/jpeg',
    };

    it('should index image embedding with contentVector when caption exists', async () => {
      const mockEmbeddingRecord = {
        embedding: new Array(1024).fill(0.1),
        caption: 'An invoice from Acme Corp',
      };

      const mockCaptionEmbedding = {
        embedding: new Array(1536).fill(0.2),
        model: 'text-embedding-3-small',
        tokenCount: 5,
      };

      const mockIndexImageEmbedding = vi.fn().mockResolvedValue('img_TEST-IMAGE-ID');

      // Mock updateEmbeddingStatus (processing)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock ImageEmbeddingRepository
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(mockEmbeddingRecord),
        }),
      }));

      // Mock file name query
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ name: 'invoice.jpg', mime_type: 'image/jpeg' }],
      });

      // Mock EmbeddingService for caption text embedding
      vi.doMock('@/services/embeddings/EmbeddingService', () => ({
        EmbeddingService: {
          getInstance: () => ({
            generateTextEmbedding: vi.fn().mockResolvedValue(mockCaptionEmbedding),
          }),
        },
      }));

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

      // Mock updateEmbeddingStatus (completed)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock FileEventEmitter
      vi.doMock('@/domains/files/emission/FileEventEmitter', () => ({
        getFileEventEmitter: () => ({
          emitReadinessChanged: vi.fn(),
        }),
      }));
      vi.doMock('@bc-agent/shared', () => ({
        FILE_READINESS_STATE: { PROCESSING: 'processing', READY: 'ready' },
      }));

      const result = await service.processFileChunks(mockImageJobData);

      expect(result.chunkCount).toBe(0);
      expect(result.totalTokens).toBe(0);

      // Verify indexImageEmbedding was called with contentVector
      expect(mockIndexImageEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-image-id',
          userId: 'test-user-id',
          caption: 'An invoice from Acme Corp',
          contentVector: mockCaptionEmbedding.embedding,
        })
      );
    });

    it('should proceed without contentVector when caption text embedding fails', async () => {
      const mockEmbeddingRecord = {
        embedding: new Array(1024).fill(0.1),
        caption: 'A photo of something',
      };

      const mockIndexImageEmbedding = vi.fn().mockResolvedValue('img_TEST-IMAGE-ID');

      // Mock updateEmbeddingStatus (processing)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock ImageEmbeddingRepository
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(mockEmbeddingRecord),
        }),
      }));

      // Mock file name query
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ name: 'photo.jpg', mime_type: 'image/jpeg' }],
      });

      // Mock EmbeddingService to fail
      vi.doMock('@/services/embeddings/EmbeddingService', () => ({
        EmbeddingService: {
          getInstance: () => ({
            generateTextEmbedding: vi.fn().mockRejectedValue(new Error('Embedding API down')),
          }),
        },
      }));

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

      // Mock updateEmbeddingStatus (completed)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock FileEventEmitter
      vi.doMock('@/domains/files/emission/FileEventEmitter', () => ({
        getFileEventEmitter: () => ({
          emitReadinessChanged: vi.fn(),
        }),
      }));
      vi.doMock('@bc-agent/shared', () => ({
        FILE_READINESS_STATE: { PROCESSING: 'processing', READY: 'ready' },
      }));

      const result = await service.processFileChunks(mockImageJobData);

      expect(result.chunkCount).toBe(0);

      // Should still call indexImageEmbedding but without contentVector
      expect(mockIndexImageEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-image-id',
          contentVector: undefined,
        })
      );
    });

    it('should skip contentVector generation when no caption exists', async () => {
      const mockEmbeddingRecord = {
        embedding: new Array(1024).fill(0.1),
        caption: null,
      };

      const mockIndexImageEmbedding = vi.fn().mockResolvedValue('img_TEST-IMAGE-ID');

      // Mock updateEmbeddingStatus (processing)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock ImageEmbeddingRepository
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(mockEmbeddingRecord),
        }),
      }));

      // Mock file name query
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ name: 'photo.jpg', mime_type: 'image/jpeg' }],
      });

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

      // Mock updateEmbeddingStatus (completed)
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Mock FileEventEmitter
      vi.doMock('@/domains/files/emission/FileEventEmitter', () => ({
        getFileEventEmitter: () => ({
          emitReadinessChanged: vi.fn(),
        }),
      }));
      vi.doMock('@bc-agent/shared', () => ({
        FILE_READINESS_STATE: { PROCESSING: 'processing', READY: 'ready' },
      }));

      const result = await service.processFileChunks(mockImageJobData);

      expect(result.chunkCount).toBe(0);

      // Should call indexImageEmbedding without contentVector
      expect(mockIndexImageEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-image-id',
          contentVector: undefined,
        })
      );
    });
  });
});
