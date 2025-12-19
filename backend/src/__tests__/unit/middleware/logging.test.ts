/**
 * HTTP Logging Middleware Unit Tests
 *
 * F6-004: Unit tests for pino-http logging middleware
 *
 * Test Coverage:
 * 1. Request ID generation and propagation
 * 2. Log level customization based on status codes
 * 3. Header redaction for sensitive data
 * 4. Health check endpoint filtering
 *
 * @module __tests__/unit/middleware/logging.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// Mock pino-http before importing the middleware
vi.mock('pino-http', () => {
  return {
    default: vi.fn((options) => {
      // Store options for testing
      (global as Record<string, unknown>).__pinoHttpOptions = options;
      return vi.fn(); // Return a mock middleware
    }),
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import to trigger the mock setup
import '@/middleware/logging';

// ===== TEST HELPERS =====

interface MockIncomingMessage extends Partial<IncomingMessage> {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  query?: Record<string, string>;
  raw?: {
    url?: string;
    query?: Record<string, string>;
  };
  id?: string;
}

interface MockServerResponse extends Partial<ServerResponse> {
  statusCode: number;
  setHeader: ReturnType<typeof vi.fn>;
  getHeaders?: () => Record<string, string>;
}

/**
 * Get the pino-http options that were passed during middleware creation
 */
function getPinoHttpOptions(): Record<string, unknown> {
  return (global as Record<string, unknown>).__pinoHttpOptions as Record<string, unknown>;
}

/**
 * Creates a mock IncomingMessage
 */
function createMockRequest(overrides: Partial<MockIncomingMessage> = {}): MockIncomingMessage {
  return {
    headers: {},
    method: 'GET',
    url: '/api/test',
    raw: {
      url: '/api/test',
      query: {},
    },
    ...overrides,
  };
}

/**
 * Creates a mock ServerResponse
 */
function createMockResponse(overrides: Partial<MockServerResponse> = {}): MockServerResponse {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    getHeaders: () => ({}),
    ...overrides,
  };
}

// ===== 1. REQUEST ID GENERATION TESTS =====

describe('httpLogger - Request ID Generation', () => {
  it('should have genReqId function defined', () => {
    const options = getPinoHttpOptions();
    expect(options.genReqId).toBeDefined();
    expect(typeof options.genReqId).toBe('function');
  });

  it('should reuse existing X-Request-ID header', () => {
    const options = getPinoHttpOptions();
    const genReqId = options.genReqId as (req: IncomingMessage, res: ServerResponse) => string;

    const mockReq = createMockRequest({
      headers: { 'x-request-id': 'existing-id-123' },
    });
    const mockRes = createMockResponse();

    const result = genReqId(mockReq as IncomingMessage, mockRes as ServerResponse);

    expect(result).toBe('existing-id-123');
  });

  it('should generate new request ID when X-Request-ID is not present', () => {
    const options = getPinoHttpOptions();
    const genReqId = options.genReqId as (req: IncomingMessage, res: ServerResponse) => string;

    const mockReq = createMockRequest({ headers: {} });
    const mockRes = createMockResponse();

    const result = genReqId(mockReq as IncomingMessage, mockRes as ServerResponse);

    expect(result).toMatch(/^req_\d+_[a-z0-9]+$/);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', result);
  });

  it('should generate unique IDs for different requests', () => {
    const options = getPinoHttpOptions();
    const genReqId = options.genReqId as (req: IncomingMessage, res: ServerResponse) => string;

    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const mockReq = createMockRequest({ headers: {} });
      const mockRes = createMockResponse();
      const id = genReqId(mockReq as IncomingMessage, mockRes as ServerResponse);
      ids.add(id);
    }

    expect(ids.size).toBe(10);
  });
});

// ===== 2. LOG LEVEL CUSTOMIZATION TESTS =====

describe('httpLogger - Log Level Customization', () => {
  it('should have customLogLevel function defined', () => {
    const options = getPinoHttpOptions();
    expect(options.customLogLevel).toBeDefined();
    expect(typeof options.customLogLevel).toBe('function');
  });

  it('should return "error" for 5xx status codes', () => {
    const options = getPinoHttpOptions();
    const customLogLevel = options.customLogLevel as (req: IncomingMessage, res: ServerResponse, err?: Error) => string;

    const mockReq = createMockRequest();
    const mockRes = createMockResponse({ statusCode: 500 });

    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('error');

    mockRes.statusCode = 503;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('error');
  });

  it('should return "error" when there is an error', () => {
    const options = getPinoHttpOptions();
    const customLogLevel = options.customLogLevel as (req: IncomingMessage, res: ServerResponse, err?: Error) => string;

    const mockReq = createMockRequest();
    const mockRes = createMockResponse({ statusCode: 200 });
    const error = new Error('Test error');

    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse, error)).toBe('error');
  });

  it('should return "warn" for 4xx status codes', () => {
    const options = getPinoHttpOptions();
    const customLogLevel = options.customLogLevel as (req: IncomingMessage, res: ServerResponse, err?: Error) => string;

    const mockReq = createMockRequest();
    const mockRes = createMockResponse({ statusCode: 400 });

    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('warn');

    mockRes.statusCode = 401;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('warn');

    mockRes.statusCode = 404;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('warn');

    mockRes.statusCode = 499;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('warn');
  });

  it('should return "info" for 3xx status codes', () => {
    const options = getPinoHttpOptions();
    const customLogLevel = options.customLogLevel as (req: IncomingMessage, res: ServerResponse, err?: Error) => string;

    const mockReq = createMockRequest();
    const mockRes = createMockResponse({ statusCode: 301 });

    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('info');

    mockRes.statusCode = 302;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('info');
  });

  it('should return "info" for 2xx status codes', () => {
    const options = getPinoHttpOptions();
    const customLogLevel = options.customLogLevel as (req: IncomingMessage, res: ServerResponse, err?: Error) => string;

    const mockReq = createMockRequest();
    const mockRes = createMockResponse({ statusCode: 200 });

    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('info');

    mockRes.statusCode = 201;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('info');

    mockRes.statusCode = 204;
    expect(customLogLevel(mockReq as IncomingMessage, mockRes as ServerResponse)).toBe('info');
  });
});

// ===== 3. MESSAGE FORMATTING TESTS =====

describe('httpLogger - Message Formatting', () => {
  it('should have customSuccessMessage function defined', () => {
    const options = getPinoHttpOptions();
    expect(options.customSuccessMessage).toBeDefined();
    expect(typeof options.customSuccessMessage).toBe('function');
  });

  it('should format success message correctly', () => {
    const options = getPinoHttpOptions();
    const customSuccessMessage = options.customSuccessMessage as (req: IncomingMessage, res: ServerResponse) => string;

    const mockReq = createMockRequest({ method: 'POST', url: '/api/users' });
    const mockRes = createMockResponse({ statusCode: 201 });

    const message = customSuccessMessage(mockReq as IncomingMessage, mockRes as ServerResponse);

    expect(message).toBe('POST /api/users 201');
  });

  it('should have customErrorMessage function defined', () => {
    const options = getPinoHttpOptions();
    expect(options.customErrorMessage).toBeDefined();
    expect(typeof options.customErrorMessage).toBe('function');
  });

  it('should format error message correctly', () => {
    const options = getPinoHttpOptions();
    const customErrorMessage = options.customErrorMessage as (req: IncomingMessage, res: ServerResponse, err: Error) => string;

    const mockReq = createMockRequest({ method: 'DELETE', url: '/api/users/123' });
    const mockRes = createMockResponse({ statusCode: 500 });
    const error = new Error('Database connection failed');

    const message = customErrorMessage(mockReq as IncomingMessage, mockRes as ServerResponse, error);

    expect(message).toBe('DELETE /api/users/123 500 - Database connection failed');
  });
});

// ===== 4. SERIALIZER TESTS (HEADER REDACTION) =====

describe('httpLogger - Serializers', () => {
  it('should have serializers defined', () => {
    const options = getPinoHttpOptions();
    expect(options.serializers).toBeDefined();
    expect(typeof options.serializers).toBe('object');
  });

  describe('request serializer', () => {
    it('should redact authorization header', () => {
      const options = getPinoHttpOptions();
      const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

      const mockReqObject = {
        id: 'req-123',
        method: 'GET',
        url: '/api/protected',
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        raw: {
          url: '/api/protected',
          query: {},
          session: {},
        },
      };

      const serialized = serializers.req(mockReqObject);

      expect(serialized.headers).toBeDefined();
      expect((serialized.headers as Record<string, string>).authorization).toBe('[REDACTED]');
      expect((serialized.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('should redact cookie header', () => {
      const options = getPinoHttpOptions();
      const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

      const mockReqObject = {
        id: 'req-123',
        method: 'GET',
        url: '/api/data',
        headers: {
          cookie: 'session=abc123; other=value',
        },
        raw: {
          url: '/api/data',
          query: {},
          session: {},
        },
      };

      const serialized = serializers.req(mockReqObject);

      expect((serialized.headers as Record<string, string>).cookie).toBe('[REDACTED]');
    });

    it('should include request ID, method, and URL', () => {
      const options = getPinoHttpOptions();
      const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

      const mockReqObject = {
        id: 'req-456',
        method: 'POST',
        url: '/api/create',
        headers: {},
        raw: {
          url: '/api/create',
          query: { filter: 'active' },
          session: {},
        },
      };

      const serialized = serializers.req(mockReqObject);

      expect(serialized.id).toBe('req-456');
      expect(serialized.method).toBe('POST');
      expect(serialized.url).toBe('/api/create');
    });
  });

  describe('response serializer', () => {
    it('should include status code', () => {
      const options = getPinoHttpOptions();
      const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

      const mockResObject = {
        statusCode: 404,
        getHeaders: () => ({ 'content-type': 'application/json' }),
      };

      const serialized = serializers.res(mockResObject);

      expect(serialized.statusCode).toBe(404);
    });
  });
});

// ===== 5. AUTO LOGGING FILTER TESTS =====

describe('httpLogger - Auto Logging Filter', () => {
  it('should have autoLogging configuration defined', () => {
    const options = getPinoHttpOptions();
    expect(options.autoLogging).toBeDefined();
  });

  it('should ignore /health endpoint', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/health' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should ignore /ping endpoint', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/ping' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should not ignore other endpoints', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const endpoints = ['/api/users', '/api/sessions', '/api/messages', '/', '/dashboard'];

    for (const url of endpoints) {
      const mockReq = createMockRequest({ url });
      expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(false);
    }
  });
});

// ===== 6. SECURITY TESTS =====

describe('httpLogger - Security', () => {
  it('should not expose sensitive data in serialized output', () => {
    const options = getPinoHttpOptions();
    const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

    const mockReqObject = {
      id: 'req-789',
      method: 'POST',
      url: '/api/login',
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        cookie: 'session=s%3AabC123.signature',
        'x-api-key': 'sk-live-123456789',
        'content-type': 'application/json',
      },
      raw: {
        url: '/api/login',
        query: {},
        session: {},
      },
    };

    const serialized = serializers.req(mockReqObject);
    const serializedStr = JSON.stringify(serialized);

    // Should not contain actual sensitive values
    expect(serializedStr).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(serializedStr).not.toContain('s%3AabC123.signature');

    // Authorization and cookie should be redacted
    expect((serialized.headers as Record<string, string>).authorization).toBe('[REDACTED]');
    expect((serialized.headers as Record<string, string>).cookie).toBe('[REDACTED]');
  });

  // FIX #2: Test x-api-key redaction
  it('should redact x-api-key header', () => {
    const options = getPinoHttpOptions();
    const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

    const mockReqObject = {
      id: 'req-api-key-test',
      method: 'GET',
      url: '/api/data',
      headers: {
        'x-api-key': 'sk-live-super-secret-key-12345',
        'content-type': 'application/json',
      },
      raw: {
        url: '/api/data',
        query: {},
        session: {},
      },
    };

    const serialized = serializers.req(mockReqObject);
    const serializedStr = JSON.stringify(serialized);

    // x-api-key should be redacted
    expect((serialized.headers as Record<string, string>)['x-api-key']).toBe('[REDACTED]');
    expect(serializedStr).not.toContain('sk-live-super-secret-key-12345');
  });

  it('should redact all common API key header variations', () => {
    const options = getPinoHttpOptions();
    const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

    const mockReqObject = {
      id: 'req-multi-secret',
      method: 'POST',
      url: '/api/secure',
      headers: {
        authorization: 'Bearer jwt-token',
        cookie: 'session=abc123',
        'x-api-key': 'api-key-value',
      },
      raw: {
        url: '/api/secure',
        query: {},
        session: {},
      },
    };

    const serialized = serializers.req(mockReqObject);

    // All sensitive headers should be redacted
    expect((serialized.headers as Record<string, string>).authorization).toBe('[REDACTED]');
    expect((serialized.headers as Record<string, string>).cookie).toBe('[REDACTED]');
    expect((serialized.headers as Record<string, string>)['x-api-key']).toBe('[REDACTED]');
  });
});

// ===== 7. ADDITIONAL HEALTH ENDPOINTS TESTS =====

// FIX #3: Test additional health check endpoints
describe('httpLogger - Extended Health Check Endpoints', () => {
  it('should ignore /ready endpoint (Kubernetes readiness)', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/ready' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should ignore /live endpoint (Kubernetes liveness)', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/live' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should ignore /liveness endpoint', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/liveness' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should ignore /readiness endpoint', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: '/readiness' });

    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(true);
  });

  it('should NOT ignore similar but different endpoints', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    // These should NOT be ignored (different from health endpoints)
    const nonHealthEndpoints = [
      '/api/health', // Different path
      '/healthcheck', // Different name
      '/health/detailed', // Subpath
      '/ready/status', // Subpath
      '/api/ready', // Different path
    ];

    for (const url of nonHealthEndpoints) {
      const mockReq = createMockRequest({ url });
      expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(false);
    }
  });

  it('should handle undefined url gracefully', () => {
    const options = getPinoHttpOptions();
    const autoLogging = options.autoLogging as { ignore: (req: IncomingMessage) => boolean };

    const mockReq = createMockRequest({ url: undefined as unknown as string });

    // Should not throw and return false (don't ignore)
    expect(() => autoLogging.ignore(mockReq as IncomingMessage)).not.toThrow();
    expect(autoLogging.ignore(mockReq as IncomingMessage)).toBe(false);
  });
});

// ===== 8. MIDDLEWARE ATTACHMENT TESTS =====

// FIX #14: Test that req.log is attached by middleware
describe('httpLogger - Middleware Integration', () => {
  it('should return a middleware function', () => {
    // Re-import to get the actual middleware
    // The mock returns a function
    const options = getPinoHttpOptions();

    // Verify the middleware was created with proper options
    expect(options).toBeDefined();
    expect(options.logger).toBeDefined();
    expect(options.genReqId).toBeDefined();
    expect(options.customLogLevel).toBeDefined();
    expect(options.serializers).toBeDefined();
    expect(options.autoLogging).toBeDefined();
  });

  it('should have all required pino-http options configured', () => {
    const options = getPinoHttpOptions();

    // Verify complete configuration
    const requiredOptions = [
      'logger',
      'genReqId',
      'customLogLevel',
      'customSuccessMessage',
      'customErrorMessage',
      'serializers',
      'autoLogging',
    ];

    for (const opt of requiredOptions) {
      expect(options[opt]).toBeDefined();
    }
  });

  /**
   * Note: Testing that req.log exists after middleware execution
   * would require integration tests with actual Express.
   * The pino-http library attaches req.log automatically.
   *
   * For unit tests, we verify the middleware is properly configured.
   * Integration tests should verify req.log functionality.
   */
});

// ===== 9. PII COMPLIANCE DOCUMENTATION TESTS =====

// FIX #13: Document PII handling in logs
describe('httpLogger - PII Compliance Documentation', () => {
  /**
   * IMPORTANT: PII COMPLIANCE NOTES
   *
   * The logging middleware includes the following PII in logs:
   * - userId: User identifier from session
   * - sessionId: Session identifier
   *
   * For GDPR/CCPA compliance in production:
   * 1. Logs must be encrypted at rest
   * 2. Access to logs must be controlled and audited
   * 3. Log retention policies must be defined
   * 4. Users have the right to request deletion of their data
   * 5. Consider anonymizing/pseudonymizing for analytics
   *
   * The request serializer includes userId and sessionId for:
   * - Debugging production issues
   * - Tracing requests across services
   * - Security incident investigation
   */

  it('should document that userId is included in serialized request', () => {
    const options = getPinoHttpOptions();
    const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

    // Verify the serializer accesses session data
    const mockReqObject = {
      id: 'req-pii-test',
      method: 'GET',
      url: '/api/user-data',
      headers: {},
      raw: {
        url: '/api/user-data',
        query: {},
        session: {
          id: 'sess-123',
          microsoftOAuth: {
            userId: 'user-456',
          },
        },
      },
    };

    const serialized = serializers.req(mockReqObject);

    // These fields ARE included (for debugging)
    // Document this for compliance awareness
    expect(serialized.userId).toBe('user-456');
    expect(serialized.sessionId).toBe('sess-123');
  });

  it('should handle missing session gracefully (no PII leak)', () => {
    const options = getPinoHttpOptions();
    const serializers = options.serializers as Record<string, (arg: Record<string, unknown>) => Record<string, unknown>>;

    const mockReqObject = {
      id: 'req-no-session',
      method: 'GET',
      url: '/api/public',
      headers: {},
      raw: {
        url: '/api/public',
        query: {},
        // No session
      },
    };

    const serialized = serializers.req(mockReqObject);

    // Should not crash, just have undefined values
    expect(serialized.userId).toBeUndefined();
    expect(serialized.sessionId).toBeUndefined();
  });
});
