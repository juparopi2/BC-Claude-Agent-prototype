/**
 * Redis Configuration with Profile System
 *
 * Provides configuration profiles for different Redis use cases:
 * - PRODUCTION: Standard production settings with retries
 * - TEST: Fast-fail settings for unit/integration tests
 * - BULLMQ: BullMQ-specific settings (maxRetriesPerRequest: null)
 *
 * This eliminates "Socket closed unexpectedly" errors by providing
 * appropriate retry strategies for each use case.
 *
 * @module infrastructure/redis/redis
 */

import Redis, { RedisOptions } from 'ioredis';
import { createChildLogger } from '@/shared/utils/logger';
import { Environment } from '@/infrastructure/config/EnvironmentFacade';
import { env } from '@/infrastructure/config/environment';

const logger = createChildLogger({ service: 'RedisConfig' });

/**
 * Redis configuration profile types
 */
export type RedisProfile = 'PRODUCTION' | 'TEST' | 'BULLMQ';

/**
 * Redis profile configurations
 *
 * Each profile defines specific retry strategies, timeouts, and connection
 * settings appropriate for different use cases.
 */
const REDIS_PROFILES: Record<RedisProfile, Partial<RedisOptions>> = {
  /**
   * PRODUCTION: Standard production settings
   * - Moderate retries with exponential backoff
   * - Reasonable timeouts for user-facing operations
   * - Offline queue enabled for resilience
   */
  PRODUCTION: {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000, // 10 seconds
    commandTimeout: 5000, // 5 seconds
    enableOfflineQueue: true,
    retryStrategy: (times: number) => {
      // Exponential backoff: 50ms, 100ms, 200ms, 400ms, max 2000ms
      const delay = Math.min(times * 50, 2000);
      logger.debug({ attempt: times, delayMs: delay }, 'Retrying Redis connection');
      return delay;
    },
    reconnectOnError: (err: Error) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        // Only reconnect when the error matches the target error
        logger.warn({ error: err.message }, 'Reconnecting due to READONLY error');
        return true;
      }
      return false;
    },
  },

  /**
   * TEST: Fast-fail settings for unit/integration tests
   * - Minimal retries for quick test execution
   * - Short timeouts to detect failures fast
   * - No offline queue to fail immediately
   */
  TEST: {
    maxRetriesPerRequest: 1, // Fast fail in tests
    connectTimeout: 2000, // 2 seconds
    commandTimeout: 1000, // 1 second
    enableOfflineQueue: false,
    retryStrategy: (times: number) => {
      // Single retry with 100ms delay
      if (times > 1) {
        logger.debug({ attempt: times }, 'Test Redis connection retry limit reached');
        return null;
      }
      logger.debug({ attempt: times }, 'Retrying test Redis connection');
      return 100;
    },
  },

  /**
   * BULLMQ: BullMQ-specific settings
   * - maxRetriesPerRequest: null (REQUIRED by BullMQ)
   * - Conservative backoff for job queue reliability
   * - Longer command timeout for job processing
   * - Offline queue enabled for job persistence
   */
  BULLMQ: {
    maxRetriesPerRequest: null, // Required by BullMQ - unlimited retries
    connectTimeout: 10000, // 10 seconds
    commandTimeout: 30000, // 30 seconds - longer for job processing
    enableOfflineQueue: true,
    retryStrategy: (times: number) => {
      // Conservative backoff for job queue: 100ms, 200ms, 300ms, max 5000ms
      const delay = Math.min(times * 100, 5000);
      logger.debug({ attempt: times, delayMs: delay }, 'Retrying BullMQ Redis connection');
      return delay;
    },
    reconnectOnError: (err: Error) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        logger.warn({ error: err.message }, 'Reconnecting BullMQ due to READONLY error');
        return true;
      }
      return false;
    },
  },
};

/**
 * Get appropriate Redis profile for current environment
 *
 * Automatically selects TEST profile in test/e2e environments,
 * otherwise defaults to PRODUCTION.
 *
 * @returns Default profile based on environment
 */
export function getDefaultProfile(): RedisProfile {
  if (Environment.isTest() || Environment.isE2E()) {
    return 'TEST';
  }
  return 'PRODUCTION';
}

/**
 * Create Redis client with specified profile
 *
 * Factory function that creates ioredis client with profile-specific
 * configuration merged with base connection settings.
 *
 * **Profile Selection:**
 * - PRODUCTION: General use (sessions, cache, pub/sub)
 * - TEST: Unit/integration testing (fast-fail)
 * - BULLMQ: MessageQueue service (unlimited retries)
 *
 * **Connection Logic:**
 * - Detects local vs Azure Redis via hostname
 * - Uses TLS for Azure Redis (port 6380)
 * - Skips password for local Redis (localhost/127.0.0.1)
 *
 * @param profile - Configuration profile to use
 * @returns Configured Redis client instance
 *
 * @example
 * // General use (auto-detects environment)
 * const redis = createRedisClient();
 *
 * @example
 * // BullMQ-specific
 * const bullmqRedis = createRedisClient('BULLMQ');
 *
 * @example
 * // Test with fast-fail
 * const testRedis = createRedisClient('TEST');
 */
export function createRedisClient(profile: RedisProfile = getDefaultProfile()): Redis {
  // Read from process.env directly to support runtime overrides in tests
  const redisHost = process.env.REDIS_HOST || env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT
    ? parseInt(process.env.REDIS_PORT, 10)
    : env.REDIS_PORT;
  const redisPassword = process.env.REDIS_PASSWORD || env.REDIS_PASSWORD;

  // Validate required parameters
  if (!redisHost || !redisPort) {
    throw new Error(
      'Redis configuration is incomplete. Provide REDIS_HOST and REDIS_PORT.'
    );
  }

  // Detect local vs Azure Redis
  const isLocalRedis =
    redisHost.includes('localhost') || redisHost.includes('127.0.0.1');

  // Azure Redis requires password
  if (!isLocalRedis && !redisPassword) {
    throw new Error(
      'Redis password is required for non-local Redis instances (Azure Redis Cache).'
    );
  }

  // Base configuration
  const baseConfig: RedisOptions = {
    host: redisHost,
    port: redisPort,
    // Only include password if it's non-empty (empty string causes AUTH command which fails on Redis without auth)
    ...(redisPassword ? { password: redisPassword } : {}),
    lazyConnect: false, // Connect immediately
    // TLS for Azure Redis (port 6380)
    ...(redisPort === 6380 ? { tls: {} } : {}),
  };

  // Merge with profile configuration
  const profileConfig = REDIS_PROFILES[profile];
  const finalConfig: RedisOptions = {
    ...baseConfig,
    ...profileConfig,
  };

  // Log configuration
  logger.info(
    {
      profile,
      host: redisHost,
      port: redisPort,
      isLocal: isLocalRedis,
      tls: redisPort === 6380,
      maxRetriesPerRequest: finalConfig.maxRetriesPerRequest,
      connectTimeout: finalConfig.connectTimeout,
      commandTimeout: finalConfig.commandTimeout,
    },
    'Creating Redis client'
  );

  // Create client
  const client = new Redis(finalConfig);

  // Event handlers for debugging
  client.on('connect', () => {
    logger.info({ profile, host: redisHost, port: redisPort }, 'Redis client connected');
  });

  client.on('ready', () => {
    logger.info({ profile }, 'Redis client ready');
  });

  client.on('error', (err: Error) => {
    logger.error({ profile, error: err, errorMessage: err.message, stack: err.stack }, 'Redis client error');
  });

  client.on('close', () => {
    logger.warn({ profile }, 'Redis connection closed');
  });

  client.on('reconnecting', (timeMs: number) => {
    logger.info({ profile, delayMs: timeMs }, 'Redis client reconnecting');
  });

  client.on('end', () => {
    logger.warn({ profile }, 'Redis connection ended');
  });

  return client;
}

/**
 * Default Redis instance for general use
 *
 * Uses environment-based profile selection (TEST in test/e2e, PRODUCTION otherwise).
 * Suitable for sessions, caching, pub/sub, and general Redis operations.
 *
 * **Backward Compatibility:**
 * This export maintains compatibility with existing code that imports { redis }.
 */
let _defaultRedisClient: Redis | null = null;

/**
 * BullMQ-specific Redis instance (lazily initialized)
 */
let _bullmqRedisClient: Redis | null = null;

/**
 * Initialize default Redis client (for backward compatibility with old API)
 *
 * Legacy function that mimics the old initRedis() pattern.
 * Now internally uses the profile-based createRedisClient().
 *
 * @returns Promise that resolves to the Redis client
 *
 * @example
 * // Old pattern (still supported)
 * await initRedis();
 * const client = getRedis();
 */
export async function initRedis(): Promise<Redis> {
  if (_defaultRedisClient && _defaultRedisClient.status === 'ready') {
    logger.info('Redis client already initialized');
    return _defaultRedisClient;
  }

  _defaultRedisClient = createRedisClient(getDefaultProfile());

  // Wait for connection to be ready
  if (_defaultRedisClient.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      _defaultRedisClient!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      _defaultRedisClient!.once('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  return _defaultRedisClient;
}

/**
 * Get the default Redis client (for backward compatibility with old API)
 *
 * Legacy function that returns the singleton Redis instance.
 * Returns null if not initialized via initRedis().
 *
 * @returns Redis client or null if not initialized
 *
 * @example
 * // Old pattern (still supported)
 * const client = getRedis();
 * if (client) {
 *   await client.ping();
 * }
 */
export function getRedis(): Redis | null {
  return _defaultRedisClient;
}

/**
 * Get BullMQ-specific Redis client
 *
 * Lazily creates a BULLMQ profile client on first access.
 * This instance has maxRetriesPerRequest: null as required by BullMQ.
 *
 * @returns Redis client with BULLMQ profile
 *
 * @example
 * import { getRedisForBullMQ } from '@/infrastructure/redis/redis';
 * const redis = getRedisForBullMQ();
 * const queue = new Queue('my-queue', { connection: redis });
 */
export function getRedisForBullMQ(): Redis {
  if (!_bullmqRedisClient) {
    _bullmqRedisClient = createRedisClient('BULLMQ');
  }
  return _bullmqRedisClient;
}

/**
 * Singleton for lazy-initialized eager Redis client
 */
let _eagerRedisClient: Redis | null = null;

/**
 * Get eagerly-available Redis instance (lazy initialization)
 *
 * **New API:** Use this for direct access without initialization ceremony.
 * Automatically creates client with environment-based profile on first call.
 *
 * **Note:** Prefer initRedis()/getRedis() pattern in server.ts for
 * explicit initialization control. This function is for services that
 * need immediate Redis access.
 *
 * **Why lazy?** To prevent Redis client creation at module import time,
 * which would fail in test environments where .env is loaded later.
 *
 * @returns Redis client with default profile
 *
 * @example
 * import { getEagerRedis } from '@/infrastructure/redis/redis';
 * const redis = getEagerRedis();
 * await redis.ping();
 */
export function getEagerRedis(): Redis {
  if (!_eagerRedisClient) {
    _eagerRedisClient = createRedisClient(getDefaultProfile());
  }
  return _eagerRedisClient;
}

/**
 * Create test-specific Redis instance
 *
 * Factory for creating TEST profile Redis instances in tests.
 * Useful for test isolation and cleanup.
 *
 * @returns Redis client with TEST profile (fast-fail)
 *
 * @example
 * // In test setup
 * const testRedis = createTestRedis();
 * await testRedis.flushdb();
 * // ... run tests ...
 * await testRedis.quit();
 */
export function createTestRedis(): Redis {
  return createRedisClient('TEST');
}

/**
 * Gracefully close Redis connection (overloaded for backward compatibility)
 *
 * Supports two usage patterns:
 * 1. New API: closeRedis(client) - close specific client
 * 2. Old API: closeRedis() - close default singleton client
 *
 * @param client - Optional Redis client to close (uses default if not provided)
 *
 * @example
 * // Old API (backward compatible)
 * await closeRedis();
 *
 * @example
 * // New API (explicit client)
 * const client = createRedisClient('TEST');
 * await closeRedis(client);
 */
export async function closeRedis(client?: Redis): Promise<void> {
  const targetClient = client || _defaultRedisClient;

  if (!targetClient) {
    logger.warn('No Redis client to close');
    return;
  }

  try {
    if (targetClient.status === 'ready' || targetClient.status === 'connect') {
      await targetClient.quit();
      logger.info('Redis connection closed gracefully');

      // Clear singleton reference if closing default client
      if (targetClient === _defaultRedisClient) {
        _defaultRedisClient = null;
      }
      if (targetClient === _bullmqRedisClient) {
        _bullmqRedisClient = null;
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to close Redis connection gracefully');
    // Force disconnect if quit fails
    targetClient.disconnect();
  }
}

/**
 * Check Redis health (overloaded for backward compatibility)
 *
 * Supports two usage patterns:
 * 1. New API: checkRedisHealth(client) - check specific client
 * 2. Old API: checkRedisHealth() - check default singleton client
 *
 * @param client - Optional Redis client to check (uses default if not provided)
 * @returns true if Redis is healthy, false otherwise
 *
 * @example
 * // Old API (backward compatible)
 * const healthy = await checkRedisHealth();
 *
 * @example
 * // New API (explicit client)
 * const client = createRedisClient('TEST');
 * const healthy = await checkRedisHealth(client);
 */
export async function checkRedisHealth(client?: Redis): Promise<boolean> {
  const targetClient = client || _defaultRedisClient;

  if (!targetClient) {
    logger.warn('No Redis client to check health');
    return false;
  }

  try {
    if (targetClient.status !== 'ready') {
      return false;
    }

    const response = await targetClient.ping();
    return response === 'PONG';
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return false;
  }
}

/**
 * Session storage helpers
 * (Backward compatibility with old redis.ts API)
 */

/**
 * Store session data in Redis
 *
 * @param sessionId - Session ID
 * @param data - Session data
 * @param expirySeconds - Expiry time in seconds (default: 30 minutes)
 */
export async function setSession(
  sessionId: string,
  data: Record<string, unknown>,
  expirySeconds: number = 1800
): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const key = `session:${sessionId}`;
  await client.setex(key, expirySeconds, JSON.stringify(data));
}

/**
 * Get session data from Redis
 *
 * @param sessionId - Session ID
 * @returns Session data or null if not found
 */
export async function getSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const key = `session:${sessionId}`;
  const data = await client.get(key);

  return data ? JSON.parse(data) : null;
}

/**
 * Delete session data from Redis
 *
 * @param sessionId - Session ID
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const key = `session:${sessionId}`;
  await client.del(key);
}

/**
 * Cache helpers
 * (Backward compatibility with old redis.ts API)
 */

/**
 * Set a value in cache
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param expirySeconds - Expiry time in seconds (optional)
 */
export async function setCache(key: string, value: unknown, expirySeconds?: number): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const serialized = JSON.stringify(value);

  if (expirySeconds) {
    await client.setex(key, expirySeconds, serialized);
  } else {
    await client.set(key, serialized);
  }
}

/**
 * Get a value from cache
 *
 * @param key - Cache key
 * @returns Cached value or null if not found
 */
export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const data = await client.get(key);

  return data ? JSON.parse(data) : null;
}

/**
 * Delete a value from cache
 *
 * @param key - Cache key
 */
export async function deleteCache(key: string): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  await client.del(key);
}

/**
 * Delete multiple keys matching a pattern
 *
 * @param pattern - Key pattern (e.g., "session:*")
 * @returns Number of keys deleted
 */
export async function deleteCachePattern(pattern: string): Promise<number> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }

  const keys = await client.keys(pattern);

  if (keys.length === 0) {
    return 0;
  }

  await client.del(...keys);
  return keys.length;
}

/**
 * Reset all Redis singletons for testing
 *
 * Closes and resets all ioredis singleton instances:
 * - Default Redis client
 * - BullMQ Redis client
 * - Eager Redis client
 *
 * **INTERNAL USE ONLY:** This function is intended for integration tests
 * to prevent connection leaks between test files.
 *
 * @internal
 *
 * @example
 * // In test afterAll hook
 * afterAll(async () => {
 *   await __resetAllRedis();
 * });
 */
export async function __resetAllRedis(): Promise<void> {
  const errors: Error[] = [];

  // Close default client
  if (_defaultRedisClient) {
    try {
      if (_defaultRedisClient.status === 'ready' || _defaultRedisClient.status === 'connect') {
        await _defaultRedisClient.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
    _defaultRedisClient = null;
  }

  // Close BullMQ client
  if (_bullmqRedisClient) {
    try {
      if (_bullmqRedisClient.status === 'ready' || _bullmqRedisClient.status === 'connect') {
        await _bullmqRedisClient.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
    _bullmqRedisClient = null;
  }

  // Close eager client
  if (_eagerRedisClient) {
    try {
      if (_eagerRedisClient.status === 'ready' || _eagerRedisClient.status === 'connect') {
        await _eagerRedisClient.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
    _eagerRedisClient = null;
  }

  if (errors.length > 0) {
    logger.warn({ errorCount: errors.length }, '__resetAllRedis completed with errors');
  } else {
    logger.debug('__resetAllRedis completed successfully');
  }
}
