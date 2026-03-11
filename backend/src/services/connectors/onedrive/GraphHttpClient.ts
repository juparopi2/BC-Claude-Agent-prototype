/**
 * GraphHttpClient (PRD-101 Step 3)
 *
 * Thin HTTP wrapper around the Microsoft Graph API.
 * Handles auth headers, JSON parsing, binary downloads, automatic
 * OData pagination, and 429 back-off — all in one place so callers
 * never touch raw fetch directly.
 *
 * Design:
 *  - Stateless: every public method receives the bearer token explicitly.
 *  - 429 retry: reads Retry-After header, waits, retries up to MAX_RETRIES times.
 *  - 401: NOT retried — callers own the token-refresh cycle.
 *  - Singleton via getGraphHttpClient() / __resetGraphHttpClient().
 *
 * @module services/connectors/onedrive
 */

import { createChildLogger } from '@/shared/utils/logger';

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = 'https://graph.microsoft.com/v1.0';
const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 10;

const logger = createChildLogger({ service: 'GraphHttpClient' });

// ============================================================================
// Custom Error
// ============================================================================

/**
 * Thrown for all non-2xx responses from the Microsoft Graph API.
 */
export class GraphApiError extends Error {
  readonly statusCode: number;
  /** The `code` field from the Graph error body (e.g. `"itemNotFound"`), if available. */
  readonly graphErrorCode: string | undefined;

  constructor(statusCode: number, message: string, graphErrorCode?: string) {
    super(message);
    this.name = 'GraphApiError';
    this.statusCode = statusCode;
    this.graphErrorCode = graphErrorCode;
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Build the standard auth headers for every Graph request.
 */
function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/**
 * Parse a Graph error response body and extract a human-readable message
 * and optional error code.
 */
async function parseGraphErrorBody(
  response: Response
): Promise<{ message: string; graphErrorCode?: string }> {
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as Record<string, unknown>).error === 'object'
    ) {
      const err = (body as { error: { code?: string; message?: string } }).error;
      return {
        message: err.message ?? `Graph API error (${response.status})`,
        graphErrorCode: err.code,
      };
    }
  } catch {
    // Body was not JSON — fall through to generic message
  }
  return { message: `Graph API error (${response.status})` };
}

/**
 * Extract the Retry-After delay (ms) from a 429 response.
 * Falls back to DEFAULT_RETRY_AFTER_SECONDS when the header is absent or unparseable.
 */
function retryAfterMs(response: Response): number {
  const header = response.headers.get('Retry-After');
  if (header !== null) {
    const seconds = parseFloat(header);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds) * 1000;
    }
  }
  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

/**
 * Tiny async sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// GraphHttpClient
// ============================================================================

export class GraphHttpClient {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Perform a GET request to the Graph API and return the parsed JSON body.
   *
   * @param path        Path relative to `https://graph.microsoft.com/v1.0` (must start with `/`),
   *                    or a full absolute URL when `absoluteUrl` is true.
   * @param token       Bearer token.
   * @param absoluteUrl When true, `path` is used verbatim as the URL (e.g. Graph delta/nextLink
   *                    cursors which are already full URLs). Defaults to false.
   * @returns           Parsed JSON body cast to T.
   * @throws            {GraphApiError} on non-2xx responses.
   */
  async get<T>(path: string, token: string, absoluteUrl = false): Promise<T> {
    const response = await this.fetchWithRetry(path, token, { method: 'GET' }, absoluteUrl);
    return response.json() as Promise<T>;
  }

  /**
   * Perform a paginated GET request, automatically following `@odata.nextLink`
   * until all pages have been fetched.
   *
   * @param path     Path relative to the Graph API base URL.
   * @param token    Bearer token.
   * @param itemKey  Key inside each page object that holds the items array.
   *                 Defaults to `"value"` (standard OData convention).
   * @returns        Flat array of all items across all pages.
   * @throws         {GraphApiError} on non-2xx responses.
   */
  async getWithPagination<T>(
    path: string,
    token: string,
    itemKey: string = 'value'
  ): Promise<T[]> {
    const allItems: T[] = [];
    let nextUrl: string | null = `${BASE_URL}${path}`;
    let pageCount = 0;

    while (nextUrl !== null) {
      pageCount++;
      const response = await this.fetchWithRetry(
        nextUrl,
        token,
        { method: 'GET' },
        /* absoluteUrl */ true
      );

      const page = (await response.json()) as Record<string, unknown>;

      const items = page[itemKey];
      if (Array.isArray(items)) {
        allItems.push(...(items as T[]));
      }

      const next = page['@odata.nextLink'];
      nextUrl = typeof next === 'string' ? next : null;

      logger.debug(
        { path, pageCount, itemsThisPage: Array.isArray(items) ? items.length : 0, hasNextPage: nextUrl !== null },
        'Pagination page fetched'
      );
    }

    logger.info({ path, pageCount, totalItems: allItems.length }, 'Paginated fetch complete');
    return allItems;
  }

  /**
   * Perform a GET request and return the raw response body as a Buffer.
   * Suitable for file downloads. Follows HTTP 302 redirects automatically
   * (Node's native fetch follows redirects by default).
   *
   * @param path   Path relative to the Graph API base URL.
   * @param token  Bearer token.
   * @returns      Raw body as a Node.js Buffer.
   * @throws       {GraphApiError} on non-2xx responses.
   */
  async getBuffer(path: string, token: string): Promise<Buffer> {
    const response = await this.fetchWithRetry(path, token, {
      method: 'GET',
      redirect: 'follow',
    } as RequestInit);

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Perform a POST request to the Graph API.
   *
   * @param path   Path relative to `https://graph.microsoft.com/v1.0`.
   * @param token  Bearer token.
   * @param body   Request body (will be serialized to JSON).
   * @returns      Parsed JSON body cast to T.
   * @throws       {GraphApiError} on non-2xx responses.
   */
  async post<T>(path: string, token: string, body: unknown): Promise<T> {
    const response = await this.fetchWithRetry(path, token, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return response.json() as Promise<T>;
  }

  /**
   * Perform a PATCH request to the Graph API.
   *
   * @param path   Path relative to `https://graph.microsoft.com/v1.0`.
   * @param token  Bearer token.
   * @param body   Request body (will be serialized to JSON).
   * @returns      Parsed JSON body cast to T.
   * @throws       {GraphApiError} on non-2xx responses.
   */
  async patch<T>(path: string, token: string, body: unknown): Promise<T> {
    const response = await this.fetchWithRetry(path, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return response.json() as Promise<T>;
  }

  /**
   * Perform a DELETE request to the Graph API.
   *
   * @param path   Path relative to `https://graph.microsoft.com/v1.0`.
   * @param token  Bearer token.
   * @throws       {GraphApiError} on non-2xx responses.
   */
  async delete(path: string, token: string): Promise<void> {
    await this.fetchWithRetry(path, token, { method: 'DELETE' });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Core fetch wrapper with 429 back-off retry logic.
   *
   * @param pathOrUrl    Either a relative path (`/me/drive/...`) or, when
   *                     `absoluteUrl` is true, a full URL (used for pagination
   *                     nextLink URLs).
   * @param token        Bearer token.
   * @param init         RequestInit options forwarded to fetch.
   * @param absoluteUrl  When true, `pathOrUrl` is used verbatim as the URL.
   */
  private async fetchWithRetry(
    pathOrUrl: string,
    token: string,
    init: RequestInit,
    absoluteUrl = false
  ): Promise<Response> {
    const url = absoluteUrl ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const baseHeaders = buildHeaders(token);
    // Merge any additional headers from init (e.g. Content-Type for POST/PATCH)
    const headers: Record<string, string> = {
      ...baseHeaders,
      ...((init.headers as Record<string, string>) ?? {}),
    };

    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      const startMs = Date.now();

      let response: Response;
      try {
        response = await fetch(url, { ...init, headers });
      } catch (networkError) {
        const errorInfo =
          networkError instanceof Error
            ? { message: networkError.message, stack: networkError.stack, name: networkError.name }
            : { value: String(networkError) };
        logger.error(
          { url, attempt, error: errorInfo },
          'Graph API network error'
        );
        throw networkError;
      }

      const durationMs = Date.now() - startMs;

      logger.info(
        {
          method: (init.method ?? 'GET').toUpperCase(),
          url,
          status: response.status,
          durationMs,
          attempt,
        },
        'Graph API request'
      );

      // ---- Success --------------------------------------------------------
      if (response.ok) {
        return response;
      }

      // ---- 401 — do not retry, caller handles token refresh ---------------
      if (response.status === 401) {
        const { message, graphErrorCode } = await parseGraphErrorBody(response);
        logger.warn({ url, graphErrorCode }, 'Graph API 401 — token refresh required');
        throw new GraphApiError(401, message, graphErrorCode);
      }

      // ---- 429 — rate limited, back off and retry -------------------------
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const waitMs = retryAfterMs(response);
        logger.warn(
          { url, attempt, waitMs, retryAfterHeader: response.headers.get('Retry-After') },
          'Graph API 429 — rate limited, waiting before retry'
        );
        await sleep(waitMs);
        attempt++;
        continue;
      }

      // ---- Any other non-2xx error -----------------------------------------
      const { message, graphErrorCode } = await parseGraphErrorBody(response);
      logger.error(
        { url, status: response.status, graphErrorCode },
        'Graph API returned error status'
      );
      throw new GraphApiError(response.status, message, graphErrorCode);
    }

    // Exhausted retries on 429
    throw new GraphApiError(429, `Graph API rate limit exceeded after ${MAX_RETRIES} retries`);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GraphHttpClient | undefined;

/**
 * Get the GraphHttpClient singleton.
 */
export function getGraphHttpClient(): GraphHttpClient {
  if (!instance) {
    instance = new GraphHttpClient();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetGraphHttpClient(): void {
  instance = undefined;
}
