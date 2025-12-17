import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SemanticSearchService } from '@/services/search/semantic/SemanticSearchService';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { SEMANTIC_THRESHOLD } from '@/services/search/semantic/types';
import type { TextEmbedding } from '@/services/embeddings/types';
import type { SearchResult } from '@/services/search/types';
import type { ParsedFile } from '@/types/file.types';

// Mock dependencies
vi.mock('@/services/embeddings/EmbeddingService');
vi.mock('@/services/search/VectorSearchService');
vi.mock('@/services/files/FileService');
vi.mock('openai', () => {
  return {
    OpenAI: class {
      embeddings = {
        create: vi.fn()
      }
    }
  };
});

describe('SemanticSearchService', () => {
  let service: SemanticSearchService;
  let mockEmbeddingService: any;
  let mockVectorSearchService: any;
  let mockFileService: any;

  const userId = 'test-user-id';
  const query = 'test query';

  beforeEach(() => {
    // Reset service singleton
    (SemanticSearchService as any).instance = undefined;
    service = SemanticSearchService.getInstance();

    // Setup mocks
    mockEmbeddingService = {
      generateTextEmbedding: vi.fn(),
    };

    mockVectorSearchService = {
      search: vi.fn(),
    };

    mockFileService = {
      getFile: vi.fn(),
    };

    vi.mocked(EmbeddingService.getInstance).mockReturnValue(mockEmbeddingService);
    vi.mocked(VectorSearchService.getInstance).mockReturnValue(mockVectorSearchService);
    vi.mocked(getFileService).mockReturnValue(mockFileService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('searchRelevantFiles', () => {
    it('should return empty array when no files match threshold', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue([]);

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.query).toBe(query);
      expect(result.threshold).toBe(SEMANTIC_THRESHOLD);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should filter results below SEMANTIC_THRESHOLD (0.7)', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      // VectorSearchService.search() already filters by minScore,
      // so only results above threshold are returned
      const searchResults: SearchResult[] = [
        {
          chunkId: 'chunk-1',
          fileId: 'file-1',
          content: 'high relevance content',
          score: 0.85,
          chunkIndex: 0,
        },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockResolvedValue({
        id: 'file-1',
        name: 'test-file.txt',
      } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      // Should only include file-1 (score 0.85)
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.relevanceScore).toBe(0.85);

      // Verify minScore was passed to vector search
      expect(mockVectorSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          minScore: SEMANTIC_THRESHOLD,
        })
      );
    });

    it('should respect maxFiles limit', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      // Create search results for 3 different files, all above threshold
      const searchResults: SearchResult[] = [
        { chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 },
        { chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85, chunkIndex: 0 },
        { chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.75, chunkIndex: 0 },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({
        userId,
        query,
        maxFiles: 2
      });

      // Should only return top 2 files
      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[1]?.fileId).toBe('file-2');
    });

    it('should exclude manually attached fileIds', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      const searchResults: SearchResult[] = [
        { chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 },
        { chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85, chunkIndex: 0 },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({
        userId,
        query,
        excludeFileIds: ['file-1']
      });

      // Should only return file-2
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-2');
    });

    it('should call EmbeddingService to embed query', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue([]);

      await service.searchRelevantFiles({ userId, query });

      expect(mockEmbeddingService.generateTextEmbedding).toHaveBeenCalledWith(
        query,
        userId,
        'semantic-search'
      );
    });

    it('should call VectorSearchService with query embedding', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue([]);

      await service.searchRelevantFiles({ userId, query, maxFiles: 3, maxChunksPerFile: 2 });

      expect(mockVectorSearchService.search).toHaveBeenCalledWith({
        embedding: mockEmbedding.embedding,
        userId,
        top: 3 * 2 * 2, // maxFiles * maxChunksPerFile * 2
        minScore: SEMANTIC_THRESHOLD,
      });
    });

    it('should aggregate chunks by fileId', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      // Multiple chunks from same file
      const searchResults: SearchResult[] = [
        { chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 },
        { chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.85, chunkIndex: 1 },
        { chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.75, chunkIndex: 2 },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockResolvedValue({
        id: 'file-1',
        name: 'test-file.txt',
      } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      // Should aggregate into single result
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.topChunks).toHaveLength(3);
    });

    it('should sort results by relevance score descending', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      const searchResults: SearchResult[] = [
        { chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.75, chunkIndex: 0 },
        { chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.95, chunkIndex: 0 },
        { chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.85, chunkIndex: 0 },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({ userId, query });

      // Should be sorted by relevance (0.95, 0.85, 0.75)
      expect(result.results[0]?.relevanceScore).toBe(0.95);
      expect(result.results[1]?.relevanceScore).toBe(0.85);
      expect(result.results[2]?.relevanceScore).toBe(0.75);
    });

    it('should limit chunks per file to maxChunksPerFile', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      // 5 chunks from same file
      const searchResults: SearchResult[] = [
        { chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 },
        { chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.90, chunkIndex: 1 },
        { chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.85, chunkIndex: 2 },
        { chunkId: 'chunk-4', fileId: 'file-1', content: 'content 4', score: 0.80, chunkIndex: 3 },
        { chunkId: 'chunk-5', fileId: 'file-1', content: 'content 5', score: 0.75, chunkIndex: 4 },
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue(searchResults);

      mockFileService.getFile.mockResolvedValue({
        id: 'file-1',
        name: 'test-file.txt',
      } as ParsedFile);

      const result = await service.searchRelevantFiles({
        userId,
        query,
        maxChunksPerFile: 2
      });

      // Should only include top 2 chunks
      expect(result.results[0]?.topChunks).toHaveLength(2);
      expect(result.results[0]?.topChunks[0]?.score).toBe(0.95);
      expect(result.results[0]?.topChunks[1]?.score).toBe(0.90);
    });

    it('should use custom threshold when provided', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      const customThreshold = 0.8;

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockResolvedValue([]);

      const result = await service.searchRelevantFiles({
        userId,
        query,
        threshold: customThreshold
      });

      expect(result.threshold).toBe(customThreshold);
      expect(mockVectorSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          minScore: customThreshold,
        })
      );
    });
  });

  describe('error handling', () => {
    it('should return empty results on EmbeddingService failure', async () => {
      mockEmbeddingService.generateTextEmbedding.mockRejectedValue(
        new Error('Embedding service error')
      );

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should return empty results on VectorSearchService failure', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.search.mockRejectedValue(
        new Error('Vector search error')
      );

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should log errors but not throw', async () => {
      mockEmbeddingService.generateTextEmbedding.mockRejectedValue(
        new Error('Test error')
      );

      // Should not throw
      await expect(
        service.searchRelevantFiles({ userId, query })
      ).resolves.toBeDefined();
    });
  });
});
