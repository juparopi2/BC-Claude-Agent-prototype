/**
 * OneDrive OAuth Routes (PRD-101)
 *
 * Handles the OAuth 2.0 consent and callback flow for connecting a user's
 * OneDrive to the platform.
 *
 * Endpoints:
 * - POST /api/connections/onedrive/auth/initiate   – Start (or fast-path) the auth flow.
 * - GET  /api/auth/callback/onedrive               – Microsoft OAuth redirect callback.
 *
 * Fast-path: if the user already has a valid MSAL cache entry (because they
 * are logged in with the same Microsoft account), we try acquireTokenSilent
 * before generating a consent URL.  This avoids an unnecessary browser
 * redirect for users who have already granted the required scopes.
 *
 * @module routes/onedrive-auth
 */

import { Router, Request, Response } from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { GRAPH_API_SCOPES } from '@bc-agent/shared';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { MsalRedisCachePlugin } from '@/domains/auth/oauth/MsalRedisCachePlugin';
import { getEagerRedis } from '@/infrastructure/redis/redis';
import { getGraphTokenManager } from '@/services/connectors/GraphTokenManager';
import { prisma } from '@/infrastructure/database/prisma';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendInternalError } from '@/shared/utils/error-response';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';
import { ONEDRIVE_CONSENT_SCOPES } from '@/types/microsoft.types';

const logger = createChildLogger({ service: 'OnedriveAuth' });
const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONEDRIVE_SCOPES = [...ONEDRIVE_CONSENT_SCOPES];

/** Scopes stored in the `scopes_granted` column (space-separated, no offline_access). */
const SCOPES_GRANTED_VALUE = GRAPH_API_SCOPES.FILES_READ_ALL;

function getRedirectUri(): string {
  if (process.env.ONEDRIVE_REDIRECT_URI) {
    return process.env.ONEDRIVE_REDIRECT_URI;
  }
  // Derive from MICROSOFT_REDIRECT_URI (already set in CI/production) by appending /onedrive
  if (process.env.MICROSOFT_REDIRECT_URI) {
    return `${process.env.MICROSOFT_REDIRECT_URI}/onedrive`;
  }
  return 'http://localhost:3002/api/auth/callback/onedrive';
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:3000';
}

function getMsalAuthority(): string {
  return (
    process.env.MICROSOFT_AUTHORITY ??
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`
  );
}

/**
 * Build a fresh MSAL ConfidentialClientApplication backed by a Redis cache
 * partition identified by `partitionKey`.
 *
 * Throws if MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not set.
 */
function buildMsalClient(partitionKey: string): ConfidentialClientApplication {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured');
  }

  return new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: getMsalAuthority(),
    },
    cache: {
      cachePlugin: new MsalRedisCachePlugin(partitionKey),
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: fetch/create OneDrive connection for user
// ---------------------------------------------------------------------------

/**
 * Find the user's existing 'onedrive' connection, or create a new one.
 * Returns the connection ID (UPPERCASE).
 */
async function getOrCreateOneDriveConnection(userId: string): Promise<string> {
  const existing = await prisma.connections.findFirst({
    where: { user_id: userId, provider: 'onedrive' },
    select: { id: true },
  });

  if (existing) {
    return existing.id.toUpperCase();
  }

  // Create a fresh disconnected connection
  const { randomUUID } = await import('crypto');
  const newId = randomUUID().toUpperCase();

  await prisma.connections.create({
    data: {
      id: newId,
      user_id: userId,
      provider: 'onedrive',
      status: 'disconnected',
    },
  });

  logger.info({ userId, connectionId: newId }, 'Created new OneDrive connection record');
  return newId;
}

// ---------------------------------------------------------------------------
// Helper: fetch OneDrive drive info and store on connection
// ---------------------------------------------------------------------------

/**
 * Calls /me/drive on Microsoft Graph and stores the drive ID and display name
 * on the connection record.  Errors are non-fatal (logged as warnings).
 */
async function storeDriveInfo(connectionId: string, accessToken: string): Promise<void> {
  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      logger.warn(
        { connectionId, status: response.status },
        'Failed to fetch OneDrive drive info from Graph'
      );
      return;
    }

    const drive = (await response.json()) as {
      id?: string;
      name?: string;
      owner?: { user?: { displayName?: string } };
    };

    const driveId = drive.id ?? null;
    const displayName =
      drive.owner?.user?.displayName
        ? `${drive.owner.user.displayName}'s OneDrive`
        : 'OneDrive';

    await prisma.connections.update({
      where: { id: connectionId },
      data: {
        microsoft_drive_id: driveId,
        display_name: displayName,
        updated_at: new Date(),
      },
    });

    logger.info({ connectionId, driveId, displayName }, 'Stored OneDrive drive info');
  } catch (error) {
    const errorInfo =
      error instanceof Error
        ? { message: error.message, name: error.name }
        : { value: String(error) };
    logger.warn({ connectionId, error: errorInfo }, 'Failed to store OneDrive drive info');
  }
}

// ============================================================================
// POST /api/connections/onedrive/auth/initiate
// ============================================================================

/**
 * POST /api/connections/onedrive/auth/initiate
 *
 * Initiates the OneDrive OAuth connection flow for the authenticated user.
 *
 * Fast-path: if the user already has valid MSAL cache tokens (from their main
 * Microsoft login), acquireTokenSilent is attempted first.  On success the
 * tokens are stored and `{ connectionId, status: 'connected' }` is returned.
 *
 * If silent acquisition fails or the required scopes have not been consented,
 * an authorization URL is returned and the client should redirect the user to
 * it:  `{ authUrl, connectionId, status: 'requires_consent' }`.
 */
router.post(
  '/connections/onedrive/auth/initiate',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;

      const connectionId = await getOrCreateOneDriveConnection(userId);

      logger.info({ userId, connectionId }, 'OneDrive auth initiate requested');

      // ------------------------------------------------------------------
      // Fast-path: try MSAL silent token acquisition
      // ------------------------------------------------------------------
      const homeAccountId = oauthSession?.homeAccountId;
      const msalPartitionKey = oauthSession?.msalPartitionKey;

      if (homeAccountId && msalPartitionKey) {
        try {
          const msalClient = buildMsalClient(msalPartitionKey);
          const tokenCache = msalClient.getTokenCache();
          const account = await tokenCache.getAccountByHomeId(homeAccountId);

          if (account) {
            const silentResult = await msalClient.acquireTokenSilent({
              account,
              scopes: [GRAPH_API_SCOPES.FILES_READ_ALL],
            });

            if (silentResult?.accessToken) {
              const expiresAt =
                silentResult.expiresOn ?? new Date(Date.now() + 3600 * 1000);

              const tokenManager = getGraphTokenManager();
              await tokenManager.storeTokens(connectionId, {
                accessToken: silentResult.accessToken,
                expiresAt,
              });

              // Update MSAL metadata on the connection
              await prisma.connections.update({
                where: { id: connectionId },
                data: {
                  msal_home_account_id: homeAccountId,
                  scopes_granted: SCOPES_GRANTED_VALUE,
                  updated_at: new Date(),
                },
              });

              await storeDriveInfo(connectionId, silentResult.accessToken);

              logger.info(
                { userId, connectionId },
                'OneDrive connected via MSAL silent acquisition'
              );

              res.json({ connectionId, status: 'connected' });
              return;
            }
          }
        } catch (silentError) {
          const errorInfo =
            silentError instanceof Error
              ? { message: silentError.message, name: silentError.name }
              : { value: String(silentError) };
          logger.info(
            { userId, error: errorInfo },
            'MSAL silent acquisition failed; falling back to consent URL'
          );
          // Fall through to consent URL generation
        }
      }

      // ------------------------------------------------------------------
      // Consent-required path: generate authorization URL
      // ------------------------------------------------------------------
      const redirectUri = getRedirectUri();

      // Use msalPartitionKey if available; otherwise generate a temporary key
      // that we store in session for the callback to look up.
      const partitionKey = msalPartitionKey ?? req.sessionID;

      const msalClient = buildMsalClient(partitionKey);
      const authUrl = await msalClient.getAuthCodeUrl({
        scopes: ONEDRIVE_SCOPES,
        redirectUri,
        // Pass the connectionId in state so the callback knows which connection
        // to update.  Use a prefix so we can detect malformed state values.
        state: `onedrive:${connectionId}`,
        prompt: 'select_account',
      });

      // Persist partitionKey in session so the callback can reconstruct the
      // MSAL client with the same cache partition.
      if (req.session) {
        req.session.onedriveMsalPartitionKey = partitionKey;
      }

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.info({ userId, connectionId }, 'Generated OneDrive consent URL');

      res.json({ authUrl, connectionId, status: 'requires_consent' });
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      logger.error({ error: errorInfo }, 'Failed to initiate OneDrive auth');
      sendInternalError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
);

// ============================================================================
// GET /api/auth/callback/onedrive
// ============================================================================

/**
 * GET /api/auth/callback/onedrive
 *
 * Microsoft OAuth redirect callback for OneDrive authorization.
 *
 * Exchanges the authorization code for tokens, stores them encrypted on the
 * connection record, fetches drive metadata, and redirects the user to the
 * frontend.
 *
 * The `state` query parameter must be in the format `onedrive:{connectionId}`.
 */
router.get(
  '/auth/callback/onedrive',
  async (req: Request, res: Response): Promise<void> => {
    const frontendUrl = getFrontendUrl();
    const redirectError = (reason: string): void => {
      res.redirect(`${frontendUrl}/new?onedrive_error=${encodeURIComponent(reason)}`);
    };

    try {
      const { code, state, error: oauthError, error_description } = req.query;

      // Handle OAuth errors returned by Microsoft
      if (oauthError) {
        logger.error(
          { oauthError, error_description },
          'OneDrive OAuth callback returned error from Microsoft'
        );
        redirectError(String(oauthError));
        return;
      }

      if (!code || typeof code !== 'string') {
        logger.error('OneDrive OAuth callback missing code parameter');
        redirectError('missing_code');
        return;
      }

      // ------------------------------------------------------------------
      // Validate state parameter
      // ------------------------------------------------------------------
      if (!state || typeof state !== 'string' || !state.startsWith('onedrive:')) {
        logger.error({ state }, 'OneDrive OAuth callback: invalid or missing state');
        redirectError('invalid_state');
        return;
      }

      const connectionId = state.slice('onedrive:'.length).toUpperCase();

      if (!connectionId) {
        logger.error('OneDrive OAuth callback: empty connectionId in state');
        redirectError('invalid_state');
        return;
      }

      // ------------------------------------------------------------------
      // Validate user is authenticated (session must exist)
      // ------------------------------------------------------------------
      const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;
      const userId = oauthSession?.userId;

      if (!userId) {
        logger.warn({ connectionId }, 'OneDrive callback: unauthenticated session');
        redirectError('unauthenticated');
        return;
      }

      // ------------------------------------------------------------------
      // Verify connection belongs to user
      // ------------------------------------------------------------------
      const connection = await prisma.connections.findFirst({
        where: { id: connectionId, user_id: userId },
        select: { id: true },
      });

      if (!connection) {
        logger.warn(
          { connectionId, userId },
          'OneDrive callback: connection not found or belongs to another user'
        );
        redirectError('connection_not_found');
        return;
      }

      // ------------------------------------------------------------------
      // Exchange authorization code for tokens
      // ------------------------------------------------------------------

      // Recover the MSAL cache partition key used during initiate.
      // Fall back to the user's main partition key so that the newly acquired
      // tokens are stored alongside their login tokens.
      const msalPartitionKey =
        req.session?.onedriveMsalPartitionKey
        ?? oauthSession?.msalPartitionKey
        ?? req.sessionID;

      const redirectUri = getRedirectUri();
      const msalClient = buildMsalClient(msalPartitionKey);

      const tokenResult = await msalClient.acquireTokenByCode({
        code,
        scopes: ONEDRIVE_SCOPES,
        redirectUri,
      });

      if (!tokenResult?.accessToken) {
        logger.error({ connectionId }, 'acquireTokenByCode returned no access token');
        redirectError('token_exchange_failed');
        return;
      }

      const homeAccountId = tokenResult.account?.homeAccountId ?? null;
      const expiresAt = tokenResult.expiresOn ?? new Date(Date.now() + 3600 * 1000);

      // ------------------------------------------------------------------
      // Persist tokens
      // ------------------------------------------------------------------
      const tokenManager = getGraphTokenManager();
      await tokenManager.storeTokens(connectionId, {
        accessToken: tokenResult.accessToken,
        expiresAt,
      });

      // Store MSAL metadata and granted scopes
      await prisma.connections.update({
        where: { id: connectionId },
        data: {
          ...(homeAccountId && { msal_home_account_id: homeAccountId }),
          scopes_granted: SCOPES_GRANTED_VALUE,
          updated_at: new Date(),
        },
      });

      // Align MSAL cache: copy to homeAccountId key for GraphTokenManager background refresh
      if (homeAccountId && msalPartitionKey !== homeAccountId) {
        try {
          const redis = getEagerRedis();
          const cacheData = await redis.get(`msal:token:${msalPartitionKey}`);
          if (cacheData) {
            await redis.setex(`msal:token:${homeAccountId}`, 90 * 24 * 60 * 60, cacheData);
            logger.info({ oldKey: msalPartitionKey, newKey: homeAccountId },
              'Aligned OneDrive MSAL cache partition key to homeAccountId');
          }
        } catch (err) {
          logger.warn({ error: err instanceof Error ? err.message : String(err) },
            'Failed to align OneDrive MSAL cache partition key');
        }
      }

      logger.info(
        { connectionId, homeAccountId, expiresAt },
        'Stored OneDrive tokens from OAuth callback'
      );

      // ------------------------------------------------------------------
      // Fetch and store drive info
      // ------------------------------------------------------------------
      await storeDriveInfo(connectionId, tokenResult.accessToken);

      // ------------------------------------------------------------------
      // Clean up temporary session key
      // ------------------------------------------------------------------
      if (req.session?.onedriveMsalPartitionKey) {
        delete req.session.onedriveMsalPartitionKey;
      }

      // CRITICAL: Save session before redirecting
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            logger.error(
              {
                error: err instanceof Error
                  ? { message: err.message, stack: err.stack }
                  : { value: String(err) },
              },
              'Failed to save session after OneDrive OAuth callback'
            );
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.info(
        { userId, connectionId },
        'OneDrive OAuth callback completed; redirecting to frontend'
      );

      res.redirect(
        `${frontendUrl}/new?connected=onedrive&connectionId=${encodeURIComponent(connectionId)}`
      );
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      logger.error({ error: errorInfo }, 'OneDrive OAuth callback failed with unexpected error');
      redirectError('callback_failed');
    }
  }
);

export default router;
