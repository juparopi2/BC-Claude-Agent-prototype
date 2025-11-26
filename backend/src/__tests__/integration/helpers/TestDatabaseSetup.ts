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

/**
 * Database connection status
 */
let isDatabaseInitialized = false;

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
} = {}) {
  const timeout = options.timeout || 30000;

  beforeAll(async () => {
    await ensureDatabaseAvailable();
  }, timeout);

  afterAll(async () => {
    await closeDatabaseConnection();
  }, timeout);

  return {
    /**
     * Check if database is ready
     */
    isReady: () => isDatabaseInitialized,
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

  // Import Redis setup dynamically to avoid circular dependencies
  const { setupIntegrationTest } = require('../setup.integration');

  // Setup Redis
  const redisSetup = setupIntegrationTest({ keyPrefix: options.keyPrefix });

  // Setup Database
  beforeAll(async () => {
    await ensureDatabaseAvailable();
  }, timeout);

  afterAll(async () => {
    await closeDatabaseConnection();
  }, timeout);

  return {
    getRedis: redisSetup.getRedis,
    getRedisConfig: redisSetup.getConfig,
    isDatabaseReady: () => isDatabaseInitialized,
  };
}

/**
 * Type guard to check if we're in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}
