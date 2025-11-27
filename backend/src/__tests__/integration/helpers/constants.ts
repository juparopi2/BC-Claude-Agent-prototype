/**
 * Integration Test Constants
 *
 * Centralized configuration for integration tests.
 * All test files should import these constants instead of hardcoding values.
 *
 * @module __tests__/integration/helpers/constants
 */

/**
 * Session secret for express-session middleware in tests.
 * IMPORTANT: All test servers must use this same secret for session signing.
 */
export const TEST_SESSION_SECRET = 'test-secret-for-integration-test';

/**
 * Test prefix for all test data - ensures safe cleanup.
 * Used for string columns (email, microsoft_id) but NOT for UNIQUEIDENTIFIER
 * columns (id) which must be valid UUIDs.
 */
export const TEST_PREFIX = 'test_integration_';

/**
 * Test email domain for identifying test users.
 * All test users should use this domain in their email.
 */
export const TEST_EMAIL_DOMAIN = '@bcagent.test';

/**
 * Default timeout for async operations in tests (ms)
 */
export const DEFAULT_TEST_TIMEOUT = 10000;

/**
 * Socket.IO connection timeout (ms)
 */
export const SOCKET_CONNECTION_TIMEOUT = 10000;

/**
 * Default event wait timeout (ms)
 */
export const EVENT_WAIT_TIMEOUT = 5000;

/**
 * Session cookie configuration
 */
export const TEST_SESSION_COOKIE = {
  maxAge: 86400000, // 24 hours
  secure: false, // Test environment
  httpOnly: true,
  sameSite: 'lax' as const,
};

/**
 * Redis key prefix for test sessions
 */
export const REDIS_SESSION_PREFIX = 'sess:';

/**
 * Approval timeout for tests (ms) - shorter than production
 */
export const TEST_APPROVAL_TIMEOUT = 5000;

/**
 * Centralized timeout constants for test lifecycle hooks.
 * Use these instead of hardcoding values like 60000, 30000, etc.
 */
export const TEST_TIMEOUTS = {
  /** beforeAll hook timeout (ms) */
  BEFORE_ALL: 60000,
  /** afterAll hook timeout (ms) */
  AFTER_ALL: 30000,
  /** Database initialization timeout (ms) */
  DATABASE_INIT: 30000,
  /** Redis initialization timeout (ms) */
  REDIS_INIT: 10000,
  /** Socket connection timeout (ms) */
  SOCKET_CONNECTION: 10000,
  /** Event wait timeout (ms) */
  EVENT_WAIT: 5000,
  /** Short wait for event propagation (ms) */
  EVENT_PROPAGATION: 200,
  /** Medium wait for async operations (ms) */
  ASYNC_OPERATION: 500,
  /** Message cleanup timeout (ms) */
  MESSAGE_CLEANUP: 1000,
} as const;

/**
 * Default fallback port for Socket.IO test servers.
 * All tests should use this single port instead of 3097, 3098, 3099.
 */
export const TEST_SERVER_FALLBACK_PORT = 3099;

/**
 * Redis key patterns for cleanup
 */
export const REDIS_CLEANUP_PATTERNS = {
  /** Session keys */
  SESSIONS: 'sess:*',
  /** BullMQ queue keys */
  BULLMQ: 'bull:*',
  /** Generic queue keys */
  QUEUES: 'queue:*',
  /** Test data keys */
  TEST_DATA: 'test:*',
  /** Sequence number keys */
  SEQUENCES: 'seq:*',
} as const;
