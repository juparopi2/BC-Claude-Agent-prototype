import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment BEFORE importing the module under test.
// The constructor reads env at instantiation time, so this must come first.
vi.mock('@/infrastructure/config/environment', () => ({
  env: {
    COHERE_ENDPOINT: 'https://test-cohere.eastus.models.ai.azure.com',
    COHERE_API_KEY: 'test-api-key',
    USE_UNIFIED_INDEX: true,
  },
}));

// Mock Redis — all cache calls succeed silently by default.
vi.mock('@/infrastructure/redis/redis', () => ({
  createRedisClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    mget: vi.fn().mockResolvedValue([]),
    pipeline: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  })),
}));

// Mock usage tracking — fire-and-forget, must not throw.
vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackEmbedding: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock logger to suppress output during tests.
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

import { CohereEmbeddingService } from '@/services/search/embeddings/CohereEmbeddingService';
import { env } from '@/infrastructure/config/environment';
import { createRedisClient } from '@/infrastructure/redis/redis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a valid Cohere /v2/embed response for N texts. */
function makeCohereResponse(count: number, tokenCount = 5) {
  return {
    id: 'test-response-id',
    embeddings: {
      float: Array.from({ length: count }, () => new Array(1536).fill(0.1)),
    },
    meta: { billed_units: { input_tokens: tokenCount } },
  };
}

/** Produce a minimal successful fetch Response wrapping JSON. */
function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Produce a failed fetch Response. */
function makeErrorResponse(status: number, statusText: string, body = 'error'): Response {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CohereEmbeddingService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('throws when COHERE_ENDPOINT is not configured', () => {
      // Temporarily clear the endpoint on the mocked env object.
      const original = (env as Record<string, unknown>).COHERE_ENDPOINT;
      (env as Record<string, unknown>).COHERE_ENDPOINT = undefined;

      expect(() => new CohereEmbeddingService()).toThrow(
        'COHERE_ENDPOINT not configured',
      );

      (env as Record<string, unknown>).COHERE_ENDPOINT = original;
    });

    it('throws when COHERE_API_KEY is not configured', () => {
      const original = (env as Record<string, unknown>).COHERE_API_KEY;
      (env as Record<string, unknown>).COHERE_API_KEY = undefined;

      expect(() => new CohereEmbeddingService()).toThrow(
        'COHERE_API_KEY not configured',
      );

      (env as Record<string, unknown>).COHERE_API_KEY = original;
    });

    it('creates instance with valid configuration', () => {
      const service = new CohereEmbeddingService();
      expect(service.dimensions).toBe(1536);
      expect(service.modelName).toBe('Cohere-embed-v4');
    });
  });

  // -------------------------------------------------------------------------
  // embedText
  // -------------------------------------------------------------------------

  describe('embedText', () => {
    it('sends correct request body with search_document input type', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1)));

      const service = new CohereEmbeddingService();
      const result = await service.embedText('hello world', 'search_document');

      expect(result.embedding).toHaveLength(1536);
      expect(result.model).toBe('Cohere-embed-v4');
      expect(result.inputTokens).toBe(5);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v2/embed');
      expect(init.method).toBe('POST');

      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(parsed.input_type).toBe('search_document');
      expect(parsed.texts).toEqual(['hello world']);
    });

    it('sends correct request body with search_query input type', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1)));

      const service = new CohereEmbeddingService();
      await service.embedText('my query', 'search_query');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(parsed.input_type).toBe('search_query');
    });

    it('returns cached result when cache hits', async () => {
      const cachedValue = JSON.stringify({
        embedding: new Array(1536).fill(0.9),
        model: 'Cohere-embed-v4',
        inputTokens: 3,
      });

      // Inject a cache mock whose get() returns the cached string.
      const mockCache = {
        get: vi.fn().mockResolvedValue(cachedValue),
        set: vi.fn().mockResolvedValue('OK'),
        mget: vi.fn().mockResolvedValue([]),
        pipeline: vi.fn(() => ({ set: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) })),
      };
      vi.mocked(createRedisClient).mockReturnValueOnce(mockCache as never);

      const fetchSpy = vi.spyOn(global, 'fetch');
      const service = new CohereEmbeddingService();
      const result = await service.embedText('cached text', 'search_document');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.embedding).toHaveLength(1536);
      expect(result.embedding[0]).toBe(0.9);
    });

    it('throws on empty text', async () => {
      const service = new CohereEmbeddingService();
      await expect(service.embedText('', 'search_query')).rejects.toThrow(
        'Text cannot be empty',
      );
    });
  });

  // -------------------------------------------------------------------------
  // embedImage
  // -------------------------------------------------------------------------

  describe('embedImage', () => {
    it('adds data URI prefix when not already present', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1)));

      const service = new CohereEmbeddingService();
      const rawBase64 = 'abc123base64data==';
      await service.embedImage(rawBase64, 'search_document');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      const images = parsed.images as string[];
      expect(images[0]).toBe(`data:image/jpeg;base64,${rawBase64}`);
    });

    it('preserves existing data URI prefix', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1)));

      const service = new CohereEmbeddingService();
      const withPrefix = 'data:image/png;base64,abc123==';
      await service.embedImage(withPrefix, 'search_document');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      const images = parsed.images as string[];
      // Must not double-prefix.
      expect(images[0]).toBe(withPrefix);
      expect(images[0]).not.toContain('data:image/jpeg;base64,data:image/png');
    });

    it('returns correct result shape', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        makeOkResponse(makeCohereResponse(1, 8)),
      );

      const service = new CohereEmbeddingService();
      const result = await service.embedImage('somebase64==', 'search_document');

      expect(result.embedding).toHaveLength(1536);
      expect(result.model).toBe('Cohere-embed-v4');
      expect(result.inputTokens).toBe(8);
    });
  });

  // -------------------------------------------------------------------------
  // embedQuery
  // -------------------------------------------------------------------------

  describe('embedQuery', () => {
    it('delegates to embedText with search_query input type', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1)));

      const service = new CohereEmbeddingService();
      const embedTextSpy = vi.spyOn(service, 'embedText');

      await service.embedQuery('user question');

      expect(embedTextSpy).toHaveBeenCalledWith('user question', 'search_query');
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // embedTextBatch
  // -------------------------------------------------------------------------

  describe('embedTextBatch', () => {
    it('returns empty array for empty input', async () => {
      const service = new CohereEmbeddingService();
      const result = await service.embedTextBatch([], 'search_document');
      expect(result).toEqual([]);
    });

    it('returns correct number of results for a small batch', async () => {
      const texts = ['alpha', 'beta', 'gamma'];
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        makeOkResponse(makeCohereResponse(3, 15)),
      );

      const service = new CohereEmbeddingService();
      const results = await service.embedTextBatch(texts, 'search_document');

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.embedding).toHaveLength(1536);
        expect(r.model).toBe('Cohere-embed-v4');
      });
    });

    it('chunks large batches and calls the API twice for 150 texts', async () => {
      const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);

      const fetchSpy = vi
        .spyOn(global, 'fetch')
        // First chunk: 96 texts
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(96, 480)))
        // Second chunk: 54 texts
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(54, 270)));

      const service = new CohereEmbeddingService();
      const results = await service.embedTextBatch(texts, 'search_document');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(150);
    });

    it('uses cached results and only calls API for uncached texts', async () => {
      const texts = ['cached-a', 'missing-b', 'cached-c'];

      const cachedEntry = JSON.stringify({
        embedding: new Array(1536).fill(0.5),
        model: 'Cohere-embed-v4',
        inputTokens: 2,
      });

      // mget returns cached for indices 0 and 2; null for index 1.
      const mockCache = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        mget: vi.fn().mockResolvedValue([cachedEntry, null, cachedEntry]),
        pipeline: vi.fn(() => ({
          set: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([]),
        })),
      };
      vi.mocked(createRedisClient).mockReturnValueOnce(mockCache as never);

      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(makeOkResponse(makeCohereResponse(1, 5)));

      const service = new CohereEmbeddingService();
      const results = await service.embedTextBatch(texts, 'search_document');

      // Only one API call for the single cache miss.
      expect(fetchSpy).toHaveBeenCalledOnce();
      // All three results present.
      expect(results).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws descriptive error on HTTP 500', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        makeErrorResponse(500, 'Internal Server Error', 'Service unavailable'),
      );

      const service = new CohereEmbeddingService();
      await expect(service.embedText('test', 'search_query')).rejects.toThrow(
        'Cohere API error: 500',
      );
    });

    it('includes rate limit guidance on 429 error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        makeErrorResponse(429, 'Too Many Requests', 'Rate limit exceeded'),
      );

      const service = new CohereEmbeddingService();
      await expect(service.embedText('test', 'search_query')).rejects.toThrow(
        'rate limit',
      );
    });

    it('throws descriptive error on network failure', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      const service = new CohereEmbeddingService();
      await expect(service.embedText('test', 'search_query')).rejects.toThrow(
        'Cohere API network error',
      );
    });
  });
});
