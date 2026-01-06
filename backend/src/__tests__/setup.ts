import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { server } from './mocks/server';

// Mock OpenAI globally to prevent load errors in all tests (unit & integration)
vi.mock('openai', () => {
  return {
    OpenAI: class {
      embeddings = {
        create: vi.fn()
      };
      chat = {
        completions: {
          create: vi.fn()
        }
      };
    }
  };
});

// Mock logger globally with SINGLETON pattern to prevent undefined logger issues
// in classes that cache logger in instance fields (e.g., PersistenceCoordinator)
// The logger module exports: logger, createChildLogger, createRequestLogger, and convenience methods
const mockLogger = vi.hoisted(() => {
  const mock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };
  // Self-reference for child() calls
  mock.child.mockReturnValue(mock);
  return mock;
});

// IMPORTANT: Use regular functions (not vi.fn()) so vi.resetAllMocks() doesn't clear implementations
vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: () => mockLogger,  // Regular function, not vi.fn()
  createRequestLogger: () => mockLogger,  // Regular function, not vi.fn()
  // Convenience exports (destructured from logger)
  info: mockLogger.info,
  warn: mockLogger.warn,
  error: mockLogger.error,
  debug: mockLogger.debug,
  fatal: mockLogger.fatal,
  trace: mockLogger.trace,
}));

// Reduce log verbosity during tests (improves performance)
process.env.LOG_LEVEL = 'warn';

// MSW Server setup
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mock-database-url';
process.env.REDIS_URL = 'mock-redis-url';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.ANTHROPIC_API_KEY = 'mock-api-key';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef'; // 32 bytes for AES-256
process.env.SESSION_SECRET = 'test-session-secret-for-testing-only';
process.env.MICROSOFT_CLIENT_ID = 'mock-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'mock-client-secret';
process.env.MICROSOFT_TENANT_ID = 'common';
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:3002/api/auth/callback';
process.env.BC_API_URL = 'https://api.businesscentral.dynamics.com/v2.0';

// Export mockLogger for test files that need to assert on logger calls
export { mockLogger };
