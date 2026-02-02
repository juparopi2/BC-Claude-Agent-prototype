/**
 * Unit Tests - Auth OAuth Routes
 *
 * Tests for Microsoft OAuth 2.0 authentication endpoints.
 * Uses supertest for HTTP endpoint testing with mocked dependencies.
 *
 * REFACTORED: All tests now use the REAL router with mocked middleware.
 * No more duplicated endpoint logic in tests.
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
import { ErrorCode } from '@/shared/constants/errors';

// ============================================
// Mock Dependencies using vi.hoisted to ensure proper hoisting
// ============================================

// Use vi.hoisted to define mocks before vi.mock factories run
const { mockOAuthService, mockBCTokenManager, mockExecuteQuery, mockLogger, mockAuthenticateMicrosoft } = vi.hoisted(() => {
  // Store for auth mock configuration
  const authConfig = {
    userId: null as string | null,
    microsoftSession: null as MicrosoftOAuthSession | null,
    shouldReject: false,
  };

  return {
    mockOAuthService: {
      getAuthCodeUrl: vi.fn(),
      handleAuthCallback: vi.fn(),
      handleAuthCallbackWithCache: vi.fn(),
      getUserProfile: vi.fn(),
      acquireBCToken: vi.fn(),
      acquireBCTokenSilent: vi.fn(),
      getConfig: vi.fn(() => ({ tenantId: 'test-tenant-id' })),
    },
    mockBCTokenManager: {
      storeBCToken: vi.fn(),
    },
    mockExecuteQuery: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    mockAuthenticateMicrosoft: Object.assign(
      (req: Request, res: Response, next: NextFunction) => {
        if (authConfig.shouldReject) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Microsoft OAuth session not found. Please log in.',
          });
        }
        if (authConfig.userId) {
          req.userId = authConfig.userId;
          req.microsoftSession = authConfig.microsoftSession || undefined;
        }
        next();
      },
      {
        // Helper to configure the mock
        configure: (config: {
          userId?: string | null;
          microsoftSession?: MicrosoftOAuthSession | null;
          shouldReject?: boolean;
        }) => {
          authConfig.userId = config.userId ?? null;
          authConfig.microsoftSession = config.microsoftSession ?? null;
          authConfig.shouldReject = config.shouldReject ?? false;
        },
        reset: () => {
          authConfig.userId = null;
          authConfig.microsoftSession = null;
          authConfig.shouldReject = false;
        },
      }
    ),
  };
});

// Mock database
vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock OAuth service factory
vi.mock('@/domains/auth/oauth/MicrosoftOAuthService', () => ({
  createMicrosoftOAuthService: () => mockOAuthService,
}));

// Mock BC Token Manager factory
vi.mock('@/services/auth/BCTokenManager', () => ({
  createBCTokenManager: () => mockBCTokenManager,
}));

// Mock the authentication middleware
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: mockAuthenticateMicrosoft,
  // authenticateMicrosoftOptional: same behavior as authenticateMicrosoft for logout route
  authenticateMicrosoftOptional: mockAuthenticateMicrosoft,
}));

// NOW import the router that depends on mocks
import authOAuthRouter from '@/routes/auth-oauth';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a test Express app with session support and the REAL router
 */
function createTestApp(): Application {
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

  // Use the REAL auth router
  app.use('/api/auth', authOAuthRouter);

  return app;
}

/**
 * Configure auth middleware to authenticate a specific user
 */
function authenticateAs(userId: string, microsoftSession?: Partial<MicrosoftOAuthSession>) {
  const fullSession: MicrosoftOAuthSession = {
    userId,
    microsoftId: 'ms-id-123',
    displayName: 'Test User',
    email: 'test@example.com',
    accessToken: 'test-access-token',
    homeAccountId: 'home-account-id-123',
    msalPartitionKey: 'session-id-123',
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    ...microsoftSession,
  };

  mockAuthenticateMicrosoft.configure({
    userId,
    microsoftSession: fullSession,
    shouldReject: false,
  });
}

/**
 * Configure auth middleware to reject (unauthenticated)
 */
function unauthenticated() {
  mockAuthenticateMicrosoft.configure({ shouldReject: true });
}

// ============================================
// Test Suite
// ============================================

describe('Auth OAuth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateMicrosoft.reset();
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

      // SINGLE code exchange using sessionId as partition key (new flow)
      mockOAuthService.handleAuthCallbackWithCache.mockResolvedValueOnce({
        access_token: 'test-access-token',
        expires_in: 3600,
        homeAccountId: 'home-account-id-new',
        scope: 'openid profile email',
      });

      // User profile fetched using the access token from cache call
      mockOAuthService.getUserProfile.mockResolvedValueOnce({
        id: 'ms-id-new-user',
        displayName: 'New User',
        mail: 'newuser@example.com',
      });

      // No existing user
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Insert new user
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // BC token acquisition fails via silent refresh (expected for new user)
      mockOAuthService.acquireBCTokenSilent.mockRejectedValueOnce(new Error('Consent required'));

      // Act
      const response = await agent
        .get(`/api/auth/callback?code=test-code&state=${state}`)
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/new');
      // Verify only ONE code exchange happened (handleAuthCallbackWithCache)
      expect(mockOAuthService.handleAuthCallbackWithCache).toHaveBeenCalledTimes(1);
      expect(mockOAuthService.handleAuthCallback).not.toHaveBeenCalled();
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

      // SINGLE code exchange using sessionId as partition key (new flow)
      mockOAuthService.handleAuthCallbackWithCache.mockResolvedValueOnce({
        access_token: 'test-access-token',
        expires_in: 3600,
        homeAccountId: 'home-account-id-existing',
        scope: 'openid profile email',
      });

      // User profile fetched using the access token from cache call
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

      // BC token fails (silent)
      mockOAuthService.acquireBCTokenSilent.mockRejectedValueOnce(new Error('No BC consent'));

      // Act
      const response = await agent
        .get(`/api/auth/callback?code=test-code&state=${state}`)
        .expect(302);

      // Assert
      expect(response.headers.location).toBe('http://localhost:3000/new');
      // Verify only ONE code exchange happened (handleAuthCallbackWithCache)
      expect(mockOAuthService.handleAuthCallbackWithCache).toHaveBeenCalledTimes(1);
      expect(mockOAuthService.handleAuthCallback).not.toHaveBeenCalled();
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

      // SINGLE code exchange using sessionId as partition key (new flow)
      mockOAuthService.handleAuthCallbackWithCache.mockResolvedValueOnce({
        access_token: 'test-access-token',
        expires_in: 3600,
        homeAccountId: 'home-account-id-bc',
        scope: 'openid profile email',
      });

      // User profile fetched using the access token from cache call
      mockOAuthService.getUserProfile.mockResolvedValueOnce({
        id: 'ms-id-bc',
        displayName: 'BC User',
        mail: 'bcuser@example.com',
      });

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'bc-user-id', microsoft_id: 'ms-id-bc' }],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // BC token succeeds via silent refresh (new flow)
      const bcToken = {
        accessToken: 'bc-access-token',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockOAuthService.acquireBCTokenSilent.mockResolvedValueOnce(bcToken);

      // Act
      await agent.get(`/api/auth/callback?code=test-code&state=${state}`).expect(302);

      // Assert
      // Verify only ONE code exchange happened (handleAuthCallbackWithCache)
      expect(mockOAuthService.handleAuthCallbackWithCache).toHaveBeenCalledTimes(1);
      expect(mockOAuthService.handleAuthCallback).not.toHaveBeenCalled();
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

      // handleAuthCallbackWithCache fails (new flow)
      mockOAuthService.handleAuthCallbackWithCache.mockRejectedValueOnce(new Error('Token exchange failed'));

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
      // Arrange
      const app = createTestApp();
      authenticateAs('user-logout');

      // Act
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logged out successfully');
    });

    it('should return 401 if not authenticated', async () => {
      // Arrange
      const app = createTestApp();
      unauthenticated();

      // Act
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // GET /api/auth/me
  // ============================================
  describe('GET /api/auth/me', () => {
    it('should return current user data', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-me-123');

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

      // Assert - IDs are returned as UPPERCASE per CLAUDE.md guidelines
      expect(response.body).toMatchObject({
        id: 'USER-ME-123',
        email: 'me@example.com',
        fullName: 'Current User',
        role: 'admin',
      });
    });

    it('should return 404 if user not found in database', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('ghost-user');

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(404);

      // Assert - standardized error format
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('User record not found');
      expect(response.body.code).toBe(ErrorCode.USER_NOT_FOUND);
    });

    it('should return 500 on database error', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-db-error');

      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should return 401 if not authenticated', async () => {
      // Arrange
      const app = createTestApp();
      unauthenticated();

      // Act
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // GET /api/auth/bc-status
  // ============================================
  describe('GET /api/auth/bc-status', () => {
    it('should return hasAccess: false when no BC token exists', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-no-bc');

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
      const app = createTestApp();
      authenticateAs('user-valid-bc');

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
      const app = createTestApp();
      authenticateAs('user-expired-bc');

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
      const app = createTestApp();
      authenticateAs('ghost-user');

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(404);

      // Assert - standardized error format
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('User record not found');
      expect(response.body.code).toBe(ErrorCode.USER_NOT_FOUND);
    });

    it('should return 401 if not authenticated', async () => {
      // Arrange
      const app = createTestApp();
      unauthenticated();

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // POST /api/auth/bc-consent
  // ============================================
  describe('POST /api/auth/bc-consent', () => {
    it('should acquire and store BC token successfully', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-bc-consent', {
        homeAccountId: 'home-account-id-bc',
        msalPartitionKey: 'session-id-bc',
      });

      const bcToken = {
        accessToken: 'new-bc-token',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockOAuthService.acquireBCTokenSilent.mockResolvedValueOnce(bcToken);

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(mockOAuthService.acquireBCTokenSilent).toHaveBeenCalledWith('session-id-bc', 'home-account-id-bc');
      expect(mockBCTokenManager.storeBCToken).toHaveBeenCalledWith('user-bc-consent', bcToken);
    });

    it('should return 401 if homeAccountId or msalPartitionKey is missing (session expired)', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-no-cache', { homeAccountId: undefined, msalPartitionKey: undefined });

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(401);

      // Assert - standardized error format
      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.message).toContain('Session expired');
      expect(response.body.code).toBe(ErrorCode.SESSION_EXPIRED);
    });

    it('should return 503 if BC token acquisition fails', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-bc-fail', {
        homeAccountId: 'home-account-id-fail',
        msalPartitionKey: 'session-id-fail',
      });

      mockOAuthService.acquireBCTokenSilent.mockRejectedValueOnce(new Error('Admin consent required'));

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(503);

      // Assert - standardized error format
      expect(response.body.error).toBe('Service Unavailable');
      expect(response.body.message).toContain('admin consent');
      expect(response.body.code).toBe(ErrorCode.BC_UNAVAILABLE);
    });

    it('should return 401 if not authenticated', async () => {
      // Arrange
      const app = createTestApp();
      unauthenticated();

      // Act
      const response = await request(app)
        .post('/api/auth/bc-consent')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // Security Edge Cases
  // ============================================
  describe('Security Edge Cases', () => {
    it('should not leak sensitive token data in responses', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-secure');

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'user-secure',
          email: 'secure@example.com',
          full_name: 'Secure User',
          role: 'viewer',
          microsoft_email: 'secure@example.com',
          microsoft_id: 'ms-secure',
          last_microsoft_login: new Date(),
          created_at: new Date(),
          is_active: true,
          bc_access_token_encrypted: 'SHOULD_NOT_APPEAR',
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
      const app = createTestApp();
      authenticateAs('user-tenant-a');

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'user-tenant-a',
          email: 'tenanta@example.com',
          full_name: 'Tenant A User',
          role: 'viewer',
          microsoft_email: 'tenanta@example.com',
          microsoft_id: 'ms-tenant-a',
          last_microsoft_login: new Date(),
          created_at: new Date(),
          is_active: true,
        }],
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
      // IDs are returned as UPPERCASE per CLAUDE.md guidelines
      expect(response.body.id).toBe('USER-TENANT-A');
    });

    it('should use authenticated userId for BC status check', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-bc-check');

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ bc_access_token_encrypted: null }],
      });

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
    it('should handle boundary case: token expires exactly now', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-boundary');

      const now = new Date();
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

    it('should handle token expiring in 1 second (boundary valid)', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-1sec');

      const oneSecondFromNow = new Date(Date.now() + 1000);
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'token',
          bc_token_expires_at: oneSecondFromNow.toISOString(),
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - 1 second in future is still valid
      expect(response.body.hasAccess).toBe(true);
      expect(response.body.isExpired).toBe(false);
    });

    it('should handle token expired 1 second ago', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-expired-1sec');

      const oneSecondAgo = new Date(Date.now() - 1000);
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'token',
          bc_token_expires_at: oneSecondAgo.toISOString(),
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - 1 second ago is expired
      expect(response.body.hasAccess).toBe(false);
      expect(response.body.isExpired).toBe(true);
    });

    it('should handle null bc_token_expires_at gracefully', async () => {
      // Arrange
      const app = createTestApp();
      authenticateAs('user-null-expiry');

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'token',
          bc_token_expires_at: null,
        }],
      });

      // Act
      const response = await request(app)
        .get('/api/auth/bc-status')
        .expect(200);

      // Assert - null expiry should be treated as no valid token
      expect(response.body.hasAccess).toBe(false);
    });
  });

  // ============================================
  // Additional Edge Cases (Phase 3)
  // ============================================
  describe('Additional Edge Cases (Phase 3)', () => {
    describe('OAuth Callback Edge Cases', () => {
      it('should handle empty code parameter', async () => {
        // Arrange
        const app = createTestApp();

        // Act
        const response = await request(app)
          .get('/api/auth/callback?code=&state=test-state')
          .expect(302);

        // Assert
        expect(response.headers.location).toContain('error=');
      });

      it('should handle extremely long state parameter', async () => {
        // Arrange
        const app = createTestApp();
        const longState = 'a'.repeat(1000);

        // Act
        const response = await request(app)
          .get(`/api/auth/callback?code=test&state=${longState}`)
          .expect(302);

        // Assert - should reject as invalid state
        expect(response.headers.location).toContain('error=');
      });

      it('should handle state with special characters', async () => {
        // Arrange
        const app = createTestApp();
        const specialState = encodeURIComponent('<script>alert("xss")</script>');

        // Act
        const response = await request(app)
          .get(`/api/auth/callback?code=test&state=${specialState}`)
          .expect(302);

        // Assert
        expect(response.headers.location).toContain('error=');
      });

      it('should handle multiple error parameters in callback', async () => {
        // Arrange
        const app = createTestApp();

        // Act
        const response = await request(app)
          .get('/api/auth/callback?error=access_denied&error=another_error&error_description=test')
          .expect(302);

        // Assert - first error should be used
        expect(response.headers.location).toContain('error=access_denied');
      });

      it('should handle URL-encoded error_description', async () => {
        // Arrange
        const app = createTestApp();
        const encodedDesc = encodeURIComponent('User denied access to the application');

        // Act
        const response = await request(app)
          .get(`/api/auth/callback?error=consent_required&error_description=${encodedDesc}`)
          .expect(302);

        // Assert
        expect(response.headers.location).toContain('error=consent_required');
      });
    });

    describe('User Profile Edge Cases', () => {
      it('should handle user with null email from Microsoft', async () => {
        // Arrange
        const app = createTestApp();
        const agent = request.agent(app);

        mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
          return `https://login.microsoftonline.com/authorize?state=${state}`;
        });

        const loginResponse = await agent.get('/api/auth/login');
        const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
        const state = stateMatch ? stateMatch[1] : '';

        // SINGLE code exchange using sessionId as partition key (new flow)
        mockOAuthService.handleAuthCallbackWithCache.mockResolvedValueOnce({
          access_token: 'test-token',
          expires_in: 3600,
          homeAccountId: 'home-account-null-email',
          scope: 'openid profile email',
        });

        // Profile with null email
        mockOAuthService.getUserProfile.mockResolvedValueOnce({
          id: 'ms-null-email',
          displayName: 'No Email User',
          mail: null,
          userPrincipalName: 'nomail@tenant.onmicrosoft.com',
        });

        mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });
        mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

        // BC token fails
        mockOAuthService.acquireBCTokenSilent.mockRejectedValueOnce(new Error('No BC'));

        // Act
        const response = await agent
          .get(`/api/auth/callback?code=test&state=${state}`)
          .expect(302);

        // Assert - should handle gracefully
        expect(response.headers.location).not.toContain('error=');
      });

      it('should handle user with very long display name', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-long-name');

        const longName = 'A'.repeat(500);
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [{
            id: 'user-long-name',
            email: 'longname@example.com',
            full_name: longName,
            role: 'viewer',
            microsoft_email: 'longname@example.com',
            microsoft_id: 'ms-long',
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
        expect(response.body.fullName).toBe(longName);
      });

      it('should handle special characters in display name', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-special-chars');

        const specialName = 'José García-López <admin>';
        mockExecuteQuery.mockResolvedValueOnce({
          recordset: [{
            id: 'user-special-chars',
            email: 'jose@example.com',
            full_name: specialName,
            role: 'viewer',
            microsoft_email: 'jose@example.com',
            microsoft_id: 'ms-jose',
            last_microsoft_login: new Date(),
            created_at: new Date(),
            is_active: true,
          }],
        });

        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .expect(200);

        // Assert - should return as-is (sanitization happens elsewhere)
        expect(response.body.fullName).toBe(specialName);
      });
    });

    describe('Database Error Handling', () => {
      it('should handle database timeout on user lookup', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-timeout');

        const timeoutError = new Error('Request timeout');
        (timeoutError as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        mockExecuteQuery.mockRejectedValueOnce(timeoutError);

        // Act
        const response = await request(app)
          .get('/api/auth/me')
          .expect(500);

        // Assert
        expect(response.body.error).toBe('Internal Server Error');
      });

      it('should handle database connection pool exhaustion', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-pool-exhausted');

        const poolError = new Error('Connection pool exhausted');
        (poolError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
        mockExecuteQuery.mockRejectedValueOnce(poolError);

        // Act
        const response = await request(app)
          .get('/api/auth/bc-status')
          .expect(500);

        // Assert
        expect(response.body.error).toBe('Internal Server Error');
      });

      it('should handle concurrent database updates', async () => {
        // Arrange - simulates deadlock retry scenario
        const app = createTestApp();
        const agent = request.agent(app);

        mockOAuthService.getAuthCodeUrl.mockImplementation(async (state: string) => {
          return `https://login.microsoftonline.com/authorize?state=${state}`;
        });

        const loginResponse = await agent.get('/api/auth/login');
        const stateMatch = loginResponse.headers.location.match(/state=([a-f0-9]+)/);
        const state = stateMatch ? stateMatch[1] : '';

        // SINGLE code exchange using sessionId as partition key (new flow)
        mockOAuthService.handleAuthCallbackWithCache.mockResolvedValueOnce({
          access_token: 'test-token',
          expires_in: 3600,
          homeAccountId: 'home-account-concurrent',
          scope: 'openid profile email',
        });

        mockOAuthService.getUserProfile.mockResolvedValueOnce({
          id: 'ms-concurrent',
          displayName: 'Concurrent User',
          mail: 'concurrent@example.com',
        });

        // Deadlock error on first try
        const deadlockError = new Error('Transaction deadlock');
        (deadlockError as unknown as { number: number }).number = 1205;
        mockExecuteQuery.mockRejectedValueOnce(deadlockError);

        // Act
        const response = await agent
          .get(`/api/auth/callback?code=test&state=${state}`)
          .expect(302);

        // Assert - should redirect with error on DB failure
        expect(response.headers.location).toContain('error=callback_failed');
      });
    });

    describe('BC Token Edge Cases', () => {
      it('should handle missing homeAccountId (session expired)', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-no-home-account', { homeAccountId: undefined, msalPartitionKey: 'session-id' });

        // Act
        const response = await request(app)
          .post('/api/auth/bc-consent')
          .expect(401);

        // Assert - standardized error format
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.code).toBe(ErrorCode.SESSION_EXPIRED);
      });

      it('should handle BC token with past expiry date', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-bc-past', {
          homeAccountId: 'home-account-past',
          msalPartitionKey: 'session-id-past',
        });

        const pastDate = new Date(Date.now() - 86400000); // 24 hours ago
        const bcToken = {
          accessToken: 'past-bc-token',
          expiresAt: pastDate,
        };
        mockOAuthService.acquireBCTokenSilent.mockResolvedValueOnce(bcToken);

        // Act - should still store it (might be refresh scenario)
        const response = await request(app)
          .post('/api/auth/bc-consent')
          .expect(200);

        // Assert
        expect(response.body.success).toBe(true);
        expect(mockBCTokenManager.storeBCToken).toHaveBeenCalled();
      });

      it('should handle BC token storage failure', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-storage-fail', {
          homeAccountId: 'home-account-storage',
          msalPartitionKey: 'session-id-storage',
        });

        const bcToken = {
          accessToken: 'new-bc-token',
          expiresAt: new Date(Date.now() + 3600000),
        };
        mockOAuthService.acquireBCTokenSilent.mockResolvedValueOnce(bcToken);
        mockBCTokenManager.storeBCToken.mockRejectedValueOnce(new Error('Encryption failed'));

        // Act
        const response = await request(app)
          .post('/api/auth/bc-consent')
          .expect(503);

        // Assert - standardized error format (BC_UNAVAILABLE for BC-related failures)
        expect(response.body.error).toBe('Service Unavailable');
        expect(response.body.code).toBe(ErrorCode.BC_UNAVAILABLE);
      });
    });

    describe('Session Edge Cases', () => {
      it('should handle logout when session already destroyed', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-double-logout');

        // First logout
        await request(app).post('/api/auth/logout').expect(200);

        // Second logout with fresh auth
        authenticateAs('user-double-logout');
        const response = await request(app)
          .post('/api/auth/logout')
          .expect(200);

        // Assert
        expect(response.body.success).toBe(true);
      });

      it('should handle concurrent logout requests', async () => {
        // Arrange
        const app = createTestApp();
        authenticateAs('user-concurrent-logout');

        // Act - fire multiple concurrent requests
        const responses = await Promise.all([
          request(app).post('/api/auth/logout'),
          request(app).post('/api/auth/logout'),
        ]);

        // Assert - all should complete without error
        responses.forEach((response) => {
          expect([200, 401]).toContain(response.status);
        });
      });
    });
  });
});
