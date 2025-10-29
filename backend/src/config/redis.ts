/**
 * Redis Configuration
 *
 * Azure Redis Cache connection and client management.
 * Used for session storage, caching, and real-time features.
 *
 * @module config/redis
 */

import { createClient } from 'redis';
import { env, isProd } from './environment';

/**
 * Type definitions using ReturnType to avoid generic conflicts
 */
type RedisClientType = ReturnType<typeof createClient>;
type RedisClientOptions = Parameters<typeof createClient>[0];

/**
 * Redis client instance
 */
let redisClient: RedisClientType | null = null;

/**
 * Get Redis configuration
 *
 * @returns Redis client options
 */
function getRedisConfig(): RedisClientOptions {
  // If connection string is provided, use it
  if (env.REDIS_CONNECTION_STRING) {
    return {
      url: env.REDIS_CONNECTION_STRING,
    };
  }

  // Otherwise, use individual parameters
  if (!env.REDIS_HOST || !env.REDIS_PORT || !env.REDIS_PASSWORD) {
    throw new Error('Redis configuration is incomplete. Provide either REDIS_CONNECTION_STRING or REDIS_HOST, REDIS_PORT, and REDIS_PASSWORD.');
  }

  // Azure Redis requires SSL
  const protocol = isProd ? 'rediss' : 'redis';
  const url = `${protocol}://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}`;

  // In redis v5.9.0, tls must be exactly true, not boolean
  if (isProd) {
    return {
      url,
      socket: {
        tls: true,
        rejectUnauthorized: true,
      },
    };
  }

  return {
    url,
  };
}

/**
 * Initialize Redis client
 *
 * @returns Promise that resolves to the Redis client
 */
export async function initRedis(): Promise<RedisClientType> {
  try {
    if (redisClient && redisClient.isOpen) {
      console.log('✅ Redis client already initialized');
      return redisClient;
    }

    console.log('🔌 Connecting to Azure Redis Cache...');

    const config = getRedisConfig();
    const client = createClient(config);

    // Handle Redis errors
    client.on('error', (err: Error) => {
      console.error('❌ Redis client error:', err);
    });

    client.on('connect', () => {
      console.log('✅ Redis client connected');
    });

    client.on('reconnecting', () => {
      console.log('🔄 Redis client reconnecting...');
    });

    client.on('ready', () => {
      console.log('✅ Redis client ready');
    });

    await client.connect();

    console.log('✅ Connected to Azure Redis Cache');

    redisClient = client;
    return client;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    throw error;
  }
}

/**
 * Get the Redis client
 *
 * @returns Redis client or null if not initialized
 */
export function getRedis(): RedisClientType | null {
  return redisClient;
}

/**
 * Close the Redis connection
 */
export async function closeRedis(): Promise<void> {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      redisClient = null;
      console.log('✅ Redis connection closed');
    }
  } catch (error) {
    console.error('❌ Failed to close Redis connection:', error);
    throw error;
  }
}

/**
 * Check if Redis is connected and healthy
 *
 * @returns true if Redis is healthy, false otherwise
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();

    if (!client || !client.isOpen) {
      return false;
    }

    // Try a simple PING command
    const response = await client.ping();
    return response === 'PONG';
  } catch (error) {
    console.error('❌ Redis health check failed:', error);
    return false;
  }
}

/**
 * Session storage helpers
 */

/**
 * Store session data in Redis
 *
 * @param sessionId - Session ID
 * @param data - Session data
 * @param expirySeconds - Expiry time in seconds
 */
export async function setSession(
  sessionId: string,
  data: Record<string, any>,
  expirySeconds: number = 1800 // 30 minutes default
): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized');
  }

  const key = `session:${sessionId}`;
  await client.setEx(key, expirySeconds, JSON.stringify(data));
}

/**
 * Get session data from Redis
 *
 * @param sessionId - Session ID
 * @returns Session data or null if not found
 */
export async function getSession(sessionId: string): Promise<Record<string, any> | null> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized');
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
    throw new Error('Redis client not initialized');
  }

  const key = `session:${sessionId}`;
  await client.del(key);
}

/**
 * Cache helpers
 */

/**
 * Set a value in cache
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param expirySeconds - Expiry time in seconds (optional)
 */
export async function setCache(key: string, value: any, expirySeconds?: number): Promise<void> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized');
  }

  const serialized = JSON.stringify(value);

  if (expirySeconds) {
    await client.setEx(key, expirySeconds, serialized);
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
export async function getCache<T = any>(key: string): Promise<T | null> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized');
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
    throw new Error('Redis client not initialized');
  }

  await client.del(key);
}

/**
 * Delete multiple keys matching a pattern
 *
 * @param pattern - Key pattern (e.g., "session:*")
 */
export async function deleteCachePattern(pattern: string): Promise<number> {
  const client = getRedis();

  if (!client) {
    throw new Error('Redis client not initialized');
  }

  const keys = await client.keys(pattern);

  if (keys.length === 0) {
    return 0;
  }

  await client.del(keys);
  return keys.length;
}
