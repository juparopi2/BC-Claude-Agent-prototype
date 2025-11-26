/**
 * Integration Test Setup
 *
 * Provides utilities for integration tests that require real Redis connections.
 * Uses the Redis container from docker-compose.test.yml (local) or
 * GitHub Actions service containers (CI).
 *
 * Environment variables:
 *   REDIS_TEST_HOST - Redis host (default: localhost)
 *   REDIS_TEST_PORT - Redis port (default: 6399 for docker-compose.test.yml)
 *
 * @module __tests__/integration/setup.integration
 */

import IORedis from 'ioredis';
import { afterAll, beforeAll } from 'vitest';

/**
 * Default Redis configuration for integration tests
 */
export const REDIS_TEST_CONFIG = {
  host: process.env.REDIS_TEST_HOST || 'localhost',
  port: parseInt(process.env.REDIS_TEST_PORT || '6399', 10),
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) {
      return null; // Stop retrying
    }
    return Math.min(times * 100, 1000);
  },
};

/**
 * Creates a Redis connection for integration tests
 * @param keyPrefix - Optional prefix for Redis keys to isolate tests
 */
export function createTestRedisConnection(keyPrefix?: string): IORedis {
  return new IORedis({
    ...REDIS_TEST_CONFIG,
    keyPrefix,
    lazyConnect: true,
  });
}

/**
 * Checks if Redis is available for integration tests
 * Throws descriptive error if Redis is not running
 */
export async function ensureRedisAvailable(): Promise<void> {
  const redis = createTestRedisConnection();

  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis response: ${pong}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Redis not available for integration tests. ` +
        `Make sure Redis is running on ${REDIS_TEST_CONFIG.host}:${REDIS_TEST_CONFIG.port}.\n` +
        `Run: docker-compose -f docker-compose.test.yml up -d\n` +
        `Original error: ${errorMessage}`
    );
  } finally {
    await redis.quit();
  }
}

/**
 * Clears all keys matching a pattern from Redis
 * Use with caution - only in test environment
 */
export async function clearRedisKeys(redis: IORedis, pattern: string): Promise<number> {
  const keys = await redis.keys(pattern);
  if (keys.length === 0) return 0;

  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.del(key));
  await pipeline.exec();

  return keys.length;
}

/**
 * Clears all BullMQ-related keys for a specific queue
 */
export async function clearBullMQQueue(redis: IORedis, queueName: string): Promise<void> {
  // BullMQ uses specific key patterns
  const patterns = [
    `bull:${queueName}:*`,
    `bull:${queueName}`,
  ];

  for (const pattern of patterns) {
    await clearRedisKeys(redis, pattern);
  }
}

/**
 * Setup hook for integration test files
 * Call this at the top of your integration test file
 *
 * @example
 * ```typescript
 * import { setupIntegrationTest } from '../setup.integration';
 *
 * const { getRedis } = setupIntegrationTest();
 *
 * describe('My Integration Test', () => {
 *   it('should work with real Redis', async () => {
 *     const redis = getRedis();
 *     await redis.set('key', 'value');
 *   });
 * });
 * ```
 */
export function setupIntegrationTest(options: { keyPrefix?: string } = {}) {
  let redis: IORedis | null = null;

  beforeAll(async () => {
    // First check Redis is available
    await ensureRedisAvailable();

    // Create connection for this test suite
    redis = createTestRedisConnection(options.keyPrefix);
    await redis.connect();
  });

  afterAll(async () => {
    if (redis) {
      // Clean up test keys if prefix was used
      if (options.keyPrefix) {
        await clearRedisKeys(redis, `${options.keyPrefix}*`);
      }
      await redis.quit();
      redis = null;
    }
  });

  return {
    getRedis: () => {
      if (!redis) {
        throw new Error('Redis connection not initialized. Make sure beforeAll has run.');
      }
      return redis;
    },
    getConfig: () => REDIS_TEST_CONFIG,
  };
}

/**
 * Type guard to check if we're in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}
