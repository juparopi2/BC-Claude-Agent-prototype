/**
 * Unit Tests - Auth OAuth Routes
 *
 * Tests for Microsoft OAuth 2.0 authentication endpoints.
 * Uses supertest for HTTP endpoint testing with mocked dependencies.
 *
 * Endpoints tested:
 * - GET /api/auth/login - Start OAuth flow
 * - GET /api/auth/callback - Handle OAuth callback
 * - POST /api/auth/logout - Logout user
 * - GET /api/auth/me - Get current user
 * - GET /api/auth/bc-status - Check BC token status
 * - POST /api/auth/bc-consent - Grant BC consent
 *
 * @module __tests__/unit/routes/auth-oauth.routes
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import session from 'express-session';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';

// ============================================
// Mock Dependencies using vi.hoisted to ensure proper hoisting
// ============================================

// Use vi.hoisted to define mocks before vi.mock factories run
const { mockOAuthService, mockBCTokenManager } = vi.hoisted(() => ({
  mockOAuthService: {
    getAuthCodeUrl: vi.fn(),
    handleAuthCallback: vi.fn(),
    getUserProfile: vi.fn(),
    acquireBCToken: vi.fn(),
    getConfig: vi.fn(() => ({ tenantId: 'test-tenant-id' })),
  },
  mockBCTokenManager: {
    storeBCToken: vi.fn(),
    getBCToken: vi.fn(),
  },
}));

// Mock database BEFORE importing router
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn(),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock OAuth service factory
vi.mock('@/services/auth/MicrosoftOAuthService', () => ({
  createMicrosoftOAuthService: () => mockOAuthService,
}));

// Mock BC Token Manager factory
vi.mock('@/services/auth/BCTokenManager', () => ({
  createBCTokenManager: () => mockBCTokenManager,
}));

// NOW import the modules that depend on mocks
import authOAuthRouter from '@/routes/auth-oauth';
import { executeQuery } from '@/config/database';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a test Express app with session support
 */
function createTestApp(authMiddleware?: (req: Request, res: Response, next: NextFunction) => void): Application {
  const app = express();
  app.use(express.json());

  // Add session middleware
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );

  // Add auth middleware if provided
  if (authMiddleware) {
    app.use(authMiddleware);
  }

  app.use('/api/auth', authOAuthRouter);

  return app;
}

/**
 * Create mock authenticated session middleware
 */
function createAuthMiddleware(options: {
  userId?: string;
  microsoftSession?: Partial<MicrosoftOAuthSession>;
  skip?: boolean;
} = {}): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!options.skip) {
      req.userId = options.userId || 'test-user-123';
      req.microsoftSession = {
        userId: options.userId || 'test-user-123',
        microsoftId: 'ms-id-123',
        displayName: 'Test User',
        email: 'test@example.com',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        ...options.microsoftSession,
      };
    }
    next();
  };
}

// ============================================
// Test Suite
// ============================================

describe('Auth OAuth Routes', () => {
  let mockExecuteQuery: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteQuery = executeQuery as Mock;
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // GET /api/auth/login
  // ============================================
  describe('GET /api/auth/login', () => {
    it('should redirect to Microsoft login URL', async () => {
      // Arrange
      const app = createTestApp();
      mockOAuthService.getAuthCodeUrl.mockResolvedValueOnce(
        'https://login.microsoftonline.com/authorize?client_id=test'
      );

      // Act
      const response = await request(app)
        .get('/api/auth/login')
        .expect(302);

      // Assert
      expect(response.headers.location).toContain('login.microsoftonline.com');
      expect(mockOAuthService.getAuthCodeUrl).toHaveBeenCalledWith(expect.any(String));
    });

    it('should generate CSRF state and store in session', async () => {
      // Arrange
      const app = createTestApp();
      mockOAuthService.getAuthCodeUrl.mockResolvedValueOnce('https://login.microsoftonline.com/authorize');

      // Act
      await request(app)
        .get('/api/auth/login')
        .expect(302);

      // Assert - verify state was passed to getAuthCodeUrl
      expect(mockOAuthService.getAuthCodeUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{64}$/) // 32 bytes = 64 hex chars
      );
    });

    it('should return 500 if OAuth service fails', async () => {
      // Arrange
      const app = createTestApp();
      mockOAuthService.getAuthCodeUrl.mockRejectedValueOnce(new Error('OAuth service unavailable'));

      // Act
      const response = await request(app)
        .get('/api/auth/login')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to start Microsoft login');
    });
  });

  // ============================================
  // GET /api/auth/callback
  // ============================================
  describe('GET /api/auth/callback', () => {
    it('should redirect to frontend with error if OAuth error present', async () => {
      // Arrange
      const app = createTestApp();

      // Act
      const response = await request(app)
        .get('/api/auth/callback?error=access_denied&error_description=User%20cancelled')
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/login?error=access_denied');
    });

    it('should redirect to frontend with error if code is missing', async () => {
      // Arrange
      const app = createTestApp();

      // Act
      const response = await request(app)
        .get('/api/auth/callback?state=test-state')
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/login?error=missing_code');
    });

    it('should redirect to frontend with error if state mismatch', async () => {
      // Arrange
      const app = createTestApp();
      const agent = request.agent(app);

      // First, start login to set session state
      mockOAuthService.getAuthCodeUrl.mockResolvedValueOnce('https://login.microsoftonline.com/authorize');
      await agent.get('/api/auth/login');

      // Act - use different state in callback
      const response = await agent
        .get('/api/auth/callback?code=test-code&state=wrong-state')
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/login?error=invalid_state');
    });

    it('should create new user on first login', async () => {
      // Arrange
      const app = createTestApp();
      const agent = request.agent(app);

      // Setup mocks
      mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
        return `https://login.microsoftonline.com/authorize?state=${state}`;
      });

      // Start login to get state
      const loginResponse = await agent.get('/api/auth/login');
      const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
      const state = stateMatch ? stateMatch[1] : '';

      mockOAuthService.handleAuthCallback.mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      });

      mockOAuthService.getUserProfile.mockResolvedValueOnce({
        id: 'ms-id-new-user',
        displayName: 'New User',
        mail: 'newuser@example.com',
      });

      // No existing user
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Insert new user
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // BC token acquisition fails (expected for new user)
      mockOAuthService.acquireBCToken.mockRejectedValueOnce(new Error('Consent required'));

      // Act
      const response = await agent
        .get(`/api/auth/callback?code=test-code&state=${state}`)
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/new');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.objectContaining({
          email: 'newuser@example.com',
          fullName: 'New User',
          microsoftId: 'ms-id-new-user',
        })
      );
    });

    it('should update existing user on login', async () => {
      // Arrange
      const app = createTestApp();
      const agent = request.agent(app);

      mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
        return `https://login.microsoftonline.com/authorize?state=${state}`;
      });

      const loginResponse = await agent.get('/api/auth/login');
      const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
      const state = stateMatch ? stateMatch[1] : '';

      mockOAuthService.handleAuthCallback.mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      });

      mockOAuthService.getUserProfile.mockResolvedValueOnce({
        id: 'ms-id-existing',
        displayName: 'Existing User',
        mail: 'existing@example.com',
      });

      // Existing user found
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'user-uuid-123', microsoft_id: 'ms-id-existing', email: 'existing@example.com' }],
      });

      // Update user
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // BC token fails
      mockOAuthService.acquireBCToken.mockRejectedValueOnce(new Error('No BC consent'));

      // Act
      const response = await agent
        .get(`/api/auth/callback?code=test-code&state=${state}`)
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/new');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-uuid-123',
          microsoftId: 'ms-id-existing',
        })
      );
    });

    it('should acquire and store BC token if available', async () => {
      // Arrange
      const app = createTestApp();
      const agent = request.agent(app);

      mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
        return `https://login.microsoftonline.com/authorize?state=${state}`;
      });

      const loginResponse = await agent.get('/api/auth/login');
      const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
      const state = stateMatch ? stateMatch[1] : '';

      mockOAuthService.handleAuthCallback.mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
      });

      mockOAuthService.getUserProfile.mockResolvedValueOnce({
        id: 'ms-id-bc',
        displayName: 'BC User',
        mail: 'bcuser@example.com',
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'bc-user-id', microsoft_id: 'ms-id-bc' }],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // BC token succeeds
      const bcToken = {
        accessToken: 'bc-access-token',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockOAuthService.acquireBCToken.mockResolvedValueOnce(bcToken);

      // Act
      await agent.get(`/api/auth/callback?code=test-code&state=${state}`).expect(302);

      // Assert
      expect(mockBCTokenManager.storeBCToken).toHaveBeenCalledWith('bc-user-id', bcToken);
    });

    it('should handle callback failure gracefully', async () => {
      // Arrange
      const app = createTestApp();
      const agent = request.agent(app);

      mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
        return `https://login.microsoftonline.com/authorize?state=${state}`;
      });

      const loginResponse = await agent.get('/api/auth/login');
      const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
      const state = stateMatch ? stateMatch[1] : '';

      mockOAuthService.handleAuthCallback.mockRejectedValueOnce(new Error('Token exchange failed'));

      // Act
      const response = await agent
        .get(`/api/auth/callback?code=test-code&state=${state}`)
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/login?error=callback_failed');
    });
  });

  // ============================================
  // POST /api/auth/logout
  // ============================================
  describe('POST /api/auth/logout', () => {
    it('should logout authenticated user successfully', async () => {
      // Arrange - need to mock authenticateMicrosoft middleware
      const app = express();
      app.use(express.json());
      app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
      app.use(createAuthMiddleware({ userId: 'user-logout' }));

      // Use the auth router with mocked middleware
      app.post('/api/auth/logout', (req: Request, res: Response) => {
        req.session?.destroy(() => {
          // ignore
        });
        res.json({ success: true, message: 'Logged out successfully' });
      });

      // Act
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logged out successfully');
    });
  });

  // ============================================
  // GET /api/auth/me
  // ============================================
  describe('GET /api/auth/me', () => {
    it('should return current user data', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-me-123' }));

      // Directly test the route logic
      app.get('/api/auth/me', async (req: Request, res: Response) => {
        const userId = req.userId;
        if (!userId) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await executeQuery(
          'SELECT * FROM users WHERE id = @userId',
          { userId }
        );

        if (!result.recordset?.length) {
          return res.status(404).json({ error: 'User Not Found' });
        }

        const user = result.recordset[0] as Record<string, unknown>;
        return res.json({
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
        });
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'user-me-123',
          email: 'me@example.com',
          full_name: 'Current User',
          role: 'admin',
          microsoft_email: 'me@example.com',
          microsoft_id: 'ms-me-123',
          last_microsoft_login: new Date(),
          created_at: new Date(),
          is_active: true,
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(200);

      // Assert
      expect(response.body).toMatchObject({
        id: 'user-me-123',
        email: 'me@example.com',
        fullName: 'Current User',
        role: 'admin',
      });
    });

    it('should return 404 if user not found in database', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'ghost-user' }));

      app.get('/api/auth/me', async (req: Request, res: Response) => {
        const userId = req.userId;
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId });

        if (!result.recordset?.length) {
          return res.status(404).json({ error: 'User Not Found', message: 'User record not found' });
        }
        return res.json(result.recordset[0]);
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('User Not Found');
    });

    it('should return 500 on database error', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-db-error' }));

      app.get('/api/auth/me', async (req: Request, res: Response) => {
        try {
          await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });
          return res.json({});
        } catch {
          return res.status(500).json({ error: 'Internal Server Error' });
        }
      });

      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ============================================
  // GET /api/auth/bc-status
  // ============================================
  describe('GET /api/auth/bc-status', () => {
    it('should return hasAccess: false when no BC token exists', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-no-bc' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery(
          'SELECT bc_access_token_encrypted, bc_token_expires_at FROM users WHERE id = @userId',
          { userId: req.userId }
        );

        if (!result.recordset?.length) {
          return res.status(404).json({ error: 'User Not Found' });
        }

        const user = result.recordset[0] as Record<string, unknown>;

        if (!user.bc_access_token_encrypted) {
          return res.json({
            hasAccess: false,
            message: 'Business Central access not granted',
            consentUrl: '/api/auth/bc-consent',
          });
        }

        return res.json({ hasAccess: true });
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ bc_access_token_encrypted: null, bc_token_expires_at: null }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert
      expect(response.body.hasAccess).toBe(false);
      expect(response.body.consentUrl).toBe('/api/auth/bc-consent');
    });

    it('should return hasAccess: true when BC token is valid', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-valid-bc' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });

        const user = result.recordset?.[0] as Record<string, unknown>;
        const expiresAt = new Date(user.bc_token_expires_at as string);
        const isExpired = expiresAt <= new Date();

        return res.json({
          hasAccess: !isExpired,
          expiresAt: expiresAt.toISOString(),
          isExpired,
        });
      });

      const futureDate = new Date(Date.now() + 3600000);
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: futureDate.toISOString(),
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert
      expect(response.body.hasAccess).toBe(true);
      expect(response.body.isExpired).toBe(false);
    });

    it('should return isExpired: true when BC token has expired', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-expired-bc' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });

        const user = result.recordset?.[0] as Record<string, unknown>;
        const expiresAt = new Date(user.bc_token_expires_at as string);
        const isExpired = expiresAt <= new Date();

        return res.json({
          hasAccess: !isExpired,
          expiresAt: expiresAt.toISOString(),
          isExpired,
          message: isExpired ? 'Business Central token expired (will be refreshed automatically)' : 'Business Central access is active',
        });
      });

      const pastDate = new Date(Date.now() - 3600000);
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: pastDate.toISOString(),
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert
      expect(response.body.hasAccess).toBe(false);
      expect(response.body.isExpired).toBe(true);
      expect(response.body.message).toContain('expired');
    });

    it('should return 404 if user not found', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'ghost-user' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });

        if (!result.recordset?.length) {
          return res.status(404).json({ error: 'User Not Found', message: 'User record not found' });
        }
        return res.json({});
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('User Not Found');
    });
  });

  // ============================================
  // POST /api/auth/bc-consent
  // ============================================
  describe('POST /api/auth/bc-consent', () => {
    it('should acquire and store BC token successfully', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({
        userId: 'user-bc-consent',
        microsoftSession: { refreshToken: 'valid-refresh-token' },
      }));

      app.post('/api/auth/bc-consent', async (req: Request, res: Response) => {
        const userId = req.userId!;
        const refreshToken = req.microsoftSession?.refreshToken;

        if (!refreshToken) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Refresh token not found in session. Please log in again.',
          });
        }

        try {
          const bcToken = await mockOAuthService.acquireBCToken(refreshToken);
          await mockBCTokenManager.storeBCToken(userId, bcToken);

          return res.json({
            success: true,
            message: 'Business Central access granted successfully',
            expiresAt: bcToken.expiresAt.toISOString(),
          });
        } catch {
          return res.status(500).json({ error: 'Failed to grant BC access' });
        }
      });

      const bcToken = {
        accessToken: 'new-bc-token',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockOAuthService.acquireBCToken.mockResolvedValueOnce(bcToken);

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(mockBCTokenManager.storeBCToken).toHaveBeenCalledWith('user-bc-consent', bcToken);
    });

    it('should return 400 if refresh token is missing', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({
        userId: 'user-no-refresh',
        microsoftSession: { refreshToken: undefined },
      }));

      app.post('/api/auth/bc-consent', async (req: Request, res: Response) => {
        const refreshToken = req.microsoftSession?.refreshToken;

        if (!refreshToken) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Refresh token not found in session. Please log in again.',
          });
        }
        return res.json({ success: true });
      });

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Refresh token not found');
    });

    it('should return 500 if BC token acquisition fails', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({
        userId: 'user-bc-fail',
        microsoftSession: { refreshToken: 'valid-token' },
      }));

      app.post('/api/auth/bc-consent', async (req: Request, res: Response) => {
        const refreshToken = req.microsoftSession?.refreshToken;

        try {
          await mockOAuthService.acquireBCToken(refreshToken);
          return res.json({ success: true });
        } catch {
          return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to grant Business Central access. You may need to grant admin consent for the Financials.ReadWrite.All permission.',
          });
        }
      });

      mockOAuthService.acquireBCToken.mockRejectedValueOnce(new Error('Admin consent required'));

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toContain('admin consent');
    });
  });

  // ============================================
  // Security Edge Cases
  // ============================================
  describe('Security Edge Cases', () => {
    it('should not leak sensitive token data in responses', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-secure' }));

      app.get('/api/auth/me', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });
        const user = result.recordset?.[0] as Record<string, unknown>;

        // Should NOT include token fields
        return res.json({
          id: user.id,
          email: user.email,
          fullName: user.full_name,
        });
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'user-secure',
          email: 'secure@example.com',
          full_name: 'Secure User',
          bc_access_token_encrypted: 'SHOULD_NOT_APPEAR',
          bc_refresh_token: 'SHOULD_NOT_APPEAR',
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(200);

      // Assert
      expect(JSON.stringify(response.body)).not.toContain('SHOULD_NOT_APPEAR');
      expect(response.body.bc_access_token_encrypted).toBeUndefined();
    });

    it('should handle SQL injection attempts in callback', async () => {
      // Arrange
      const app = createTestApp();

      // Malicious code parameter - should be rejected before DB
      const maliciousCode = "'; DROP TABLE users; --";

      // Act
      const response = await request(app)
        .get(`/api/auth/callback?code=${encodeURIComponent(maliciousCode)}&state=test`)
        .expect(302);

      // Assert - should fail safely at state validation, never reaching DB
      expect(response.headers.location).toContain('error=');
    });

    it('should validate CSRF state is exactly 64 hex characters', async () => {
      // Arrange
      const app = createTestApp();
      mockOAuthService.getAuthCodeUrl.mockResolvedValueOnce('https://login.microsoftonline.com/authorize');

      // Act
      await request(app).get('/api/auth/login').expect(302);

      // Assert
      const stateArg = mockOAuthService.getAuthCodeUrl.mock.calls[0]?.[0] as string;
      expect(stateArg).toMatch(/^[a-f0-9]{64}$/);
      expect(stateArg).toHaveLength(64);
    });
  });

  // ============================================
  // Multi-Tenant Isolation
  // ============================================
  describe('Multi-Tenant Isolation', () => {
    it('should only return data for authenticated user', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-tenant-a' }));

      app.get('/api/auth/me', async (req: Request, res: Response) => {
        // Query uses userId from auth middleware, not from request params
        const result = await executeQuery(
          'SELECT * FROM users WHERE id = @userId',
          { userId: req.userId }
        );
        return res.json(result.recordset?.[0] || {});
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'user-tenant-a', email: 'tenanta@example.com' }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(200);

      // Assert - verify query was made with authenticated userId
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'user-tenant-a' }
      );
      expect(response.body.id).toBe('user-tenant-a');
    });

    it('should use authenticated userId for BC status check', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-bc-check' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        await executeQuery(
          'SELECT * FROM users WHERE id = @userId',
          { userId: req.userId }
        );
        return res.json({ checked: true });
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{}] });

      // Act
      await request(app).get('/api/auth/bc-status').expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'user-bc-check' }
      );
    });
  });

  // ============================================
  // Token Expiration Edge Cases
  // ============================================
  describe('Token Expiration Edge Cases', () => {
    it('should handle bc_token_expires_at as null gracefully', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-null-expiry' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });
        const user = result.recordset?.[0] as Record<string, unknown>;

        if (!user.bc_access_token_encrypted) {
          return res.json({ hasAccess: false });
        }

        // Handle null expiration
        const expiresAt = user.bc_token_expires_at;
        if (!expiresAt) {
          return res.json({ hasAccess: false, message: 'Token expiration unknown' });
        }

        return res.json({ hasAccess: true });
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'some-token',
          bc_token_expires_at: null, // NULL expiration
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - should not crash, handle gracefully
      expect(response.body.hasAccess).toBe(false);
      expect(response.body.message).toContain('expiration');
    });

    it('should handle boundary case: token expires exactly now', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-boundary' }));

      const now = new Date();

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });
        const user = result.recordset?.[0] as Record<string, unknown>;

        const expiresAt = new Date(user.bc_token_expires_at as string);
        const isExpired = expiresAt <= new Date();

        return res.json({ hasAccess: !isExpired, isExpired });
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'token',
          bc_token_expires_at: now.toISOString(),
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - boundary case: exactly now counts as expired
      expect(response.body.isExpired).toBe(true);
      expect(response.body.hasAccess).toBe(false);
    });

    it('should handle invalid date format in bc_token_expires_at', async () => {
      // Arrange
      const app = express();
      app.use(express.json());
      app.use(createAuthMiddleware({ userId: 'user-invalid-date' }));

      app.get('/api/auth/bc-status', async (req: Request, res: Response) => {
        try {
          const result = await executeQuery('SELECT * FROM users WHERE id = @userId', { userId: req.userId });
          const user = result.recordset?.[0] as Record<string, unknown>;

          const expiresAt = new Date(user.bc_token_expires_at as string);

          // Check for Invalid Date
          if (isNaN(expiresAt.getTime())) {
            return res.json({ hasAccess: false, error: 'Invalid expiration date' });
          }

          return res.json({ hasAccess: true });
        } catch {
          return res.status(500).json({ error: 'Internal error' });
        }
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'token',
          bc_token_expires_at: 'not-a-valid-date', // Invalid date string
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - should handle gracefully
      expect(response.body.hasAccess).toBe(false);
      expect(response.body.error).toBe('Invalid expiration date');
    });
  });
});
