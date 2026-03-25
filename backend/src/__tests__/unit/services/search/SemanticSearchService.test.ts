import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SemanticSearchService } from '@/services/search/semantic/SemanticSearchService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { SEMANTIC_THRESHOLD } from '@/services/search/semantic/types';
import type { SemanticSearchResult } from '@/services/search/types';
import type { ParsedFile } from '@/types/file.types';

// Mock dependencies
vi.mock('@/services/search/VectorSearchService');
vi.mock('@/services/files/FileService');

// Mock CohereEmbeddingService — replaces the legacy EmbeddingService path
const mockEmbedQuery = vi.fn();
vi.mock('@/services/search/embeddings/CohereEmbeddingService', () => ({
  getCohereEmbeddingService: vi.fn(() => ({
    embedQuery: mockEmbedQuery,
    dimensions: 1536,
    modelName: 'Cohere-embed-v4',
  })),
}));

describe('SemanticSearchService', () => {
  let service: SemanticSearchService;
  let mockVectorSearchService: {
    search: ReturnType<typeof vi.fn>;
    searchImages: ReturnType<typeof vi.fn>;
    semanticSearch: ReturnType<typeof vi.fn>;
  };
  let mockFileService: { getFile: ReturnType<typeof vi.fn> };

  const userId = 'test-user-id';
  const query = 'test query';
  const mockEmbedding = new Array(1536).fill(0.1);

  beforeEach(() => {
    // Reset service singleton
    (SemanticSearchService as unknown as { instance: undefined }).instance = undefined;
    service = SemanticSearchService.getInstance();

    mockVectorSearchService = {
      search: vi.fn(),
      searchImages: vi.fn(),
      semanticSearch: vi.fn(),
    };

    mockFileService = {
      getFile: vi.fn(),
    };

    vi.mocked(VectorSearchService.getInstance).mockReturnValue(
      mockVectorSearchService as unknown as VectorSearchService,
    );
    vi.mocked(getFileService).mockReturnValue(mockFileService as unknown as ReturnType<typeof getFileService>);

    // Default: embedQuery returns a valid embedding
    mockEmbedQuery.mockResolvedValue({
      embedding: mockEmbedding,
      model: 'Cohere-embed-v4',
      inputTokens: 5,
    });

    // Default: semanticSearch returns empty results
    mockVectorSearchService.semanticSearch.mockResolvedValue({
      results: [],
      extractiveAnswers: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

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

  describe('searchRelevantFiles', () => {
    it('should return empty array when no files match threshold', async () => {
      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.query).toBe(query);
      expect(result.threshold).toBe(SEMANTIC_THRESHOLD);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should filter results below SEMANTIC_THRESHOLD (0.7)', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({
          chunkId: 'chunk-1',
          fileId: 'file-1',
          content: 'high relevance content',
          score: 0.85,
        }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'test-file.txt' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.relevanceScore).toBe(0.85);

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ minScore: SEMANTIC_THRESHOLD }),
      );
    });

    it('should respect maxFiles limit', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.75 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query, maxFiles: 2 });

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[1]?.fileId).toBe('file-2');
    });

    it('should exclude manually attached fileIds', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.85 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query, excludeFileIds: ['file-1'] });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-2');
    });

    it('should NOT call embedding service for search queries (Azure handles query-time vectorization)', async () => {
      await service.searchRelevantFiles({ userId, query });

      expect(mockEmbedQuery).not.toHaveBeenCalled();
    });

    it('should call VectorSearchService.semanticSearch with query embedding', async () => {
      await service.searchRelevantFiles({ userId, query, maxFiles: 3, maxChunksPerFile: 2 });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          text: query,
          userId,
          minScore: SEMANTIC_THRESHOLD,
        }),
      );
    });

    it('should aggregate chunks by fileId', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.85, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.75, chunkIndex: 2 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'test-file.txt' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.topChunks).toHaveLength(3);
    });

    it('should sort results by relevance score descending', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.75 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-2', content: 'content 2', score: 0.95 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-3', content: 'content 3', score: 0.85 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: `${fid}.txt` } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results[0]?.relevanceScore).toBe(0.95);
      expect(result.results[1]?.relevanceScore).toBe(0.85);
      expect(result.results[2]?.relevanceScore).toBe(0.75);
    });

    it('should limit chunks per file to maxChunksPerFile', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.95, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.90, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'chunk-3', fileId: 'file-1', content: 'content 3', score: 0.85, chunkIndex: 2 }),
        createSemanticResult({ chunkId: 'chunk-4', fileId: 'file-1', content: 'content 4', score: 0.80, chunkIndex: 3 }),
        createSemanticResult({ chunkId: 'chunk-5', fileId: 'file-1', content: 'content 5', score: 0.75, chunkIndex: 4 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'test-file.txt' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query, maxChunksPerFile: 2 });

      expect(result.results[0]?.topChunks).toHaveLength(2);
      expect(result.results[0]?.topChunks[0]?.score).toBe(0.95);
      expect(result.results[0]?.topChunks[1]?.score).toBe(0.90);
    });

    it('should use custom threshold when provided', async () => {
      const customThreshold = 0.8;

      const result = await service.searchRelevantFiles({ userId, query, threshold: customThreshold });

      expect(result.threshold).toBe(customThreshold);
      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ minScore: customThreshold }),
      );
    });
  });

  describe('error handling', () => {
    it('should return empty results on CohereEmbeddingService failure', async () => {
      mockEmbedQuery.mockRejectedValue(new Error('Cohere embedding service error'));

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should return empty results on VectorSearchService failure', async () => {
      mockVectorSearchService.semanticSearch.mockRejectedValue(new Error('Vector search error'));

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toEqual([]);
      expect(result.totalChunksSearched).toBe(0);
    });

    it('should not throw on service failure', async () => {
      mockEmbedQuery.mockRejectedValue(new Error('Test error'));

      await expect(service.searchRelevantFiles({ userId, query })).resolves.toBeDefined();
    });
  });

  describe('unified search (text + images)', () => {
    it('should call semanticSearch with text and userId from Cohere search', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85 }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'doc.txt' } as ParsedFile);

      await service.searchRelevantFiles({ userId, query });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          text: query,
          userId,
        }),
      );
    });

    it('should merge text and image results sorted by score', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85, isImage: false }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'A sunset photo [Image: photo.jpg]', score: 0.90, isImage: true }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({
          id: fid,
          name: fid === 'file-2' ? 'photo.jpg' : 'doc.txt',
          mimeType: fid === 'file-2' ? 'image/jpeg' : 'text/plain',
        } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query });

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

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'test', mimeType: 'text/plain' } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query });

      const textResult = result.results.find(r => r.fileId === 'file-1');
      const imageResult = result.results.find(r => r.fileId === 'file-2');

      expect(textResult?.isImage).toBe(false);
      expect(textResult?.topChunks.length).toBeGreaterThan(0);
      expect(imageResult?.isImage).toBe(true);
      expect(imageResult?.topChunks).toHaveLength(1);
      expect(imageResult?.topChunks[0]?.content).toContain('[Image:');
    });

    it('should exclude images from results if fileId is in excludeFileIds', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'img_file-1', fileId: 'file-1', content: 'Photo 1', score: 0.90, isImage: true }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'Photo 2', score: 0.85, isImage: true }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'photo.jpg' } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query, excludeFileIds: ['file-1'] });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-2');
    });

    it('should include totalChunksSearched from semanticSearch results', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'content 1', score: 0.85, chunkIndex: 0 }),
        createSemanticResult({ chunkId: 'chunk-2', fileId: 'file-1', content: 'content 2', score: 0.80, chunkIndex: 1 }),
        createSemanticResult({ chunkId: 'img_file-2', fileId: 'file-2', content: 'photo', score: 0.90, isImage: true }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockImplementation((_uid: string, fid: string) =>
        Promise.resolve({ id: fid, name: 'test' } as ParsedFile),
      );

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.totalChunksSearched).toBe(3);
    });

    it('should not duplicate files that appear multiple times', async () => {
      const semanticResults: SemanticSearchResult[] = [
        createSemanticResult({ chunkId: 'chunk-1', fileId: 'file-1', content: 'text content', score: 0.85, isImage: false }),
        createSemanticResult({ chunkId: 'img_file-1', fileId: 'file-1', content: 'image content', score: 0.80, isImage: true }),
      ];

      mockVectorSearchService.semanticSearch.mockResolvedValue({ results: semanticResults, extractiveAnswers: [] });
      mockFileService.getFile.mockResolvedValue({ id: 'file-1', name: 'doc.pdf' } as ParsedFile);

      const result = await service.searchRelevantFiles({ userId, query });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.fileId).toBe('file-1');
      expect(result.results[0]?.isImage).toBe(false);
    });
  });

  describe('image search mode', () => {
    it('should add isImage eq true filter in image mode', async () => {
      await service.searchRelevantFiles({ userId, query, searchMode: 'image' });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ additionalFilter: 'isImage eq true' }),
      );
    });

    it('should combine isImage filter with date filter in image mode', async () => {
      await service.searchRelevantFiles({
        userId,
        query,
        searchMode: 'image',
        dateFilter: { from: '2025-03-01', to: '2025-03-31' },
      });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalFilter: 'isImage eq true and fileModifiedAt ge 2025-03-01T00:00:00Z and fileModifiedAt le 2025-03-31T23:59:59Z',
        }),
      );
    });
  });

  describe('date filter', () => {
    it('should add dateFrom filter in text mode', async () => {
      await service.searchRelevantFiles({ userId, query, dateFilter: { from: '2025-01-01' } });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ additionalFilter: 'fileModifiedAt ge 2025-01-01T00:00:00Z' }),
      );
    });

    it('should add dateTo filter in text mode', async () => {
      await service.searchRelevantFiles({ userId, query, dateFilter: { to: '2025-06-30' } });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ additionalFilter: 'fileModifiedAt le 2025-06-30T23:59:59Z' }),
      );
    });

    it('should combine dateFrom and dateTo filters', async () => {
      await service.searchRelevantFiles({
        userId,
        query,
        dateFilter: { from: '2025-01-01', to: '2025-12-31' },
      });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalFilter: 'fileModifiedAt ge 2025-01-01T00:00:00Z and fileModifiedAt le 2025-12-31T23:59:59Z',
        }),
      );
    });

    it('should combine mimeType filter with date filter', async () => {
      await service.searchRelevantFiles({
        userId,
        query,
        filterMimeTypes: ['application/pdf'],
        dateFilter: { from: '2025-03-01' },
      });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalFilter: "search.in(mimeType, 'application/pdf', ',') and fileModifiedAt ge 2025-03-01T00:00:00Z",
        }),
      );
    });

    it('should not add date filter when dateFilter is undefined', async () => {
      await service.searchRelevantFiles({ userId, query });

      expect(mockVectorSearchService.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ additionalFilter: undefined }),
      );
    });
  });
});
