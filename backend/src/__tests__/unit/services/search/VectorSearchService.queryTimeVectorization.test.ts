import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — Query-Time Vectorization Tests (PRD-203)
 *
 * Verifies that the USE_QUERY_TIME_VECTORIZATION feature flag correctly
 * switches the vector query kind between 'text' (Azure-native vectorization)
 * and 'vector' (client-supplied embedding array) in semanticSearch().
 *
 * Matrix tested:
 *   USE_QUERY_TIME_VECTORIZATION=true  + USE_UNIFIED_INDEX=true  → kind:'text'
 *   USE_QUERY_TIME_VECTORIZATION=false + USE_UNIFIED_INDEX=true  → kind:'vector'
 *   USE_QUERY_TIME_VECTORIZATION=true  + USE_UNIFIED_INDEX=false → legacy dual-vector (flag ignored)
 *   Default value of USE_QUERY_TIME_VECTORIZATION                → false
 *
 * Companion to VectorSearchService.unified.test.ts (PRD-201).
 */

// ---------------------------------------------------------------------------
// Hoisted env mock — must toggle between tests without module reload
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  USE_UNIFIED_INDEX: true as boolean,
  USE_QUERY_TIME_VECTORIZATION: false as boolean,
  AZURE_SEARCH_ENDPOINT: 'https://test.search.windows.net',
  AZURE_SEARCH_KEY: 'test-key',
}));

vi.mock('@/infrastructure/config/environment', () => ({ env: mockEnv }));

// Silence Azure SDK constructor — we inject mocks via initializeClients()
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

/** Build a fully-mocked SearchClient suitable for injection */
function createMockSearchClient() {
  return {
    search: vi.fn().mockResolvedValue({
      results: {
        // Async iterator that immediately signals done — no results
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
      },
    }),
    uploadDocuments: vi.fn().mockResolvedValue({
      results: [{ succeeded: true, key: 'test-key' }],
    }),
    mergeDocuments: vi.fn().mockResolvedValue({
      results: [{ succeeded: true }],
    }),
    deleteDocuments: vi.fn().mockResolvedValue({
      results: [{ succeeded: true }],
    }),
    getDocumentsCount: vi.fn().mockResolvedValue(0),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VectorSearchService — Query-Time Vectorization (PRD-203)', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof vi.fn>;
  let mockClientV1: ReturnType<typeof createMockSearchClient>;
  let mockClientV2: ReturnType<typeof createMockSearchClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the singleton so each test gets a fresh state
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    // Default: unified index ON, query-time vectorization OFF
    mockEnv.USE_UNIFIED_INDEX = true;
    mockEnv.USE_QUERY_TIME_VECTORIZATION = false;

    mockIndexClient = {
      getIndex: vi.fn().mockResolvedValue({ name: 'file-chunks-index' }),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
    } as unknown as ReturnType<typeof vi.fn>;

    mockClientV1 = createMockSearchClient();
    mockClientV2 = createMockSearchClient();

    service = VectorSearchService.getInstance();
    await service.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      mockClientV2 as unknown as SearchClient<Record<string, unknown>>,
    );
  });

  // -------------------------------------------------------------------------
  // Core behavior: kind:'text' when flag ON + unified
  // -------------------------------------------------------------------------

  describe('when USE_QUERY_TIME_VECTORIZATION=true AND USE_UNIFIED_INDEX=true', () => {
    it('sends a vector query with kind:"text" and the query string', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = true;
      mockEnv.USE_UNIFIED_INDEX = true;

      await service.semanticSearch({
        text: 'find invoices',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClientV2.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries).toHaveLength(1);
      expect(vectorQueries?.[0]?.kind).toBe('text');
      expect(vectorQueries?.[0]?.text).toBe('find invoices');
      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    });

    it('does NOT include a "vector" embedding array in the query when flag is ON', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = true;
      mockEnv.USE_UNIFIED_INDEX = true;

      const textEmbedding = new Array(1536).fill(0.5);

      await service.semanticSearch({
        text: 'quarterly report',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      // The query must NOT carry a client-supplied vector array
      expect(vectorQueries?.[0]?.vector).toBeUndefined();
      // kind must be 'text', not 'vector'
      expect(vectorQueries?.[0]?.kind).toBe('text');
    });

    it('routes to the v2 client (not v1)', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = true;
      mockEnv.USE_UNIFIED_INDEX = true;

      await service.semanticSearch({
        text: 'purchase orders',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClientV2.search).toHaveBeenCalledTimes(1);
      expect(mockClientV1.search).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Core behavior: kind:'vector' when flag OFF + unified
  // -------------------------------------------------------------------------

  describe('when USE_QUERY_TIME_VECTORIZATION=false AND USE_UNIFIED_INDEX=true', () => {
    it('sends a vector query with kind:"vector" and the embedding array', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = false;
      mockEnv.USE_UNIFIED_INDEX = true;

      const textEmbedding = new Array(1536).fill(0.2);

      await service.semanticSearch({
        text: 'find invoices',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClientV2.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries).toHaveLength(1);
      expect(vectorQueries?.[0]?.kind).toBe('vector');
      expect(vectorQueries?.[0]?.vector).toEqual(textEmbedding);
      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    });

    it('does NOT include a "text" string property in the query when flag is OFF', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = false;
      mockEnv.USE_UNIFIED_INDEX = true;

      const textEmbedding = new Array(1536).fill(0.3);

      await service.semanticSearch({
        text: 'budget analysis',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      // Query kind must be 'vector', never 'text'
      expect(vectorQueries?.[0]?.kind).toBe('vector');
    });

    it('produces no vector queries when no embedding is provided (no flag effect)', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = false;
      mockEnv.USE_UNIFIED_INDEX = true;

      await service.semanticSearch({
        text: 'find invoices',
        // textEmbedding deliberately omitted
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorSearchOptions = callOptions?.vectorSearchOptions as { queries?: unknown } | undefined;

      // Without an embedding, the unified OFF path emits no vector queries
      expect(vectorSearchOptions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Legacy path: flag has no effect when USE_UNIFIED_INDEX=false
  // -------------------------------------------------------------------------

  describe('when USE_QUERY_TIME_VECTORIZATION=true AND USE_UNIFIED_INDEX=false (legacy path)', () => {
    it('ignores the query-time vectorization flag and uses legacy dual-vector queries', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = true;
      mockEnv.USE_UNIFIED_INDEX = false;

      // Reset singleton so getActiveSearchClient picks v1
      (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
      const legacyService = VectorSearchService.getInstance();
      await legacyService.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
        // No v2 client — legacy mode
      );

      const textEmbedding = new Array(1536).fill(0.1);
      const imageEmbedding = new Array(1024).fill(0.2);

      await legacyService.semanticSearch({
        text: 'find invoices',
        textEmbedding,
        imageEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClientV1.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClientV1.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      // Legacy path always uses kind:'vector' with per-field vectors
      const kinds = vectorQueries?.map(q => q['kind']);
      expect(kinds).not.toContain('text');
      kinds?.forEach(k => expect(k).toBe('vector'));

      // Legacy fields — embeddingVector must NOT appear
      const allFields = vectorQueries?.map(q => q['fields']).flat();
      expect(allFields).toContain('contentVector');
      expect(allFields).not.toContain('embeddingVector');
    });

    it('routes to the v1 client (not v2) regardless of the vectorization flag', async () => {
      mockEnv.USE_QUERY_TIME_VECTORIZATION = true;
      mockEnv.USE_UNIFIED_INDEX = false;

      (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
      const legacyService = VectorSearchService.getInstance();
      await legacyService.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      );

      await legacyService.semanticSearch({
        text: 'test query',
        textEmbedding: new Array(1536).fill(0.1),
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClientV1.search).toHaveBeenCalledTimes(1);
      expect(mockClientV2.search).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Default value: USE_QUERY_TIME_VECTORIZATION defaults to false
  // -------------------------------------------------------------------------

  describe('default value', () => {
    it('defaults USE_QUERY_TIME_VECTORIZATION to false — uses kind:"vector" path', async () => {
      // mockEnv.USE_QUERY_TIME_VECTORIZATION is false (set in beforeEach)
      mockEnv.USE_UNIFIED_INDEX = true;

      const textEmbedding = new Array(1536).fill(0.4);

      await service.semanticSearch({
        text: 'expense claims',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      // Default OFF → kind must be 'vector', not 'text'
      expect(vectorQueries?.[0]?.kind).toBe('vector');
      expect(vectorQueries?.[0]?.vector).toEqual(textEmbedding);
    });

    it('does not emit a kind:"text" query unless the flag is explicitly enabled', async () => {
      // mockEnv.USE_QUERY_TIME_VECTORIZATION is false (set in beforeEach, never changed)
      mockEnv.USE_UNIFIED_INDEX = true;

      const textEmbedding = new Array(1536).fill(0.1);

      await service.semanticSearch({
        text: 'vendor list',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockClientV2.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      const anyTextKind = vectorQueries?.some(q => q['kind'] === 'text');
      expect(anyTextKind).toBe(false);
    });
  });
});
