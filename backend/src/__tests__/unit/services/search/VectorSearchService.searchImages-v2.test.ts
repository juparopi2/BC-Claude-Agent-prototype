import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — searchImages PRD-202 Routing Tests
 *
 * Verifies that the searchImages() method correctly routes between v1 (legacy
 * imageVector) and v2 (unified embeddingVector) based on the USE_UNIFIED_INDEX
 * flag, and that getV2SearchClient() always returns a usable v2 client.
 *
 * Stand-alone file: does not depend on VectorSearchService.unified.test.ts.
 */

// ---------------------------------------------------------------------------
// Hoisted env mock — toggled per-test without module reload
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  USE_UNIFIED_INDEX: true as boolean,
  AZURE_SEARCH_ENDPOINT: 'https://test.search.windows.net',
  AZURE_SEARCH_KEY: 'test-key',
}));

vi.mock('@/infrastructure/config/environment', () => ({ env: mockEnv }));

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

describe('VectorSearchService — searchImages PRD-202', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof createMockIndexClient>;
  let mockClientV1: ReturnType<typeof emptyMockClient>;
  let mockClientV2: ReturnType<typeof emptyMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset singleton so each test gets a fresh VectorSearchService instance
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockEnv.USE_UNIFIED_INDEX = true;

    mockIndexClient = createMockIndexClient();
    mockClientV1 = emptyMockClient();
    mockClientV2 = emptyMockClient();

    service = VectorSearchService.getInstance();
    await service.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      mockClientV2 as unknown as SearchClient<Record<string, unknown>>,
    );
  });

  // -------------------------------------------------------------------------
  // 1. Client routing — unified
  // -------------------------------------------------------------------------

  it('searchImages uses v2 client and embeddingVector field when unified=true', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;
    const embedding = new Array(1536).fill(0.1);

    await service.searchImages({ embedding, userId: 'user-abc', top: 5 });

    // v2 must be called; v1 must NOT be called
    expect(mockClientV2.search).toHaveBeenCalledTimes(1);
    expect(mockClientV1.search).not.toHaveBeenCalled();

    // Confirm the vector field name sent to the SDK
    const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const vectorQueries = (
      callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> }
    )?.queries;
    expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    expect(vectorQueries?.[0]?.vector).toEqual(embedding);
  });

  // -------------------------------------------------------------------------
  // 2. Client routing — legacy
  // -------------------------------------------------------------------------

  it('searchImages uses v1 client and imageVector field when unified=false', async () => {
    mockEnv.USE_UNIFIED_INDEX = false;

    // Reset and reinitialise without v2 client (legacy mode)
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const legacyService = VectorSearchService.getInstance();
    await legacyService.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      // No v2 client
    );

    const embedding = new Array(1024).fill(0.1);
    await legacyService.searchImages({ embedding, userId: 'user-abc', top: 5 });

    expect(mockClientV1.search).toHaveBeenCalledTimes(1);
    expect(mockClientV2.search).not.toHaveBeenCalled();

    const callOptions = mockClientV1.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const vectorQueries = (
      callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> }
    )?.queries;
    expect(vectorQueries?.[0]?.fields).toEqual(['imageVector']);
  });

  // -------------------------------------------------------------------------
  // 3. userId filter is always applied — unified mode
  // -------------------------------------------------------------------------

  it('searchImages applies userId filter in unified mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;
    const embedding = new Array(1536).fill(0.2);

    await service.searchImages({ embedding, userId: 'user-xyz', top: 3 });

    const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    // userId is normalised to uppercase
    expect(filter).toContain("userId eq 'USER-XYZ'");
  });

  // -------------------------------------------------------------------------
  // 4. userId filter is always applied — legacy mode
  // -------------------------------------------------------------------------

  it('searchImages applies userId filter in legacy mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = false;
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const legacyService = VectorSearchService.getInstance();
    await legacyService.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
    );

    const embedding = new Array(1024).fill(0.2);
    await legacyService.searchImages({ embedding, userId: 'user-xyz', top: 3 });

    const callOptions = mockClientV1.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain("userId eq 'USER-XYZ'");
  });

  // -------------------------------------------------------------------------
  // 5. isImage filter is always present — unified mode
  // -------------------------------------------------------------------------

  it('searchImages applies isImage filter in unified mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;
    const embedding = new Array(1536).fill(0.1);

    await service.searchImages({ embedding, userId: 'user-abc', top: 5 });

    const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain('isImage eq true');
  });

  // -------------------------------------------------------------------------
  // 6. isImage filter is always present — legacy mode
  // -------------------------------------------------------------------------

  it('searchImages applies isImage filter in legacy mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = false;
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const legacyService = VectorSearchService.getInstance();
    await legacyService.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
    );

    const embedding = new Array(1024).fill(0.1);
    await legacyService.searchImages({ embedding, userId: 'user-abc', top: 5 });

    const callOptions = mockClientV1.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain('isImage eq true');
  });

  // -------------------------------------------------------------------------
  // 7. minScore threshold filters out low-scoring results
  // -------------------------------------------------------------------------

  it('searchImages respects minScore threshold in unified mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;

    // Provide two rows: one above the threshold, one below
    const rows = [
      { fileId: 'FILE-A', content: '[Image: chart.png]', score: 0.9 },
      { fileId: 'FILE-B', content: '[Image: logo.png]', score: 0.2 },
    ];

    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const svc = VectorSearchService.getInstance();
    const clientV2WithRows = createMockSearchClient(rows);
    await svc.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      emptyMockClient() as unknown as SearchClient<Record<string, unknown>>,
      clientV2WithRows as unknown as SearchClient<Record<string, unknown>>,
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

  it('searchImages respects minScore threshold in legacy mode', async () => {
    mockEnv.USE_UNIFIED_INDEX = false;

    const rows = [
      { fileId: 'FILE-A', content: '[Image: photo.jpg]', score: 0.8 },
      { fileId: 'FILE-B', content: '[Image: icon.png]', score: 0.1 },
    ];

    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const legacyService = VectorSearchService.getInstance();
    const clientV1WithRows = createMockSearchClient(rows);
    await legacyService.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      clientV1WithRows as unknown as SearchClient<Record<string, unknown>>,
    );

    const results = await legacyService.searchImages({
      embedding: new Array(1024).fill(0.1),
      userId: 'user-abc',
      top: 10,
      minScore: 0.5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.fileId).toBe('FILE-A');
  });

  // -------------------------------------------------------------------------
  // 8. additionalFilter is ANDed into the base filter
  // -------------------------------------------------------------------------

  it('searchImages includes additionalFilter when provided', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;
    const embedding = new Array(1536).fill(0.1);
    const additionalFilter = "siteId eq 'SITE-001'";

    await service.searchImages({
      embedding,
      userId: 'user-abc',
      top: 5,
      additionalFilter,
    });

    const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
    const filter = callOptions?.filter as string;

    expect(filter).toContain(additionalFilter);
    // Must still contain the base filters
    expect(filter).toContain('isImage eq true');
    expect(filter).toContain("userId eq 'USER-ABC'");
  });

  // -------------------------------------------------------------------------
  // 9. getV2SearchClient returns v2 client when flag is true
  // -------------------------------------------------------------------------

  it('getV2SearchClient returns the pre-initialised v2 client when flag is true', async () => {
    mockEnv.USE_UNIFIED_INDEX = true;
    // service was already initialised in beforeEach with mockClientV2

    const returned = await service.getV2SearchClient();

    // Should be the exact mock instance we injected
    expect(returned).toBe(mockClientV2);
  });

  // -------------------------------------------------------------------------
  // 10. getV2SearchClient creates v2 client even when flag is false
  // -------------------------------------------------------------------------

  it('getV2SearchClient creates v2 client even when USE_UNIFIED_INDEX is false', async () => {
    mockEnv.USE_UNIFIED_INDEX = false;

    // Reset singleton, init WITHOUT a v2 override — simulates the case where
    // getV2SearchClient is called by a migration script with the flag off.
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
    const svc = VectorSearchService.getInstance();
    await svc.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      // No v2 client injected
    );

    // The SDK constructor is mocked above; configure it to return a sentinel object
    const fakeV2Client = { search: vi.fn() };
    (SearchClient as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fakeV2Client);

    const returned = await svc.getV2SearchClient();

    // getV2SearchClient must always produce a usable v2 client regardless of the flag
    expect(returned).toBeDefined();
    expect(returned).toBe(fakeV2Client);
  });
});
