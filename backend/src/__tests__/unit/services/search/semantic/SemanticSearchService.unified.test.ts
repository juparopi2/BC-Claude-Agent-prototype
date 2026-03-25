import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SemanticSearchService — Query-Time Vectorization Tests
 *
 * Verifies that SemanticSearchService correctly delegates embedding generation
 * to Azure AI Search (query-time vectorization) rather than calling
 * getCohereEmbeddingService() client-side.
 *
 * Key invariants under test:
 * - No non-keyword searches call embedQuery() — Azure vectorizes at query time
 * - Image mode uses isImage OData filter without a client-side embedQuery() call
 * - Keyword mode skips embedding entirely (unchanged)
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

/** Spy on the unified embedQuery call */
const mockEmbedQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    embedding: new Array(1536).fill(0.1),
    model: 'Cohere-embed-v4',
    inputTokens: 5,
  }),
);

vi.mock('@/services/search/embeddings/CohereEmbeddingService', () => ({
  getCohereEmbeddingService: vi.fn(() => ({
    embedQuery: mockEmbedQuery,
    dimensions: 1536,
    modelName: 'Cohere-embed-v4',
  })),
}));

// ---------------------------------------------------------------------------
// VectorSearchService mock — captures what SemanticSearchService sends
// ---------------------------------------------------------------------------

const mockSemanticSearch = vi.fn().mockResolvedValue({ results: [], extractiveAnswers: [] });

vi.mock('@/services/search/VectorSearchService', () => ({
  VectorSearchService: {
    getInstance: vi.fn(() => ({
      semanticSearch: mockSemanticSearch,
    })),
  },
}));

// ---------------------------------------------------------------------------
// FileService mock — needed for result enrichment (getFile)
// ---------------------------------------------------------------------------

vi.mock('@/services/files/FileService', () => ({
  getFileService: vi.fn(() => ({
    getFile: vi.fn().mockResolvedValue(null),
  })),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { SemanticSearchService } from '@/services/search/semantic/SemanticSearchService';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SemanticSearchService — Cohere Unified Embedding Path', () => {
  const userId = 'user-abc';
  const query = 'show me invoices from last month';

  beforeEach(() => {
    // Reset singleton so each test constructs a fresh instance
    (SemanticSearchService as unknown as { instance: undefined }).instance = undefined;

    mockEmbedQuery.mockClear();
    mockSemanticSearch.mockClear();
    mockSemanticSearch.mockResolvedValue({ results: [], extractiveAnswers: [] });
  });

  // -------------------------------------------------------------------------
  // Embedding choice
  // -------------------------------------------------------------------------

  it('does NOT call embedQuery() for text search (Azure handles query-time vectorization)', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query });

    expect(mockEmbedQuery).not.toHaveBeenCalled();

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(searchArgs).toHaveProperty('text', query);
    expect(searchArgs).toHaveProperty('userId', userId);
  });

  it('calls vectorSearchService.semanticSearch with the query text and userId', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query });

    expect(mockSemanticSearch).toHaveBeenCalledTimes(1);
    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(searchArgs).toHaveProperty('text', query);
    expect(searchArgs).toHaveProperty('userId', userId);
    expect(searchArgs).not.toHaveProperty('textEmbedding');
  });

  // -------------------------------------------------------------------------
  // Image mode
  // -------------------------------------------------------------------------

  it('does NOT call embedQuery() in image mode and still adds isImage OData filter', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchMode: 'image' });

    // Azure handles query-time vectorization — no client-side embedding call
    expect(mockEmbedQuery).not.toHaveBeenCalled();

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    const filter = searchArgs['additionalFilter'] as string | undefined;

    expect(filter).toContain('isImage eq true');
  });

  it('does NOT add isImage filter for text mode', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchMode: 'text' });

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    const filter = searchArgs['additionalFilter'] as string | undefined;

    expect(filter ?? '').not.toContain('isImage eq true');
  });

  // -------------------------------------------------------------------------
  // Keyword mode — no embedding generated
  // -------------------------------------------------------------------------

  it('skips embedding entirely for keyword searchType', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchType: 'keyword' });

    expect(mockEmbedQuery).not.toHaveBeenCalled();

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(searchArgs['useVectorSearch']).toBe(false);
    expect(searchArgs['useSemanticRanker']).toBe(false);
  });
});
