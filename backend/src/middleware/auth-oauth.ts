/**
 * Microsoft OAuth Authentication Middleware
 *
 * Provides middleware for:
 * - Verifying Microsoft OAuth session
 * - Checking Business Central API access
 * - Extracting user from session
 */

import { Request, Response, NextFunction } from 'express';
import { MicrosoftOAuthSession } from '../types/microsoft.types';
import { logger } from '../utils/logger';

/**
 * Extend Express Request to include Microsoft OAuth session
 */
declare global {
  namespace Express {
    interface Request {
      microsoftSession?: MicrosoftOAuthSession;
      userId?: string;
      userEmail?: string;
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
export function authenticateMicrosoft(req: Request, res: Response, next: NextFunction): void {
  try {
    // Check if session exists
    if (!req.session || !req.session.microsoftOAuth) {
      logger.warn('Microsoft OAuth authentication failed: No session', {
        path: req.path,
        method: req.method,
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Microsoft OAuth session not found. Please log in.',
      });
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

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid Microsoft OAuth session. Please log in again.',
      });
      return;
    }

    // Check if access token is present and not expired
    if (!oauthSession.accessToken) {
      logger.warn('Microsoft OAuth authentication failed: No access token', {
        path: req.path,
        method: req.method,
        userId: oauthSession.userId,
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token missing. Please log in again.',
      });
      return;
    }

    // Check token expiration
    if (oauthSession.tokenExpiresAt && new Date(oauthSession.tokenExpiresAt) <= new Date()) {
      logger.warn('Microsoft OAuth authentication failed: Token expired', {
        path: req.path,
        method: req.method,
        userId: oauthSession.userId,
        expiresAt: oauthSession.tokenExpiresAt,
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token expired. Please log in again.',
      });
      return;
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

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed due to server error',
    });
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
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated',
      });
      return;
    }

    // Check if user has BC tokens in database
    const { executeQuery } = await import('../config/database');

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
      res.status(404).json({
        error: 'User Not Found',
        message: 'User record not found',
      });
      return;
    }

    const user = result.recordset[0] as Record<string, unknown>;

    // Check if BC token exists
    if (!user.bc_access_token_encrypted) {
      logger.warn('Business Central access required but not granted', {
        userId: req.userId,
        path: req.path,
      });

      res.status(403).json({
        error: 'Business Central Access Required',
        message: 'You have not granted access to Business Central. Please visit /api/auth/bc-consent to authorize.',
        consentUrl: '/api/auth/bc-consent',
      });
      return;
    }

    // Check if BC token is expired
    const expiresAt = new Date(user.bc_token_expires_at as string);
    const now = new Date();

    if (expiresAt <= now) {
      logger.warn('Business Central token expired', {
        userId: req.userId,
        expiresAt,
        path: req.path,
      });

      res.status(403).json({
        error: 'Business Central Token Expired',
        message: 'Your Business Central access token has expired. Token will be refreshed automatically on next request, or visit /api/auth/bc-consent.',
        consentUrl: '/api/auth/bc-consent',
      });
      return;
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

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify Business Central access',
    });
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
