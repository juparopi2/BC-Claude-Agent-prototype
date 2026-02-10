import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SemanticSearchService } from '@/services/search/semantic/SemanticSearchService';
import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { SEMANTIC_THRESHOLD } from '@/services/search/semantic/types';
import type { TextEmbedding, ImageEmbedding } from '@/services/embeddings/types';
import type { SearchResult, ImageSearchResult, SemanticSearchResult } from '@/services/search/types';
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
      generateImageQueryEmbedding: vi.fn(),
    };

    mockVectorSearchService = {
      search: vi.fn(),
      searchImages: vi.fn(),
      semanticSearch: vi.fn(),
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
    // Default image query embedding mock - reused across tests
    const mockImageQueryEmbedding: ImageEmbedding = {
      embedding: new Array(1024).fill(0.1),
      model: 'vectorize-text-2023-04-15',
      imageSize: 0,
      userId,
      createdAt: new Date(),
    };

    // Helper to setup standard mocks for text-only tests
    const setupStandardMocks = () => {
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue([]);
    };

    // Helper to create SemanticSearchResult format
    const createSemanticResult = (params: {
      chunkId: string;
      fileId: string;
      content: string;
      score: number;
      isImage?: boolean;
      chunkIndex?: number;
    }): SemanticSearchResult => ({
      chunkId: params.chunkId,
      fileId: params.fileId,
      content: params.content,
      vectorScore: params.score,
      score: params.score,
      chunkIndex: params.chunkIndex ?? 0,
      isImage: params.isImage ?? false,
    });

    it('should return empty array when no files match threshold', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      setupStandardMocks();
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);

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

      // semanticSearch returns only results above threshold
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({
          chunkId: 'chunk-1',
          fileId: 'file-1',
          content: 'high relevance content',
          score: 0.85,
        }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

      mockFileService.getFile.mockResolvedValue({
        id: 'file-1',
        name: 'test-file.txt',
      } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      // Should only include file-1 (score 0.85)
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.relevanceScore).toBe(0.85);

      // Verify minScore was passed to semanticSearch
      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
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
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.75 }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

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

      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85 }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

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

      setupStandardMocks();
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);

      await service.searchRelevantFiles({ userId, query });

      expect(mockEmbeddingService.generateTextEmbedding).toHaveBeenCalledWith(
        query,
        userId,
        'semantic-search'
      );
    });

    it('should call VectorSearchService.semanticSearch with query embedding', async () => {
      const mockEmbedding: TextEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        tokenCount: 10,
        userId,
        createdAt: new Date(),
      };

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue([]);

      await service.searchRelevantFiles({ userId, query, maxFiles: 3, maxChunksPerFile: 2 });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          text: query,
          textEmbedding: mockEmbedding.embedding,
          imageEmbedding: mockImageQueryEmbedding.embedding,
          userId,
          fetchTopK: 3 * 2 * 3, // maxFiles * maxChunksPerFile * 3
          finalTopK: 3 * 2 * 2, // maxFiles * maxChunksPerFile * 2
          minScore: SEMANTIC_THRESHOLD,
        })
      );
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
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.85, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.75, chunkIndex: 2 }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

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

      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.75 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.85 }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

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
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.90, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.85, chunkIndex: 2 }),
        createSemanticResult({ chunkId: 'chunk-4', fileId: 'file-1', content: 'content 4', score: 0.80, chunkIndex: 3 }),
        createSemanticResult({ chunkId: 'chunk-5', fileId: 'file-1', content: 'content 5', score: 0.75, chunkIndex: 4 }),
      ];

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);

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

      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue([]);

      const result = await service.searchRelevantFiles({
        userId,
        query,
        threshold: customThreshold
      });

      expect(result.threshold).toBe(customThreshold);
      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          minScore: customThreshold,
        })
      );
    });
  });

  describe('error handling', () => {
    const mockImageQueryEmbedding: ImageEmbedding = {
      embedding: new Array(1024).fill(0.1),
      model: 'vectorize-text-2023-04-15',
      imageSize: 0,
      userId,
      createdAt: new Date(),
    };

    it('should return empty results on EmbeddingService failure', async () => {
      mockEmbeddingService.generateTextEmbedding.mockRejectedValue(
        new Error('Embedding service error')
      );
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);

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
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockRejectedValue(
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
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);

      // Should not throw
      await expect(
        service.searchRelevantFiles({ userId, query })
      ).resolves.toBeDefined();
    });
  });

  describe('unified search (text + images) - D26 semanticSearch', () => {
    const mockTextEmbedding: TextEmbedding = {
      embedding: new Array(1536).fill(0.1),
      model: 'text-embedding-3-small',
      tokenCount: 10,
      userId,
      createdAt: new Date(),
    };

    const mockImageQueryEmbedding: ImageEmbedding = {
      embedding: new Array(1024).fill(0.2),
      model: 'vectorize-text-2023-04-15',
      imageSize: 0,
      userId,
      createdAt: new Date(),
    };

    // Helper to create SemanticSearchResult format
    const createSemanticResult = (params: {
      chunkId: string;
      fileId: string;
      content: string;
      score: number;
      isImage: boolean;
      chunkIndex?: number;
    }): SemanticSearchResult => ({
      chunkId: params.chunkId,
      fileId: params.fileId,
      content: params.content,
      vectorScore: params.score,
      score: params.score,
      chunkIndex: params.chunkIndex ?? 0,
      isImage: params.isImage,
    });

    it('should call semanticSearch with both text and image embeddings', async () => {
      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue([]);

      await service.searchRelevantFiles({ userId, query });

      // Should call both embedding methods
      expect(mockEmbeddingService.generateTextEmbedding).toHaveBeenCalledWith(
        query, userId, 'semantic-search'
      );
      expect(mockEmbeddingService.generateImageQueryEmbedding).toHaveBeenCalledWith(
        query, userId, 'semantic-search'
      );

      // Should call semanticSearch with both embeddings
      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          text: query,
          textEmbedding: mockTextEmbedding.embedding,
          imageEmbedding: mockImageQueryEmbedding.embedding,
          userId,
        })
      );
    });

    it('should merge text and image results sorted by score', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85, isImage: false }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'A sunset photo [Image: photo.jpg]', score: 0.90, isImage: true }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: fid === 'file-2' ? 'photo.jpg' : 'doc.txt', mimeType: fid === 'file-2' ? 'image/jpeg' : 'text/plain' } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({ userId, query });

      // Image (0.90) should be first, then text (0.85)
      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.fileId).toBe('file-2');
      expect(result.results[0]?.isImage).toBe(true);
      expect(result.results[0]?.relevanceScore).toBe(0.90);

      expect(result.results[1]?.fileId).toBe('file-1');
      expect(result.results[1]?.isImage).toBe(false);
      expect(result.results[1]?.relevanceScore).toBe(0.85);
    });

    it('should set isImage flag correctly on results', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85, isImage: false }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'A sunset [Image: photo.jpg]', score: 0.80, isImage: true }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'test', mimeType: 'text/plain' } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({ userId, query });

      const textResult = result.results.find(r => r.fileId === 'file-1');
      const imageResult = result.results.find(r => r.fileId === 'file-2');

      expect(textResult?.isImage).toBe(false);
      expect(textResult?.topChunks.length).toBeGreaterThan(0);

      expect(imageResult?.isImage).toBe(true);
      expect(imageResult?.topChunks).toHaveLength(1); // Images include caption as single chunk
      expect(imageResult?.topChunks[0]?.content).toContain('[Image:');
    });

    it('should continue with text-only search if image query embedding fails', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content', score: 0.85, isImage: false }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockRejectedValue(
        new Error('Azure Vision not configured')
      );
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'doc.txt' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      // Should still return text results even though image embedding failed
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');

      // semanticSearch should have been called without image embedding
      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          textEmbedding: mockTextEmbedding.embedding,
          imageEmbedding: undefined,
        })
      );
    });

    it('should exclude images from results if fileId is in excludeFileIds', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'img_file-1', fileId: 'file-1', content: 'Photo 1', score: 0.90, isImage: true }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'Photo 2', score: 0.85, isImage: true }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'photo.jpg' } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({
        userId,
        query,
        excludeFileIds: ['file-1']
      });

      // Should only include file-2
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-2');
    });

    it('should include totalChunksSearched from semanticSearch results', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.85, isImage: false, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.80, isImage: false, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'photo', score: 0.90, isImage: true }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockImplementation((uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'test' } as ParsedFile)
      );

      const result = await service.searchRelevantFiles({ userId, query });

      // 3 total results from semanticSearch
      expect(result.totalChunksSearched).toBe(3);
    });

    it('should not duplicate files that appear multiple times', async () => {
      // Same file with multiple chunks - text result takes precedence
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85, isImage: false }),
        createSemanticResult({ chunkId: 'img_file-1', fileId: 'file-1', content: 'image content', score: 0.80, isImage: true }),
      ];

      mockEmbeddingService.generateTextEmbedding.mockResolvedValue(mockTextEmbedding);
      mockEmbeddingService.generateImageQueryEmbedding.mockResolvedValue(mockImageQueryEmbedding);
      mockVectorSearchService.semanticSearch.mockResolvedValue(semanticResults);
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'doc.pdf' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      // Should only appear once (text result takes precedence since it comes first and isImage=false)
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      // The first result for this fileId was text (isImage=false), so that determines the type
      expect(result.results[0]?.isImage).toBe(false);
    });
  });
});
