/**
 * Redis Client Configuration (redis package)
 *
 * Provides Redis client using the official 'redis' package (v5.x)
 * Compatible with connect-redis@7 for session storage.
 *
 * Separate from ioredis configuration (redis.ts) which is used by BullMQ.
 *
 * @module config/redis-client
 */

import { createClient, RedisClientType } from 'redis';
import { createChildLogger } from '@/utils/logger';
import { Environment } from '@config/EnvironmentFacade';
import { env } from './environment';

const logger = createChildLogger({ service: 'RedisClient' });

/**
 * Redis client profiles for different use cases
 */
export type RedisClientProfile = 'SESSION' | 'CACHE' | 'TEST';

declare global {
  var __redisPackageClient: RedisClientType | null | undefined;
  var __redisPackageTestClient: RedisClientType | null | undefined;
}

function _getRedisClientInternal(): RedisClientType | null {
  return globalThis.__redisPackageClient ?? null;
}

function _setRedisClientInternal(client: RedisClientType | null): void {
  globalThis.__redisPackageClient = client;
}

function _getTestRedisClientInternal(): RedisClientType | null {
  return globalThis.__redisPackageTestClient ?? null;
}

function _setTestRedisClientInternal(client: RedisClientType | null): void {
  globalThis.__redisPackageTestClient = client;
}

/**
 * Create Redis client using official 'redis' package
 *
 * This is compatible with connect-redis@7 for session storage.
 * BullMQ continues to use ioredis (see config/redis.ts).
 *
 * @param profile - Configuration profile
 * @returns Configured Redis client
 */
export function createRedisClient(profile: RedisClientProfile = 'SESSION'): RedisClientType {
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

  // Profile-specific configuration
  const profileConfig = {
    SESSION: {
      name: 'session-client',
    },
    CACHE: {
      name: 'cache-client',
    },
    TEST: {
      name: 'test-client',
    },
  };

  // Base configuration
  // For Azure Redis with TLS (port 6380), use separate socket config
  const socketConfig = redisPort === 6380
    ? {
        host: redisHost,
        port: redisPort,
        tls: true as const, // Explicitly type as literal true for RedisTlsOptions
      }
    : {
        host: redisHost,
        port: redisPort,
      };

  const config = {
    socket: socketConfig,
    // Only include password if it's non-empty
    ...(redisPassword ? { password: redisPassword } : {}),
    // Use profile name for client identification
    name: profileConfig[profile].name,
  };

  // Log configuration
  logger.info(
    {
      profile,
      host: redisHost,
      port: redisPort,
      isLocal: isLocalRedis,
      tls: redisPort === 6380,
      hasPassword: !!redisPassword,
    },
    'Creating Redis client (redis package)'
  );

  // Create client
  const client = createClient(config);

  // Event handlers for debugging
  client.on('connect', () => {
    logger.info({ profile, host: redisHost, port: redisPort }, 'Redis client connecting');
  });

  client.on('ready', () => {
    logger.info({ profile }, 'Redis client ready');
  });

  client.on('error', (err: Error) => {
    logger.error({ profile, error: err.message }, 'Redis client error');
  });

  client.on('end', () => {
    logger.warn({ profile }, 'Redis client connection ended');
  });

  client.on('reconnecting', () => {
    logger.info({ profile }, 'Redis client reconnecting');
  });

  return client as RedisClientType;
}

/**
 * Get default Redis client for sessions (lazy initialization)
 *
 * @returns Redis client instance
 */
export function getRedisClient(): RedisClientType | null {
  return _getRedisClientInternal();
}

/**
 * Initialize default Redis client
 *
 * @returns Promise that resolves to the Redis client
 */
export async function initRedisClient(): Promise<RedisClientType> {
  const existing = _getRedisClientInternal();
  if (existing && existing.isOpen) {
    logger.info('Redis client already initialized');
    return existing;
  }

  const profile = Environment.isTest() ? 'TEST' : 'SESSION';
  const client = createRedisClient(profile);

  await client.connect();
  _setRedisClientInternal(client);

  return client;
}

/**
 * Get test Redis client (separate instance for tests)
 *
 * @returns Test Redis client
 */
export function getTestRedisClient(): RedisClientType | null {
  return _getTestRedisClientInternal();
}

/**
 * Initialize test Redis client
 *
 * @returns Promise that resolves to test Redis client
 */
export async function initTestRedisClient(): Promise<RedisClientType> {
  const existing = _getTestRedisClientInternal();
  if (existing && existing.isOpen) {
    logger.info('Test Redis client already initialized');
    return existing;
  }

  const client = createRedisClient('TEST');
  await client.connect();
  _setTestRedisClientInternal(client);

  return client;
}

/**
 * Close Redis client connection
 *
 * @param client - Optional specific client to close (uses default if not provided)
 */
export async function closeRedisClient(client?: RedisClientType): Promise<void> {
  const targetClient = client || _getRedisClientInternal();

  if (!targetClient) {
    logger.warn('No Redis client to close');
    return;
  }

  try {
    if (targetClient.isOpen) {
      await targetClient.quit();
      logger.info('Redis client connection closed gracefully');

      if (targetClient === _getRedisClientInternal()) {
        _setRedisClientInternal(null);
      }
      if (targetClient === _getTestRedisClientInternal()) {
        _setTestRedisClientInternal(null);
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to close Redis client gracefully');
    await targetClient.disconnect();
  }
}

/**
 * Check Redis client health
 *
 * @param client - Optional specific client to check (uses default if not provided)
 * @returns true if Redis is healthy, false otherwise
 */
export async function checkRedisClientHealth(client?: RedisClientType): Promise<boolean> {
  const targetClient = client || _getRedisClientInternal();

  if (!targetClient) {
    logger.warn('No Redis client to check health');
    return false;
  }

  try {
    if (!targetClient.isOpen) {
      return false;
    }

    const response = await targetClient.ping();
    return response === 'PONG';
  } catch (error) {
    logger.error({ error }, 'Redis client health check failed');
    return false;
  }
}
