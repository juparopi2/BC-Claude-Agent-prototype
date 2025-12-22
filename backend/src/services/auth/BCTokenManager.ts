/**
 * Business Central Token Manager
 *
 * Manages per-user Business Central API tokens with encryption.
 * Features:
 * - AES-256-GCM encryption for token storage
 * - Automatic token refresh when expired
 * - Database persistence
 */

import crypto from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { BCTokenData, TokenAcquisitionResult } from '../../types/microsoft.types';
import { MicrosoftOAuthService } from './MicrosoftOAuthService';
import { logger } from '@/shared/utils/logger';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

export class BCTokenManager {
  private encryptionKey: Buffer;
  private oauthService: MicrosoftOAuthService;

  // Map to store in-flight refresh promises for deduplication
  private refreshPromises = new Map<string, Promise<BCTokenData>>();

  constructor(encryptionKey: string, oauthService: MicrosoftOAuthService) {
    // Derive 32-byte key from base64 encryption key
    this.encryptionKey = Buffer.from(encryptionKey, 'base64');

    if (this.encryptionKey.length !== KEY_LENGTH) {
      throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
    }

    this.oauthService = oauthService;
    logger.info('BCTokenManager initialized');
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
      logger.error('Token encryption failed', { error });
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
      logger.error('Token decryption failed', { error });
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

      logger.info('Stored encrypted BC tokens for user', { userId, expiresAt: tokenData.expiresAt });
    } catch (error) {
      logger.error('Failed to store BC tokens', { error, userId });
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
        logger.info('No BC token stored for user, acquiring new token', { userId });
        return await this._getOrCreateRefreshPromise(userId, userRefreshToken);
      }

      const expiresAt = new Date(record.bc_token_expires_at as string);
      const now = new Date();

      // If token expired or expires in next 5 minutes, refresh it
      if (expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
        logger.info('BC token expired or expiring soon, refreshing', { userId, expiresAt });
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
      logger.error('Failed to get BC token', { error, userId });
      throw new Error('Failed to retrieve Business Central token');
    }
  }

  /**
   * Get existing refresh promise or create new one (deduplication)
   *
   * @param userId - User ID
   * @param userRefreshToken - User's Microsoft refresh token
   * @returns BC token data
   */
  private async _getOrCreateRefreshPromise(userId: string, userRefreshToken: string): Promise<BCTokenData> {
    const key = `refresh:${userId}`;

    // Check if refresh already in progress
    if (this.refreshPromises.has(key)) {
      logger.debug('BCTokenManager: Reusing existing refresh promise', { userId });
      return this.refreshPromises.get(key)!;
    }

    // Create new refresh promise
    logger.debug('BCTokenManager: Creating new refresh promise', { userId });
    
    // Create new refresh promise
    logger.debug('BCTokenManager: Creating new refresh promise', { userId });
    
    const promise = this.refreshBCToken(userId, userRefreshToken)
      .finally(() => {
        // CRITICAL: Always cleanup, even on error
        this.refreshPromises.delete(key);
        logger.debug('BCTokenManager: Refresh promise cleaned up', { userId });
      });

    // Store promise in map
    this.refreshPromises.set(key, promise);

    return promise;
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
      logger.info('Refreshing BC token', { userId });

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
      logger.error('Failed to refresh BC token', { error, userId });
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

      logger.info('Cleared BC tokens for user', { userId });
    } catch (error) {
      logger.error('Failed to clear BC tokens', { error, userId });
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
