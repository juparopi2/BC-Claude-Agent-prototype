/**
 * TestDatabaseSetup - Database Management for Integration Tests
 *
 * Provides utilities for managing database connections in integration tests.
 * Ensures proper initialization and cleanup of database connections.
 *
 * Usage Pattern:
 * ```typescript
 * import { setupDatabaseForTests } from '../helpers';
 *
 * describe('My Integration Test', () => {
 *   setupDatabaseForTests(); // Call at describe level
 *
 *   it('should work with real database', async () => {
 *     // Database is initialized automatically
 *   });
 * });
 * ```
 *
 * @module __tests__/integration/helpers/TestDatabaseSetup
 */

import { beforeAll, afterAll } from 'vitest';
import { initDatabase, closeDatabase, executeQuery } from '@/config/database';
import { initRedis, closeRedis } from '@/config/redis';
import { initRedisClient, closeRedisClient } from '@/config/redis-client';
import { REDIS_TEST_CONFIG } from '../setup.integration';

/**
 * Database connection status
 */
let isDatabaseInitialized = false;

/**
 * Redis connection status (ioredis for BullMQ)
 */
let isRedisInitialized = false;

/**
 * Redis client connection status (redis package for sessions/TestSessionFactory)
 */
let isRedisClientInitialized = false;

/**
 * Initializes Redis for integration tests using local Docker config
 * Overrides environment variables to use test Redis (localhost:6399)
 *
 * IMPORTANT: This function MUST close any existing Redis connection first,
 * because the production .env may have already initialized a connection to
 * Azure Redis. We need to reconnect to the local test Redis (Docker).
 */
export async function initRedisForTests(): Promise<void> {
  // FIRST: Close any existing Redis connection
  // This is critical because the .env file may have already caused a connection
  // to Azure Redis, but tests need to use local Docker Redis (localhost:6399)
  try {
    await closeRedis();
  } catch {
    // Ignore errors - connection might not exist yet
  }

  // Override environment variables to use local Docker Redis
  process.env.REDIS_HOST = REDIS_TEST_CONFIG.host;
  process.env.REDIS_PORT = String(REDIS_TEST_CONFIG.port);
  process.env.REDIS_PASSWORD = ''; // Docker Redis has no password

  // Clear connection string to force use of individual parameters
  delete process.env.REDIS_CONNECTION_STRING;

  try {
    // Initialize ioredis (for BullMQ)
    await initRedis();
    isRedisInitialized = true;
    console.log(`✅ Redis (ioredis) initialized for tests (${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port})`);

    // Initialize redis-client (for sessions/TestSessionFactory)
    await initRedisClient();
    isRedisClientInitialized = true;
    console.log(`✅ Redis client (redis package) initialized for tests`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Redis not available for integration tests. ` +
        `Make sure Redis is running: docker compose -f docker-compose.test.yml up -d\n` +
        `Original error: ${errorMessage}`
    );
  }
}

/**
 * Closes Redis connections for tests (both ioredis and redis package)
 */
export async function closeRedisForTests(): Promise<void> {
  // Close redis-client (redis package for sessions)
  if (isRedisClientInitialized) {
    await closeRedisClient();
    isRedisClientInitialized = false;
  }

  // Close ioredis (for BullMQ)
  if (isRedisInitialized) {
    await closeRedis();
    isRedisInitialized = false;
  }
}

/**
 * Ensures database is available for integration tests
 * Throws descriptive error if database connection fails
 */
export async function ensureDatabaseAvailable(): Promise<void> {
  try {
    await initDatabase();

    // Verify connection with simple query
    const result = await executeQuery<{ result: number }>('SELECT 1 as result');
    if (result.recordset[0]?.result !== 1) {
      throw new Error('Database connection verification failed');
    }

    isDatabaseInitialized = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Database not available for integration tests. ` +
        `Verify DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD environment variables.\n` +
        `Original error: ${errorMessage}`
    );
  }
}

/**
 * Closes database connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (isDatabaseInitialized) {
    await closeDatabase();
    isDatabaseInitialized = false;
  }
}

/**
 * Setup hook for integration test files that need database access
 * Call this at the top of your describe block
 *
 * This function:
 * 1. Initializes database connection in beforeAll
 * 2. Closes connection in afterAll
 * 3. Provides helper methods for database operations
 *
 * @example
 * ```typescript
 * import { setupDatabaseForTests } from '../helpers';
 *
 * describe('Session Integration Tests', () => {
 *   const { isReady } = setupDatabaseForTests();
 *
 *   it('should create a session', async () => {
 *     expect(isReady()).toBe(true);
 *     // Database operations work here
 *   });
 * });
 * ```
 */
export function setupDatabaseForTests(options: {
  /** Timeout for database initialization in ms (default: 30000) */
  timeout?: number;
  /** Skip Redis initialization (default: false) */
  skipRedis?: boolean;
} = {}) {
  const timeout = options.timeout || 30000;
  const skipRedis = options.skipRedis || false;

  beforeAll(async () => {
    // Initialize Redis FIRST if not skipped (TestSessionFactory depends on it)
    if (!skipRedis) {
      await initRedisForTests();
    }
    await ensureDatabaseAvailable();
  }, timeout);

  afterAll(async () => {
    await closeDatabaseConnection();
    if (!skipRedis) {
      await closeRedisForTests();
    }
  }, timeout);

  return {
    /**
     * Check if database is ready
     */
    isReady: () => isDatabaseInitialized,
    /**
     * Check if Redis (ioredis) is ready
     */
    isRedisReady: () => isRedisInitialized,
    /**
     * Check if Redis client (redis package) is ready for TestSessionFactory
     */
    isRedisClientReady: () => isRedisClientInitialized,
  };
}

/**
 * Combined setup for tests that need both Redis and Database
 * Uses the Redis setup from setup.integration.ts
 *
 * @example
 * ```typescript
 * import { setupFullIntegrationTest } from '../helpers';
 *
 * describe('Full Integration Test', () => {
 *   const { getRedis, isDatabaseReady } = setupFullIntegrationTest();
 *
 *   it('should work with Redis and Database', async () => {
 *     const redis = getRedis();
 *     await redis.set('key', 'value');
 *     // Database operations also work
 *   });
 * });
 * ```
 */
export function setupFullIntegrationTest(options: {
  /** Redis key prefix for isolation */
  keyPrefix?: string;
  /** Timeout for initialization in ms */
  timeout?: number;
} = {}) {
  const timeout = options.timeout || 30000;

  // Setup Database and Redis (production client for TestSessionFactory compatibility)
  beforeAll(async () => {
    // Initialize Redis FIRST (TestSessionFactory depends on it)
    await initRedisForTests();
    // Then Database
    await ensureDatabaseAvailable();
  }, timeout);

  afterAll(async () => {
    await closeDatabaseConnection();
    await closeRedisForTests();
  }, timeout);

  return {
    isDatabaseReady: () => isDatabaseInitialized,
    isRedisReady: () => isRedisInitialized,
    isRedisClientReady: () => isRedisClientInitialized,
  };
}

/**
 * Type guard to check if we're in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}
