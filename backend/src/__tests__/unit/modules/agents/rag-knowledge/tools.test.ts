/**
 * RAG Knowledge Tools Tests (PRD-071)
 *
 * Tests that knowledgeSearchTool returns CitationResult format
 * for successful searches and StructuredSearchResult for errors/empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the semantic search service before importing the tool
const mockSearchRelevantFiles = vi.fn();
vi.mock('@/services/search/semantic', () => ({
  getSemanticSearchService: () => ({
    searchRelevantFiles: mockSearchRelevantFiles,
  }),
  SEMANTIC_THRESHOLD: 0.7,
}));

const mockSearchImages = vi.fn();
vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: () => ({
      searchImages: mockSearchImages,
    }),
  },
}));

const mockGetByFileId = vi.fn();
vi.mock('@/repositories/ImageEmbeddingRepository', () => ({
  getImageEmbeddingRepository: () => ({
    getByFileId: mockGetByFileId,
  }),
}));

const mockGetFile = vi.fn();
vi.mock('@/services/files/FileService', () => ({
  getFileService: () => ({
    getFile: mockGetFile,
  }),
}));

import { knowledgeSearchTool, visualImageSearchTool, findSimilarImagesTool } from '@/modules/agents/rag-knowledge/tools';

describe('knowledgeSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns CitationResult with _type for successful results', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { content: 'Relevant excerpt', score: 0.88, chunkIndex: 0 },
          ],
        },
      ],
      totalChunksSearched: 100,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'test query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].fileId).toBe('FILE-1');
    expect(parsed.documents[0].fileName).toBe('report.pdf');
    expect(parsed.documents[0].documentRelevance).toBe(0.9);
    expect(parsed.totalResults).toBe(1);
    expect(parsed.query).toBe('test query');
  });

  it('includes passages with excerpts and relevance scores', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'doc.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.85,
          isImage: false,
          topChunks: [
            { content: 'First chunk', score: 0.9, chunkIndex: 0 },
            { content: 'Second chunk', score: 0.8, chunkIndex: 1 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'search' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.documents[0].passages).toHaveLength(2);
    expect(parsed.documents[0].passages[0].excerpt).toBe('First chunk');
    expect(parsed.documents[0].passages[0].relevanceScore).toBe(0.9);
    expect(parsed.documents[0].passages[0].citationId).toBe('FILE-1-0');
    expect(parsed.documents[0].passages[1].citationId).toBe('FILE-1-1');
  });

  it('includes summary text in result', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'doc.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.8,
          isImage: false,
          topChunks: [{ content: 'text', score: 0.8, chunkIndex: 0 }],
        },
        {
          fileId: 'FILE-2',
          fileName: 'doc2.txt',
          mimeType: 'text/plain',
          relevanceScore: 0.7,
          isImage: false,
          topChunks: [{ content: 'text2', score: 0.7, chunkIndex: 0 }],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'my query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.summary).toContain('2 relevant documents');
    expect(parsed.summary).toContain('my query');
  });

  it('returns StructuredSearchResult for empty results (no _type)', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await knowledgeSearchTool.invoke(
      { query: 'empty query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
    expect(parsed.searchMetadata.query).toBe('empty query');
  });

  it('returns StructuredSearchResult with error for failures (no _type)', async () => {
    mockSearchRelevantFiles.mockRejectedValue(new Error('Service unavailable'));

    const result = await knowledgeSearchTool.invoke(
      { query: 'fail query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.error).toBe('Service unavailable');
  });

  it('returns error when no userId in config', async () => {
    const result = await knowledgeSearchTool.invoke(
      { query: 'no user' },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });
});

describe('visualImageSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns CitationResult for successful visual search', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'truck.jpg',
          mimeType: 'image/jpeg',
          relevanceScore: 0.85,
          isImage: true,
          topChunks: [
            { content: 'A red truck [Image: truck.jpg]', score: 0.85, chunkIndex: 0 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await visualImageSearchTool.invoke(
      { query: 'red truck' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].fileId).toBe('FILE-1');
    expect(parsed.summary).toContain('visual similarity');
  });

  it('passes searchMode: image to searchRelevantFiles', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 0,
      threshold: 0.6,
    });

    await visualImageSearchTool.invoke(
      { query: 'sunset' },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        searchMode: 'image',
        userId: 'USER-1',
        query: 'sunset',
      })
    );
  });

  it('passes date filter when provided', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 0,
      threshold: 0.6,
    });

    await visualImageSearchTool.invoke(
      { query: 'sunset', dateFrom: '2025-01-01', dateTo: '2025-06-30' },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFilter: { from: '2025-01-01', to: '2025-06-30' },
      })
    );
  });

  it('returns error when no userId in config', async () => {
    const result = await visualImageSearchTool.invoke(
      { query: 'test' },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });

  it('returns empty result when no images match', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await visualImageSearchTool.invoke(
      { query: 'nonexistent' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
  });
});

describe('findSimilarImagesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a file for getFile lookups
    mockGetFile.mockResolvedValue({ id: 'FILE-1', name: 'source.jpg', mimeType: 'image/jpeg' });
  });

  it('returns similar images excluding the source image', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: 'FILE-1',
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    mockSearchImages.mockResolvedValue([
      { fileId: 'FILE-1', fileName: 'source.jpg', score: 1.0, isImage: true },
      { fileId: 'FILE-2', fileName: 'similar1.jpg', score: 0.9, isImage: true },
      { fileId: 'FILE-3', fileName: 'similar2.jpg', score: 0.8, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: 'FILE-1' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    // Should exclude source (FILE-1), leaving FILE-2 and FILE-3
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].fileId).toBe('FILE-2');
    expect(parsed.documents[1].fileId).toBe('FILE-3');
  });

  it('returns error when source embedding not found', async () => {
    mockGetByFileId.mockResolvedValue(null);

    const result = await findSimilarImagesTool.invoke(
      { fileId: 'NONEXISTENT' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Source image embedding not found');
  });

  it('returns error when no userId in config', async () => {
    const result = await findSimilarImagesTool.invoke(
      { fileId: 'FILE-1' },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });

  it('respects maxResults parameter', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: 'FILE-1',
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    // Return more results than maxResults
    mockSearchImages.mockResolvedValue([
      { fileId: 'FILE-1', fileName: 'source.jpg', score: 1.0, isImage: true },
      { fileId: 'FILE-2', fileName: 's1.jpg', score: 0.9, isImage: true },
      { fileId: 'FILE-3', fileName: 's2.jpg', score: 0.8, isImage: true },
      { fileId: 'FILE-4', fileName: 's3.jpg', score: 0.7, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: 'FILE-1', maxResults: 2 },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.documents).toHaveLength(2);
  });

  it('returns empty result when no similar images found', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: 'FILE-1',
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    // Only the source image itself is returned
    mockSearchImages.mockResolvedValue([
      { fileId: 'FILE-1', fileName: 'source.jpg', score: 1.0, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: 'FILE-1' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
  });

  it('normalizes fileId to uppercase for repository lookup', async () => {
    mockGetByFileId.mockResolvedValue(null);

    await findSimilarImagesTool.invoke(
      { fileId: 'lowercase-file-id' },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockGetByFileId).toHaveBeenCalledWith('LOWERCASE-FILE-ID', 'USER-1');
  });
});
