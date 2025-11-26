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
