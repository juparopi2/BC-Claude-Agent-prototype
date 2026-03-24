import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SemanticSearchService — Unified Index Path Tests (PRD-201)
 *
 * Verifies that SemanticSearchService correctly branches on
 * isUnifiedIndexEnabled() and uses Cohere's embedQuery() instead of
 * the legacy dual-embedding approach when USE_UNIFIED_INDEX=true.
 *
 * Companion to SemanticSearchService.test.ts which covers the legacy path.
 *
 * Key invariants under test:
 * - Unified path calls embedQuery() (single call, 1536d)
 * - Unified path passes textEmbedding only — no imageEmbedding
 * - Image mode with unified index: uses isImage filter, same embedQuery() call
 * - Keyword mode skips embedding entirely (unchanged in both paths)
 * - Legacy path preserved when isUnifiedIndexEnabled() returns false
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

/** Controls unified/legacy branching per-test */
const mockIsUnified = vi.hoisted(() => ({ value: true }));

/** Spy on the unified embedQuery call */
const mockEmbedQuery = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    embedding: new Array(1536).fill(0.1),
    model: 'Cohere-embed-v4',
    inputTokens: 5,
  }),
);

vi.mock('@/services/search/embeddings/EmbeddingServiceFactory', () => ({
  isUnifiedIndexEnabled: vi.fn(() => mockIsUnified.value),
  getUnifiedEmbeddingService: vi.fn(() => ({
    embedQuery: mockEmbedQuery,
    dimensions: 1536,
    modelName: 'Cohere-embed-v4',
  })),
}));

// ---------------------------------------------------------------------------
// Legacy embedding service mock (should NOT be called on unified path)
// ---------------------------------------------------------------------------

const mockGenerateTextEmbedding = vi.fn().mockResolvedValue({
  embedding: new Array(1536).fill(0.2),
  model: 'text-embedding-3-small',
  tokenCount: 8,
  userId: 'user-abc',
  createdAt: new Date(),
});

const mockGenerateImageQueryEmbedding = vi.fn().mockResolvedValue({
  embedding: new Array(1024).fill(0.3),
  model: 'vectorize-text-2023-04-15',
  imageSize: 0,
  userId: 'user-abc',
  createdAt: new Date(),
});

vi.mock('@/services/embeddings/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: vi.fn(() => ({
      generateTextEmbedding: mockGenerateTextEmbedding,
      generateImageQueryEmbedding: mockGenerateImageQueryEmbedding,
    })),
  },
}));

// ---------------------------------------------------------------------------
// VectorSearchService mock — captures what SemanticSearchService sends
// ---------------------------------------------------------------------------

const mockSemanticSearch = vi.fn().mockResolvedValue([]);

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
import { isUnifiedIndexEnabled, getUnifiedEmbeddingService } from '@/services/search/embeddings/EmbeddingServiceFactory';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SemanticSearchService — Unified Index Path (PRD-201)', () => {
  const userId = 'user-abc';
  const query = 'show me invoices from last month';

  beforeEach(() => {
    // Reset singleton so each test constructs a fresh instance
    (SemanticSearchService as unknown as { instance: undefined }).instance = undefined;

    // Default: unified path active
    mockIsUnified.value = true;
    vi.mocked(isUnifiedIndexEnabled).mockImplementation(() => mockIsUnified.value);

    mockEmbedQuery.mockClear();
    mockGenerateTextEmbedding.mockClear();
    mockGenerateImageQueryEmbedding.mockClear();
    mockSemanticSearch.mockClear();
    mockSemanticSearch.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // Unified path: embedding choice
  // -------------------------------------------------------------------------

  it('calls embedQuery() instead of generateTextEmbedding() on the unified path', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query });

    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    expect(mockEmbedQuery).toHaveBeenCalledWith(query);

    // Legacy methods must NOT be invoked
    expect(mockGenerateTextEmbedding).not.toHaveBeenCalled();
    expect(mockGenerateImageQueryEmbedding).not.toHaveBeenCalled();
  });

  it('passes only textEmbedding (no imageEmbedding) to vectorSearchService on unified path', async () => {
    const service = SemanticSearchService.getInstance();
    const expectedEmbedding = new Array(1536).fill(0.1);
    mockEmbedQuery.mockResolvedValueOnce({
      embedding: expectedEmbedding,
      model: 'Cohere-embed-v4',
      inputTokens: 5,
    });

    await service.searchRelevantFiles({ userId, query });

    expect(mockSemanticSearch).toHaveBeenCalledTimes(1);
    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(searchArgs).toHaveProperty('textEmbedding', expectedEmbedding);
    // imageEmbedding must be absent (unified vector space covers both modalities)
    expect(searchArgs).not.toHaveProperty('imageEmbedding');
    expect(searchArgs['imageEmbedding']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Unified path + image mode
  // -------------------------------------------------------------------------

  it('uses the same embedQuery() call in image mode and adds isImage OData filter', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchMode: 'image' });

    // Still calls embedQuery() once — unified space handles image content too
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    expect(mockGenerateImageQueryEmbedding).not.toHaveBeenCalled();

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    const filter = searchArgs['additionalFilter'] as string | undefined;

    expect(filter).toContain('isImage eq true');
  });

  it('does NOT add isImage filter for text mode on unified path', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchMode: 'text' });

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    const filter = searchArgs['additionalFilter'] as string | undefined;

    expect(filter ?? '').not.toContain('isImage eq true');
  });

  // -------------------------------------------------------------------------
  // Keyword mode — no embedding generated (path-independent invariant)
  // -------------------------------------------------------------------------

  it('skips embedding entirely for keyword searchType regardless of unified flag', async () => {
    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query, searchType: 'keyword' });

    expect(mockEmbedQuery).not.toHaveBeenCalled();
    expect(mockGenerateTextEmbedding).not.toHaveBeenCalled();
    expect(mockGenerateImageQueryEmbedding).not.toHaveBeenCalled();

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(searchArgs['useVectorSearch']).toBe(false);
    expect(searchArgs['useSemanticRanker']).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Legacy path preserved (regression guard)
  // -------------------------------------------------------------------------

  it('falls back to generateTextEmbedding() + generateImageQueryEmbedding() when unified is disabled', async () => {
    mockIsUnified.value = false;
    vi.mocked(isUnifiedIndexEnabled).mockReturnValue(false);

    const service = SemanticSearchService.getInstance();

    await service.searchRelevantFiles({ userId, query });

    // Unified embedding must NOT be called
    expect(mockEmbedQuery).not.toHaveBeenCalled();

    // Both legacy embeddings must be called (text + image query in parallel)
    expect(mockGenerateTextEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateTextEmbedding).toHaveBeenCalledWith(query, userId, 'semantic-search');

    expect(mockGenerateImageQueryEmbedding).toHaveBeenCalledTimes(1);
    expect(mockGenerateImageQueryEmbedding).toHaveBeenCalledWith(query, userId, 'semantic-search');
  });

  it('legacy path passes both textEmbedding and imageEmbedding to vectorSearchService', async () => {
    mockIsUnified.value = false;
    vi.mocked(isUnifiedIndexEnabled).mockReturnValue(false);

    const textEmbeddingData = new Array(1536).fill(0.2);
    const imageEmbeddingData = new Array(1024).fill(0.3);

    mockGenerateTextEmbedding.mockResolvedValueOnce({
      embedding: textEmbeddingData,
      model: 'text-embedding-3-small',
      tokenCount: 8,
      userId,
      createdAt: new Date(),
    });
    mockGenerateImageQueryEmbedding.mockResolvedValueOnce({
      embedding: imageEmbeddingData,
      model: 'vectorize-text-2023-04-15',
      imageSize: 0,
      userId,
      createdAt: new Date(),
    });

    const service = SemanticSearchService.getInstance();
    await service.searchRelevantFiles({ userId, query });

    const searchArgs = mockSemanticSearch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(searchArgs).toHaveProperty('textEmbedding', textEmbeddingData);
    expect(searchArgs).toHaveProperty('imageEmbedding', imageEmbeddingData);
  });

  // -------------------------------------------------------------------------
  // getUnifiedEmbeddingService() availability guard
  // -------------------------------------------------------------------------

  it('returns empty results when USE_UNIFIED_INDEX is true but getUnifiedEmbeddingService() returns undefined', async () => {
    mockIsUnified.value = true;
    vi.mocked(isUnifiedIndexEnabled).mockReturnValue(true);
    vi.mocked(getUnifiedEmbeddingService).mockReturnValueOnce(undefined);

    const service = SemanticSearchService.getInstance();

    // Graceful degradation: service catches the error and returns empty results
    const result = await service.searchRelevantFiles({ userId, query });
    expect(result.results).toEqual([]);
    expect(result.totalChunksSearched).toBe(0);
  });
});
