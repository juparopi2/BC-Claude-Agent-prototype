/**
 * Microsoft OAuth Authentication Routes
 *
 * Handles Microsoft Entra ID OAuth 2.0 authentication flow.
 *
 * Endpoints:
 * - GET /api/auth/login - Start OAuth login flow
 * - GET /api/auth/callback - Handle OAuth callback
 * - POST /api/auth/logout - Logout user
 * - GET /api/auth/me - Get current user
 * - GET /api/auth/bc-status - Check Business Central token status
 * - POST /api/auth/bc-consent - Grant Business Central consent
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { executeQuery } from '@/infrastructure/database/database';
import { createMicrosoftOAuthService } from '@/domains/auth/oauth/MicrosoftOAuthService';
import { createBCTokenManager } from '@/services/auth/BCTokenManager';
import { authenticateMicrosoft, authenticateMicrosoftOptional } from '@/domains/auth/middleware/auth-oauth';
import { MicrosoftOAuthSession } from '@/types/microsoft.types';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';
import { AUTH_TIME_MS } from '@bc-agent/shared';
import { deleteMsalCache } from '@/domains/auth/oauth/MsalRedisCachePlugin';

const logger = createChildLogger({ service: 'AuthOAuthRoutes' });

/**
 * Extract tenant ID from client_info base64 string
 * client_info contains: { uid: user_id, utid: tenant_id }
 */
function extractTenantIdFromClientInfo(clientInfo: string | undefined): string | null {
  if (!clientInfo) return null;
  try {
    const decoded = JSON.parse(Buffer.from(clientInfo, 'base64').toString('utf8'));
    return decoded.utid || null;
  } catch {
    return null;
  }
}

const router = Router();

// Initialize services
const oauthService = createMicrosoftOAuthService();
const bcTokenManager = createBCTokenManager();

/**
 * GET /api/auth/login
 *
 * Start Microsoft OAuth login flow.
 * Generates authorization URL and redirects user to Microsoft login page.
 */
router.get('/login', async (req: Request, res: Response) => {
  try {
    // Generate CSRF protection state
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session for verification
    if (req.session) {
      req.session.oauthState = state;
    }

    // Get authorization URL
    const authUrl = await oauthService.getAuthCodeUrl(state);

    logger.info('Redirecting to Microsoft login', { state });

    // CRITICAL: Ensure session is saved to Redis BEFORE redirecting
    // Without this, the redirect may happen before async session save completes,
    // causing "invalid_state" errors when Microsoft redirects back to callback
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error('Failed to save session before OAuth redirect', {
            error: err instanceof Error
              ? { message: err.message, stack: err.stack }
              : { value: String(err) }
          });
          reject(err);
        } else {
          logger.info('Session saved successfully before OAuth redirect', {
            sessionID: req.sessionID,
            hasOAuthState: !!req.session?.oauthState
          });
          resolve();
        }
      });
    });

    // Now safe to redirect
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to start Microsoft login', { error });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to start Microsoft login');
  }
});

/**
 * GET /api/auth/callback
 *
 * Handle OAuth callback from Microsoft.
 * Exchanges authorization code for tokens and creates user session.
 *
 * IMPORTANT: OAuth authorization codes are ONE-TIME USE. We exchange the code
 * exactly ONCE using handleAuthCallbackWithCache with sessionId as the MSAL
 * cache partition key. This avoids the "chicken and egg" problem where we need
 * userId before exchanging the code.
 *
 * Flow:
 * 1. Validate state (CSRF)
 * 2. Exchange code for tokens using sessionId as cache partition key
 * 3. Get user profile using the access token
 * 4. Lookup/create user in database
 * 5. Store sessionId as msalPartitionKey in session
 * 6. Redirect to frontend
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError, error_description, client_info } = req.query;

    // Enhanced diagnostic logging for troubleshooting session issues
    logger.info('OAuth callback received', {
      hasSession: !!req.session,
      sessionID: req.sessionID,
      hasOAuthState: !!req.session?.oauthState,
      receivedState: typeof state === 'string' ? state.substring(0, 16) + '...' : undefined,
      expectedState: req.session?.oauthState ? req.session.oauthState.substring(0, 16) + '...' : undefined,
      hasCode: !!code,
    });

    // Check for OAuth errors
    if (oauthError) {
      logger.error('OAuth callback error', { oauthError, error_description });
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=${oauthError}`);
    }

    // Validate required parameters
    if (!code || typeof code !== 'string') {
      logger.error('OAuth callback missing code parameter');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=missing_code`);
    }

    // Verify CSRF state
    if (!state || state !== req.session?.oauthState) {
      logger.error('OAuth callback state mismatch', { receivedState: state, expectedState: req.session?.oauthState });
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=invalid_state`);
    }

    // Clear state from session
    if (req.session) {
      delete req.session.oauthState;
    }

    // Use sessionId as the MSAL cache partition key
    // This avoids the "chicken and egg" problem: we don't have userId yet
    // but we need a partition key to exchange the code
    const msalPartitionKey = req.sessionID;

    // Exchange authorization code for tokens ONCE using sessionId as partition key
    // CRITICAL: OAuth codes are ONE-TIME USE - do not call this twice!
    const tokenResponse = await oauthService.handleAuthCallbackWithCache(code, state as string, msalPartitionKey);

    // Get user profile using the access token
    const userProfile = await oauthService.getUserProfile(tokenResponse.access_token);

    // Diagnostic logging for token acquisition
    logger.info({
      hasAccessToken: !!tokenResponse.access_token,
      hasHomeAccountId: !!tokenResponse.homeAccountId,
      expiresIn: tokenResponse.expires_in,
      scopes: tokenResponse.scope,
      msalPartitionKey,
    }, 'Token response received from MSAL with Redis cache');

    // Extract real tenant ID from client_info (for multi-tenant apps using "common" authority)
    const realTenantId = extractTenantIdFromClientInfo(client_info as string | undefined);
    logger.info('Extracted tenant ID from client_info', { realTenantId, hasClientInfo: !!client_info });

    // Check if user exists in database
    const existingUserResult = await executeQuery(
      `
      SELECT id, microsoft_id, email, full_name, role
      FROM users
      WHERE microsoft_id = @microsoftId OR email = @email
      `,
      { microsoftId: userProfile.id, email: userProfile.mail }
    );

    let userId: string;

    if (existingUserResult.recordset && existingUserResult.recordset.length > 0) {
      // User exists, update Microsoft login data
      const user = existingUserResult.recordset[0] as Record<string, unknown>;
      userId = user.id as string;

      await executeQuery(
        `
        UPDATE users
        SET microsoft_id = @microsoftId,
            microsoft_email = @microsoftEmail,
            microsoft_tenant_id = @tenantId,
            last_microsoft_login = GETDATE(),
            updated_at = GETDATE()
        WHERE id = @userId
        `,
        {
          userId,
          microsoftId: userProfile.id,
          microsoftEmail: userProfile.mail,
          tenantId: realTenantId,  // Use actual tenant ID from token, not config
        }
      );

      logger.info('Updated existing user with Microsoft login', { userId, email: userProfile.mail });
    } else {
      // Create new user
      userId = crypto.randomUUID();

      await executeQuery(
        `
        INSERT INTO users (
          id, email, full_name, microsoft_id, microsoft_email, microsoft_tenant_id,
          role, is_active, last_microsoft_login, created_at, updated_at
        )
        VALUES (
          @userId, @email, @fullName, @microsoftId, @microsoftEmail, @tenantId,
          'viewer', 1, GETDATE(), GETDATE(), GETDATE()
        )
        `,
        {
          userId,
          email: userProfile.mail,
          fullName: userProfile.displayName,
          microsoftId: userProfile.id,
          microsoftEmail: userProfile.mail,
          tenantId: realTenantId,  // Use actual tenant ID from token, not config
        }
      );

      logger.info('Created new user with Microsoft login', { userId, email: userProfile.mail });
    }

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Try to acquire Business Central token using silent refresh
    try {
      if (tokenResponse.homeAccountId) {
        const bcToken = await oauthService.acquireBCTokenSilent(msalPartitionKey, tokenResponse.homeAccountId);
        await bcTokenManager.storeBCToken(userId, bcToken);
        logger.info('Acquired and stored Business Central token via silent refresh', { userId });
      }
    } catch (bcError) {
      logger.warn('Failed to acquire Business Central token during login (user may need to grant consent)', {
        userId,
        error: bcError instanceof Error
          ? { message: bcError.message, name: bcError.name }
          : { value: String(bcError) },
      });
      // Continue without BC token - user will be prompted to grant consent later
    }

    // Create Microsoft OAuth session
    // Store homeAccountId and msalPartitionKey for future token refreshes via acquireTokenSilent
    const microsoftSession: MicrosoftOAuthSession = {
      userId,
      microsoftId: userProfile.id,
      displayName: userProfile.displayName,
      email: userProfile.mail,
      accessToken: tokenResponse.access_token,
      homeAccountId: tokenResponse.homeAccountId,  // Used for acquireTokenSilent
      msalPartitionKey,  // sessionId used as MSAL cache partition key
      tokenExpiresAt: expiresAt.toISOString(),
    };

    // Store in express-session
    if (req.session) {
      req.session.microsoftOAuth = microsoftSession;
    }

    // Diagnostic: confirm what's being stored in session
    logger.info({
      userId,
      email: userProfile.mail,
      hasHomeAccountId: !!microsoftSession.homeAccountId,
      msalPartitionKey: microsoftSession.msalPartitionKey,
      tokenExpiresAt: microsoftSession.tokenExpiresAt,
    }, 'Microsoft OAuth login successful (cache-based refresh enabled)');

    // Redirect to frontend app
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/new`);
  } catch (error) {
    logger.error('OAuth callback error', { error });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=callback_failed`);
  }
});

/**
 * POST /api/auth/refresh
 *
 * Proactively refresh the OAuth access token.
 * Uses MSAL acquireTokenSilent with Redis-cached tokens.
 */
router.post('/refresh', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const oauthSession = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;

    // Require homeAccountId and msalPartitionKey for cache-based refresh
    if (!oauthSession?.homeAccountId || !oauthSession?.msalPartitionKey) {
      logger.warn('Token refresh failed: Missing homeAccountId or msalPartitionKey (session expired or legacy)', {
        userId: req.userId,
        hasHomeAccountId: !!oauthSession?.homeAccountId,
        hasMsalPartitionKey: !!oauthSession?.msalPartitionKey,
      });
      sendError(res, ErrorCode.SESSION_EXPIRED, 'Session expired. Please log in again.');
      return;
    }

    // Use acquireTokenSilent with Redis cache
    logger.debug('Refreshing access token via acquireTokenSilent', {
      userId: req.userId,
      homeAccountId: oauthSession.homeAccountId,
      msalPartitionKey: oauthSession.msalPartitionKey,
    });

    const refreshed = await oauthService.refreshAccessTokenSilent(
      oauthSession.msalPartitionKey,
      oauthSession.homeAccountId
    );

    // Update session with new access token
    // Note: homeAccountId and msalPartitionKey stay the same
    req.session.microsoftOAuth = {
      ...oauthSession,
      accessToken: refreshed.accessToken,
      tokenExpiresAt: refreshed.expiresAt instanceof Date
        ? refreshed.expiresAt.toISOString()
        : String(refreshed.expiresAt),
    };

    // Force save session to ensure it's persisted
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info('Access token refreshed successfully via acquireTokenSilent', {
      userId: req.userId,
      newExpiresAt: refreshed.expiresAt instanceof Date
        ? refreshed.expiresAt.toISOString()
        : refreshed.expiresAt,
    });

    res.json({
      success: true,
      expiresAt: refreshed.expiresAt instanceof Date
        ? refreshed.expiresAt.toISOString()
        : refreshed.expiresAt,
    });
  } catch (error) {
    logger.error('Failed to refresh access token via /refresh endpoint', {
      error: error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { value: String(error) },
      userId: req.userId,
    });
    sendError(res, ErrorCode.SESSION_EXPIRED, 'Failed to refresh access token. Please log in again.');
  }
});

/**
 * POST /api/auth/logout
 *
 * Logout user and destroy session.
 * Also cleans up MSAL token cache in Redis.
 */
router.post('/logout', authenticateMicrosoftOptional, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const msalPartitionKey = req.microsoftSession?.msalPartitionKey;

    // Clean up MSAL token cache in Redis using the partition key
    if (msalPartitionKey) {
      try {
        await deleteMsalCache(msalPartitionKey);
        logger.info('Deleted MSAL cache', { userId, msalPartitionKey });
      } catch (cacheError) {
        // Log but don't fail logout if cache deletion fails
        logger.warn('Failed to delete MSAL cache during logout', {
          userId,
          msalPartitionKey,
          error: cacheError instanceof Error
            ? { message: cacheError.message }
            : { value: String(cacheError) },
        });
      }
    }

    // Destroy session
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          logger.error('Failed to destroy session', { error: err, userId });
        }
      });
    }

    logger.info('User logged out', { userId: userId || 'unauthenticated' });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', { error });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to logout');
  }
});

/**
 * GET /api/auth/me
 *
 * Get current authenticated user.
 */
router.get('/me', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;

    // Fetch user from database
    const result = await executeQuery(
      `
      SELECT id, email, full_name, role, microsoft_email, microsoft_id,
             last_microsoft_login, created_at, is_active
      FROM users
      WHERE id = @userId
      `,
      { userId }
    );

    if (!result.recordset || result.recordset.length === 0) {
      sendError(res, ErrorCode.USER_NOT_FOUND, 'User record not found');
      return;
    }

    const user = result.recordset[0] as Record<string, unknown>;

    // Calculate session expiration
    const sessionMaxAge = parseInt(process.env.SESSION_MAX_AGE || String(AUTH_TIME_MS.DEFAULT_SESSION_MAX_AGE));
    const sessionExpiresAt = new Date(Date.now() + sessionMaxAge).toISOString();

    res.json({
      id: (user.id as string).toUpperCase(), // UPPERCASE per CLAUDE.md ID standardization
      email: user.email,
      displayName: user.full_name,
      fullName: user.full_name,
      role: user.role,
      isAdmin: user.role === 'admin',
      microsoftEmail: user.microsoft_email,
      microsoftId: user.microsoft_id,
      lastLogin: user.last_microsoft_login,
      createdAt: user.created_at,
      isActive: user.is_active,
      // Auth expiry data
      tokenExpiresAt: req.microsoftSession?.tokenExpiresAt || null,
      sessionExpiresAt,
    });
  } catch (error) {
    logger.error('Failed to get current user', { error, userId: req.userId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get user information');
  }
});

/**
 * GET /api/auth/bc-status
 *
 * Check Business Central token status.
 */
router.get('/bc-status', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Fetch BC token status
    const result = await executeQuery(
      `
      SELECT bc_access_token_encrypted,
             bc_token_expires_at
      FROM users
      WHERE id = @userId
      `,
      { userId }
    );

    if (!result.recordset || result.recordset.length === 0) {
      sendError(res, ErrorCode.USER_NOT_FOUND, 'User record not found');
      return;
    }

    const user = result.recordset[0] as Record<string, unknown>;

    if (!user.bc_access_token_encrypted) {
      res.json({
        hasAccess: false,
        message: 'Business Central access not granted',
        consentUrl: '/api/auth/bc-consent',
      });
      return;
    }

    const expiresAt = new Date(user.bc_token_expires_at as string);
    const now = new Date();
    const isExpired = expiresAt <= now;

    res.json({
      hasAccess: !isExpired,
      expiresAt: expiresAt.toISOString(),
      isExpired,
      message: isExpired ? 'Business Central token expired (will be refreshed automatically)' : 'Business Central access is active',
      consentUrl: '/api/auth/bc-consent',
    });
  } catch (error) {
    logger.error('Failed to check BC status', { error, userId: req.userId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check Business Central status');
  }
});

/**
 * POST /api/auth/bc-consent
 *
 * Grant Business Central API consent.
 * Acquires BC token with delegated permissions and stores it.
 * Uses MSAL cache-based token acquisition.
 */
router.post('/bc-consent', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const homeAccountId = req.microsoftSession?.homeAccountId;
    const msalPartitionKey = req.microsoftSession?.msalPartitionKey;

    // Require homeAccountId and msalPartitionKey for cache-based token acquisition
    if (!homeAccountId || !msalPartitionKey) {
      logger.warn('BC consent failed: Missing homeAccountId or msalPartitionKey (session expired or legacy)', {
        userId,
        hasHomeAccountId: !!homeAccountId,
        hasMsalPartitionKey: !!msalPartitionKey,
      });
      sendError(res, ErrorCode.SESSION_EXPIRED, 'Session expired. Please log in again.');
      return;
    }

    // Acquire BC token via silent refresh using MSAL cache
    const bcToken = await oauthService.acquireBCTokenSilent(msalPartitionKey, homeAccountId);
    await bcTokenManager.storeBCToken(userId, bcToken);

    logger.info('Business Central consent granted via acquireTokenSilent', { userId });

    res.json({
      success: true,
      message: 'Business Central access granted successfully',
      expiresAt: bcToken.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to grant Business Central consent', { error, userId: req.userId });
    sendError(res, ErrorCode.BC_UNAVAILABLE, 'Failed to grant Business Central access. You may need to grant admin consent for the Financials.ReadWrite.All permission.');
  }
});

export default router;
