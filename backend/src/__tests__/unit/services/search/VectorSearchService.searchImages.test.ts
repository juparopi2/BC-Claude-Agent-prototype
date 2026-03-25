import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — searchImages Tests
 *
 * Verifies that the searchImages() method correctly uses the unified embeddingVector
 * field and applies the expected filters (userId, isImage, additionalFilter).
 */

// Silence Azure SDK constructors — we inject mock clients via initializeClients()
vi.mock('@azure/search-documents', () => ({
  SearchIndexClient: vi.fn(),
  SearchClient: vi.fn(),
  AzureKeyCredential: vi.fn(),
}));

// Silence usage tracking (fire-and-forget, not under test here)
vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({ trackSearch: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock SearchClient with configurable result rows.
 * Each row is { fileId, content, score }.
 */
function createMockSearchClient(rows: Array<{ fileId: string; content: string; score: number }> = []) {
  let rowIndex = 0;
  const iterator = {
    next: (): Promise<{ done: boolean; value: { document: { fileId: string; content: string }; score: number } | undefined }> => {
      if (rowIndex < rows.length) {
        const row = rows[rowIndex++]!;
        return Promise.resolve({
          done: false,
          value: { document: { fileId: row.fileId, content: row.content }, score: row.score },
        });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
  };

  return {
    search: vi.fn().mockResolvedValue({
      results: { [Symbol.asyncIterator]: () => iterator },
    }),
    uploadDocuments: vi.fn().mockResolvedValue({
      results: [{ succeeded: true, key: 'test-key' }],
    }),
    mergeDocuments: vi.fn().mockResolvedValue({ results: [{ succeeded: true }] }),
    deleteDocuments: vi.fn().mockResolvedValue({ results: [{ succeeded: true }] }),
    getDocumentsCount: vi.fn().mockResolvedValue(0),
  };
}

/** Build a plain mock SearchClient that returns no results */
function emptyMockClient() {
  return createMockSearchClient([]);
}

/** Build a mock SearchIndexClient */
function createMockIndexClient() {
  return {
    getIndex: vi.fn().mockResolvedValue({ name: 'file-chunks-index' }),
    createIndex: vi.fn(),
    deleteIndex: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VectorSearchService — searchImages', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof createMockIndexClient>;
  let mockClient: ReturnType<typeof emptyMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset singleton so each test gets a fresh VectorSearchService instance
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockIndexClient = createMockIndexClient();
    mockClient = emptyMockClient();

    service = VectorSearchService.getInstance();
    await service.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClient as unknown as SearchClient<Record<string, unknown>>,
    );
  });

  // -------------------------------------------------------------------------
  // 1. Uses embeddingVector field
  // -------------------------------------------------------------------------

  it('searchImages uses embeddingVector field', async () => {
    const embedding = new Array(1536).fill(0.1);

    await service.searchImages({ embedding, userId: 'user-abc', top: 5 });

    expect(mockClient.search).toHaveBeenCalledTimes(1);

    const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const vectorQueries = (
      callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> }
    )?.queries;
    expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    expect(vectorQueries?.[0]?.vector).toEqual(embedding);
  });

  // -------------------------------------------------------------------------
  // 2. userId filter is always applied
  // -------------------------------------------------------------------------

  it('searchImages applies userId filter', async () => {
    const embedding = new Array(1536).fill(0.2);

    await service.searchImages({ embedding, userId: 'user-xyz', top: 3 });

    const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    // userId is normalised to uppercase
    expect(filter).toContain("userId eq 'USER-XYZ'");
  });

  // -------------------------------------------------------------------------
  // 3. isImage filter is always present
  // -------------------------------------------------------------------------

  it('searchImages applies isImage filter', async () => {
    const embedding = new Array(1536).fill(0.1);

    await service.searchImages({ embedding, userId: 'user-abc', top: 5 });

    const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain('isImage eq true');
  });

  // -------------------------------------------------------------------------
  // 4. minScore threshold filters out low-scoring results
  // -------------------------------------------------------------------------

  it('searchImages respects minScore threshold', async () => {
    const rows = [
      { fileId: 'FILE-A', content: '[Image: chart.png]', score: 0.9 },
      { fileId: 'FILE-B', content: '[Image: logo.png]', score: 0.2 },
    ];

    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const svc = VectorSearchService.getInstance();
    const clientWithRows = createMockSearchClient(rows);
    await svc.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      clientWithRows as unknown as SearchClient<Record<string, unknown>>,
    );

    const results = await svc.searchImages({
      embedding: new Array(1536).fill(0.1),
      userId: 'user-abc',
      top: 10,
      minScore: 0.5,
    });

    // Only FILE-A (score 0.9) should pass the threshold
    expect(results).toHaveLength(1);
    expect(results[0]?.fileId).toBe('FILE-A');
  });

  // -------------------------------------------------------------------------
  // 5. additionalFilter is ANDed into the base filter
  // -------------------------------------------------------------------------

  it('searchImages includes additionalFilter when provided', async () => {
    const embedding = new Array(1536).fill(0.1);
    const additionalFilter = "siteId eq 'SITE-001'";

    await service.searchImages({
      embedding,
      userId: 'user-abc',
      top: 5,
      additionalFilter,
    });

    const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain(additionalFilter);
    // Must still contain the base filters
    expect(filter).toContain('isImage eq true');
    expect(filter).toContain("userId eq 'USER-ABC'");
  });
});
