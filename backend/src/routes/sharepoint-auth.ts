/**
 * SharePoint OAuth Routes (PRD-111)
 *
 * Handles the OAuth 2.0 consent and callback flow for connecting a user's
 * SharePoint to the platform.
 *
 * Endpoints:
 * - POST /api/connections/sharepoint/auth/initiate   – Start (or fast-path) the auth flow.
 * - GET  /api/auth/callback/sharepoint               – Microsoft OAuth redirect callback.
 *
 * Fast-path: if the user already has a valid MSAL cache entry (because they
 * are logged in with the same Microsoft account), we try acquireTokenSilent
 * before generating a consent URL.  This avoids an unnecessary browser
 * redirect for users who have already granted the required scopes.
 *
 * @module routes/sharepoint-auth
 */

import { Router, Request, Response } from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { MsalRedisCachePlugin } from '@/domains/auth/oauth/MsalRedisCachePlugin';
import { getGraphTokenManager } from '@/services/connectors/GraphTokenManager';
import { prisma } from '@/infrastructure/database/prisma';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendInternalError } from '@/shared/utils/error-response';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';

const logger = createChildLogger({ service: 'SharepointAuth' });
const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHAREPOINT_SCOPES = ['Sites.Read.All', 'Files.Read.All', 'offline_access'];

/** Scopes stored in the `scopes_granted` column (space-separated, no offline_access). */
const SCOPES_GRANTED_VALUE = 'Sites.Read.All Files.Read.All';

function getRedirectUri(): string {
  if (process.env.SHAREPOINT_REDIRECT_URI) {
    return process.env.SHAREPOINT_REDIRECT_URI;
  }
  // Derive from MICROSOFT_REDIRECT_URI (already set in CI/production) by appending /sharepoint
  if (process.env.MICROSOFT_REDIRECT_URI) {
    return `${process.env.MICROSOFT_REDIRECT_URI}/sharepoint`;
  }
  return 'http://localhost:3002/api/auth/callback/sharepoint';
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
// Helper: fetch/create SharePoint connection for user
// ---------------------------------------------------------------------------

/**
 * Find the user's existing 'sharepoint' connection, or create a new one.
 * Returns the connection ID (UPPERCASE).
 */
async function getOrCreateSharePointConnection(userId: string): Promise<string> {
  const existing = await prisma.connections.findFirst({
    where: { user_id: userId, provider: 'sharepoint' },
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
      provider: 'sharepoint',
      status: 'disconnected',
    },
  });

  logger.info({ userId, connectionId: newId }, 'Created new SharePoint connection record');
  return newId;
}

// ============================================================================
// POST /api/connections/sharepoint/auth/initiate
// ============================================================================

/**
 * POST /api/connections/sharepoint/auth/initiate
 *
 * Initiates the SharePoint OAuth connection flow for the authenticated user.
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
  '/connections/sharepoint/auth/initiate',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;

      const connectionId = await getOrCreateSharePointConnection(userId);

      logger.info({ userId, connectionId }, 'SharePoint auth initiate requested');

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
              scopes: ['Sites.Read.All', 'Files.Read.All'],
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
                  display_name: 'SharePoint',
                  updated_at: new Date(),
                },
              });

              logger.info(
                { userId, connectionId },
                'SharePoint connected via MSAL silent acquisition'
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
        scopes: SHAREPOINT_SCOPES,
        redirectUri,
        // Pass the connectionId in state so the callback knows which connection
        // to update.  Use a prefix so we can detect malformed state values.
        state: `sharepoint:${connectionId}`,
        prompt: 'select_account',
      });

      // Persist partitionKey in session so the callback can reconstruct the
      // MSAL client with the same cache partition.
      if (req.session) {
        req.session.sharepointMsalPartitionKey = partitionKey;
      }

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.info({ userId, connectionId }, 'Generated SharePoint consent URL');

      res.json({ authUrl, connectionId, status: 'requires_consent' });
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      logger.error({ error: errorInfo }, 'Failed to initiate SharePoint auth');
      sendInternalError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
);

// ============================================================================
// GET /api/auth/callback/sharepoint
// ============================================================================

/**
 * GET /api/auth/callback/sharepoint
 *
 * Microsoft OAuth redirect callback for SharePoint authorization.
 *
 * Exchanges the authorization code for tokens, stores them encrypted on the
 * connection record, and redirects the user to the frontend.
 *
 * The `state` query parameter must be in the format `sharepoint:{connectionId}`.
 *
 * Note: Unlike OneDrive, SharePoint connections do not store a single drive ID
 * because SharePoint has multiple drives per site.
 */
router.get(
  '/auth/callback/sharepoint',
  async (req: Request, res: Response): Promise<void> => {
    const frontendUrl = getFrontendUrl();
    const redirectError = (reason: string): void => {
      res.redirect(`${frontendUrl}/new?sharepoint_error=${encodeURIComponent(reason)}`);
    };

    try {
      const { code, state, error: oauthError, error_description } = req.query;

      // Handle OAuth errors returned by Microsoft
      if (oauthError) {
        logger.error(
          { oauthError, error_description },
          'SharePoint OAuth callback returned error from Microsoft'
        );
        redirectError(String(oauthError));
        return;
      }

      if (!code || typeof code !== 'string') {
        logger.error('SharePoint OAuth callback missing code parameter');
        redirectError('missing_code');
        return;
      }

      // ------------------------------------------------------------------
      // Validate state parameter
      // ------------------------------------------------------------------
      if (!state || typeof state !== 'string' || !state.startsWith('sharepoint:')) {
        logger.error({ state }, 'SharePoint OAuth callback: invalid or missing state');
        redirectError('invalid_state');
        return;
      }

      const connectionId = state.slice('sharepoint:'.length).toUpperCase();

      if (!connectionId) {
        logger.error('SharePoint OAuth callback: empty connectionId in state');
        redirectError('invalid_state');
        return;
      }

      // ------------------------------------------------------------------
      // Validate user is authenticated (session must exist)
      // ------------------------------------------------------------------
      const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;
      const userId = oauthSession?.userId;

      if (!userId) {
        logger.warn({ connectionId }, 'SharePoint callback: unauthenticated session');
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
          'SharePoint callback: connection not found or belongs to another user'
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
        req.session?.sharepointMsalPartitionKey
        ?? oauthSession?.msalPartitionKey
        ?? req.sessionID;

      const redirectUri = getRedirectUri();
      const msalClient = buildMsalClient(msalPartitionKey);

      const tokenResult = await msalClient.acquireTokenByCode({
        code,
        scopes: SHAREPOINT_SCOPES,
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

      // Store MSAL metadata, granted scopes, and display name
      await prisma.connections.update({
        where: { id: connectionId },
        data: {
          ...(homeAccountId && { msal_home_account_id: homeAccountId }),
          scopes_granted: SCOPES_GRANTED_VALUE,
          display_name: 'SharePoint',
          updated_at: new Date(),
        },
      });

      logger.info(
        { connectionId, homeAccountId, expiresAt },
        'Stored SharePoint tokens from OAuth callback'
      );

      // ------------------------------------------------------------------
      // Clean up temporary session key
      // ------------------------------------------------------------------
      if (req.session?.sharepointMsalPartitionKey) {
        delete req.session.sharepointMsalPartitionKey;
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
              'Failed to save session after SharePoint OAuth callback'
            );
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.info(
        { userId, connectionId },
        'SharePoint OAuth callback completed; redirecting to frontend'
      );

      res.redirect(
        `${frontendUrl}/new?connected=sharepoint&connectionId=${encodeURIComponent(connectionId)}`
      );
    } catch (error) {
      const errorInfo =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { value: String(error) };
      logger.error({ error: errorInfo }, 'SharePoint OAuth callback failed with unexpected error');
      redirectError('callback_failed');
    }
  }
);

export default router;
