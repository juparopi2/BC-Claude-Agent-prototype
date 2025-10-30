/**
 * Authentication Routes
 *
 * API endpoints for user authentication and token management.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getAuthService } from '@/services/auth';
import { authenticateJWT } from '@/middleware/auth';
import { AuthenticationError } from '@/types';

const router = Router();

/**
 * Zod Schemas for Request Validation
 */

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * POST /api/auth/register
 *
 * Register a new user account.
 *
 * Request Body:
 * - email: string (valid email)
 * - password: string (min 8 chars, 1 uppercase, 1 number)
 * - fullName: string
 *
 * Response:
 * - user: UserDTO
 * - accessToken: string (JWT, 24h expiry)
 * - refreshToken: string (JWT, 7d expiry)
 *
 * Status Codes:
 * - 201: User created successfully
 * - 400: Invalid input or email already exists
 * - 500: Server error
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, fullName } = validation.data;

    // Register user
    const authService = getAuthService();
    const result = await authService.register({ email, password, fullName });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(400).json({
        error: 'Registration failed',
        message: error.message,
      });
      return;
    }

    console.error('[Auth Routes] Register error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Registration failed',
    });
  }
});

/**
 * POST /api/auth/login
 *
 * Authenticate user with email and password.
 *
 * Request Body:
 * - email: string
 * - password: string
 *
 * Response:
 * - user: UserDTO
 * - accessToken: string (JWT, 24h expiry)
 * - refreshToken: string (JWT, 7d expiry)
 *
 * Status Codes:
 * - 200: Login successful
 * - 400: Invalid input
 * - 401: Invalid credentials or account disabled
 * - 500: Server error
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = validation.data;

    // Login user
    const authService = getAuthService();
    const result = await authService.login({ email, password });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        error: 'Authentication failed',
        message: error.message,
      });
      return;
    }

    console.error('[Auth Routes] Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Login failed',
    });
  }
});

/**
 * POST /api/auth/logout
 *
 * Logout user and revoke refresh token.
 *
 * Request Body:
 * - refreshToken: string
 *
 * Response:
 * - message: string
 *
 * Status Codes:
 * - 200: Logout successful
 * - 400: Invalid input
 * - 401: Invalid or expired refresh token
 * - 500: Server error
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = logoutSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { refreshToken } = validation.data;

    // Logout user
    const authService = getAuthService();
    await authService.logout(refreshToken);

    res.status(200).json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        error: 'Logout failed',
        message: error.message,
      });
      return;
    }

    console.error('[Auth Routes] Logout error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Logout failed',
    });
  }
});

/**
 * POST /api/auth/refresh
 *
 * Refresh access token using a valid refresh token.
 *
 * Request Body:
 * - refreshToken: string
 *
 * Response:
 * - accessToken: string (new JWT, 24h expiry)
 * - refreshToken: string (new JWT, 7d expiry)
 *
 * Status Codes:
 * - 200: Token refreshed successfully
 * - 400: Invalid input
 * - 401: Invalid, expired, or revoked refresh token
 * - 500: Server error
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = refreshTokenSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { refreshToken } = validation.data;

    // Refresh tokens
    const authService = getAuthService();
    const result = await authService.refreshTokens(refreshToken);

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        error: 'Token refresh failed',
        message: error.message,
      });
      return;
    }

    console.error('[Auth Routes] Refresh token error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Token refresh failed',
    });
  }
});

/**
 * GET /api/auth/me
 *
 * Get current authenticated user information.
 *
 * Headers:
 * - Authorization: Bearer <access_token>
 *
 * Response:
 * - user: UserDTO (from JWT payload)
 *
 * Status Codes:
 * - 200: User info retrieved successfully
 * - 401: Not authenticated or invalid token
 * - 500: Server error
 */
router.get('/me', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    // User is guaranteed to exist because of authenticateJWT middleware
    const user = req.user!;

    res.status(200).json({
      user: {
        id: user.userId,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error('[Auth Routes] Get current user error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve user information',
    });
  }
});

/**
 * GET /api/auth/status
 *
 * Check authentication service status.
 *
 * Response:
 * - configured: boolean
 * - message: string
 *
 * Status Codes:
 * - 200: Service status retrieved
 */
router.get('/status', (_req: Request, res: Response): void => {
  const authService = getAuthService();
  const configured = authService.isConfigured();

  res.status(200).json({
    configured,
    message: configured
      ? 'Authentication service is configured'
      : 'JWT_SECRET not configured',
  });
});

export default router;
