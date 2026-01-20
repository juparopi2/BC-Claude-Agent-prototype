/**
 * Distributed Lock Implementation using Redis
 *
 * Provides distributed locking for horizontal scaling scenarios where
 * multiple server instances need to coordinate access to shared resources.
 *
 * Uses Redis SET NX EX pattern for atomic lock acquisition with TTL.
 *
 * Features:
 * - Atomic lock acquisition (SET NX EX)
 * - Safe release with Lua script (only owner can release)
 * - Automatic TTL-based expiration (prevents deadlocks)
 * - withLock helper for try/finally pattern
 *
 * Usage:
 * ```typescript
 * const lock = getDistributedLock();
 *
 * // Option 1: Manual acquire/release
 * const token = await lock.acquire('my-resource', 30000);
 * if (token) {
 *   try {
 *     // Critical section
 *   } finally {
 *     await lock.release('my-resource', token);
 *   }
 * }
 *
 * // Option 2: withLock helper
 * const result = await lock.withLock('my-resource', async () => {
 *   // Critical section
 *   return someResult;
 * }, { ttlMs: 30000 });
 * ```
 *
 * @module infrastructure/redis/DistributedLock
 */

import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '@/shared/utils/logger';
import type Redis from 'ioredis';

const logger = createChildLogger({ service: 'DistributedLock' });

/**
 * Options for withLock helper
 */
export interface WithLockOptions {
  /** Lock TTL in milliseconds (default: 30000) */
  ttlMs?: number;
  /** Retry acquiring lock if not available (default: true) */
  retry?: boolean;
  /** Maximum retry attempts (default: 10) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 100) */
  retryDelayMs?: number;
  /** Throw error if lock not acquired (default: true) */
  throwOnFailure?: boolean;
}

/**
 * Result from withLock when throwOnFailure is false
 */
export interface WithLockResult<T> {
  acquired: boolean;
  result?: T;
}

/**
 * Lua script for safe lock release
 * Only releases if the token matches (prevents releasing someone else's lock)
 */
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Dependencies for DistributedLock (DI support for testing)
 */
export interface DistributedLockDependencies {
  redis: Redis;
}

/**
 * DistributedLock class
 *
 * Provides distributed locking using Redis for coordination across
 * multiple server instances.
 */
export class DistributedLock {
  private redis: Redis;

  constructor(deps: DistributedLockDependencies) {
    this.redis = deps.redis;
    logger.debug('DistributedLock initialized');
  }

  /**
   * Acquire a distributed lock
   *
   * Uses SET NX EX pattern for atomic acquisition with TTL.
   *
   * @param key - Lock key (will be prefixed with 'lock:')
   * @param ttlMs - Lock TTL in milliseconds
   * @returns Lock token if acquired, null otherwise
   *
   * @example
   * ```typescript
   * const token = await lock.acquire('user:123:refresh', 30000);
   * if (token) {
   *   // Lock acquired, do work
   *   await lock.release('user:123:refresh', token);
   * }
   * ```
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const lockKey = this.getLockKey(key);
    const token = uuidv4().toUpperCase(); // UUID per CLAUDE.md ID standardization
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    try {
      // SET key token NX EX seconds
      // NX = only set if key doesn't exist
      // EX = set expiration in seconds
      const result = await this.redis.set(lockKey, token, 'EX', ttlSeconds, 'NX');

      if (result === 'OK') {
        logger.debug({ key: lockKey, ttlMs }, 'Lock acquired');
        return token;
      }

      logger.debug({ key: lockKey }, 'Lock not acquired (already held)');
      return null;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) },
          key: lockKey,
        },
        'Failed to acquire lock'
      );
      return null;
    }
  }

  /**
   * Release a distributed lock
   *
   * Uses Lua script for atomic release that only succeeds if the
   * token matches (prevents releasing someone else's lock).
   *
   * @param key - Lock key (same as used in acquire)
   * @param token - Lock token returned from acquire
   * @returns true if lock was released, false otherwise
   */
  async release(key: string, token: string): Promise<boolean> {
    const lockKey = this.getLockKey(key);

    try {
      // Use Lua script for atomic compare-and-delete
      const result = await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);

      if (result === 1) {
        logger.debug({ key: lockKey }, 'Lock released');
        return true;
      }

      logger.debug({ key: lockKey }, 'Lock not released (not owner or expired)');
      return false;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) },
          key: lockKey,
        },
        'Failed to release lock'
      );
      return false;
    }
  }

  /**
   * Check if a lock is currently held
   *
   * @param key - Lock key to check
   * @returns true if lock exists, false otherwise
   */
  async isLocked(key: string): Promise<boolean> {
    const lockKey = this.getLockKey(key);

    try {
      const result = await this.redis.exists(lockKey);
      return result === 1;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) },
          key: lockKey,
        },
        'Failed to check lock status'
      );
      return false;
    }
  }

  /**
   * Execute a function while holding a lock
   *
   * Provides try/finally pattern with automatic lock release.
   *
   * @param key - Lock key
   * @param fn - Function to execute while holding lock
   * @param options - Lock options
   * @returns Result of function execution
   * @throws Error if lock cannot be acquired (when throwOnFailure is true)
   *
   * @example
   * ```typescript
   * // Simple usage (throws if lock not acquired)
   * const result = await lock.withLock('resource', async () => {
   *   return await doWork();
   * });
   *
   * // With retry
   * const result = await lock.withLock('resource', async () => {
   *   return await doWork();
   * }, { retry: true, maxRetries: 5 });
   *
   * // Without throwing
   * const { acquired, result } = await lock.withLock('resource', async () => {
   *   return await doWork();
   * }, { throwOnFailure: false });
   * ```
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: WithLockOptions
  ): Promise<T | WithLockResult<T>> {
    const {
      ttlMs = 30000,
      retry = true,
      maxRetries = 10,
      retryDelayMs = 100,
      throwOnFailure = true,
    } = options ?? {};

    let token: string | null = null;
    let attempts = 0;

    // Try to acquire lock with optional retry
    while (attempts < (retry ? maxRetries : 1)) {
      attempts++;
      token = await this.acquire(key, ttlMs);

      if (token) {
        break;
      }

      if (retry && attempts < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(retryDelayMs * Math.pow(1.5, attempts - 1), 5000);
        const jitter = Math.random() * 50;
        await this.sleep(delay + jitter);
      }
    }

    if (!token) {
      logger.warn({ key, attempts }, 'Failed to acquire lock after retries');

      if (throwOnFailure) {
        throw new Error(`Failed to acquire lock for key: ${key} after ${attempts} attempts`);
      }

      return { acquired: false } as WithLockResult<T>;
    }

    // Execute function with lock held
    try {
      const result = await fn();

      if (!throwOnFailure) {
        return { acquired: true, result } as WithLockResult<T>;
      }

      return result;
    } finally {
      // Always release lock
      await this.release(key, token);
    }
  }

  /**
   * Get the full lock key with prefix
   */
  private getLockKey(key: string): string {
    return `lock:${key}`;
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ===== Singleton Management =====

let distributedLockInstance: DistributedLock | null = null;

/**
 * Initialize the DistributedLock singleton
 *
 * Must be called during server startup after Redis is initialized.
 *
 * @param redis - Redis client instance
 */
export function initDistributedLock(redis: Redis): void {
  if (distributedLockInstance) {
    logger.warn('DistributedLock already initialized - skipping re-initialization');
    return;
  }

  distributedLockInstance = new DistributedLock({ redis });
  logger.info('DistributedLock singleton initialized');
}

/**
 * Get the DistributedLock singleton instance
 *
 * @returns DistributedLock instance
 * @throws Error if not initialized
 */
export function getDistributedLock(): DistributedLock {
  if (!distributedLockInstance) {
    throw new Error(
      'DistributedLock not initialized. Call initDistributedLock(redis) during server startup.'
    );
  }

  return distributedLockInstance;
}

/**
 * Check if DistributedLock singleton is initialized
 *
 * @returns true if initialized, false otherwise
 */
export function isDistributedLockInitialized(): boolean {
  return distributedLockInstance !== null;
}

/**
 * Reset the DistributedLock singleton (for testing only)
 *
 * @internal
 */
export function __resetDistributedLock(): void {
  distributedLockInstance = null;
  logger.debug('DistributedLock singleton reset (testing only)');
}
