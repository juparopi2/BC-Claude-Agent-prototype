/**
 * Global Setup for Integration Tests
 *
 * This file runs ONCE before ALL integration test files START.
 *
 * NOTE: With Vitest's `pool: 'forks'`, globalSetup runs in the main process
 * but tests run in worker processes. Connections made here are NOT shared
 * with test workers. This setup is used for:
 * - Environment validation
 * - Pre-flight checks (Redis/DB availability)
 * - Setting up test Redis configuration
 *
 * Actual DB/Redis connections are made per-file via setupDatabaseForTests().
 *
 * @module __tests__/integration/globalSetup
 */

import { config } from 'dotenv';
import path from 'path';
import { createClient } from 'redis';

// Load environment variables first
const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });

// Test Redis configuration (Docker container on port 6399)
const REDIS_TEST_CONFIG = {
  host: process.env.REDIS_TEST_HOST || 'localhost',
  port: parseInt(process.env.REDIS_TEST_PORT || '6399', 10),
};

/**
 * Global setup function - runs before all tests
 * Validates that infrastructure is available before starting tests
 */
export async function setup(): Promise<void> {
  console.log('\n🚀 [Global Setup] Validating integration test infrastructure...\n');

  // Configure environment for test Redis
  // These will be inherited by child processes (test workers)
  process.env.REDIS_HOST = REDIS_TEST_CONFIG.host;
  process.env.REDIS_PORT = String(REDIS_TEST_CONFIG.port);
  process.env.REDIS_PASSWORD = '';
  delete process.env.REDIS_CONNECTION_STRING;

  // Pre-flight check: Verify Redis is available
  console.log(`📡 [Global Setup] Checking Redis (${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port})...`);
  const redisClient = createClient({
    socket: {
      host: REDIS_TEST_CONFIG.host,
      port: REDIS_TEST_CONFIG.port,
    },
  });

  try {
    await redisClient.connect();
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      console.log('✅ [Global Setup] Redis is available');
    }
    await redisClient.quit();
  } catch (error) {
    console.error('❌ [Global Setup] Redis not available');
    console.error('   Run: docker compose -f docker-compose.test.yml up -d');
    throw new Error(
      `Redis not available at ${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port}. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Pre-flight check: Verify DATABASE_* environment variables exist
  const dbVars = ['DATABASE_SERVER', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'];
  const missingVars = dbVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    console.error(`❌ [Global Setup] Missing database environment variables: ${missingVars.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  console.log('✅ [Global Setup] Database environment variables configured');
  console.log('\n✅ [Global Setup] Pre-flight checks passed. Starting tests...\n');
}

/**
 * Global teardown function - runs after all tests complete
 */
export async function teardown(): Promise<void> {
  console.log('\n✅ [Global Teardown] Integration tests completed\n');
}

// Default export for Vitest
export default setup;
