/**
 * Business Central Token Manager
 *
 * Manages per-user Business Central API tokens with encryption.
 * Features:
 * - AES-256-GCM encryption for token storage
 * - Database persistence for access tokens only
 *
 * Note: Refresh tokens are managed internally by MSAL via Redis cache.
 * This manager only handles encrypted storage of access tokens in SQL.
 * Token refresh is handled by MicrosoftOAuthService.acquireBCTokenSilent().
 */

import crypto from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { TokenAcquisitionResult } from '../../types/microsoft.types';
import { createChildLogger } from '@/shared/utils/logger';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

export class BCTokenManager {
  private encryptionKey: Buffer;
  private logger = createChildLogger({ service: 'BCTokenManager' });

  constructor(encryptionKey: string) {
    // Derive 32-byte key from base64 encryption key
    this.encryptionKey = Buffer.from(encryptionKey, 'base64');

    if (this.encryptionKey.length !== KEY_LENGTH) {
      throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
    }

    this.logger.info('BCTokenManager initialized');
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
   * Store encrypted BC access token for a user in the database
   *
   * Note: With MSAL cache-based token management, refresh tokens are managed
   * internally by MSAL in Redis. We only store the access token here.
   *
   * @param userId - User ID (GUID)
   * @param tokenData - BC token data to store (only accessToken and expiresAt are used)
   */
  async storeBCToken(userId: string, tokenData: TokenAcquisitionResult): Promise<void> {
    try {
      const accessTokenEncrypted = this.encryptToken(tokenData.accessToken);

      await executeQuery(
        `
        UPDATE users
        SET bc_access_token_encrypted = @accessToken,
            bc_token_expires_at = @expiresAt,
            updated_at = GETDATE()
        WHERE id = @userId
        `,
        {
          userId,
          accessToken: accessTokenEncrypted,
          expiresAt: tokenData.expiresAt,
        }
      );

      this.logger.info('Stored encrypted BC token for user', { userId, expiresAt: tokenData.expiresAt });
    } catch (error) {
      this.logger.error('Failed to store BC token', { error, userId });
      throw new Error('Failed to store Business Central token');
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
            bc_token_expires_at = NULL,
            updated_at = GETDATE()
        WHERE id = @userId
        `,
        { userId }
      );

      this.logger.info('Cleared BC token for user', { userId });
    } catch (error) {
      this.logger.error('Failed to clear BC token', { error, userId });
      throw new Error('Failed to clear Business Central token');
    }
  }
}

/**
 * Create BCTokenManager instance from environment variables
 */
export function createBCTokenManager(): BCTokenManager {
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be configured');
  }

  return new BCTokenManager(encryptionKey);
}
