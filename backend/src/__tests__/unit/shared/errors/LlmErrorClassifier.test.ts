/**
 * LlmErrorClassifier Unit Tests
 *
 * Tests for classifyLlmError and isRetryableLlmError.
 * Verifies correct error code assignment, retry metadata, and that
 * user-facing messages never leak technical details (JSON, status codes, stacks).
 */

import { describe, it, expect } from 'vitest';
import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  RateLimitError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
} from '@anthropic-ai/sdk';
import { ErrorCode } from '@bc-agent/shared';
import {
  classifyLlmError,
  isRetryableLlmError,
} from '@/shared/errors/LlmErrorClassifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a headers-compatible object accepted by APIError subclasses.
 *
 * The Anthropic SDK calls headers.get('request-id') in its constructor.
 * The LlmErrorClassifier accesses error.headers as a plain Record via bracket
 * notation (headers['retry-after']), so we cannot use a real Headers instance
 * (which doesn't expose entries via bracket access). A plain object with a
 * .get() method satisfies both constraints. Cast to Headers for SDK constructor
 * compatibility.
 */
function makeHeaders(entries: Record<string, string> = {}): Headers {
  const headersLike = {
    ...entries,
    get(key: string): string | null {
      return entries[key] ?? null;
    },
  };
  return headersLike as unknown as Headers;
}

// ---------------------------------------------------------------------------
// classifyLlmError
// ---------------------------------------------------------------------------

describe('classifyLlmError', () => {
  // -------------------------------------------------------------------------
  // 1. RateLimitError → LLM_RATE_LIMITED
  // -------------------------------------------------------------------------
  describe('RateLimitError', () => {
    it('returns LLM_RATE_LIMITED with retryable=true', () => {
      const error = new RateLimitError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        'rate limited',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_RATE_LIMITED);
      expect(result.retryable).toBe(true);
    });

    it('defaults retryAfterMs to 30000 when no retry-after header', () => {
      const error = new RateLimitError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        'rate limited',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.retryAfterMs).toBe(30000);
    });

    it('parses retry-after header in seconds', () => {
      const error = new RateLimitError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        'rate limited',
        makeHeaders({ 'retry-after': '30' }),
      );

      const result = classifyLlmError(error);

      expect(result.retryAfterMs).toBe(30000);
    });

    it('parses retry-after header value of 1 second', () => {
      const error = new RateLimitError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        'rate limited',
        makeHeaders({ 'retry-after': '1' }),
      );

      const result = classifyLlmError(error);

      expect(result.retryAfterMs).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // 2. APIError status=529 → LLM_OVERLOADED
  // -------------------------------------------------------------------------
  describe('APIError status 529', () => {
    it('returns LLM_OVERLOADED with retryable=true', () => {
      const error = new APIError(
        529,
        { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
        'overloaded',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_OVERLOADED);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(15000);
    });
  });

  // -------------------------------------------------------------------------
  // 3. APIError type=overloaded_error → LLM_OVERLOADED
  // -------------------------------------------------------------------------
  describe('APIError type=overloaded_error', () => {
    it('returns LLM_OVERLOADED when error body type is overloaded_error', () => {
      // The classifier checks (apiError as Record<string, unknown>).type
      // which maps to the .error body's own .type property exposed by the SDK.
      // We construct a plain APIError and manually set .type to trigger the path.
      const error = new APIError(
        500,
        { type: 'overloaded_error', message: 'API overloaded' },
        'API overloaded',
        makeHeaders(),
      ) as APIError & { type: string };

      // The classifier reads (apiError as Record<string,unknown>).type, which
      // corresponds to the top-level .type property set on the error object.
      (error as unknown as Record<string, unknown>).type = 'overloaded_error';

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_OVERLOADED);
      expect(result.retryable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 4. AuthenticationError → LLM_AUTH_ERROR
  // -------------------------------------------------------------------------
  describe('AuthenticationError', () => {
    it('returns LLM_AUTH_ERROR with retryable=false', () => {
      const error = new AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid api key' } },
        'invalid api key',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_AUTH_ERROR);
      expect(result.retryable).toBe(false);
      expect(result.retryAfterMs).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. BadRequestError → LLM_BAD_REQUEST
  // -------------------------------------------------------------------------
  describe('BadRequestError', () => {
    it('returns LLM_BAD_REQUEST with retryable=false', () => {
      const error = new BadRequestError(
        400,
        { type: 'error', error: { type: 'invalid_request_error', message: 'bad param' } },
        'bad param',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_BAD_REQUEST);
      expect(result.retryable).toBe(false);
      expect(result.retryAfterMs).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. InternalServerError (500) → LLM_SERVER_ERROR
  // -------------------------------------------------------------------------
  describe('InternalServerError', () => {
    it('returns LLM_SERVER_ERROR for status 500', () => {
      const error = new InternalServerError(
        500,
        { type: 'error', error: { type: 'api_error', message: 'internal server error' } },
        'internal server error',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_SERVER_ERROR);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(10000);
    });

    it('returns LLM_SERVER_ERROR for status 503', () => {
      const error = new InternalServerError(
        503,
        { type: 'error', error: { type: 'api_error', message: 'service unavailable' } },
        'service unavailable',
        makeHeaders(),
      );

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. APIConnectionError → LLM_CONNECTION_ERROR
  // -------------------------------------------------------------------------
  describe('APIConnectionError', () => {
    it('returns LLM_CONNECTION_ERROR with retryable=true', () => {
      const error = new APIConnectionError({ message: 'ECONNREFUSED' });

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_CONNECTION_ERROR);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // 8. APIConnectionTimeoutError → LLM_TIMEOUT
  // -------------------------------------------------------------------------
  describe('APIConnectionTimeoutError', () => {
    it('returns LLM_TIMEOUT with retryable=true', () => {
      const error = new APIConnectionTimeoutError({ message: 'Request timed out.' });

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_TIMEOUT);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(5000);
    });

    it('is detected before APIConnectionError (subclass ordering)', () => {
      // APIConnectionTimeoutError extends APIConnectionError.
      // The classifier must check the more specific subclass first.
      const error = new APIConnectionTimeoutError();

      const result = classifyLlmError(error);

      // Must be TIMEOUT, not CONNECTION_ERROR
      expect(result.code).toBe(ErrorCode.LLM_TIMEOUT);
    });
  });

  // -------------------------------------------------------------------------
  // 9. DOMException TimeoutError → LLM_TIMEOUT (AbortSignal.timeout())
  // -------------------------------------------------------------------------
  describe('DOMException TimeoutError', () => {
    it('returns LLM_TIMEOUT for DOMException with name=TimeoutError', () => {
      const error = new DOMException('timeout', 'TimeoutError');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_TIMEOUT);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(5000);
    });
  });

  // -------------------------------------------------------------------------
  // 10. LangChain fallback: "overloaded" in message → LLM_OVERLOADED
  // -------------------------------------------------------------------------
  describe('LangChain string fallback — overloaded', () => {
    it('returns LLM_OVERLOADED when message contains "overloaded"', () => {
      const error = new Error('LLM provider is overloaded, please try again');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_OVERLOADED);
      expect(result.retryable).toBe(true);
    });

    it('returns LLM_OVERLOADED when message contains "529"', () => {
      const error = new Error('Unexpected status code 529 from provider');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_OVERLOADED);
    });
  });

  // -------------------------------------------------------------------------
  // 11. LangChain fallback: "429" in message → LLM_RATE_LIMITED
  // -------------------------------------------------------------------------
  describe('LangChain string fallback — rate limited', () => {
    it('returns LLM_RATE_LIMITED when message contains "429"', () => {
      const error = new Error('HTTP 429 Too Many Requests');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_RATE_LIMITED);
      expect(result.retryable).toBe(true);
    });

    it('returns LLM_RATE_LIMITED when message contains "rate limit"', () => {
      const error = new Error('You have exceeded your rate limit');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_RATE_LIMITED);
    });

    it('returns LLM_RATE_LIMITED when message contains "too many requests"', () => {
      const error = new Error('too many requests from this client');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.LLM_RATE_LIMITED);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Plain Error → AGENT_EXECUTION_FAILED
  // -------------------------------------------------------------------------
  describe('generic Error fallback', () => {
    it('returns AGENT_EXECUTION_FAILED for an unrecognised Error', () => {
      const error = new Error('something unexpected happened');

      const result = classifyLlmError(error);

      expect(result.code).toBe(ErrorCode.AGENT_EXECUTION_FAILED);
      expect(result.retryable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Thrown string → AGENT_EXECUTION_FAILED
  // -------------------------------------------------------------------------
  describe('thrown string fallback', () => {
    it('returns AGENT_EXECUTION_FAILED when a string is thrown', () => {
      const result = classifyLlmError('some string error');

      expect(result.code).toBe(ErrorCode.AGENT_EXECUTION_FAILED);
      expect(result.retryable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 14. User messages must NOT contain JSON, status codes, or stack traces
  // -------------------------------------------------------------------------
  describe('user message cleanliness', () => {
    const testCases = [
      {
        label: 'RateLimitError',
        error: new RateLimitError(
          429,
          { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
          'rate limited',
          makeHeaders({ 'retry-after': '10' }),
        ) as unknown,
      },
      {
        label: 'APIError status=529',
        error: new APIError(
          529,
          { type: 'overloaded_error', message: 'overloaded' },
          'overloaded',
          makeHeaders(),
        ) as unknown,
      },
      {
        label: 'AuthenticationError',
        error: new AuthenticationError(
          401,
          { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
          'bad key',
          makeHeaders(),
        ) as unknown,
      },
      {
        label: 'BadRequestError',
        error: new BadRequestError(
          400,
          { type: 'error', error: { type: 'invalid_request_error', message: 'bad param' } },
          'bad param',
          makeHeaders(),
        ) as unknown,
      },
      {
        label: 'InternalServerError',
        error: new InternalServerError(
          500,
          { type: 'error', error: { type: 'api_error', message: 'crash' } },
          'crash',
          makeHeaders(),
        ) as unknown,
      },
      {
        label: 'APIConnectionError',
        error: new APIConnectionError({ message: 'ECONNREFUSED 127.0.0.1:443' }) as unknown,
      },
      {
        label: 'APIConnectionTimeoutError',
        error: new APIConnectionTimeoutError({ message: 'timed out' }) as unknown,
      },
      {
        label: 'DOMException TimeoutError',
        error: new DOMException('signal timed out', 'TimeoutError') as unknown,
      },
      {
        label: 'LangChain overloaded string fallback',
        error: new Error('LLM overloaded') as unknown,
      },
      {
        label: 'LangChain rate-limit string fallback',
        error: new Error('HTTP 429 from provider') as unknown,
      },
      {
        label: 'generic Error',
        error: new Error('Something completely unknown') as unknown,
      },
      {
        label: 'thrown string',
        error: 'plain thrown string' as unknown,
      },
    ];

    it.each(testCases)('$label: userMessage contains no JSON, status codes, or stack traces', (testCase) => {
      const { error } = testCase;
      const { userMessage } = classifyLlmError(error);

      // Must not contain JSON object/array delimiters
      expect(userMessage).not.toMatch(/[{}[\]]/);

      // Must not contain bare HTTP status codes (3–4 digit numbers)
      expect(userMessage).not.toMatch(/\b[34]\d{2}\b/);

      // Must not contain stack trace markers
      expect(userMessage).not.toMatch(/at \w/);
      expect(userMessage).not.toMatch(/Error:/);
    });
  });
});

// ---------------------------------------------------------------------------
// isRetryableLlmError
// ---------------------------------------------------------------------------

describe('isRetryableLlmError', () => {
  it('returns true for RateLimitError', () => {
    const error = new RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
      'rate limited',
      makeHeaders(),
    );

    expect(isRetryableLlmError(error)).toBe(true);
  });

  it('returns true for APIConnectionTimeoutError', () => {
    const error = new APIConnectionTimeoutError();

    expect(isRetryableLlmError(error)).toBe(true);
  });

  it('returns true for APIConnectionError', () => {
    const error = new APIConnectionError({ message: 'connection refused' });

    expect(isRetryableLlmError(error)).toBe(true);
  });

  it('returns true for InternalServerError', () => {
    const error = new InternalServerError(
      500,
      { type: 'error', error: { type: 'api_error', message: 'server crash' } },
      'server crash',
      makeHeaders(),
    );

    expect(isRetryableLlmError(error)).toBe(true);
  });

  it('returns true for generic unknown Error', () => {
    const error = new Error('something unexpected');

    expect(isRetryableLlmError(error)).toBe(true);
  });

  it('returns false for AuthenticationError', () => {
    const error = new AuthenticationError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
      'bad key',
      makeHeaders(),
    );

    expect(isRetryableLlmError(error)).toBe(false);
  });

  it('returns false for BadRequestError', () => {
    const error = new BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'bad param' } },
      'bad param',
      makeHeaders(),
    );

    expect(isRetryableLlmError(error)).toBe(false);
  });
});
