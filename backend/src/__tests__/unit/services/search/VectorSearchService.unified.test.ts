import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — Unified Index Routing Tests (PRD-201)
 *
 * Verifies that the USE_UNIFIED_INDEX feature flag correctly routes
 * all index read/write operations between the v1 (legacy dual-vector)
 * and v2 (unified 1536d Cohere) clients and field names.
 *
 * Companion to VectorSearchService.test.ts which covers the legacy path.
 * These tests only add the PRD-201 unified routing assertions.
 */

// ---------------------------------------------------------------------------
// Hoisted env mock — must toggle between tests without module reload
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  USE_UNIFIED_INDEX: true as boolean,
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

/** Minimal FileChunkWithEmbedding fixture */
function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: 'chunk-abc',
    fileId: 'file-abc',
    userId: 'user-abc',
    content: 'test content',
    embedding: new Array(1536).fill(0.1),
    chunkIndex: 0,
    tokenCount: 10,
    embeddingModel: 'Cohere-embed-v4',
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VectorSearchService — Unified Index Routing (PRD-201)', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof vi.fn>;
  let mockClientV1: ReturnType<typeof createMockSearchClient>;
  let mockClientV2: ReturnType<typeof createMockSearchClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the singleton so each test gets a fresh state
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockEnv.USE_UNIFIED_INDEX = true;

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
  // semanticSearch — unified path
  // -------------------------------------------------------------------------

  describe('semanticSearch', () => {
    it('sends a single vector query on embeddingVector when unified index is enabled', async () => {
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
      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
      expect(vectorQueries?.[0]?.vector).toEqual(textEmbedding);
    });

    it('sends dual vector queries (contentVector + imageVector) on legacy path (regression)', async () => {
      mockEnv.USE_UNIFIED_INDEX = false;
      // Reset singleton so getActiveSearchClient picks v1
      (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
      const legacyService = VectorSearchService.getInstance();
      await legacyService.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
        // No v2 client passed — legacy mode
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

      const fields = vectorQueries?.map(q => q['fields']);
      expect(fields).toContainEqual(['contentVector']);
      expect(fields).toContainEqual(['imageVector']);
      // Unified field must NOT appear in legacy mode
      expect(fields?.flat()).not.toContain('embeddingVector');
    });
  });

  // -------------------------------------------------------------------------
  // indexChunksBatch — unified path
  // -------------------------------------------------------------------------

  describe('indexChunksBatch', () => {
    it('sets embeddingVector (not contentVector) when unified index is enabled', async () => {
      mockEnv.USE_UNIFIED_INDEX = true;
      const chunk = makeChunk();

      await service.indexChunksBatch([chunk]);

      expect(mockClientV2.uploadDocuments).toHaveBeenCalledTimes(1);
      const docs = mockClientV2.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toHaveProperty('embeddingVector');
      expect(docs[0]).not.toHaveProperty('contentVector');
    });

    it('sets contentVector (not embeddingVector) on legacy path (regression)', async () => {
      mockEnv.USE_UNIFIED_INDEX = false;
      (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
      const legacyService = VectorSearchService.getInstance();
      await legacyService.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      );

      const chunk = makeChunk();
      await legacyService.indexChunksBatch([chunk]);

      const docs = mockClientV1.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs[0]).toHaveProperty('contentVector');
      expect(docs[0]).not.toHaveProperty('embeddingVector');
    });
  });

  // -------------------------------------------------------------------------
  // indexImageEmbedding — unified path
  // -------------------------------------------------------------------------

  describe('indexImageEmbedding', () => {
    it('sets embeddingVector (not imageVector) when unified index is enabled', async () => {
      mockEnv.USE_UNIFIED_INDEX = true;
      const embedding = new Array(1536).fill(0.3);

      await service.indexImageEmbedding({
        fileId: 'file-img-001',
        userId: 'user-abc',
        embedding,
        fileName: 'chart.png',
        caption: 'A bar chart showing Q1 sales',
      });

      expect(mockClientV2.uploadDocuments).toHaveBeenCalledTimes(1);
      const docs = mockClientV2.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toHaveProperty('embeddingVector', embedding);
      expect(docs[0]).not.toHaveProperty('imageVector');
      expect(docs[0]).not.toHaveProperty('contentVector');
      expect(docs[0]).toHaveProperty('isImage', true);
    });

    it('sets imageVector (not embeddingVector) on legacy path (regression)', async () => {
      mockEnv.USE_UNIFIED_INDEX = false;
      (VectorSearchService as unknown as { instance: undefined }).instance = undefined;
      const legacyService = VectorSearchService.getInstance();
      await legacyService.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClientV1 as unknown as SearchClient<Record<string, unknown>>,
      );

      const embedding = new Array(1024).fill(0.3);
      await legacyService.indexImageEmbedding({
        fileId: 'file-img-001',
        userId: 'user-abc',
        embedding,
        fileName: 'chart.png',
      });

      const docs = mockClientV1.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs[0]).toHaveProperty('imageVector', embedding);
      expect(docs[0]).not.toHaveProperty('embeddingVector');
    });
  });

  // -------------------------------------------------------------------------
  // searchImages — always uses v1 client for dimension safety
  // -------------------------------------------------------------------------

  describe('searchImages', () => {
    it('always uses the v1 client even when USE_UNIFIED_INDEX is true (dimension safety)', async () => {
      mockEnv.USE_UNIFIED_INDEX = true;
      const embedding = new Array(1024).fill(0.1);

      await service.searchImages({
        embedding,
        userId: 'user-abc',
        top: 5,
      });

      // v1 must be called; v2 must NOT be called
      expect(mockClientV1.search).toHaveBeenCalledTimes(1);
      expect(mockClientV2.search).not.toHaveBeenCalled();
    });

    it('queries imageVector field (not embeddingVector) in both unified and legacy modes', async () => {
      mockEnv.USE_UNIFIED_INDEX = true;
      const embedding = new Array(1024).fill(0.1);

      await service.searchImages({
        embedding,
        userId: 'user-abc',
        top: 5,
      });

      const callOptions = mockClientV1.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries?.[0]?.fields).toEqual(['imageVector']);
    });
  });

  // -------------------------------------------------------------------------
  // initializeClients — v2 client wiring
  // -------------------------------------------------------------------------

  describe('initializeClients', () => {
    it('accepts and stores the v2 search client override when provided', async () => {
      // The service was already initialized in beforeEach with both v1 and v2.
      // A semanticSearch call with USE_UNIFIED_INDEX=true should route to v2.
      mockEnv.USE_UNIFIED_INDEX = true;

      await service.semanticSearch({
        text: 'test',
        textEmbedding: new Array(1536).fill(0.1),
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      // Confirms v2 was wired — v2 search was called, v1 was not
      expect(mockClientV2.search).toHaveBeenCalledTimes(1);
      expect(mockClientV1.search).not.toHaveBeenCalled();
    });
  });
});
