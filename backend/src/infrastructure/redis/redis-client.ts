/**
 * Redis Client Configuration (redis package)
 *
 * Provides Redis client using the official 'redis' package (v5.x)
 * Compatible with connect-redis@7 for session storage.
 *
 * Separate from ioredis configuration (redis.ts) which is used by BullMQ.
 *
 * @module infrastructure/redis/redis-client
 */

import { createClient, RedisClientType } from 'redis';
import { createChildLogger } from '@/shared/utils/logger';
import { Environment } from '@/infrastructure/config/EnvironmentFacade';
import { env } from '@/infrastructure/config/environment';

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
 * Parse Azure Redis connection string into individual components
 *
 * Supports formats like:
 * - redis-name.redis.cache.windows.net:6380,password=xxx,ssl=True,abortConnect=False
 *
 * @param connectionString - Azure Redis connection string
 * @returns Parsed components { host, port, password }
 */
function parseAzureRedisConnectionString(connectionString: string): {
  host: string;
  port: number;
  password: string;
} {
  // Azure Redis connection string format:
  // redis-name.redis.cache.windows.net:6380,password=xxx,ssl=True,abortConnect=False
  const parts = connectionString.split(',');

  if (parts.length === 0) {
    throw new Error('Invalid Redis connection string format');
  }

  // First part is host:port
  const hostPort = parts[0].trim();
  const [host, portStr] = hostPort.includes(':')
    ? hostPort.split(':')
    : [hostPort, '6380']; // Default to SSL port

  const port = parseInt(portStr, 10);

  // Find password in remaining parts
  let password = '';
  for (const part of parts.slice(1)) {
    const trimmed = part.trim();
    if (trimmed.toLowerCase().startsWith('password=')) {
      password = trimmed.substring(9);
      break;
    }
  }

  if (!host) {
    throw new Error('Invalid Redis connection string: missing host');
  }

  console.log(`🔍 Parsed Redis connection string: host=${host}, port=${port}`);

  return { host, port, password };
}

/**
 * Get Redis configuration from connection string or individual params
 */
function getRedisConfig(): { host: string; port: number; password: string | undefined } {
  // First check for connection string
  const connectionString = process.env.REDIS_CONNECTION_STRING || env.REDIS_CONNECTION_STRING;

  if (connectionString) {
    console.log('🔍 Parsing REDIS_CONNECTION_STRING...');
    const parsed = parseAzureRedisConnectionString(connectionString);
    return {
      host: parsed.host,
      port: parsed.port,
      password: parsed.password || undefined,
    };
  }

  // Fall back to individual parameters
  const redisHost = process.env.REDIS_HOST || env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT
    ? parseInt(process.env.REDIS_PORT, 10)
    : env.REDIS_PORT;
  // Check if REDIS_PASSWORD was explicitly set (including empty string for no-auth Docker Redis)
  const redisPassword = process.env.REDIS_PASSWORD !== undefined
    ? process.env.REDIS_PASSWORD
    : env.REDIS_PASSWORD;

  if (!redisHost || !redisPort) {
    throw new Error(
      'Redis configuration is incomplete. Provide REDIS_CONNECTION_STRING or REDIS_HOST and REDIS_PORT.'
    );
  }

  return {
    host: redisHost,
    port: redisPort,
    password: redisPassword,
  };
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
  const { host: redisHost, port: redisPort, password: redisPassword } = getRedisConfig();

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
    logger.error({ profile, error: err, errorMessage: err.message, stack: err.stack }, 'Redis client error');
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

/**
 * Reset Redis client singletons for testing
 *
 * Closes and resets all 'redis' package singleton instances:
 * - Default session client
 * - Test client
 *
 * **INTERNAL USE ONLY:** This function is intended for integration tests
 * to prevent connection leaks between test files.
 *
 * @internal
 *
 * @example
 * // In test afterAll hook
 * afterAll(async () => {
 *   await __resetRedisClient();
 * });
 */
export async function __resetRedisClient(): Promise<void> {
  const errors: Error[] = [];

  // Close default client
  const defaultClient = _getRedisClientInternal();
  if (defaultClient) {
    try {
      if (defaultClient.isOpen) {
        await defaultClient.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
    _setRedisClientInternal(null);
  }

  // Close test client
  const testClient = _getTestRedisClientInternal();
  if (testClient) {
    try {
      if (testClient.isOpen) {
        await testClient.quit();
      }
    } catch (e) {
      errors.push(e as Error);
    }
    _setTestRedisClientInternal(null);
  }

  if (errors.length > 0) {
    logger.warn({ errorCount: errors.length }, '__resetRedisClient completed with errors');
  } else {
    logger.debug('__resetRedisClient completed successfully');
  }
}
