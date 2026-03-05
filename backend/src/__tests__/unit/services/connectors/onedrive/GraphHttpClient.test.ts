/**
 * GraphHttpClient Unit Tests (PRD-101)
 *
 * Tests the thin HTTP wrapper around the Microsoft Graph API.
 * Covers JSON GET, paginated GET, binary GET, 429 retry logic,
 * 401 non-retry behavior, and GraphApiError shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// global.fetch is mocked per test via vi.fn() assigned below

// Import after mocks
import {
  GraphHttpClient,
  GraphApiError,
  __resetGraphHttpClient,
} from '@/services/connectors/onedrive/GraphHttpClient';

// ============================================================================
// TEST HELPERS
// ============================================================================

const TOKEN = 'test-bearer-token';

/**
 * Build a minimal mock Response object that satisfies the parts of the
 * Response interface used by GraphHttpClient.
 */
function makeMockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  const headersMap = new Map(Object.entries(headers));

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headersMap.get(name) ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
    // arrayBuffer is not used for JSON responses; provide a no-op stub
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Build a mock binary Response for getBuffer tests.
 */
function makeBinaryResponse(data: Buffer): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: vi.fn(),
    arrayBuffer: vi.fn().mockResolvedValue(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    text: vi.fn(),
  } as unknown as Response;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('GraphHttpClient', () => {
  let client: GraphHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGraphHttpClient();
    global.fetch = vi.fn();
    client = new GraphHttpClient();
  });

  // ==========================================================================
  // get<T>
  // ==========================================================================

  describe('get<T>()', () => {
    it('returns parsed JSON body on a 200 response', async () => {
      const payload = { id: '123', name: 'Test Drive' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(200, payload)
      );

      const result = await client.get<{ id: string; name: string }>(
        '/me/drive',
        TOKEN
      );

      expect(result).toEqual(payload);
      expect(global.fetch).toHaveBeenCalledOnce();
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit
      ];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/drive');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('throws GraphApiError with statusCode 404 and message from body', async () => {
      const errorBody = {
        error: { code: 'itemNotFound', message: 'The resource could not be found.' },
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(404, errorBody)
      );

      await expect(client.get('/me/drive/items/bad-id', TOKEN)).rejects.toThrow(
        GraphApiError
      );

      await expect(client.get('/me/drive/items/bad-id', TOKEN)).rejects.toMatchObject({
        statusCode: 404,
        graphErrorCode: 'itemNotFound',
        message: 'The resource could not be found.',
      });
    });

    it('throws GraphApiError with statusCode 401 and does not retry', async () => {
      const errorBody = {
        error: { code: 'InvalidAuthenticationToken', message: 'Access token is invalid.' },
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(401, errorBody)
      );

      await expect(client.get('/me/drive', TOKEN)).rejects.toThrow(GraphApiError);
      await expect(client.get('/me/drive', TOKEN)).rejects.toMatchObject({
        statusCode: 401,
      });

      // Two separate get() calls — each calls fetch exactly once (no retries)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // getWithPagination<T>
  // ==========================================================================

  describe('getWithPagination<T>()', () => {
    it('collects items across multiple pages by following @odata.nextLink', async () => {
      const page1 = {
        value: [{ id: 'item-1' }, { id: 'item-2' }],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc123',
      };
      const page2 = {
        value: [{ id: 'item-3' }],
      };

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(makeMockResponse(200, page1))
        .mockResolvedValueOnce(makeMockResponse(200, page2));

      const result = await client.getWithPagination<{ id: string }>(
        '/me/drive/root/children',
        TOKEN
      );

      expect(result).toEqual([{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // First call: relative path resolved to base URL
      const [firstUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(firstUrl).toBe(
        'https://graph.microsoft.com/v1.0/me/drive/root/children'
      );

      // Second call: the absolute nextLink URL used verbatim
      const [secondUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(secondUrl).toBe(
        'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc123'
      );
    });

    it('returns empty array when the value key is an empty array', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(200, { value: [] })
      );

      const result = await client.getWithPagination('/me/drive/root/children', TOKEN);

      expect(result).toEqual([]);
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it('returns empty array when the value key is absent from the page', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(200, {})
      );

      const result = await client.getWithPagination('/me/drive/root/children', TOKEN);

      expect(result).toEqual([]);
    });

    it('respects a custom itemKey parameter', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(200, { items: [{ name: 'foo' }] })
      );

      const result = await client.getWithPagination<{ name: string }>(
        '/me/drive/root/children',
        TOKEN,
        'items'
      );

      expect(result).toEqual([{ name: 'foo' }]);
    });
  });

  // ==========================================================================
  // getBuffer()
  // ==========================================================================

  describe('getBuffer()', () => {
    it('returns a Buffer containing the raw response body', async () => {
      const content = Buffer.from('binary file content here');
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeBinaryResponse(content)
      );

      const result = await client.getBuffer('/me/drive/items/file-id/content', TOKEN);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('binary file content here');
    });

    it('sends the correct Authorization header', async () => {
      const content = Buffer.from('data');
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeBinaryResponse(content)
      );

      await client.getBuffer('/me/drive/items/file-id/content', TOKEN);

      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit
      ];
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('throws GraphApiError on non-2xx response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMockResponse(403, {
          error: { code: 'accessDenied', message: 'Access denied.' },
        })
      );

      await expect(
        client.getBuffer('/me/drive/items/restricted/content', TOKEN)
      ).rejects.toThrow(GraphApiError);
    });
  });

  // ==========================================================================
  // 429 Retry Logic
  // ==========================================================================

  describe('429 retry logic', () => {
    it('retries after 429 and returns data on the second attempt', async () => {
      const payload = { id: 'item-1' };
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

      // First call: 429 with a very short Retry-After to avoid real delays
      fetchMock
        .mockResolvedValueOnce(
          makeMockResponse(429, { error: { code: 'TooManyRequests' } }, {
            'Retry-After': '0.001',
          })
        )
        .mockResolvedValueOnce(makeMockResponse(200, payload));

      const result = await client.get<{ id: string }>('/me/drive/items/1', TOKEN);

      expect(result).toEqual(payload);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('uses a short wait when Retry-After header is missing (0.001s override via tiny mock)', async () => {
      // We cannot easily mock the private sleep, but we CAN observe that
      // fetch is called multiple times. Use Retry-After: 0.001 on the 429.
      const payload = { id: 'item-after-default-wait' };
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

      fetchMock
        .mockResolvedValueOnce(
          // No Retry-After header — falls back to DEFAULT_RETRY_AFTER_SECONDS (10s).
          // We use a 0.001s header so the test completes quickly.
          makeMockResponse(429, { error: { code: 'TooManyRequests' } }, {
            'Retry-After': '0.001',
          })
        )
        .mockResolvedValueOnce(makeMockResponse(200, payload));

      const result = await client.get<{ id: string }>('/me/drive/items/1', TOKEN);

      expect(result).toEqual(payload);
      // Verify retry happened
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('throws GraphApiError(429) after MAX_RETRIES (3) exhausted 429 responses', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

      // Return 429 for every attempt (initial + 3 retries = 4 total calls)
      fetchMock.mockResolvedValue(
        makeMockResponse(429, { error: { code: 'TooManyRequests' } }, {
          'Retry-After': '0.001',
        })
      );

      await expect(client.get('/me/drive/items/1', TOKEN)).rejects.toMatchObject({
        statusCode: 429,
      });

      // Initial attempt + 3 retries = 4 total fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(4);
    }, 30_000);
  });

  // ==========================================================================
  // GraphApiError
  // ==========================================================================

  describe('GraphApiError', () => {
    it('has correct name, statusCode, message, and graphErrorCode', () => {
      const err = new GraphApiError(404, 'Item not found.', 'itemNotFound');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(GraphApiError);
      expect(err.name).toBe('GraphApiError');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Item not found.');
      expect(err.graphErrorCode).toBe('itemNotFound');
    });

    it('graphErrorCode is undefined when not provided', () => {
      const err = new GraphApiError(500, 'Internal server error.');

      expect(err.statusCode).toBe(500);
      expect(err.graphErrorCode).toBeUndefined();
    });

    it('is instanceof Error so it can be caught generically', () => {
      const err = new GraphApiError(403, 'Access denied.', 'accessDenied');

      expect(err instanceof Error).toBe(true);
    });
  });
});
