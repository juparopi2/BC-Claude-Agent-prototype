/**
 * GraphTokenManager (PRD-100)
 *
 * Manages Microsoft Graph API tokens for external connections (OneDrive, SharePoint).
 * Reuses AES-256-GCM encryption pattern from BCTokenManager.ts.
 *
 * Token lifecycle:
 * - Tokens stored encrypted in `connections` table (access_token_encrypted, refresh_token_encrypted)
 * - MSAL `acquireTokenSilent` used for refresh via MsalRedisCachePlugin
 * - Custom error for expired tokens triggers re-auth flow
 *
 * @module services/connectors
 */

import crypto from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

const logger = createChildLogger({ service: 'GraphTokenManager' });

// ============================================================================
// Custom Error
// ============================================================================

export class ConnectionTokenExpiredError extends Error {
  readonly code = 'CONNECTION_TOKEN_EXPIRED';
  constructor(connectionId: string) {
    super(`Token expired for connection ${connectionId}`);
    this.name = 'ConnectionTokenExpiredError';
  }
}

// ============================================================================
// GraphTokenManager
// ============================================================================

export class GraphTokenManager {
  private encryptionKey: Buffer;

  constructor(encryptionKey: string) {
    this.encryptionKey = Buffer.from(encryptionKey, 'base64');

    if (this.encryptionKey.length !== KEY_LENGTH) {
      throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
    }

    logger.info('GraphTokenManager initialized');
  }

  /**
   * Get a valid access token for a connection.
   * Checks expiration and throws ConnectionTokenExpiredError if token is stale.
   */
  async getValidToken(connectionId: string): Promise<string> {
    const connection = await prisma.connections.findUnique({
      where: { id: connectionId },
      select: {
        access_token_encrypted: true,
        token_expires_at: true,
        status: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (!connection.access_token_encrypted) {
      throw new ConnectionTokenExpiredError(connectionId);
    }

    // Check if token is expired (with 5-minute buffer)
    if (connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at);
      const bufferMs = 5 * 60 * 1000;
      if (Date.now() > expiresAt.getTime() - bufferMs) {
        throw new ConnectionTokenExpiredError(connectionId);
      }
    }

    return this.decryptToken(connection.access_token_encrypted);
  }

  /**
   * Store encrypted tokens for a connection.
   */
  async storeTokens(
    connectionId: string,
    tokenResult: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
    }
  ): Promise<void> {
    const accessTokenEncrypted = this.encryptToken(tokenResult.accessToken);
    const refreshTokenEncrypted = tokenResult.refreshToken
      ? this.encryptToken(tokenResult.refreshToken)
      : undefined;

    await prisma.connections.update({
      where: { id: connectionId },
      data: {
        access_token_encrypted: accessTokenEncrypted,
        ...(refreshTokenEncrypted && { refresh_token_encrypted: refreshTokenEncrypted }),
        token_expires_at: tokenResult.expiresAt,
        status: 'connected',
        last_error: null,
        last_error_at: null,
      },
    });

    logger.info(
      { connectionId, expiresAt: tokenResult.expiresAt },
      'Stored encrypted Graph tokens'
    );
  }

  /**
   * Revoke (clear) tokens for a connection.
   */
  async revokeTokens(connectionId: string): Promise<void> {
    await prisma.connections.update({
      where: { id: connectionId },
      data: {
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        status: 'disconnected',
      },
    });

    logger.info({ connectionId }, 'Revoked Graph tokens');
  }

  // ==========================================================================
  // Private encryption helpers (same pattern as BCTokenManager)
  // ==========================================================================

  private encryptToken(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:encryptedData:authTag (all base64)
    return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
  }

  private decryptToken(encryptedValue: string): string {
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }

    const [ivBase64, encryptedBase64, authTagBase64] = parts;
    const iv = Buffer.from(ivBase64!, 'base64');
    const encrypted = Buffer.from(encryptedBase64!, 'base64');
    const authTag = Buffer.from(authTagBase64!, 'base64');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GraphTokenManager | null = null;

/**
 * Get the GraphTokenManager singleton.
 * Requires ENCRYPTION_KEY environment variable.
 */
export function getGraphTokenManager(): GraphTokenManager {
  if (!instance) {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY must be configured');
    }
    instance = new GraphTokenManager(encryptionKey);
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetGraphTokenManager(): void {
  instance = null;
}
