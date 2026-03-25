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

// Hoist mock functions so they can be used in vi.mock factories
const { mockFindFirst, mockCreateMany, mockGetFileWithScopeMetadata } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreateMany: vi.fn(),
  mockGetFileWithScopeMetadata: vi.fn(),
}));

// Mock Prisma
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findFirst: mockFindFirst,
    },
  },
}));

// Mock FileChunkRepository
vi.mock('@/services/files/repository/FileChunkRepository', () => ({
  getFileChunkRepository: vi.fn(() => ({
    createMany: mockCreateMany,
  })),
}));

// Mock FileRepository (for indexImageEmbedding path)
vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    getFileWithScopeMetadata: mockGetFileWithScopeMetadata,
  })),
}));

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

// Mock environment — these tests do not depend on any specific env values
vi.mock('@/infrastructure/config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/config/environment')>();
  return actual;
});

describe('FileChunkingService', () => {
  let service: FileChunkingService;

  beforeEach(() => {
    // Reset singleton
    FileChunkingService.resetInstance();

    // Get fresh instance
    service = getFileChunkingService();

    // Clear mock calls
    vi.clearAllMocks();
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
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow(
        'File not found: test-file-id'
      );
    });

    it('should return early if no extracted text', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: 'test-file-id',
        user_id: 'test-user-id',
        mime_type: 'text/plain',
        extracted_text: null,
        pipeline_status: 'chunking',
      });

      const result = await service.processFileChunks(mockJobData);

      expect(result).toEqual({
        fileId: 'test-file-id',
        chunkCount: 0,
        totalTokens: 0,
      });
    });

    it('should throw error if processing not completed', async () => {
      mockFindFirst.mockResolvedValueOnce({
        id: 'test-file-id',
        user_id: 'test-user-id',
        mime_type: 'text/plain',
        extracted_text: 'Some text content',
        pipeline_status: 'extracting',
      });

      await expect(service.processFileChunks(mockJobData)).rejects.toThrow(
        'File not in chunking status: extracting'
      );
    });

    it('should process file and return correct result', async () => {
      // Mock file query via Prisma
      mockFindFirst.mockResolvedValueOnce({
        id: 'test-file-id',
        user_id: 'test-user-id',
        mime_type: 'text/plain',
        extracted_text: 'This is the extracted text content from the file.',
        pipeline_status: 'chunking',
      });

      // Mock createMany to return chunk records
      mockCreateMany.mockResolvedValueOnce([
        { id: 'MOCK-CHUNK-1', text: 'Chunk 1 content', chunkIndex: 0, tokenCount: 100 },
        { id: 'MOCK-CHUNK-2', text: 'Chunk 2 content', chunkIndex: 1, tokenCount: 120 },
      ]);

      const result = await service.processFileChunks(mockJobData);

      expect(result).toEqual({
        fileId: 'test-file-id',
        chunkCount: 2,
        totalTokens: 220, // 100 + 120
        embeddingJobId: undefined,
      });

      // Verify createMany was called with correct args
      expect(mockCreateMany).toHaveBeenCalledWith(
        'test-file-id',
        'test-user-id',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Chunk 1 content', chunkIndex: 0, tokenCount: 100 }),
          expect.objectContaining({ text: 'Chunk 2 content', chunkIndex: 1, tokenCount: 120 }),
        ]),
      );
    });

    it('should rethrow error on chunk insert failure', async () => {
      // Mock file query via Prisma
      mockFindFirst.mockResolvedValueOnce({
        id: 'test-file-id',
        user_id: 'test-user-id',
        mime_type: 'text/plain',
        extracted_text: 'Some content',
        pipeline_status: 'chunking',
      });

      // Mock chunk insert failure
      mockCreateMany.mockRejectedValueOnce(new Error('Database error'));

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

    it('should index image embedding with caption when caption exists', async () => {
      const mockEmbeddingRecord = {
        embedding: new Array(1536).fill(0.1),
        caption: 'An invoice from Acme Corp',
      };

      const mockIndexImageEmbedding = vi.fn().mockResolvedValue('img_TEST-IMAGE-ID');

      // Mock FileRepository.getFileWithScopeMetadata
      mockGetFileWithScopeMetadata.mockResolvedValueOnce({
        name: 'invoice.jpg',
        mime_type: 'image/jpeg',
        file_modified_at: null,
        size_bytes: null,
        source_type: 'local',
        parent_folder_id: null,
        scope_site_id: null,
      });

      // Mock ImageEmbeddingRepository
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(mockEmbeddingRecord),
        }),
      }));

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

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

      // Verify indexImageEmbedding was called with the embedding from the repository and the caption
      expect(mockIndexImageEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-image-id',
          userId: 'test-user-id',
          embedding: mockEmbeddingRecord.embedding,
          caption: 'An invoice from Acme Corp',
        })
      );
    });

    it('should index image embedding without caption when caption is null', async () => {
      const mockEmbeddingRecord = {
        embedding: new Array(1536).fill(0.1),
        caption: null,
      };

      const mockIndexImageEmbedding = vi.fn().mockResolvedValue('img_TEST-IMAGE-ID');

      // Mock FileRepository.getFileWithScopeMetadata
      mockGetFileWithScopeMetadata.mockResolvedValueOnce({
        name: 'photo.jpg',
        mime_type: 'image/jpeg',
        file_modified_at: null,
        size_bytes: null,
        source_type: 'local',
        parent_folder_id: null,
        scope_site_id: null,
      });

      // Mock ImageEmbeddingRepository
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(mockEmbeddingRecord),
        }),
      }));

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

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

      // Should call indexImageEmbedding with the embedding and undefined caption
      expect(mockIndexImageEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-image-id',
          embedding: mockEmbeddingRecord.embedding,
          caption: undefined,
        })
      );
    });

    it('should skip indexing and still emit readiness when no embedding record found', async () => {
      const mockIndexImageEmbedding = vi.fn();

      // Mock FileRepository.getFileWithScopeMetadata (not called if no embedding record)
      mockGetFileWithScopeMetadata.mockResolvedValueOnce(null);

      // Mock ImageEmbeddingRepository — returns null (no embedding persisted)
      vi.doMock('@/repositories/ImageEmbeddingRepository', () => ({
        getImageEmbeddingRepository: () => ({
          getByFileId: vi.fn().mockResolvedValue(null),
        }),
      }));

      // Mock VectorSearchService
      vi.doMock('@services/search/VectorSearchService', () => ({
        VectorSearchService: {
          getInstance: () => ({
            indexImageEmbedding: mockIndexImageEmbedding,
          }),
        },
      }));

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

      // Should NOT call indexImageEmbedding when no embedding record
      expect(mockIndexImageEmbedding).not.toHaveBeenCalled();
    });
  });
});
