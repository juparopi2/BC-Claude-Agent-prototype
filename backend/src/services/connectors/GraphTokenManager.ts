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
import { ConfidentialClientApplication } from '@azure/msal-node';
import { GRAPH_API_SCOPES } from '@bc-agent/shared';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import { MsalRedisCachePlugin } from '@/domains/auth/oauth/MsalRedisCachePlugin';

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
   *
   * If the stored token is expired (within the 5-minute buffer), the method
   * first attempts an MSAL silent refresh using `msal_home_account_id` and
   * the `scopes_granted` stored on the connection.  If silent refresh
   * succeeds the new token is persisted and returned.  If it fails (or the
   * connection has no MSAL account ID), ConnectionTokenExpiredError is thrown
   * so the caller can trigger the full OAuth re-consent flow.
   */
  async getValidToken(connectionId: string): Promise<string> {
    const connection = await prisma.connections.findUnique({
      where: { id: connectionId },
      select: {
        access_token_encrypted: true,
        token_expires_at: true,
        status: true,
        msal_home_account_id: true,
        scopes_granted: true,
        user_id: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (!connection.access_token_encrypted) {
      await this.markConnectionExpired(connectionId, connection.user_id ?? undefined);
      throw new ConnectionTokenExpiredError(connectionId);
    }

    // Check if token is expired (with 5-minute buffer)
    const bufferMs = 5 * 60 * 1000;
    const isExpired = connection.token_expires_at
      ? Date.now() > new Date(connection.token_expires_at).getTime() - bufferMs
      : false;

    if (isExpired) {
      // Attempt MSAL silent refresh before giving up
      if (connection.msal_home_account_id) {
        const scopes = connection.scopes_granted
          ? connection.scopes_granted.split(' ').filter(Boolean)
          : [GRAPH_API_SCOPES.FILES_READ_ALL];

        try {
          logger.info(
            { connectionId, homeAccountId: connection.msal_home_account_id },
            'Token expired; attempting MSAL silent refresh'
          );

          const freshToken = await this.refreshViaMsal(
            connectionId,
            connection.msal_home_account_id,
            scopes,
            // Use homeAccountId as the MSAL cache partition key.
            // The login callback aligns the MSAL cache to this key after authentication.
            connection.msal_home_account_id
          );

          logger.info({ connectionId }, 'MSAL silent refresh succeeded; returning fresh token');
          return freshToken;
        } catch (msalError) {
          const errorInfo =
            msalError instanceof Error
              ? { message: msalError.message, name: msalError.name }
              : { value: String(msalError) };
          logger.warn(
            { connectionId, error: errorInfo },
            'MSAL silent refresh failed; connection requires re-authentication'
          );
          // Fall through to throw ConnectionTokenExpiredError
        }
      }

      await this.markConnectionExpired(connectionId, connection.user_id ?? undefined);
      throw new ConnectionTokenExpiredError(connectionId);
    }

    return this.decryptToken(connection.access_token_encrypted);
  }

  /**
   * Mark connection as expired in DB and notify the frontend via WebSocket.
   * Non-fatal: failures are logged but do not propagate.
   */
  private async markConnectionExpired(connectionId: string, userId?: string): Promise<void> {
    try {
      await prisma.connections.update({
        where: { id: connectionId },
        data: {
          status: 'expired',
          last_error: 'Token expired — re-authentication required',
          last_error_at: new Date(),
        },
      });

      logger.info({ connectionId }, 'Marked connection as expired');

      // Notify frontend via WebSocket (dynamic import to avoid circular deps)
      if (userId) {
        try {
          const { getSocketIO, isSocketServiceInitialized } = await import(
            '@/services/websocket/SocketService'
          );
          if (isSocketServiceInitialized()) {
            const { SYNC_WS_EVENTS } = await import('@bc-agent/shared');
            getSocketIO()
              .to(`user:${userId}`)
              .emit(SYNC_WS_EVENTS.CONNECTION_EXPIRED, { connectionId });
          }
        } catch {
          // WebSocket emission is best-effort
        }
      }
    } catch (err) {
      const errorInfo =
        err instanceof Error
          ? { message: err.message, name: err.name }
          : { value: String(err) };
      logger.warn({ connectionId, error: errorInfo }, 'Failed to mark connection as expired');
    }
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
  // Private MSAL refresh helper
  // ==========================================================================

  /**
   * Attempt to silently acquire a fresh access token via MSAL and persist it.
   *
   * Creates a short-lived MSAL ConfidentialClientApplication backed by a Redis
   * cache partition, looks up the account by homeAccountId, and calls
   * acquireTokenSilent.  On success the new token is encrypted and stored on
   * the connection record before being returned to the caller.
   *
   * @param connectionId     - Connection ID used for DB update.
   * @param homeAccountId    - MSAL homeAccountId stored on the connection.
   * @param scopes           - Scopes to request (e.g. ['Files.Read.All']).
   * @param msalPartitionKey - Redis cache partition key; we reuse homeAccountId
   *                           since the login callback aligns the MSAL cache to
   *                           this key after authentication.
   * @returns Fresh access token string.
   * @throws Error if MSAL cannot find the account or silent acquisition fails.
   */
  private async refreshViaMsal(
    connectionId: string,
    homeAccountId: string,
    scopes: string[],
    msalPartitionKey: string
  ): Promise<string> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const authority =
      process.env.MICROSOFT_AUTHORITY ??
      `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`;

    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured');
    }

    const cachePlugin = new MsalRedisCachePlugin(msalPartitionKey);

    const msalClient = new ConfidentialClientApplication({
      auth: { clientId, clientSecret, authority },
      cache: { cachePlugin },
    });

    const tokenCache = msalClient.getTokenCache();
    const account = await tokenCache.getAccountByHomeId(homeAccountId);

    if (!account) {
      throw new Error(`Account ${homeAccountId} not found in MSAL cache`);
    }

    const result = await msalClient.acquireTokenSilent({ account, scopes });

    if (!result?.accessToken) {
      throw new Error('acquireTokenSilent returned no access token');
    }

    // Persist the refreshed token so subsequent calls use the new value
    const expiresAt = result.expiresOn ?? new Date(Date.now() + 3600 * 1000);
    await this.storeTokens(connectionId, { accessToken: result.accessToken, expiresAt });

    return result.accessToken;
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
