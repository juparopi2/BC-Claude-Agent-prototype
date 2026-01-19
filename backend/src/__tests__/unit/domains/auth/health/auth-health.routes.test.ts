/**
 * @module auth-health.routes.test
 * Unit tests for Auth Health Routes.
 * Tests the /api/auth/health endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';
import { AUTH_SESSION_STATUS } from '@bc-agent/shared';

// Use vi.hoisted to define mocks before vi.mock factories run
const { mockLogger, mockAuthMiddleware, authConfig } = vi.hoisted(() => {
  const config = {
    microsoftOAuth: null as MicrosoftOAuthSession | null,
  };

  return {
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    mockAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
      // Simulate session with microsoftOAuth - create minimal session object
      req.session = {
        microsoftOAuth: config.microsoftOAuth,
      } as Express.Session;
      next();
    },
    authConfig: config,
  };
});

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => mockLogger,
}));

// Mock the middleware
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoftOptional: mockAuthMiddleware,
}));

// Import the router AFTER mocks are set up
import authHealthRouter from '@/domains/auth/health/auth-health.routes';

describe('Auth Health Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset auth config
    authConfig.microsoftOAuth = null;

    // Create fresh Express app for each test
    // NO express-session middleware - our mock handles session simulation
    app = express();
    app.use(express.json());
    app.use('/api/auth', authHealthRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/auth/health', () => {
    it('should return 200 with health status', async () => {
      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('needsRefresh');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return unauthenticated when no session exists', async () => {
      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body.status).toBe(AUTH_SESSION_STATUS.UNAUTHENTICATED);
      expect(response.body.needsRefresh).toBe(false);
    });

    it('should return authenticated when session is valid', async () => {
      // Set up valid session with token expiring in 30 minutes
      authConfig.microsoftOAuth = {
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };

      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body.status).toBe(AUTH_SESSION_STATUS.AUTHENTICATED);
      expect(response.body.needsRefresh).toBe(false);
      expect(response.body.userId).toBe('USER-123');
    });

    it('should return expiring when token is about to expire', async () => {
      // Set up session with token expiring in 3 minutes
      authConfig.microsoftOAuth = {
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      };

      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body.status).toBe(AUTH_SESSION_STATUS.EXPIRING);
      expect(response.body.needsRefresh).toBe(true);
    });

    it('should return expired when token has expired', async () => {
      // Set up session with expired token
      authConfig.microsoftOAuth = {
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      };

      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body.status).toBe(AUTH_SESSION_STATUS.EXPIRED);
      expect(response.body.needsRefresh).toBe(true);
    });

    it('should include tokenExpiresIn in response', async () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      authConfig.microsoftOAuth = {
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: expiresAt.toISOString(),
      };

      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      expect(response.body.tokenExpiresIn).toBeDefined();
      expect(response.body.tokenExpiresIn).toBeGreaterThan(0);
    });

    it('should include valid timestamp in response', async () => {
      const beforeRequest = new Date().toISOString();

      const response = await request(app)
        .get('/api/auth/health')
        .expect(200);

      const afterRequest = new Date().toISOString();

      // Verify timestamp is a valid ISO string in the expected range
      expect(response.body.timestamp).toBeDefined();
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
      expect(response.body.timestamp >= beforeRequest).toBe(true);
      expect(response.body.timestamp <= afterRequest).toBe(true);
    });
  });
});
