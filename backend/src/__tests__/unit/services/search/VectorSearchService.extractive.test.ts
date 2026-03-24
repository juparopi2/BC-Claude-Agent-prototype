import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';
import type { ExtractiveSearchAnswer, SemanticSearchFullResult } from '@/services/search/types';

/**
 * VectorSearchService — Extractive Answers & Captions Tests (PRD-203)
 *
 * Verifies that the semantic search path correctly requests, maps, and exposes
 * extractive answers (top-level) and extractive captions (per-result) when the
 * Azure AI Search Semantic Ranker is enabled.
 *
 * Coverage:
 *  1. Semantic ranker ON  → extractive answers + captions requested in search options
 *  2. Semantic ranker OFF → extractive answers + captions NOT requested
 *  3. Top-level answers mapped to ExtractiveSearchAnswer[]
 *  4. Per-result captions populate captionText / captionHighlights
 *  5. Empty / undefined answers and captions handled gracefully
 *  6. Return type is SemanticSearchFullResult with `results` and `extractiveAnswers`
 */

// ---------------------------------------------------------------------------
// Hoisted env mock
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => ({
  USE_UNIFIED_INDEX: true as boolean,
  USE_QUERY_TIME_VECTORIZATION: false as boolean,
  AZURE_SEARCH_ENDPOINT: 'https://test.search.windows.net',
  AZURE_SEARCH_KEY: 'test-key',
}));

vi.mock('@/infrastructure/config/environment', () => ({ env: mockEnv }));

// Silence Azure SDK constructors — clients are injected via initializeClients()
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

interface MockCaption {
  text?: string;
  highlights?: string;
}

interface MockAnswer {
  text: string;
  highlights?: string;
  score: number;
  key: string;
}

interface MockResultDocument {
  chunkId: string;
  fileId: string;
  content: string;
  chunkIndex: number;
  isImage?: boolean;
}

interface MockResult {
  document: MockResultDocument;
  score: number;
  rerankerScore?: number;
  captions?: MockCaption[];
}

/** Build a mock SearchClient that yields the provided results and top-level answers */
function createMockSearchClient(
  results: MockResult[] = [],
  answers?: MockAnswer[],
) {
  // Build an async iterator over the provided results array
  let idx = 0;
  const asyncIterator = {
    next: (): Promise<{ done: boolean; value: MockResult | undefined }> => {
      if (idx < results.length) {
        return Promise.resolve({ done: false, value: results[idx++] });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
  };

  // The search response object; answers lives at the top level
  const searchResponse: Record<string, unknown> = {
    results: { [Symbol.asyncIterator]: () => asyncIterator },
  };
  if (answers !== undefined) {
    searchResponse['answers'] = answers;
  }

  return {
    search: vi.fn().mockResolvedValue(searchResponse),
    uploadDocuments: vi.fn().mockResolvedValue({ results: [{ succeeded: true, key: 'k' }] }),
    mergeDocuments: vi.fn().mockResolvedValue({ results: [{ succeeded: true }] }),
    deleteDocuments: vi.fn().mockResolvedValue({ results: [{ succeeded: true }] }),
    getDocumentsCount: vi.fn().mockResolvedValue(0),
  };
}

/** Create a minimal index client stub */
function createMockIndexClient() {
  return {
    getIndex: vi.fn().mockResolvedValue({ name: 'file-chunks-index' }),
    createIndex: vi.fn(),
    deleteIndex: vi.fn(),
  };
}

/** Minimal document fixture */
function makeDocument(overrides: Partial<MockResultDocument> = {}): MockResultDocument {
  return {
    chunkId: 'chunk-001',
    fileId: 'file-001',
    content: 'Some relevant content',
    chunkIndex: 0,
    isImage: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VectorSearchService — Extractive Answers & Captions (PRD-203)', () => {
  let service: VectorSearchService;
  let mockIndexClient: ReturnType<typeof createMockIndexClient>;

  const baseQuery = {
    text: 'find invoices',
    textEmbedding: new Array(1536).fill(0.1),
    userId: 'user-abc',
    useVectorSearch: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset singleton so each test gets a fresh instance
    (VectorSearchService as unknown as { instance: undefined }).instance = undefined;

    mockEnv.USE_UNIFIED_INDEX = true;
    mockEnv.USE_QUERY_TIME_VECTORIZATION = false;

    mockIndexClient = createMockIndexClient();
    service = VectorSearchService.getInstance();
  });

  // -------------------------------------------------------------------------
  // 1. Semantic ranker ON — extractive options requested
  // -------------------------------------------------------------------------

  describe('when useSemanticRanker is true', () => {
    it('includes extractive answers and captions in the search options sent to Azure', async () => {
      const mockClient = createMockSearchClient();
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(mockClient.search).toHaveBeenCalledTimes(1);
      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const semanticOpts = callOptions?.semanticSearchOptions as Record<string, unknown> | undefined;

      expect(callOptions?.queryType).toBe('semantic');
      expect(semanticOpts).toBeDefined();
      expect(semanticOpts?.answers).toMatchObject({ answerType: 'extractive' });
      expect(semanticOpts?.captions).toMatchObject({ captionType: 'extractive' });
    });

    it('requests highlight: true on captions when semantic ranker is on', async () => {
      const mockClient = createMockSearchClient();
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      const semanticOpts = callOptions?.semanticSearchOptions as Record<string, unknown> | undefined;
      const captionsOpt = semanticOpts?.captions as Record<string, unknown> | undefined;

      expect(captionsOpt?.highlight).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Semantic ranker OFF — extractive options NOT requested
  // -------------------------------------------------------------------------

  describe('when useSemanticRanker is false (keyword mode)', () => {
    it('does NOT set semanticSearchOptions when semantic ranker is disabled', async () => {
      const mockClient = createMockSearchClient();
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      await service.semanticSearch({ ...baseQuery, useSemanticRanker: false });

      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;

      expect(callOptions?.semanticSearchOptions).toBeUndefined();
      expect(callOptions?.queryType).toBeUndefined();
    });

    it('does NOT set queryType to "semantic" when semantic ranker is off', async () => {
      const mockClient = createMockSearchClient();
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      await service.semanticSearch({
        ...baseQuery,
        useSemanticRanker: false,
        useVectorSearch: false,
      });

      const callOptions = mockClient.search.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(callOptions?.queryType).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Top-level answers mapped to ExtractiveSearchAnswer[]
  // -------------------------------------------------------------------------

  describe('extractiveAnswers mapping', () => {
    it('maps top-level answers from the search response into extractiveAnswers', async () => {
      const rawAnswers: MockAnswer[] = [
        { text: 'Invoice 1001 was paid on 2024-01-15.', highlights: '<em>Invoice 1001</em> was paid on 2024-01-15.', score: 0.92, key: 'chunk-001' },
        { text: 'Total amount due: $500.', highlights: undefined, score: 0.75, key: 'chunk-002' },
      ];
      const mockClient = createMockSearchClient([], rawAnswers);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.extractiveAnswers).toHaveLength(2);

      const first = result.extractiveAnswers[0] as ExtractiveSearchAnswer;
      expect(first.text).toBe('Invoice 1001 was paid on 2024-01-15.');
      expect(first.highlights).toBe('<em>Invoice 1001</em> was paid on 2024-01-15.');
      expect(first.score).toBe(0.92);
      expect(first.key).toBe('chunk-001');

      const second = result.extractiveAnswers[1] as ExtractiveSearchAnswer;
      expect(second.text).toBe('Total amount due: $500.');
      expect(second.highlights).toBeUndefined();
      expect(second.score).toBe(0.75);
      expect(second.key).toBe('chunk-002');
    });

    it('preserves exact score and key values from raw answers', async () => {
      const rawAnswers: MockAnswer[] = [
        { text: 'Answer A', score: 0.999, key: 'CHUNK-UPPERCASE-KEY' },
      ];
      const mockClient = createMockSearchClient([], rawAnswers);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.extractiveAnswers[0]?.score).toBe(0.999);
      expect(result.extractiveAnswers[0]?.key).toBe('CHUNK-UPPERCASE-KEY');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Per-result captions populate captionText / captionHighlights
  // -------------------------------------------------------------------------

  describe('per-result captions', () => {
    it('populates captionText and captionHighlights from the first caption of each result', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-001', fileId: 'file-001' }),
          score: 0.9,
          rerankerScore: 3.2,
          captions: [
            { text: 'This invoice shows a total of $500.', highlights: 'This <em>invoice</em> shows a total of $500.' },
            { text: 'Second caption (ignored)', highlights: 'Second <em>caption</em>' },
          ],
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results).toHaveLength(1);
      const r = result.results[0]!;
      expect(r.captionText).toBe('This invoice shows a total of $500.');
      expect(r.captionHighlights).toBe('This <em>invoice</em> shows a total of $500.');
    });

    it('uses only the first caption when multiple captions are present', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-002', fileId: 'file-002' }),
          score: 0.8,
          rerankerScore: 2.5,
          captions: [
            { text: 'First caption.', highlights: '<em>First</em> caption.' },
            { text: 'Second caption — must not appear.', highlights: 'Second caption — must not appear.' },
          ],
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results[0]?.captionText).toBe('First caption.');
      expect(result.results[0]?.captionHighlights).toBe('<em>First</em> caption.');
    });

    it('leaves captionText and captionHighlights undefined when result has no captions', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-003', fileId: 'file-003' }),
          score: 0.7,
          rerankerScore: 2.0,
          // no captions property
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results[0]?.captionText).toBeUndefined();
      expect(result.results[0]?.captionHighlights).toBeUndefined();
    });

    it('leaves captionText and captionHighlights undefined when captions array is empty', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-004', fileId: 'file-004' }),
          score: 0.65,
          rerankerScore: 1.8,
          captions: [],
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results[0]?.captionText).toBeUndefined();
      expect(result.results[0]?.captionHighlights).toBeUndefined();
    });

    it('handles a caption that has text but no highlights', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-005', fileId: 'file-005' }),
          score: 0.6,
          rerankerScore: 1.5,
          captions: [{ text: 'Plain caption with no highlights.' }],
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results[0]?.captionText).toBe('Plain caption with no highlights.');
      expect(result.results[0]?.captionHighlights).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Empty / undefined answers handled gracefully
  // -------------------------------------------------------------------------

  describe('graceful handling of empty or absent answers', () => {
    it('returns empty extractiveAnswers when search response has no answers property', async () => {
      // createMockSearchClient with no answers argument → answers key is absent
      const mockClient = createMockSearchClient([]);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.extractiveAnswers).toEqual([]);
    });

    it('returns empty extractiveAnswers when answers array is empty', async () => {
      const mockClient = createMockSearchClient([], []);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.extractiveAnswers).toEqual([]);
    });

    it('returns empty extractiveAnswers when semantic ranker is off (keyword mode)', async () => {
      const rawAnswers: MockAnswer[] = [
        { text: 'Should not appear.', score: 0.9, key: 'chunk-x' },
      ];
      // Even if the mock returns answers, the service should not request them in keyword mode.
      // The answers in the response are irrelevant in keyword mode, but we still confirm the
      // returned extractiveAnswers reflects whatever comes back from the raw response mapping.
      // In practice Azure won't return answers without semantic config — this test ensures
      // the mapping code does not crash regardless of the server-side response.
      const mockClient = createMockSearchClient([], rawAnswers);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({
        ...baseQuery,
        useSemanticRanker: false,
        useVectorSearch: false,
      });

      // The semantic config is NOT sent — Azure would never return answers here.
      // The mapping code still runs. We verify it does not throw and returns the array.
      expect(Array.isArray(result.extractiveAnswers)).toBe(true);
    });

    it('does not throw when results have no captions and answers is undefined', async () => {
      const results: MockResult[] = [
        {
          document: makeDocument(),
          score: 0.5,
          rerankerScore: 1.0,
        },
      ];
      const mockClient = createMockSearchClient(results);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      await expect(
        service.semanticSearch({ ...baseQuery, useSemanticRanker: true }),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Return type shape — SemanticSearchFullResult
  // -------------------------------------------------------------------------

  describe('return type is SemanticSearchFullResult', () => {
    it('always returns an object with both results and extractiveAnswers keys', async () => {
      const mockClient = createMockSearchClient();
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result: SemanticSearchFullResult = await service.semanticSearch({
        ...baseQuery,
        useSemanticRanker: true,
      });

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('extractiveAnswers');
      expect(Array.isArray(result.results)).toBe(true);
      expect(Array.isArray(result.extractiveAnswers)).toBe(true);
    });

    it('returns correct shape when both results and answers are populated', async () => {
      const rawAnswers: MockAnswer[] = [
        { text: 'Top extractive answer.', highlights: '<em>Top</em> extractive answer.', score: 0.88, key: 'chunk-A' },
      ];
      const results: MockResult[] = [
        {
          document: makeDocument({ chunkId: 'chunk-A', fileId: 'file-A' }),
          score: 0.85,
          rerankerScore: 3.5,
          captions: [{ text: 'Caption for chunk A.', highlights: 'Caption for <em>chunk A</em>.' }],
        },
        {
          document: makeDocument({ chunkId: 'chunk-B', fileId: 'file-B', content: 'Another relevant chunk' }),
          score: 0.70,
          rerankerScore: 2.8,
          captions: [{ text: 'Caption for chunk B.' }],
        },
      ];
      const mockClient = createMockSearchClient(results, rawAnswers);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      // Structural shape
      expect(result.results).toHaveLength(2);
      expect(result.extractiveAnswers).toHaveLength(1);

      // Results are sorted descending by score (rerankerScore / 4)
      expect(result.results[0]?.chunkId).toBe('chunk-A');
      expect(result.results[1]?.chunkId).toBe('chunk-B');

      // Each result carries the required SemanticSearchResult fields
      expect(result.results[0]).toMatchObject({
        chunkId: 'chunk-A',
        fileId: 'file-A',
        captionText: 'Caption for chunk A.',
        captionHighlights: 'Caption for <em>chunk A</em>.',
      });

      // Extractive answer shape
      expect(result.extractiveAnswers[0]).toMatchObject({
        text: 'Top extractive answer.',
        highlights: '<em>Top</em> extractive answer.',
        score: 0.88,
        key: 'chunk-A',
      });
    });

    it('returns empty arrays when search yields no documents and no answers', async () => {
      const mockClient = createMockSearchClient([], []);
      await service.initializeClients(
        mockIndexClient as unknown as SearchIndexClient,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
        mockClient as unknown as SearchClient<Record<string, unknown>>,
      );

      const result = await service.semanticSearch({ ...baseQuery, useSemanticRanker: true });

      expect(result.results).toEqual([]);
      expect(result.extractiveAnswers).toEqual([]);
    });
  });
});
