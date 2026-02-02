/**
 * Microsoft OAuth Authentication Middleware
 *
 * Provides middleware for:
 * - Verifying Microsoft OAuth session
 * - Checking Business Central API access
 * - Extracting user from session
 */

import { Request, Response, NextFunction } from 'express';
import { MicrosoftOAuthSession } from '@/types/microsoft.types';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import {
  sendError,
  sendUnauthorized,
  sendNotFound,
  sendInternalError,
} from '@/shared/utils/error-response';
import { AUTH_TIME_MS } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'OAuthMiddleware' });

/**
 * Extend Express Request to include Microsoft OAuth session and BC tokens
 */
declare global {
  namespace Express {
    interface Request {
      microsoftSession?: MicrosoftOAuthSession;
      userId?: string;
      userEmail?: string;
      /** BC access token (set by requireBCAccess middleware after auto-refresh) */
      bcAccessToken?: string;
      /** BC token expiration (set by requireBCAccess middleware after auto-refresh) */
      bcTokenExpiresAt?: Date;
    }
  }
}

/**
 * Middleware: Authenticate with Microsoft OAuth
 *
 * Verifies that the user has a valid Microsoft OAuth session.
 * If authenticated, attaches user info to req.microsoftSession, req.userId, req.userEmail.
 * If not authenticated, returns 401 Unauthorized.
 *
 * Usage:
 * ```typescript
 * router.get('/protected', authenticateMicrosoft, (req, res) => {
 *   const userId = req.userId; // Available after auth
 * });
 * ```
 */
export async function authenticateMicrosoft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {

    // Check if session exists
    if (!req.session || !req.session.microsoftOAuth) {

      logger.warn('Microsoft OAuth authentication failed: No session', {
        path: req.path,
        method: req.method,
      });

      sendError(res, ErrorCode.UNAUTHORIZED, 'Microsoft OAuth session not found. Please log in.');
      return;
    }

    const oauthSession = req.session.microsoftOAuth as MicrosoftOAuthSession;

    // Verify required session fields
    if (!oauthSession.userId || !oauthSession.microsoftId) {
      logger.warn('Microsoft OAuth authentication failed: Invalid session data', {
        path: req.path,
        method: req.method,
        hasUserId: !!oauthSession.userId,
        hasMicrosoftId: !!oauthSession.microsoftId,
      });

      sendError(res, ErrorCode.UNAUTHORIZED, 'Invalid Microsoft OAuth session. Please log in again.');
      return;
    }

    // Check if access token is present and not expired
    if (!oauthSession.accessToken) {
      logger.warn('Microsoft OAuth authentication failed: No access token', {
        path: req.path,
        method: req.method,
        userId: oauthSession.userId,
      });

      sendError(res, ErrorCode.INVALID_TOKEN, 'Access token missing. Please log in again.');
      return;
    }

    // Check token expiration and auto-refresh if needed (proactive: refresh 5 min before expiry)
    const tokenExpiresAt = oauthSession.tokenExpiresAt ? new Date(oauthSession.tokenExpiresAt) : null;
    const shouldRefresh = tokenExpiresAt &&
      tokenExpiresAt.getTime() <= Date.now() + AUTH_TIME_MS.PROACTIVE_REFRESH_BUFFER;

    if (shouldRefresh) {
      const isExpired = tokenExpiresAt.getTime() <= Date.now();
      logger.info(isExpired ? 'Access token expired, attempting auto-refresh' : 'Access token expiring soon, proactive refresh', {
        path: req.path,
        method: req.method,
        userId: oauthSession.userId,
        expiresAt: oauthSession.tokenExpiresAt,
        timeUntilExpiry: tokenExpiresAt.getTime() - Date.now(),
      });

      // Require homeAccountId and msalPartitionKey for cache-based refresh
      if (!oauthSession.homeAccountId || !oauthSession.msalPartitionKey) {
        logger.warn('Token expired but no homeAccountId/msalPartitionKey available (legacy session)', {
          userId: oauthSession.userId,
          hasHomeAccountId: !!oauthSession.homeAccountId,
          hasMsalPartitionKey: !!oauthSession.msalPartitionKey,
        });

        sendError(res, ErrorCode.SESSION_EXPIRED, 'Session expired. Please log in again.');
        return;
      }

      // Attempt to refresh the token automatically using MSAL cache
      try {
        const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');
        const oauthService = createMicrosoftOAuthService();

        logger.debug('Refreshing access token via acquireTokenSilent', {
          userId: oauthSession.userId,
          msalPartitionKey: oauthSession.msalPartitionKey,
        });

        const refreshed = await oauthService.refreshAccessTokenSilent(
          oauthSession.msalPartitionKey,
          oauthSession.homeAccountId
        );

        // Update session with new access token
        req.session.microsoftOAuth = {
          ...oauthSession,
          accessToken: refreshed.accessToken,
          tokenExpiresAt: refreshed.expiresAt instanceof Date
            ? refreshed.expiresAt.toISOString()
            : String(refreshed.expiresAt),
        };

        // Save session (force save to ensure it's persisted)
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        logger.info('Access token refreshed successfully via acquireTokenSilent', {
          userId: oauthSession.userId,
          newExpiresAt: refreshed.expiresAt instanceof Date
            ? refreshed.expiresAt.toISOString()
            : refreshed.expiresAt,
        });

        // Continue with refreshed token
        req.microsoftSession = req.session.microsoftOAuth;
        req.userId = oauthSession.userId;
        req.userEmail = oauthSession.email;

        next();
        return;
      } catch (error) {
        logger.error('Failed to refresh access token via acquireTokenSilent', {
          error: error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { value: String(error) },
          userId: oauthSession.userId,
        });

        // Refresh failed, require re-login
        sendError(res, ErrorCode.SESSION_EXPIRED, 'Failed to refresh access token. Please log in again.');
        return;
      }
    }

    // Attach session data to request
    req.microsoftSession = oauthSession;
    req.userId = oauthSession.userId;
    req.userEmail = oauthSession.email;

    logger.debug('Microsoft OAuth authentication successful', {
      path: req.path,
      method: req.method,
      userId: oauthSession.userId,
      email: oauthSession.email,
    });

    next();
  } catch (error) {
    logger.error('Microsoft OAuth authentication error', {
      error,
      path: req.path,
      method: req.method,
    });

    sendInternalError(res, ErrorCode.SERVICE_ERROR);
  }
}

/**
 * Middleware: Require Business Central API Access
 *
 * Verifies that the user has a valid Business Central API token.
 * Must be used after authenticateMicrosoft middleware.
 *
 * This checks the database to ensure the user has BC tokens stored.
 * If tokens are missing or expired, returns 403 Forbidden with instructions
 * to grant BC consent via /api/auth/bc-consent endpoint.
 *
 * Usage:
 * ```typescript
 * router.get('/bc-data', authenticateMicrosoft, requireBCAccess, (req, res) => {
 *   // User has valid BC access
 * });
 * ```
 */
export async function requireBCAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Ensure user is authenticated first
    if (!req.userId) {
      sendUnauthorized(res);
      return;
    }

    // Check if user has BC tokens in database
    const { executeQuery } = await import('@/infrastructure/database/database');

    const result = await executeQuery(
      `
      SELECT bc_access_token_encrypted,
             bc_token_expires_at
      FROM users
      WHERE id = @userId
      `,
      { userId: req.userId }
    );

    if (!result.recordset || result.recordset.length === 0) {
      sendNotFound(res, ErrorCode.USER_NOT_FOUND);
      return;
    }

    const user = result.recordset[0] as Record<string, unknown>;

    // Check if BC token exists
    if (!user.bc_access_token_encrypted) {
      logger.warn('Business Central access required but not granted', {
        userId: req.userId,
        path: req.path,
      });

      sendError(res, ErrorCode.BC_UNAVAILABLE, 'You have not granted access to Business Central. Please visit /api/auth/bc-consent to authorize.', { consentUrl: '/api/auth/bc-consent' });
      return;
    }

    // Check if BC token expiration date is valid
    const expiresAtRaw = user.bc_token_expires_at;
    if (!expiresAtRaw) {
      logger.warn('Business Central token expires_at is missing', {
        userId: req.userId,
        path: req.path,
      });

      sendError(res, ErrorCode.INVALID_TOKEN, 'Token expiration date not found. Please re-authorize.', { consentUrl: '/api/auth/bc-consent' });
      return;
    }

    // Check if BC token is expired
    const expiresAt = new Date(expiresAtRaw as string);
    const now = new Date();

    // Handle invalid date (e.g., empty string, malformed date)
    if (isNaN(expiresAt.getTime())) {
      logger.warn('Business Central token has invalid expiration date', {
        userId: req.userId,
        expiresAtRaw,
        path: req.path,
      });

      sendError(res, ErrorCode.INVALID_TOKEN, 'Token has invalid expiration date. Please re-authorize.', { consentUrl: '/api/auth/bc-consent' });
      return;
    }

    if (expiresAt <= now) {
      logger.info('BC token expired, attempting auto-refresh', {
        userId: req.userId,
        expiresAt,
        path: req.path,
      });

      // Auto-refresh BC tokens using MSAL cache
      try {
        const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;

        // Require homeAccountId and msalPartitionKey for cache-based refresh
        if (!oauthSession?.homeAccountId || !oauthSession?.msalPartitionKey) {
          logger.warn('BC token expired but no homeAccountId/msalPartitionKey available (legacy session)', {
            userId: req.userId,
            hasHomeAccountId: !!oauthSession?.homeAccountId,
            hasMsalPartitionKey: !!oauthSession?.msalPartitionKey,
            path: req.path,
          });
          sendError(
            res,
            ErrorCode.SESSION_EXPIRED,
            'Your session has expired. Please log in again.',
            { consentUrl: '/api/auth/bc-consent' }
          );
          return;
        }

        // Import BCTokenManager dynamically to avoid circular dependencies
        const { createBCTokenManager } = await import('@/services/auth/BCTokenManager');
        const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');

        const oauthService = createMicrosoftOAuthService();
        const tokenManager = createBCTokenManager();

        // Refresh BC token using silent refresh
        const bcToken = await oauthService.acquireBCTokenSilent(
          oauthSession.msalPartitionKey,
          oauthSession.homeAccountId
        );

        // Store refreshed BC token
        await tokenManager.storeBCToken(req.userId, bcToken);

        // Attach refreshed token to request
        req.bcAccessToken = bcToken.accessToken;
        req.bcTokenExpiresAt = bcToken.expiresAt;

        logger.info('BC token refreshed successfully via acquireTokenSilent', {
          userId: req.userId,
          newExpiresAt: bcToken.expiresAt.toISOString(),
          path: req.path,
        });

        next();
        return;
      } catch (refreshError) {
        logger.error('Failed to refresh BC token via acquireTokenSilent', {
          userId: req.userId,
          path: req.path,
          error: refreshError instanceof Error
            ? { message: refreshError.message, stack: refreshError.stack }
            : { value: String(refreshError) },
        });

        sendError(
          res,
          ErrorCode.SESSION_EXPIRED,
          'Failed to refresh Business Central access token. Please re-authorize.',
          { consentUrl: '/api/auth/bc-consent' }
        );
        return;
      }
    }

    logger.debug('Business Central access verified', {
      userId: req.userId,
      expiresAt,
    });

    next();
  } catch (error) {
    logger.error('Business Central access check error', {
      error,
      userId: req.userId,
      path: req.path,
    });

    sendInternalError(res, ErrorCode.SERVICE_ERROR);
  }
}

/**
 * Middleware: Authenticate Optional (for public/private routes)
 *
 * Similar to authenticateMicrosoft but doesn't return 401 if not authenticated.
 * If authenticated, attaches user info to request. If not, continues without auth.
 *
 * Useful for routes that work for both authenticated and unauthenticated users.
 */
export function authenticateMicrosoftOptional(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.session || !req.session.microsoftOAuth) {
      // No session, continue without auth
      next();
      return;
    }

    const oauthSession = req.session.microsoftOAuth as MicrosoftOAuthSession;

    // Verify session validity
    if (
      oauthSession.userId &&
      oauthSession.microsoftId &&
      oauthSession.accessToken &&
      (!oauthSession.tokenExpiresAt || new Date(oauthSession.tokenExpiresAt) > new Date())
    ) {
      // Valid session, attach to request
      req.microsoftSession = oauthSession;
      req.userId = oauthSession.userId;
      req.userEmail = oauthSession.email;
    }

    next();
  } catch (error) {
    logger.error('Optional Microsoft OAuth authentication error', {
      error,
      path: req.path,
    });

    // Continue without auth on error
    next();
  }
}
