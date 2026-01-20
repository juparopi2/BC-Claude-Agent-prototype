/**
 * Business Central Token Manager
 *
 * Manages per-user Business Central API tokens with encryption.
 * Features:
 * - AES-256-GCM encryption for token storage
 * - Automatic token refresh when expired
 * - Database persistence
 * - Distributed lock for horizontal scaling (Phase 3, Task 3.2)
 */

import crypto from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { BCTokenData, TokenAcquisitionResult } from '../../types/microsoft.types';
import { MicrosoftOAuthService } from '@/domains/auth/oauth/MicrosoftOAuthService';
import { createChildLogger } from '@/shared/utils/logger';
import {
  DistributedLock,
  isDistributedLockInitialized,
  getDistributedLock,
} from '@/infrastructure/redis/DistributedLock';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/** Lock TTL for token refresh operations (30 seconds) */
const DISTRIBUTED_LOCK_TTL_MS = 30000;

/** Token refresh buffer - refresh 5 minutes before expiration */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Dependencies for BCTokenManager (DI support for testing)
 */
export interface BCTokenManagerDependencies {
  distributedLock?: DistributedLock;
}

export class BCTokenManager {
  private encryptionKey: Buffer;
  private oauthService: MicrosoftOAuthService;
  private logger = createChildLogger({ service: 'BCTokenManager' });

  // Map to store in-flight refresh promises for deduplication (same-instance)
  private refreshPromises = new Map<string, Promise<BCTokenData>>();

  // Optional distributed lock for cross-instance deduplication
  private distributedLock?: DistributedLock;

  constructor(
    encryptionKey: string,
    oauthService: MicrosoftOAuthService,
    deps?: BCTokenManagerDependencies
  ) {
    // Derive 32-byte key from base64 encryption key
    this.encryptionKey = Buffer.from(encryptionKey, 'base64');

    if (this.encryptionKey.length !== KEY_LENGTH) {
      throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
    }

    this.oauthService = oauthService;

    // Initialize distributed lock (from deps or lazy singleton)
    this.distributedLock = deps?.distributedLock;

    this.logger.info('BCTokenManager initialized', {
      hasDistributedLock: !!this.distributedLock,
    });
  }

  /**
   * Get the distributed lock instance (lazy initialization)
   *
   * Returns injected lock if provided, otherwise tries singleton.
   * Returns undefined if distributed lock is not available.
   */
  private getDistributedLockInstance(): DistributedLock | undefined {
    if (this.distributedLock) {
      return this.distributedLock;
    }

    // Try to get singleton if initialized
    if (isDistributedLockInitialized()) {
      return getDistributedLock();
    }

    return undefined;
  }

  /**
   * Encrypt a token using AES-256-GCM
   *
   * @param plaintext - Token to encrypt
   * @returns Encrypted token (format: iv:encryptedData:authTag, all base64)
   */
  private encryptToken(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      const authTag = cipher.getAuthTag();

      // Format: iv:encryptedData:authTag (all base64)
      return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
    } catch (error) {
      this.logger.error('Token encryption failed', { error });
      throw new Error('Failed to encrypt token');
    }
  }

  /**
   * Decrypt a token using AES-256-GCM
   *
   * @param ciphertext - Encrypted token (format: iv:encryptedData:authTag)
   * @returns Decrypted token
   */
  private decryptToken(ciphertext: string): string {
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format');
      }

      const [ivBase64, encryptedBase64, authTagBase64] = parts;

      // Validate all parts exist (should always be true after length check)
      if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
        throw new Error('Missing encryption components');
      }

      const iv = Buffer.from(ivBase64, 'base64');
      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Token decryption failed', { error });
      throw new Error('Failed to decrypt token');
    }
  }

  /**
   * Store encrypted BC tokens for a user in the database
   *
   * @param userId - User ID (GUID)
   * @param tokenData - BC token data to store
   */
  async storeBCToken(userId: string, tokenData: TokenAcquisitionResult): Promise<void> {
    try {
      const accessTokenEncrypted = this.encryptToken(tokenData.accessToken);
      const refreshTokenEncrypted = tokenData.refreshToken ? this.encryptToken(tokenData.refreshToken) : null;

      await executeQuery(
        `
        UPDATE users
        SET bc_access_token_encrypted = @accessToken,
            bc_refresh_token_encrypted = @refreshToken,
            bc_token_expires_at = @expiresAt,
            updated_at = GETDATE()
        WHERE id = @userId
        `,
        {
          userId,
          accessToken: accessTokenEncrypted,
          refreshToken: refreshTokenEncrypted,
          expiresAt: tokenData.expiresAt,
        }
      );

      this.logger.info('Stored encrypted BC tokens for user', { userId, expiresAt: tokenData.expiresAt });
    } catch (error) {
      this.logger.error('Failed to store BC tokens', { error, userId });
      throw new Error('Failed to store Business Central tokens');
    }
  }

  /**
   * Get decrypted BC token for a user
   * Automatically refreshes if expired
   *
   * @param userId - User ID (GUID)
   * @param userRefreshToken - User's Microsoft refresh token (for BC token refresh)
   * @returns Decrypted BC token data
   */
  async getBCToken(userId: string, userRefreshToken: string): Promise<BCTokenData> {
    try {
      // Fetch encrypted tokens from database
      const result = await executeQuery(
        `
        SELECT bc_access_token_encrypted,
               bc_refresh_token_encrypted,
               bc_token_expires_at
        FROM users
        WHERE id = @userId
        `,
        { userId }
      );

      if (!result.recordset || result.recordset.length === 0) {
        throw new Error('User not found');
      }

      const record = result.recordset[0] as Record<string, unknown>;

      // If no BC token stored, acquire new one
      if (!record.bc_access_token_encrypted) {
        this.logger.info('No BC token stored for user, acquiring new token', { userId });
        return await this._getOrCreateRefreshPromise(userId, userRefreshToken);
      }

      const expiresAt = new Date(record.bc_token_expires_at as string);
      const now = new Date();

      // If token expired or expires in next 5 minutes, refresh it
      if (expiresAt <= new Date(now.getTime() + TOKEN_REFRESH_BUFFER_MS)) {
        this.logger.info('BC token expired or expiring soon, refreshing', { userId, expiresAt });
        return await this._getOrCreateRefreshPromise(userId, userRefreshToken);
      }

      // Decrypt and return token
      const accessToken = this.decryptToken(record.bc_access_token_encrypted as string);
      const refreshToken = record.bc_refresh_token_encrypted ? this.decryptToken(record.bc_refresh_token_encrypted as string) : '';

      return {
        accessToken,
        refreshToken,
        expiresAt,
      };
    } catch (error) {
      this.logger.error('Failed to get BC token', { error, userId });
      throw new Error('Failed to retrieve Business Central token');
    }
  }

  /**
   * Get existing refresh promise or create new one (deduplication)
   *
   * Implements two-layer deduplication:
   * 1. Local promise map (same-instance deduplication) - fast, no network
   * 2. Distributed lock (cross-instance deduplication) - for horizontal scaling
   *
   * @param userId - User ID
   * @param userRefreshToken - User's Microsoft refresh token
   * @returns BC token data
   */
  private async _getOrCreateRefreshPromise(userId: string, userRefreshToken: string): Promise<BCTokenData> {
    const key = `refresh:${userId}`;
    const lockKey = `bc-token-refresh:${userId}`;

    // Layer 1: Check if refresh already in progress on this instance
    if (this.refreshPromises.has(key)) {
      this.logger.debug('BCTokenManager: Reusing existing refresh promise (same-instance)', { userId });
      return this.refreshPromises.get(key)!;
    }

    // Layer 2: Try to use distributed lock for cross-instance deduplication
    const lock = this.getDistributedLockInstance();

    if (lock) {
      return this._refreshWithDistributedLock(userId, userRefreshToken, key, lockKey, lock);
    }

    // Fallback: No distributed lock available, use local deduplication only
    this.logger.debug('BCTokenManager: No distributed lock available, using local deduplication only', { userId });
    return this._refreshWithLocalDeduplication(userId, userRefreshToken, key);
  }

  /**
   * Refresh token with distributed lock for cross-instance coordination
   */
  private async _refreshWithDistributedLock(
    userId: string,
    userRefreshToken: string,
    promiseKey: string,
    lockKey: string,
    lock: DistributedLock
  ): Promise<BCTokenData> {
    this.logger.debug('BCTokenManager: Attempting distributed lock acquisition', { userId, lockKey });

    // Create the refresh promise that uses distributed lock
    const promise = (async (): Promise<BCTokenData> => {
      try {
        // Try to acquire distributed lock
        const lockToken = await lock.acquire(lockKey, DISTRIBUTED_LOCK_TTL_MS);

        if (!lockToken) {
          // Lock not acquired - another instance is likely refreshing
          // Wait briefly and check if token was refreshed
          this.logger.debug('BCTokenManager: Lock not acquired, waiting for other instance', { userId });
          await this._sleep(500);

          // Double-check: Re-fetch token from DB, it may have been refreshed
          const freshToken = await this._fetchFreshTokenFromDB(userId);
          if (freshToken && freshToken.expiresAt > new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS)) {
            this.logger.info('BCTokenManager: Token already refreshed by another instance', { userId });
            return freshToken;
          }

          // Still expired - retry with lock (recursive with retry limits handled by lock)
          return lock.withLock(
            lockKey,
            () => this._performRefreshIfNeeded(userId, userRefreshToken),
            { ttlMs: DISTRIBUTED_LOCK_TTL_MS, retry: true, maxRetries: 5, retryDelayMs: 200 }
          ) as Promise<BCTokenData>;
        }

        // Lock acquired - we're responsible for refresh
        try {
          this.logger.debug('BCTokenManager: Distributed lock acquired, performing refresh', { userId });
          return await this._performRefreshIfNeeded(userId, userRefreshToken);
        } finally {
          // Always release the lock
          await lock.release(lockKey, lockToken);
          this.logger.debug('BCTokenManager: Distributed lock released', { userId });
        }
      } catch (error) {
        this.logger.error('BCTokenManager: Distributed lock refresh failed', {
          userId,
          error: error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) },
        });
        throw error;
      }
    })();

    // Store in local promise map for same-instance deduplication
    this.refreshPromises.set(promiseKey, promise);

    // Cleanup on completion
    promise.finally(() => {
      this.refreshPromises.delete(promiseKey);
      this.logger.debug('BCTokenManager: Refresh promise cleaned up', { userId });
    });

    return promise;
  }

  /**
   * Fallback: Refresh with local deduplication only (no distributed lock)
   */
  private async _refreshWithLocalDeduplication(
    userId: string,
    userRefreshToken: string,
    promiseKey: string
  ): Promise<BCTokenData> {
    this.logger.debug('BCTokenManager: Creating new refresh promise (local deduplication)', { userId });

    const promise = this.refreshBCToken(userId, userRefreshToken)
      .finally(() => {
        // CRITICAL: Always cleanup, even on error
        this.refreshPromises.delete(promiseKey);
        this.logger.debug('BCTokenManager: Refresh promise cleaned up', { userId });
      });

    // Store promise in map
    this.refreshPromises.set(promiseKey, promise);

    return promise;
  }

  /**
   * Check if refresh is still needed and perform if so
   *
   * Double-checks the database to avoid unnecessary refreshes when
   * another instance may have already refreshed the token.
   */
  private async _performRefreshIfNeeded(userId: string, userRefreshToken: string): Promise<BCTokenData> {
    // Double-check: Another instance may have refreshed while we waited for lock
    const freshToken = await this._fetchFreshTokenFromDB(userId);

    if (freshToken && freshToken.expiresAt > new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS)) {
      this.logger.info('BCTokenManager: Token already fresh after lock acquisition', {
        userId,
        expiresAt: freshToken.expiresAt,
      });
      return freshToken;
    }

    // Token still needs refresh
    this.logger.info('BCTokenManager: Performing actual token refresh', { userId });
    return this.refreshBCToken(userId, userRefreshToken);
  }

  /**
   * Fetch fresh token data from database (for double-check after lock)
   */
  private async _fetchFreshTokenFromDB(userId: string): Promise<BCTokenData | null> {
    try {
      const result = await executeQuery(
        `
        SELECT bc_access_token_encrypted,
               bc_refresh_token_encrypted,
               bc_token_expires_at
        FROM users
        WHERE id = @userId
        `,
        { userId }
      );

      if (!result.recordset || result.recordset.length === 0) {
        return null;
      }

      const record = result.recordset[0] as Record<string, unknown>;

      if (!record.bc_access_token_encrypted || !record.bc_token_expires_at) {
        return null;
      }

      const expiresAt = new Date(record.bc_token_expires_at as string);
      const accessToken = this.decryptToken(record.bc_access_token_encrypted as string);
      const refreshToken = record.bc_refresh_token_encrypted
        ? this.decryptToken(record.bc_refresh_token_encrypted as string)
        : '';

      return { accessToken, refreshToken, expiresAt };
    } catch (error) {
      this.logger.warn('BCTokenManager: Failed to fetch fresh token from DB', {
        userId,
        error: error instanceof Error
          ? { message: error.message }
          : { value: String(error) },
      });
      return null;
    }
  }

  /**
   * Sleep helper for retry delays
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Refresh BC token using user's Microsoft refresh token
   *
   * @param userId - User ID (GUID)
   * @param userRefreshToken - User's Microsoft refresh token
   * @returns New BC token data
   */
  async refreshBCToken(userId: string, userRefreshToken: string): Promise<BCTokenData> {
    try {
      this.logger.info('Refreshing BC token', { userId });

      // Acquire new BC token using OAuth service
      const tokenResult = await this.oauthService.acquireBCToken(userRefreshToken);

      // Store encrypted token
      await this.storeBCToken(userId, tokenResult);

      return {
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken || '',
        expiresAt: tokenResult.expiresAt,
      };
    } catch (error) {
      this.logger.error('Failed to refresh BC token', { error, userId });
      throw new Error('Failed to refresh Business Central token');
    }
  }

  /**
   * Clear BC tokens for a user (on logout or token revocation)
   *
   * @param userId - User ID (GUID)
   */
  async clearBCToken(userId: string): Promise<void> {
    try {
      await executeQuery(
        `
        UPDATE users
        SET bc_access_token_encrypted = NULL,
            bc_refresh_token_encrypted = NULL,
            bc_token_expires_at = NULL,
            updated_at = GETDATE()
        WHERE id = @userId
        `,
        { userId }
      );

      this.logger.info('Cleared BC tokens for user', { userId });
    } catch (error) {
      this.logger.error('Failed to clear BC tokens', { error, userId });
      throw new Error('Failed to clear Business Central tokens');
    }
  }
}

/**
 * Create BCTokenManager instance from environment variables
 */
export function createBCTokenManager(oauthService: MicrosoftOAuthService): BCTokenManager {
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be configured');
  }

  return new BCTokenManager(encryptionKey, oauthService);
}
