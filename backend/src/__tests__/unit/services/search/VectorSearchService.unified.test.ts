import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

/**
 * VectorSearchService — Unified Index Routing Tests
 *
 * Verifies that all index read/write operations use the unified
 * embeddingVector field (1536d Cohere Embed v4) for both text and image content.
 */

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

describe('VectorSearchService — Unified Index', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof vi.fn>;
  let mockClient: ReturnType<typeof createMockSearchClient>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the singleton so each test gets a fresh state
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockIndexClient = {
      getIndex: vi.fn().mockResolvedValue({ name: 'file-chunks-index' }),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
    } as unknown as ReturnType<typeof vi.fn>;

    mockClient = createMockSearchClient();

    service = VectorSearchService.getInstance();
    await service.initializeClients(
      mockIndexClient as unknown as SearchIndexClient,
      mockClient as unknown as SearchClient<Record<string, unknown>>,
    );
  });

  // -------------------------------------------------------------------------
  // semanticSearch
  // -------------------------------------------------------------------------

  describe('semanticSearch', () => {
    it('sends a single vector query on embeddingVector', async () => {
      const textEmbedding = new Array(1536).fill(0.2);

      await service.semanticSearch({
        text: 'find invoices',
        textEmbedding,
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClient.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries).toHaveLength(1);
      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
      expect(vectorQueries?.[0]?.vector).toEqual(textEmbedding);
    });
  });

  // -------------------------------------------------------------------------
  // indexChunksBatch
  // -------------------------------------------------------------------------

  describe('indexChunksBatch', () => {
    it('sets embeddingVector (not contentVector) when indexing chunks', async () => {
      const chunk = makeChunk();

      await service.indexChunksBatch([chunk]);

      expect(mockClient.uploadDocuments).toHaveBeenCalledTimes(1);
      const docs = mockClient.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toHaveProperty('embeddingVector');
      expect(docs[0]).not.toHaveProperty('contentVector');
    });
  });

  // -------------------------------------------------------------------------
  // indexImageEmbedding
  // -------------------------------------------------------------------------

  describe('indexImageEmbedding', () => {
    it('sets embeddingVector (not imageVector) when indexing images', async () => {
      const embedding = new Array(1536).fill(0.3);

      await service.indexImageEmbedding({
        fileId: 'file-img-001',
        userId: 'user-abc',
        embedding,
        fileName: 'chart.png',
        caption: 'A bar chart showing Q1 sales',
      });

      expect(mockClient.uploadDocuments).toHaveBeenCalledTimes(1);
      const docs = mockClient.uploadDocuments.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toHaveProperty('embeddingVector', embedding);
      expect(docs[0]).not.toHaveProperty('imageVector');
      expect(docs[0]).not.toHaveProperty('contentVector');
      expect(docs[0]).toHaveProperty('isImage', true);
    });
  });

  // -------------------------------------------------------------------------
  // searchImages
  // -------------------------------------------------------------------------

  describe('searchImages', () => {
    it('queries embeddingVector field when searching images', async () => {
      const embedding = new Array(1536).fill(0.1);

      await service.searchImages({
        embedding,
        userId: 'user-abc',
        top: 5,
      });

      expect(mockClient.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const vectorQueries = (callOptions?.vectorSearchOptions as { queries: Array<Record<string, unknown>> })?.queries;

      expect(vectorQueries?.[0]?.fields).toEqual(['embeddingVector']);
    });
  });

  // -------------------------------------------------------------------------
  // initializeClients wiring verification
  // -------------------------------------------------------------------------

  describe('initializeClients', () => {
    it('routes all search operations through the injected client', async () => {
      await service.semanticSearch({
        text: 'test',
        textEmbedding: new Array(1536).fill(0.1),
        userId: 'user-abc',
        useVectorSearch: true,
        useSemanticRanker: false,
      });

      expect(mockClient.search).toHaveBeenCalledTimes(1);
    });
  });
});
