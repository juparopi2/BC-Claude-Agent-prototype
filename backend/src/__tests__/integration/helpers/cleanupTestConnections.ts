/**
 * Test Connection Cleanup Helper
 *
 * Provides utilities for properly cleaning up Redis and MessageQueue
 * connections in integration tests to prevent connection leaks.
 *
 * The main problem this solves:
 * - BullMQ creates ~22 Redis connections per MessageQueue instance
 * - Tests that create MessageQueue instances without proper cleanup leak connections
 * - Azure Redis Basic tier has 256 connection limit
 * - 30 tests × 22 connections = 660+ connections → ECONNRESET errors
 *
 * @module __tests__/integration/helpers/cleanupTestConnections
 */

import type { Redis as IORedis } from 'ioredis';
import { __resetMessageQueue, hasMessageQueueInstance } from '@/infrastructure/queue/MessageQueue';
import { __resetAllRedis } from '@/infrastructure/redis/redis';
import { __resetRedisClient } from '@/infrastructure/redis/redis-client';

/**
 * Connections tracked for cleanup
 */
interface TestConnections {
  /** Injected Redis connection (passed to MessageQueue) */
  injectedRedis?: IORedis;
  /** MessageQueue instance */
  messageQueue?: { close: () => Promise<void> };
}

/**
 * Cleanup test connections safely
 *
 * Use this in afterEach hooks when tests create MessageQueue instances
 * with injected Redis connections.
 *
 * @param connections - Object containing connections to cleanup
 *
 * @example
 * ```typescript
 * let messageQueue: MessageQueue;
 * let injectedRedis: IORedis;
 *
 * beforeEach(() => {
 *   injectedRedis = new IORedis(REDIS_TEST_CONFIG);
 *   messageQueue = getMessageQueue({ redis: injectedRedis });
 * });
 *
 * afterEach(async () => {
 *   await cleanupTestConnections({ messageQueue, injectedRedis });
 * });
 * ```
 */
export async function cleanupTestConnections(connections: TestConnections): Promise<void> {
  const errors: Error[] = [];

  // 1. Close MessageQueue first (doesn't close injected Redis)
  if (connections.messageQueue) {
    try {
      await connections.messageQueue.close();
    } catch (e) {
      errors.push(e as Error);
    }
  }

  // 2. Reset MessageQueue singleton
  try {
    await __resetMessageQueue();
  } catch (e) {
    errors.push(e as Error);
  }

  // 3. Wait for BullMQ internal connections to release
  await new Promise(resolve => setTimeout(resolve, 300));

  // 4. Close injected Redis explicitly (CRITICAL - prevents leak)
  if (connections.injectedRedis) {
    try {
      const status = connections.injectedRedis.status;
      if (status === 'ready' || status === 'connect') {
        await connections.injectedRedis.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
  }

  // 5. Final delay for full cleanup
  await new Promise(resolve => setTimeout(resolve, 100));

  if (errors.length > 0) {
    console.warn(`cleanupTestConnections completed with ${errors.length} error(s)`);
  }
}

/**
 * Full cleanup of all Redis singletons
 *
 * Use this in afterAll hooks to ensure all singleton Redis connections
 * are properly closed between test files.
 *
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await cleanupAllSingletons();
 * });
 * ```
 */
export async function cleanupAllSingletons(): Promise<void> {
  const errors: Error[] = [];

  // 1. Reset MessageQueue singleton first (only if it exists)
  // IMPORTANT: Don't call __resetMessageQueue() if no instance exists,
  // as this avoids creating unnecessary connections
  if (hasMessageQueueInstance()) {
    try {
      await __resetMessageQueue();
    } catch (e) {
      errors.push(e as Error);
    }
  }

  // 2. Wait for BullMQ to release connections
  await new Promise(resolve => setTimeout(resolve, 500));

  // 3. Reset ioredis singletons
  try {
    await __resetAllRedis();
  } catch (e) {
    errors.push(e as Error);
  }

  // 4. Reset redis package singletons
  try {
    await __resetRedisClient();
  } catch (e) {
    errors.push(e as Error);
  }

  // 5. Final delay
  await new Promise(resolve => setTimeout(resolve, 200));

  if (errors.length > 0) {
    console.warn(`cleanupAllSingletons completed with ${errors.length} error(s)`);
  }
}

/**
 * Create a try/finally wrapper for tests that need connection cleanup
 *
 * Use this to ensure connections are cleaned up even if a test fails.
 *
 * @param connections - Function that returns connections to cleanup
 * @param testFn - The test function to run
 *
 * @example
 * ```typescript
 * it('should do something', async () => {
 *   await withConnectionCleanup(
 *     () => ({ messageQueue, injectedRedis }),
 *     async () => {
 *       // Your test logic here
 *       expect(result).toBe(expected);
 *     }
 *   );
 * });
 * ```
 */
export async function withConnectionCleanup(
  connections: () => TestConnections,
  testFn: () => Promise<void>
): Promise<void> {
  try {
    await testFn();
  } finally {
    await cleanupTestConnections(connections());
  }
}
