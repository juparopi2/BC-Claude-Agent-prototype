/**
 * Tool Use Tracker Service
 *
 * Manages mapping between SDK tool use IDs and database GUIDs using Redis.
 * Tracks tool executions across the SDK → Database boundary.
 *
 * Architecture (Production-Safe):
 * - SDK generates tool use ID (string)
 * - We generate DB GUID (UNIQUEIDENTIFIER)
 * - Store mapping in Redis with TTL (5 minutes)
 * - Uses SCAN for key iteration (O(1) per call, non-blocking)
 * - Automatic cleanup after tool result persistence
 * - Supports horizontal scaling with shared Redis
 *
 * @module services/cache/ToolUseTracker
 */

import Redis from 'ioredis';
import { env } from '@/config';
import { logger } from '@/utils/logger';
import { randomUUID } from 'crypto';

/**
 * Tool Use Mapping
 */
export interface ToolUseMapping {
  sdkToolUseId: string;
  dbGuid: string;
  toolName: string;
  sessionId: string;
  createdAt: Date;
}

/**
 * Tool Use Tracker Class
 *
 * Uses Redis to store temporary mappings with automatic expiration.
 */
export class ToolUseTracker {
  private static instance: ToolUseTracker | null = null;
  private redis: Redis;
  private readonly TTL_SECONDS = 300; // 5 minutes
  private readonly KEY_PREFIX = 'tooluse:mapping:';

  private constructor() {
    // Initialize Redis connection
    this.redis = new Redis({
      host: env.REDIS_HOST || 'localhost',
      port: env.REDIS_PORT || 6379,
      password: env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.redis.on('error', (err) => {
      logger.error('Redis error in ToolUseTracker', { error: err });
    });

    this.redis.on('connect', () => {
      logger.info('ToolUseTracker connected to Redis');
    });

    logger.info('ToolUseTracker initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ToolUseTracker {
    if (!ToolUseTracker.instance) {
      ToolUseTracker.instance = new ToolUseTracker();
    }
    return ToolUseTracker.instance;
  }

  /**
   * Map Tool Use ID
   *
   * Creates a new mapping between SDK tool use ID and DB GUID.
   * Returns the DB GUID to use for database operations.
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - Tool use ID from SDK
   * @param toolName - Name of the tool
   * @returns DB GUID for this tool use
   */
  public async mapToolUseId(
    sessionId: string,
    sdkToolUseId: string,
    toolName: string
  ): Promise<string> {
    try {
      const dbGuid = randomUUID();
      const key = this.getRedisKey(sessionId, sdkToolUseId);

      const mapping: ToolUseMapping = {
        sdkToolUseId,
        dbGuid,
        toolName,
        sessionId,
        createdAt: new Date(),
      };

      // Store mapping in Redis with TTL
      await this.redis.setex(key, this.TTL_SECONDS, JSON.stringify(mapping));

      logger.debug('Tool use ID mapped', {
        sessionId,
        sdkToolUseId,
        dbGuid,
        toolName,
      });

      return dbGuid;
    } catch (error) {
      logger.error('Failed to map tool use ID', {
        error,
        sessionId,
        sdkToolUseId,
        toolName,
      });
      throw error;
    }
  }

  /**
   * Get DB GUID from SDK Tool Use ID
   *
   * Retrieves the DB GUID associated with an SDK tool use ID.
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - Tool use ID from SDK
   * @returns DB GUID or null if not found
   */
  public async getDbGuid(
    sessionId: string,
    sdkToolUseId: string
  ): Promise<string | null> {
    try {
      const key = this.getRedisKey(sessionId, sdkToolUseId);
      const data = await this.redis.get(key);

      if (!data) {
        logger.warn('Tool use ID mapping not found', { sessionId, sdkToolUseId });
        return null;
      }

      const mapping = JSON.parse(data) as ToolUseMapping;
      return mapping.dbGuid;
    } catch (error) {
      logger.error('Failed to get DB GUID', {
        error,
        sessionId,
        sdkToolUseId,
      });
      return null;
    }
  }

  /**
   * Get Full Mapping
   *
   * Retrieves complete mapping information for a tool use.
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - Tool use ID from SDK
   * @returns Tool use mapping or null if not found
   */
  public async getMapping(
    sessionId: string,
    sdkToolUseId: string
  ): Promise<ToolUseMapping | null> {
    try {
      const key = this.getRedisKey(sessionId, sdkToolUseId);
      const data = await this.redis.get(key);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as ToolUseMapping;
    } catch (error) {
      logger.error('Failed to get tool use mapping', {
        error,
        sessionId,
        sdkToolUseId,
      });
      return null;
    }
  }

  /**
   * Delete Mapping (alias for cleanupMapping)
   *
   * Removes a mapping from Redis (useful for cleanup).
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - Tool use ID from SDK
   */
  public async deleteMapping(
    sessionId: string,
    sdkToolUseId: string
  ): Promise<void> {
    return this.cleanupMapping(sessionId, sdkToolUseId);
  }

  /**
   * Cleanup Mapping
   *
   * Removes a specific mapping from Redis after tool result is stored.
   * Called by ChatMessageHandler after updating tool result in DB.
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - Tool use ID from SDK
   */
  public async cleanupMapping(
    sessionId: string,
    sdkToolUseId: string
  ): Promise<void> {
    try {
      const key = this.getRedisKey(sessionId, sdkToolUseId);
      await this.redis.del(key);

      logger.debug('Tool use mapping cleaned up', { sessionId, sdkToolUseId });
    } catch (error) {
      logger.error('Failed to cleanup tool use mapping', {
        error,
        sessionId,
        sdkToolUseId,
      });
    }
  }

  /**
   * Get All Mappings for Session
   *
   * Returns all tool use mappings for a session using SCAN (O(1) per call).
   * Useful for debugging or cleanup.
   *
   * @param sessionId - Session ID
   * @returns Array of mappings
   */
  public async getAllMappingsForSession(
    sessionId: string
  ): Promise<ToolUseMapping[]> {
    try {
      const pattern = `${this.KEY_PREFIX}${sessionId}:*`;
      const mappings: ToolUseMapping[] = [];

      // Use SCAN instead of KEYS for production safety (O(1) per iteration)
      const stream = this.redis.scanStream({
        match: pattern,
        count: 100, // Process 100 keys per iteration
      });

      for await (const keys of stream) {
        for (const key of keys) {
          const data = await this.redis.get(key);
          if (data) {
            mappings.push(JSON.parse(data) as ToolUseMapping);
          }
        }
      }

      return mappings;
    } catch (error) {
      logger.error('Failed to get all mappings for session', {
        error,
        sessionId,
      });
      return [];
    }
  }

  /**
   * Cleanup Session Mappings
   *
   * Deletes all mappings for a session using SCAN (O(1) per iteration).
   * Useful when a session ends or for cleanup.
   *
   * @param sessionId - Session ID
   * @returns Number of mappings deleted
   */
  public async cleanupSession(sessionId: string): Promise<number> {
    try {
      const pattern = `${this.KEY_PREFIX}${sessionId}:*`;
      const keysToDelete: string[] = [];

      // Use SCAN instead of KEYS for production safety
      const stream = this.redis.scanStream({
        match: pattern,
        count: 100, // Process 100 keys per iteration
      });

      for await (const keys of stream) {
        keysToDelete.push(...keys);
      }

      if (keysToDelete.length === 0) {
        return 0;
      }

      // Delete in batch
      await this.redis.del(...keysToDelete);

      logger.info('Session mappings cleaned up', {
        sessionId,
        deletedCount: keysToDelete.length,
      });

      return keysToDelete.length;
    } catch (error) {
      logger.error('Failed to cleanup session mappings', {
        error,
        sessionId,
      });
      return 0;
    }
  }

  /**
   * Get Redis Key
   *
   * Generates Redis key for a tool use mapping.
   *
   * Format: tooluse:mapping:{sessionId}:{sdkToolUseId}
   *
   * @param sessionId - Session ID
   * @param sdkToolUseId - SDK tool use ID
   * @returns Redis key
   */
  private getRedisKey(sessionId: string, sdkToolUseId: string): string {
    return `${this.KEY_PREFIX}${sessionId}:${sdkToolUseId}`;
  }

  /**
   * Health Check
   *
   * Verifies Redis connection is working.
   *
   * @returns True if healthy, false otherwise
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const testKey = 'tooluse:healthcheck';
      await this.redis.setex(testKey, 10, 'ok');
      const value = await this.redis.get(testKey);
      await this.redis.del(testKey);
      return value === 'ok';
    } catch (error) {
      logger.error('ToolUseTracker health check failed', { error });
      return false;
    }
  }

  /**
   * Close Redis Connection
   *
   * Gracefully closes the Redis connection.
   * Should be called on application shutdown.
   */
  public async close(): Promise<void> {
    try {
      await this.redis.quit();
      logger.info('ToolUseTracker Redis connection closed');
    } catch (error) {
      logger.error('Failed to close ToolUseTracker Redis connection', { error });
    }
  }
}

/**
 * Get ToolUseTracker singleton instance
 */
export function getToolUseTracker(): ToolUseTracker {
  return ToolUseTracker.getInstance();
}
