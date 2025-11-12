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
import { executeQuery } from '../config/database';
import { createMicrosoftOAuthService } from '../services/auth/MicrosoftOAuthService';
import { createBCTokenManager } from '../services/auth/BCTokenManager';
import { authenticateMicrosoft } from '../middleware/auth-oauth';
import { MicrosoftOAuthSession } from '../types/microsoft.types';
import { logger } from '../utils/logger';

const router = Router();

// Initialize services
const oauthService = createMicrosoftOAuthService();
const bcTokenManager = createBCTokenManager(oauthService);

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

    // Redirect to Microsoft login
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to start Microsoft login', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to start Microsoft login',
    });
  }
});

/**
 * GET /api/auth/callback
 *
 * Handle OAuth callback from Microsoft.
 * Exchanges authorization code for tokens and creates user session.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

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

    // Exchange code for tokens
    const tokenResponse = await oauthService.handleAuthCallback(code, state as string);

    // Get user profile from Microsoft Graph
    const userProfile = await oauthService.getUserProfile(tokenResponse.access_token);

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

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
          tenantId: oauthService.getConfig().tenantId,
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
          tenantId: oauthService.getConfig().tenantId,
        }
      );

      logger.info('Created new user with Microsoft login', { userId, email: userProfile.mail });
    }

    // Try to acquire Business Central token (may fail if consent not granted yet)
    try {
      if (tokenResponse.refresh_token) {
        const bcToken = await oauthService.acquireBCToken(tokenResponse.refresh_token);
        await bcTokenManager.storeBCToken(userId, bcToken);
        logger.info('Acquired and stored Business Central token', { userId });
      }
    } catch (bcError) {
      logger.warn('Failed to acquire Business Central token during login (user may need to grant consent)', {
        userId,
        error: bcError,
      });
      // Continue without BC token - user will be prompted to grant consent later
    }

    // Create Microsoft OAuth session
    const microsoftSession: MicrosoftOAuthSession = {
      userId,
      microsoftId: userProfile.id,
      displayName: userProfile.displayName,
      email: userProfile.mail,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt: expiresAt,
    };

    // Store in express-session
    if (req.session) {
      req.session.microsoftOAuth = microsoftSession;
    }

    logger.info('Microsoft OAuth login successful', { userId, email: userProfile.mail });

    // Redirect to frontend app
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/new`);
  } catch (error) {
    logger.error('OAuth callback error', { error });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=callback_failed`);
  }
});

/**
 * POST /api/auth/logout
 *
 * Logout user and destroy session.
 */
router.post('/logout', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;

    // Destroy session
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          logger.error('Failed to destroy session', { error: err, userId });
        }
      });
    }

    logger.info('User logged out', { userId });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to logout',
    });
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
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User record not found',
      });
    }

    const user = result.recordset[0] as Record<string, unknown>;

    return res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      microsoftEmail: user.microsoft_email,
      microsoftId: user.microsoft_id,
      lastLogin: user.last_microsoft_login,
      createdAt: user.created_at,
      isActive: user.is_active,
    });
  } catch (error) {
    logger.error('Failed to get current user', { error, userId: req.userId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user information',
    });
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
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User record not found',
      });
    }

    const user = result.recordset[0] as Record<string, unknown>;

    if (!user.bc_access_token_encrypted) {
      return res.json({
        hasAccess: false,
        message: 'Business Central access not granted',
        consentUrl: '/api/auth/bc-consent',
      });
    }

    const expiresAt = new Date(user.bc_token_expires_at as string);
    const now = new Date();
    const isExpired = expiresAt <= now;

    return res.json({
      hasAccess: !isExpired,
      expiresAt: expiresAt.toISOString(),
      isExpired,
      message: isExpired ? 'Business Central token expired (will be refreshed automatically)' : 'Business Central access is active',
      consentUrl: '/api/auth/bc-consent',
    });
  } catch (error) {
    logger.error('Failed to check BC status', { error, userId: req.userId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check Business Central status',
    });
  }
});

/**
 * POST /api/auth/bc-consent
 *
 * Grant Business Central API consent.
 * Acquires BC token with delegated permissions and stores it.
 */
router.post('/bc-consent', authenticateMicrosoft, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const refreshToken = req.microsoftSession?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token not found in session. Please log in again.',
      });
    }

    // Acquire Business Central token
    const bcToken = await oauthService.acquireBCToken(refreshToken);

    // Store encrypted BC token
    await bcTokenManager.storeBCToken(userId, bcToken);

    logger.info('Business Central consent granted', { userId });

    return res.json({
      success: true,
      message: 'Business Central access granted successfully',
      expiresAt: bcToken.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to grant Business Central consent', { error, userId: req.userId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to grant Business Central access. You may need to grant admin consent for the Financials.ReadWrite.All permission.',
    });
  }
});

export default router;
