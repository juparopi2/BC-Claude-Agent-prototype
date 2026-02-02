/**
 * MSAL Redis Cache Plugin
 *
 * Implements ICachePlugin from @azure/msal-node to persist MSAL token cache
 * in Redis. This enables token refresh via acquireTokenSilent across multiple
 * container instances (horizontal scaling).
 *
 * MSAL does not expose refresh tokens by design for security reasons.
 * Instead, it manages them internally via the token cache.
 * This plugin allows the cache to persist in Redis so that:
 * 1. Tokens survive server restarts
 * 2. Multiple container instances share the same cache
 * 3. acquireTokenSilent can retrieve and refresh tokens without user interaction
 *
 * @see https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/caching.md
 */

import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { getEagerRedis } from '@/infrastructure/redis/redis';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'MsalRedisCachePlugin' });

/**
 * Redis key prefix for MSAL token cache
 */
const MSAL_CACHE_KEY_PREFIX = 'msal:token:';

/**
 * Cache TTL: 90 days (matches Microsoft refresh token lifetime)
 * Refresh tokens typically expire after 90 days of inactivity
 */
const MSAL_CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

/**
 * MSAL Redis Cache Plugin
 *
 * Persists MSAL token cache to Redis, keyed by a partition key (typically userId).
 * This allows multiple MSAL client instances to share the same token cache.
 *
 * @example
 * ```typescript
 * const cachePlugin = new MsalRedisCachePlugin(userId);
 * const msalClient = new ConfidentialClientApplication({
 *   auth: { ... },
 *   cache: { cachePlugin },
 * });
 * ```
 */
export class MsalRedisCachePlugin implements ICachePlugin {
  private partitionKey: string;

  /**
   * Create a new MsalRedisCachePlugin instance
   *
   * @param partitionKey - Unique key to partition the cache (typically userId)
   */
  constructor(partitionKey: string) {
    this.partitionKey = partitionKey;
  }

  /**
   * Get the Redis key for this partition
   */
  private getCacheKey(): string {
    return `${MSAL_CACHE_KEY_PREFIX}${this.partitionKey}`;
  }

  /**
   * Called by MSAL before accessing the cache
   *
   * Loads the serialized cache from Redis and deserializes it into MSAL's token cache.
   * If no cache exists in Redis, MSAL will start with an empty cache.
   *
   * @param cacheContext - MSAL cache context containing the token cache
   */
  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    const cacheKey = this.getCacheKey();

    try {
      const redis = getEagerRedis();
      const cacheData = await redis.get(cacheKey);

      if (cacheData) {
        cacheContext.tokenCache.deserialize(cacheData);
        logger.debug({ partitionKey: this.partitionKey }, 'Loaded MSAL cache from Redis');
      } else {
        logger.debug({ partitionKey: this.partitionKey }, 'No MSAL cache found in Redis (new user or expired)');
      }
    } catch (error) {
      // Log but don't throw - MSAL can work with empty cache
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      logger.warn({ partitionKey: this.partitionKey, error: errorInfo }, 'Failed to load MSAL cache from Redis');
    }
  }

  /**
   * Called by MSAL after accessing/modifying the cache
   *
   * If the cache has changed (e.g., new tokens acquired), serializes and saves
   * the cache to Redis with a TTL matching the refresh token lifetime.
   *
   * @param cacheContext - MSAL cache context containing the token cache
   */
  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (!cacheContext.cacheHasChanged) {
      return;
    }

    const cacheKey = this.getCacheKey();

    try {
      const redis = getEagerRedis();
      const serializedCache = cacheContext.tokenCache.serialize();

      await redis.setex(cacheKey, MSAL_CACHE_TTL_SECONDS, serializedCache);

      logger.debug({ partitionKey: this.partitionKey }, 'Saved MSAL cache to Redis');
    } catch (error) {
      // Log but don't throw - cache persistence failure shouldn't block authentication
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) };
      logger.error({ partitionKey: this.partitionKey, error: errorInfo }, 'Failed to save MSAL cache to Redis');
    }
  }
}

/**
 * Delete MSAL cache for a user
 *
 * Call this when a user logs out to clean up their cached tokens.
 *
 * @param partitionKey - The partition key (typically userId)
 */
export async function deleteMsalCache(partitionKey: string): Promise<void> {
  const cacheKey = `${MSAL_CACHE_KEY_PREFIX}${partitionKey}`;

  try {
    const redis = getEagerRedis();
    await redis.del(cacheKey);
    logger.info({ partitionKey }, 'Deleted MSAL cache from Redis');
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { value: String(error) };
    logger.error({ partitionKey, error: errorInfo }, 'Failed to delete MSAL cache from Redis');
  }
}

/**
 * Check if MSAL cache exists for a user
 *
 * @param partitionKey - The partition key (typically userId)
 * @returns true if cache exists, false otherwise
 */
export async function hasMsalCache(partitionKey: string): Promise<boolean> {
  const cacheKey = `${MSAL_CACHE_KEY_PREFIX}${partitionKey}`;

  try {
    const redis = getEagerRedis();
    const exists = await redis.exists(cacheKey);
    return exists === 1;
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { value: String(error) };
    logger.error({ partitionKey, error: errorInfo }, 'Failed to check MSAL cache existence');
    return false;
  }
}
