/**
 * Upload Session Store (Redis Implementation)
 *
 * Stores upload session state in Redis with automatic TTL expiration.
 * Uses singleton pattern for consistent access across the application.
 *
 * Redis Keys:
 * - `upload-session:{sessionId}` - Session JSON data
 * - `upload-session:user:{userId}:active` - User's active session ID
 *
 * @module domains/files/upload-session
 */

import { randomUUID } from 'crypto';
import type { RedisClientType } from 'redis';
import { createChildLogger } from '@/shared/utils/logger';
import { getRedisClient } from '@/infrastructure/redis/redis-client';
import { FOLDER_UPLOAD_CONFIG } from '@bc-agent/shared';
import type { UploadSession, FolderBatch } from '@bc-agent/shared';
import type { Logger } from 'pino';
import type {
  IUploadSessionStore,
  CreateSessionOptions,
  FolderBatchUpdate,
  SessionUpdate,
} from './IUploadSessionStore';

/**
 * Redis key prefixes
 */
const KEY_PREFIX = {
  SESSION: 'upload-session:',
  USER_SESSIONS: 'upload-session:user:',
} as const;

/**
 * Build Redis key for session
 */
function sessionKey(sessionId: string): string {
  return `${KEY_PREFIX.SESSION}${sessionId}`;
}

/**
 * Build Redis key for user's sessions SET (multi-session support)
 */
function userSessionsKey(userId: string): string {
  return `${KEY_PREFIX.USER_SESSIONS}${userId}:sessions`;
}

/**
 * Dependencies for UploadSessionStore (DI support for testing)
 */
export interface UploadSessionStoreDependencies {
  logger?: Logger;
  redis?: RedisClientType;
}

/**
 * UploadSessionStore implementation using Redis
 */
export class UploadSessionStore implements IUploadSessionStore {
  private static instance: UploadSessionStore | null = null;

  private readonly log: Logger;
  private readonly getRedis: () => RedisClientType | null;

  private constructor(deps?: UploadSessionStoreDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'UploadSessionStore' });

    // Allow injecting Redis client for testing
    if (deps?.redis) {
      const injectedRedis = deps.redis;
      this.getRedis = () => injectedRedis;
    } else {
      this.getRedis = getRedisClient;
    }

    this.log.info('UploadSessionStore initialized');
  }

  public static getInstance(deps?: UploadSessionStoreDependencies): UploadSessionStore {
    if (!UploadSessionStore.instance) {
      UploadSessionStore.instance = new UploadSessionStore(deps);
    }
    return UploadSessionStore.instance;
  }

  public static resetInstance(): void {
    UploadSessionStore.instance = null;
  }

  /**
   * Get Redis client with error handling
   */
  private requireRedis(): RedisClientType {
    const redis = this.getRedis();
    if (!redis) {
      throw new Error('Redis client not initialized');
    }
    return redis;
  }

  /**
   * Create a new upload session
   */
  async create(options: CreateSessionOptions): Promise<UploadSession> {
    const redis = this.requireRedis();
    const { userId, folderBatches, ttlMs = FOLDER_UPLOAD_CONFIG.SESSION_TTL_MS } = options;

    const now = Date.now();
    const sessionId = randomUUID().toUpperCase();
    const expiresAt = now + ttlMs;

    const session: UploadSession = {
      id: sessionId,
      userId,
      totalFolders: folderBatches.length,
      currentFolderIndex: -1, // Not started
      completedFolders: 0,
      failedFolders: 0,
      status: 'initializing',
      folderBatches,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    // Store session
    const sKey = sessionKey(sessionId);
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    await redis.setEx(sKey, ttlSeconds, JSON.stringify(session));

    // Add session to user's sessions SET (multi-session support)
    const uKey = userSessionsKey(userId);
    await redis.sAdd(uKey, sessionId);
    // Extend SET TTL to match session TTL (will be extended on each session create/update)
    await redis.expire(uKey, ttlSeconds);

    this.log.info(
      { sessionId, userId, totalFolders: folderBatches.length, ttlSeconds },
      'Created upload session'
    );

    return session;
  }

  /**
   * Get session by ID
   */
  async get(sessionId: string): Promise<UploadSession | null> {
    const redis = this.requireRedis();
    const sKey = sessionKey(sessionId);

    const data = await redis.get(sKey);
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as UploadSession;
    } catch (error) {
      this.log.error(
        { sessionId, error: error instanceof Error ? error.message : String(error) },
        'Failed to parse session data'
      );
      return null;
    }
  }

  /**
   * Update session fields
   */
  async update(sessionId: string, updates: SessionUpdate): Promise<void> {
    const redis = this.requireRedis();
    const session = await this.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Apply updates
    const updatedSession: UploadSession = {
      ...session,
      ...updates,
      updatedAt: updates.updatedAt ?? Date.now(),
    };

    // Save back to Redis with remaining TTL
    const sKey = sessionKey(sessionId);
    const remainingTtl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));

    await redis.setEx(sKey, remainingTtl, JSON.stringify(updatedSession));

    this.log.debug({ sessionId, updates }, 'Updated session');
  }

  /**
   * Update a specific folder batch within a session
   */
  async updateBatch(sessionId: string, tempId: string, updates: FolderBatchUpdate): Promise<void> {
    const redis = this.requireRedis();
    const session = await this.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Find the batch
    const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
    if (batchIndex === -1) {
      throw new Error(`Folder batch not found: ${tempId} in session ${sessionId}`);
    }

    // Update the batch
    const updatedBatch: FolderBatch = {
      ...session.folderBatches[batchIndex]!,
      ...updates,
    };

    session.folderBatches[batchIndex] = updatedBatch;
    session.updatedAt = Date.now();

    // Save back to Redis
    const sKey = sessionKey(sessionId);
    const remainingTtl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));

    await redis.setEx(sKey, remainingTtl, JSON.stringify(session));

    this.log.debug({ sessionId, tempId, updates }, 'Updated folder batch');
  }

  /**
   * Get all active sessions for a user (multi-session support)
   *
   * Filters out expired or non-active sessions and cleans up stale references.
   */
  async getActiveSessions(userId: string): Promise<UploadSession[]> {
    const redis = this.requireRedis();
    const uKey = userSessionsKey(userId);

    const sessionIds = await redis.sMembers(uKey);
    if (!sessionIds || sessionIds.length === 0) {
      return [];
    }

    const sessions: UploadSession[] = [];
    const staleIds: string[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (!session) {
        // Session expired or doesn't exist, mark for cleanup
        staleIds.push(sessionId);
      } else if (session.status === 'active' || session.status === 'initializing') {
        sessions.push(session);
      } else {
        // Session completed/failed/expired, mark for cleanup
        staleIds.push(sessionId);
      }
    }

    // Clean up stale session references
    if (staleIds.length > 0) {
      await redis.sRem(uKey, staleIds);
      this.log.debug(
        { userId, staleIds },
        'Cleaned up stale session references'
      );
    }

    return sessions;
  }

  /**
   * Get active session for a user (legacy compatibility - returns first active)
   *
   * @deprecated Use getActiveSessions() for multi-session support
   */
  async getActiveSession(userId: string): Promise<UploadSession | null> {
    const sessions = await this.getActiveSessions(userId);
    return sessions.length > 0 ? sessions[0]! : null;
  }

  /**
   * Get count of active sessions for a user
   */
  async getActiveSessionCount(userId: string): Promise<number> {
    const sessions = await this.getActiveSessions(userId);
    return sessions.length;
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    const redis = this.requireRedis();

    // Get session to find userId
    const session = await this.get(sessionId);

    // Delete session key
    const sKey = sessionKey(sessionId);
    await redis.del(sKey);

    // Remove session from user's sessions SET
    if (session) {
      const uKey = userSessionsKey(session.userId);
      await redis.sRem(uKey, sessionId);
    }

    this.log.info({ sessionId }, 'Deleted upload session');
  }

  /**
   * Extend session TTL (heartbeat)
   */
  async extendTTL(sessionId: string, ttlMs: number = FOLDER_UPLOAD_CONFIG.SESSION_TTL_MS): Promise<void> {
    const redis = this.requireRedis();
    const session = await this.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    const newExpiresAt = now + ttlMs;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    // Update expiration in session data
    const updatedSession: UploadSession = {
      ...session,
      expiresAt: newExpiresAt,
      updatedAt: now,
    };

    // Save with new TTL
    const sKey = sessionKey(sessionId);
    await redis.setEx(sKey, ttlSeconds, JSON.stringify(updatedSession));

    // Also extend user sessions SET TTL (ensures SET persists while sessions are active)
    const uKey = userSessionsKey(session.userId);
    await redis.expire(uKey, ttlSeconds);

    this.log.debug({ sessionId, ttlSeconds }, 'Extended session TTL');
  }

  /**
   * Check if session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    const redis = this.requireRedis();
    const sKey = sessionKey(sessionId);
    const exists = await redis.exists(sKey);
    return exists === 1;
  }
}

// ===== Convenience Getters =====

/**
 * Get the singleton UploadSessionStore instance
 */
export function getUploadSessionStore(deps?: UploadSessionStoreDependencies): UploadSessionStore {
  return UploadSessionStore.getInstance(deps);
}

/**
 * Reset the singleton instance (for testing)
 */
export function __resetUploadSessionStore(): void {
  UploadSessionStore.resetInstance();
}
