/**
 * RAG Knowledge Tools Tests (PRD-071)
 *
 * Tests that searchKnowledgeTool returns CitationResult format
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

import { searchKnowledgeTool, findSimilarImagesTool } from '@/modules/agents/rag-knowledge/tools';

describe('searchKnowledgeTool', () => {
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

    const result = await searchKnowledgeTool.invoke(
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

    const result = await searchKnowledgeTool.invoke(
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

    const result = await searchKnowledgeTool.invoke(
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

    const result = await searchKnowledgeTool.invoke(
      { query: 'empty query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
    expect(parsed.searchMetadata.query).toBe('empty query');
  });

  it('returns is_error with guidance for failures (PRD-200 error passthrough)', async () => {
    mockSearchRelevantFiles.mockRejectedValue(new Error('Service unavailable'));

    const result = await searchKnowledgeTool.invoke(
      { query: 'fail query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.is_error).toBe(true);
    expect(parsed.message).toContain('Service unavailable');
  });

  it('returns error when no userId in config', async () => {
    const result = await searchKnowledgeTool.invoke(
      { query: 'no user' },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });

  it('passes searchType and sortBy to searchRelevantFiles', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 0,
      threshold: 0.6,
    });

    await searchKnowledgeTool.invoke(
      { query: 'INV-2026-0042', searchType: 'keyword', top: 3 },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'USER-1',
        query: 'INV-2026-0042',
        searchType: 'keyword',
        maxFiles: 3,
      })
    );
  });

  it('passes searchMode image when fileTypeCategory is images', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [{
        fileId: 'FILE-1',
        fileName: 'truck.jpg',
        mimeType: 'image/jpeg',
        relevanceScore: 0.85,
        isImage: true,
        topChunks: [
          { content: 'A red truck [Image: truck.jpg]', score: 0.85, chunkIndex: 0 },
        ],
      }],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'red truck', fileTypeCategory: 'images' },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        searchMode: 'image',
        searchType: 'hybrid',
      })
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.documents[0].isImage).toBe(true);
  });

  it('passes sortBy newest to searchRelevantFiles', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 0,
      threshold: 0.6,
    });

    await searchKnowledgeTool.invoke(
      { query: '*', fileTypeCategory: 'spreadsheets', dateFrom: '2026-01-01', dateTo: '2026-03-31', sortBy: 'newest' },
      { configurable: { userId: 'USER-1' } }
    );

    // query '*' forces keyword mode via validation overrides
    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        searchType: 'keyword',
        sortBy: 'newest',
      })
    );
  });

  it('returns is_error with guidance when search throws', async () => {
    const azureError = new Error('Service unavailable');
    mockSearchRelevantFiles.mockRejectedValue(azureError);

    const result = await searchKnowledgeTool.invoke(
      { query: 'test query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.is_error).toBe(true);
    expect(parsed.message).toContain('Search failed');
  });

  it('returns guidance when no results found', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'nonexistent', minRelevanceScore: 0.8 },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.guidance).toBeDefined();
    expect(parsed.guidance).toContain('Suggestions');
    expect(parsed.guidance).toContain('minRelevanceScore');
  });

  it('returns validation error for invalid date format', async () => {
    const result = await searchKnowledgeTool.invoke(
      { query: 'test', dateFrom: '01-15-2026' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.is_error).toBe(true);
    expect(parsed.message).toContain('Invalid dateFrom format');
  });

  it('accepts presentations as fileTypeCategory', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [],
      totalChunksSearched: 0,
      threshold: 0.6,
    });

    await searchKnowledgeTool.invoke(
      { query: 'quarterly review', fileTypeCategory: 'presentations' },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockSearchRelevantFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        filterMimeTypes: expect.arrayContaining([expect.stringContaining('presentation')]),
      })
    );
  });

  it('concise responseDetail returns only 1 passage per document with excerpt max 100 chars', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { chunkId: 'chunk-0', content: 'A'.repeat(200), score: 0.9, chunkIndex: 0 },
            { chunkId: 'chunk-1', content: 'B'.repeat(200), score: 0.8, chunkIndex: 1 },
            { chunkId: 'chunk-2', content: 'C'.repeat(200), score: 0.7, chunkIndex: 2 },
          ],
        },
      ],
      totalChunksSearched: 100,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'test', responseDetail: 'concise' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    // concise: only the first chunk (slice(0, 1))
    expect(parsed.documents[0].passages).toHaveLength(1);
    // concise: excerpt is capped at 100 chars
    expect(parsed.documents[0].passages[0].excerpt.length).toBeLessThanOrEqual(100);
  });

  it('detailed responseDetail (default) returns all passages with excerpt max 500 chars', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { chunkId: 'chunk-0', content: 'A'.repeat(600), score: 0.9, chunkIndex: 0 },
            { chunkId: 'chunk-1', content: 'B'.repeat(600), score: 0.8, chunkIndex: 1 },
            { chunkId: 'chunk-2', content: 'C'.repeat(600), score: 0.7, chunkIndex: 2 },
          ],
        },
      ],
      totalChunksSearched: 100,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'test', responseDetail: 'detailed' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    // detailed: all 3 chunks returned
    expect(parsed.documents[0].passages).toHaveLength(3);
    // detailed: excerpt is capped at 500 chars
    for (const passage of parsed.documents[0].passages) {
      expect(passage.excerpt.length).toBeLessThanOrEqual(500);
    }
  });

  it('detailed responseDetail is the default when responseDetail is omitted', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { chunkId: 'chunk-0', content: 'First chunk content', score: 0.9, chunkIndex: 0 },
            { chunkId: 'chunk-1', content: 'Second chunk content', score: 0.8, chunkIndex: 1 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'test' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    // Without responseDetail, default is 'detailed' → all chunks returned
    expect(parsed.documents[0].passages).toHaveLength(2);
  });

  it('concise responseDetail uses highlightedCaption as excerpt when available', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            {
              chunkId: 'chunk-0',
              content: 'A'.repeat(200),
              score: 0.9,
              chunkIndex: 0,
              highlightedCaption: 'Highlighted caption text from semantic ranker',
            },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'test', responseDetail: 'concise' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    // concise path: excerpt = highlightedCaption ?? content.slice(0, 100)
    expect(parsed.documents[0].passages[0].excerpt).toBe('Highlighted caption text from semantic ranker');
  });

  it('detailed responseDetail includes highlightedCaption field in passages when available', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            {
              chunkId: 'chunk-0',
              content: 'Full content of the document chunk here',
              score: 0.9,
              chunkIndex: 0,
              highlightedCaption: 'Highlighted caption from ranker',
            },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'test', responseDetail: 'detailed' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.documents[0].passages[0].highlightedCaption).toBe('Highlighted caption from ranker');
    // detailed path: excerpt comes from content, not highlightedCaption
    expect(parsed.documents[0].passages[0].excerpt).toBe('Full content of the document chunk here');
  });

  it('includes extractiveAnswers in CitationResult when available from search results', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { chunkId: 'chunk-0', content: 'Revenue was $5M in Q3.', score: 0.9, chunkIndex: 0 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
      extractiveAnswers: [
        {
          text: 'Revenue was $5M in Q3.',
          score: 0.95,
          highlights: 'Revenue was <em>$5M</em> in Q3.',
          sourceChunkId: 'chunk-0',
          sourceFileId: 'FILE-1',
        },
      ],
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'Q3 revenue' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.extractiveAnswers).toHaveLength(1);
    expect(parsed.extractiveAnswers[0].text).toBe('Revenue was $5M in Q3.');
    expect(parsed.extractiveAnswers[0].score).toBe(0.95);
    expect(parsed.extractiveAnswers[0].highlights).toBe('Revenue was <em>$5M</em> in Q3.');
    expect(parsed.extractiveAnswers[0].sourceChunkId).toBe('chunk-0');
    expect(parsed.extractiveAnswers[0].sourceFileId).toBe('FILE-1');
  });

  it('omits extractiveAnswers from CitationResult when not present in search results', async () => {
    mockSearchRelevantFiles.mockResolvedValue({
      results: [
        {
          fileId: 'FILE-1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          relevanceScore: 0.9,
          isImage: false,
          topChunks: [
            { chunkId: 'chunk-0', content: 'Some content.', score: 0.9, chunkIndex: 0 },
          ],
        },
      ],
      totalChunksSearched: 50,
      threshold: 0.6,
    });

    const result = await searchKnowledgeTool.invoke(
      { query: 'some query' },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    expect(parsed.extractiveAnswers).toBeUndefined();
  });
});

describe('findSimilarImagesTool', () => {
  // Use valid UUID-format IDs so the tool's UUID regex matches
  // and doesn't trigger the findByNameGlobal fallback path
  const FILE_1 = 'A1B2C3D4-0001-0000-0000-000000000001';
  const FILE_2 = 'A1B2C3D4-0001-0000-0000-000000000002';
  const FILE_3 = 'A1B2C3D4-0001-0000-0000-000000000003';
  const FILE_4 = 'A1B2C3D4-0001-0000-0000-000000000004';
  const FILE_MISSING = 'A1B2C3D4-0001-0000-0000-000000000099';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a file for getFile lookups
    mockGetFile.mockResolvedValue({ id: FILE_1, name: 'source.jpg', mimeType: 'image/jpeg' });
  });

  it('returns similar images excluding the source image', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: FILE_1,
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    mockSearchImages.mockResolvedValue([
      { fileId: FILE_1, fileName: 'source.jpg', score: 1.0, isImage: true },
      { fileId: FILE_2, fileName: 'similar1.jpg', score: 0.9, isImage: true },
      { fileId: FILE_3, fileName: 'similar2.jpg', score: 0.8, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: FILE_1 },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBe('citation_result');
    // Should exclude source (FILE_1), leaving FILE_2 and FILE_3
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].fileId).toBe(FILE_2);
    expect(parsed.documents[1].fileId).toBe(FILE_3);
  });

  it('returns error when source embedding not found', async () => {
    mockGetByFileId.mockResolvedValue(null);

    const result = await findSimilarImagesTool.invoke(
      { fileId: FILE_MISSING },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('Source image embedding not found');
  });

  it('returns error when no userId in config', async () => {
    const result = await findSimilarImagesTool.invoke(
      { fileId: FILE_1 },
      { configurable: {} }
    );

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('No user context');
  });

  it('respects maxResults parameter', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: FILE_1,
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    // Return more results than maxResults
    mockSearchImages.mockResolvedValue([
      { fileId: FILE_1, fileName: 'source.jpg', score: 1.0, isImage: true },
      { fileId: FILE_2, fileName: 's1.jpg', score: 0.9, isImage: true },
      { fileId: FILE_3, fileName: 's2.jpg', score: 0.8, isImage: true },
      { fileId: FILE_4, fileName: 's3.jpg', score: 0.7, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: FILE_1, maxResults: 2 },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed.documents).toHaveLength(2);
  });

  it('returns empty result when no similar images found', async () => {
    mockGetByFileId.mockResolvedValue({
      id: 'emb-1',
      fileId: FILE_1,
      userId: 'USER-1',
      embedding: new Array(1024).fill(0.1),
      dimensions: 1024,
      model: 'azure-vision',
      modelVersion: '2023-04-15',
    });

    // Only the source image itself is returned
    mockSearchImages.mockResolvedValue([
      { fileId: FILE_1, fileName: 'source.jpg', score: 1.0, isImage: true },
    ]);

    const result = await findSimilarImagesTool.invoke(
      { fileId: FILE_1 },
      { configurable: { userId: 'USER-1' } }
    );

    const parsed = JSON.parse(result);
    expect(parsed._type).toBeUndefined();
    expect(parsed.sources).toEqual([]);
  });

  it('normalizes fileId to uppercase for repository lookup', async () => {
    // Use a lowercase UUID — the tool should uppercase it before calling getByFileId
    const lowercaseUuid = 'a1b2c3d4-0001-0000-0000-000000000001';
    mockGetByFileId.mockResolvedValue(null);

    await findSimilarImagesTool.invoke(
      { fileId: lowercaseUuid },
      { configurable: { userId: 'USER-1' } }
    );

    expect(mockGetByFileId).toHaveBeenCalledWith('A1B2C3D4-0001-0000-0000-000000000001', 'USER-1');
  });
});
