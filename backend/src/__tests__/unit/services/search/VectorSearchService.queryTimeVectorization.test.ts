import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — Query-Time Vectorization Tests (PRD-203)
 *
 * Verifies that semanticSearch() always uses kind:'text' vector queries,
 * delegating embedding generation to the Azure AI Search native Cohere vectorizer.
 */

// ---------------------------------------------------------------------------
// Hoisted env mock
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
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
  let mockSearchClient: ReturnType<typeof createMockSearchClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the singleton so each test gets a fresh state
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockIndexClient = {
      getIndex: vi.fn().mockResolvedValue({ name: 'file-chunks-index' }),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
    } as unknown as ReturnType<typeof vi.fn>;

    mockSearchClient = createMockSearchClient();

    service = VectorSearchService.getInstance();
    await service.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockSearchClient as unknown as SearchClient<Record<string, unknown>>,
    );
  });

  // -------------------------------------------------------------------------
  // Always uses kind:'text' — Azure native Cohere vectorizer
  // -------------------------------------------------------------------------

  describe('always uses query-time vectorization', () => {
    it('sends a vector query with kind:"text" and the query string', async () => {
      await service.semanticSearch({
        text: 'find invoices',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockSearchClient.search).toHaveBeenCalledTimes(1);
      const callOptions = mockSearchClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries).toHaveLength(1);
      expect(vectorQueries?.[0]?.kind).toBe('text');
      expect(vectorQueries?.[0]?.text).toBe('find invoices');
      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    });

    it('does NOT include a client-supplied vector array in the query', async () => {
      await service.semanticSearch({
        text: 'quarterly report',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockSearchClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      // The query must NOT carry a client-supplied vector array
      expect(vectorQueries?.[0]?.vector).toBeUndefined();
      // kind must always be 'text'
      expect(vectorQueries?.[0]?.kind).toBe('text');
    });

    it('uses the search client exactly once per call', async () => {
      await service.semanticSearch({
        text: 'purchase orders',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockSearchClient.search).toHaveBeenCalledTimes(1);
    });

    it('sends kind:"text" for multiple different queries', async () => {
      await service.semanticSearch({
        text: 'budget analysis',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      await service.semanticSearch({
        text: 'vendor list',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockSearchClient.search).toHaveBeenCalledTimes(2);

      for (const call of mockSearchClient.search.mock.calls) {
        const callOptions = call[1] as Record<string, unknown>;
        const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;
        expect(vectorQueries?.[0]?.kind).toBe('text');
      }
    });

    it('never emits a kind:"vector" query', async () => {
      await service.semanticSearch({
        text: 'expense claims',
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      const callOptions = mockSearchClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      const anyVectorKind = vectorQueries?.some(q => q['kind'] === 'vector');
      expect(anyVectorKind).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // useVectorSearch: false — no vector queries emitted
  // -------------------------------------------------------------------------

  describe('when useVectorSearch is false', () => {
    it('emits no vector queries when useVectorSearch is disabled', async () => {
      await service.semanticSearch({
        text: 'find invoices',
        userId: 'user-abc',
        useVectorSearch: false,
        useSemanticRanker: false,
      });

      const callOptions = mockSearchClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorSearchOptions = callOptions?.vectorSearchOptions as { queries?: unknown } | undefined;

      expect(vectorSearchOptions).toBeUndefined();
    });
  });
});
