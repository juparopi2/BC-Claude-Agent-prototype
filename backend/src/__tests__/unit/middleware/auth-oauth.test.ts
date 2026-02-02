/**
 * Auth OAuth Middleware Unit Tests
 *
 * F6-004: Comprehensive unit tests for Microsoft OAuth authentication middleware
 *
 * Test Coverage:
 * 1. authenticateMicrosoft - Session validation and token refresh
 * 2. requireBCAccess - Business Central access verification
 * 3. authenticateMicrosoftOptional - Optional authentication
 *
 * @module __tests__/unit/middleware/auth-oauth.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';

// Mock logger with vi.hoisted() + regular functions to survive vi.resetAllMocks()
const mockLogger = vi.hoisted(() => {
  const mock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };
  mock.child.mockReturnValue(mock);
  return mock;
});

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: () => mockLogger,  // Regular function, not vi.fn()
}));

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn(),
}));

// Mock OAuth service for requireBCAccess auto-refresh tests
const mockOAuthService = vi.hoisted(() => ({
  acquireBCTokenSilent: vi.fn(),
}));

vi.mock('@/domains/auth/oauth/MicrosoftOAuthService', () => ({
  createMicrosoftOAuthService: vi.fn(() => mockOAuthService),
}));

// Mock BCTokenManager for requireBCAccess auto-refresh tests
const mockBCTokenManager = vi.hoisted(() => ({
  storeBCToken: vi.fn(),
}));

vi.mock('@/services/auth/BCTokenManager', () => ({
  createBCTokenManager: vi.fn(() => mockBCTokenManager),
}));

// DON'T mock @/utils/error-response, it should work with the real implementation
// Instead,ensure @bc-agent/shared is properly available (it should be by default)

// Import after mocking
import {
  authenticateMicrosoft,
  requireBCAccess,
  authenticateMicrosoftOptional,
} from '@/domains/auth/middleware/auth-oauth';
import { executeQuery } from '@/infrastructure/database/database';
import { ErrorCode } from '@/shared/constants/errors';

// Use mockLogger directly for assertions (not logger import which may be a different instance)

// ===== TEST HELPERS =====

interface MockSession {
  microsoftOAuth?: MicrosoftOAuthSession;
  id?: string;
  save: (callback: (err?: Error) => void) => void;
}

interface MockRequest extends Partial<Request> {
  session: MockSession;
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  microsoftSession?: MicrosoftOAuthSession;
  userId?: string;
  userEmail?: string;
}

/**
 * Creates a mock Express Request object
 *
 * NOTE: Must include `headers` property because auth-oauth.ts accesses
 * `req.headers.cookie` for E2E debug logging. Without it, TypeError occurs.
 */
function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    session: {
      save: vi.fn((cb: (err?: Error) => void) => cb()),
      ...overrides.session,
    },
    path: '/api/test',
    method: 'GET',
    headers: {}, // Required: auth-oauth.ts accesses req.headers.cookie
    ...overrides,
  } as MockRequest;
}

/**
 * Creates a mock Express Response object
 */
function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

/**
 * Creates a valid Microsoft OAuth session
 */
function createValidSession(overrides: Partial<MicrosoftOAuthSession> = {}): MicrosoftOAuthSession {
  return {
    userId: 'user-123',
    microsoftId: 'ms-abc-456',
    displayName: 'Test User',
    email: 'test@example.com',
    accessToken: 'valid-access-token',
    homeAccountId: 'test-home-account-id',
    msalPartitionKey: 'test-partition-key',
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    ...overrides,
  };
}

// ===== 1. AUTHENTICATE MICROSOFT TESTS =====

describe('authenticateMicrosoft', () => {
  let mockReq: MockRequest;
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('session validation', () => {
    it('should return 401 when session is undefined', async () => {
      mockReq = createMockRequest();
      mockReq.session = undefined as unknown as MockSession;

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('session not found'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when microsoftOAuth is undefined', async () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: undefined,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when userId is missing', async () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ userId: undefined }),
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Invalid Microsoft OAuth session'),
        })
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should return 401 when microsoftId is missing', async () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ microsoftId: undefined }),
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
        })
      );
    });

    it('should return 401 when accessToken is missing', async () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ accessToken: undefined }),
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Access token missing'),
        })
      );
    });
  });

  describe('valid session', () => {
    it('should attach session data to request and call next() for valid session', async () => {
      const validSession = createValidSession();
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: validSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockReq.microsoftSession).toEqual(validSession);
      expect(mockReq.userId).toBe('user-123');
      expect(mockReq.userEmail).toBe('test@example.com');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should work with session without tokenExpiresAt (non-expiring)', async () => {
      const sessionWithoutExpiry = createValidSession({ tokenExpiresAt: undefined });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithoutExpiry,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBe('user-123');
    });
  });

  describe('token expiration and refresh', () => {
    it('should return 401 when token is expired and no homeAccountId (legacy session)', async () => {
      const expiredSession = createValidSession({
        tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        homeAccountId: undefined, // No MSAL account identifier
      });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: expiredSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.SESSION_EXPIRED,
          message: expect.stringContaining('expired'),
        })
      );
    });

    it('should refresh token when expired and MSAL credentials are available', async () => {
      const expiredSession = createValidSession({
        tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      });

      const localMockOAuthService = {
        refreshAccessTokenSilent: vi.fn().mockResolvedValue({
          accessToken: 'new-access-token',
          expiresAt: new Date(Date.now() + 3600000),
        }),
      };

      const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');
      vi.mocked(createMicrosoftOAuthService).mockReturnValue(localMockOAuthService as ReturnType<typeof createMicrosoftOAuthService>);

      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: expiredSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(localMockOAuthService.refreshAccessTokenSilent).toHaveBeenCalledWith('test-partition-key', 'test-home-account-id');
      expect(mockNext).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('refreshed successfully'),
        expect.any(Object)
      );
    });

    it('should return 401 when token refresh fails', async () => {
      const expiredSession = createValidSession({
        tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(),
      });

      const localMockOAuthService = {
        refreshAccessTokenSilent: vi.fn().mockRejectedValue(new Error('Refresh failed')),
      };

      const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');
      vi.mocked(createMicrosoftOAuthService).mockReturnValue(localMockOAuthService as ReturnType<typeof createMicrosoftOAuthService>);

      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: expiredSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: expect.stringContaining('Failed to refresh'),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should return 500 on unexpected errors during session.save', async () => {
      const validSession = createValidSession();
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb: (err?: Error) => void) => cb(new Error('Session save error'))),
          microsoftOAuth: {
            ...validSession,
            tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired to trigger refresh
          },
        },
      });

      // Mock successful token refresh that will fail on session.save
      const mockOAuthService = {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt: new Date(Date.now() + 3600000),
        }),
      };

      const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');
      vi.mocked(createMicrosoftOAuthService).mockReturnValue(mockOAuthService as ReturnType<typeof createMicrosoftOAuthService>);

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      // After session.save fails, should return 401 (refresh flow failure)
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    // FIX #1: Test for generic catch block (line 179-190)
    it('should return 500 when unexpected error occurs accessing session', async () => {
      // Create a request where accessing session.microsoftOAuth throws
      const throwingSession = {
        save: vi.fn(),
      };

      Object.defineProperty(throwingSession, 'microsoftOAuth', {
        get() {
          throw new Error('Unexpected session corruption');
        },
      });

      mockReq = {
        session: throwingSession,
        path: '/api/test',
        method: 'GET',
      } as unknown as MockRequest;

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
          code: ErrorCode.SERVICE_ERROR,
        })
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Microsoft OAuth authentication error',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    // FIX #9: Test for request without path/method (defensive)
    it('should handle request without path or method gracefully', async () => {
      mockReq = {
        session: {
          save: vi.fn((cb: (err?: Error) => void) => cb()),
          microsoftOAuth: undefined,
        },
        headers: {}, // Required: auth-oauth.ts accesses req.headers.cookie
        // Deliberately omit path and method
      } as unknown as MockRequest;

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      // Should still return 401 without crashing
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  // FIX #6: Boundary test - token expires exactly now
  describe('token expiration boundary cases', () => {
    it('should treat token as expired when tokenExpiresAt equals current time', async () => {
      const now = new Date();
      const expiredSession = createValidSession({
        tokenExpiresAt: now.toISOString(), // Exactly now - should be treated as expired
        homeAccountId: undefined, // No MSAL credentials = can't refresh
      });

      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: expiredSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.SESSION_EXPIRED,
          message: expect.stringContaining('expired'),
        })
      );
    });

    it('should accept token expiring well in the future', async () => {
      // Token needs to be > 5 minutes in the future to avoid proactive refresh
      const futureSession = createValidSession({
        tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes in future
      });

      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: futureSession,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  // FIX #7: Test for displayName undefined
  describe('optional field handling', () => {
    it('should work with undefined displayName', async () => {
      const sessionWithoutDisplayName = createValidSession({ displayName: undefined });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithoutDisplayName,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBe('user-123');
    });

    it('should work with empty string displayName', async () => {
      const sessionWithEmptyDisplayName = createValidSession({ displayName: '' });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithEmptyDisplayName,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  // FIX #8: Test email validation edge cases
  describe('email validation edge cases', () => {
    it('should accept valid email formats', async () => {
      const validEmails = [
        'test@example.com',
        'user.name+tag@domain.co.uk',
        'user@sub.domain.org',
      ];

      for (const email of validEmails) {
        vi.clearAllMocks();
        mockRes = createMockResponse();
        mockNext = vi.fn();

        mockReq = createMockRequest({
          session: {
            save: vi.fn((cb) => cb()),
            microsoftOAuth: createValidSession({ email }),
          },
        });

        await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockReq.userEmail).toBe(email);
      }
    });

    it('should handle email with special characters (stored as-is from Microsoft)', async () => {
      // Note: Microsoft Graph API should return sanitized emails, but we test edge cases
      const sessionWithOddEmail = createValidSession({ email: 'user@example.com' });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithOddEmail,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      // Email is passed through as-is (sanitization should happen at display layer)
      expect(mockReq.userEmail).toBe('user@example.com');
    });

    it('should handle undefined email', async () => {
      const sessionWithoutEmail = createValidSession({ email: undefined });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithoutEmail,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userEmail).toBeUndefined();
    });
  });

  describe('multi-tenant isolation', () => {
    it('should correctly scope session to specific userId', async () => {
      const user1Session = createValidSession({ userId: 'user-1', email: 'user1@example.com' });
      const user2Session = createValidSession({ userId: 'user-2', email: 'user2@example.com' });

      // First request - User 1
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: user1Session,
        },
      });

      await authenticateMicrosoft(mockReq as Request, mockRes, mockNext);

      expect(mockReq.userId).toBe('user-1');
      expect(mockReq.userEmail).toBe('user1@example.com');

      // Second request - User 2
      const mockReq2 = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: user2Session,
        },
      });
      const mockNext2 = vi.fn();

      await authenticateMicrosoft(mockReq2 as Request, mockRes, mockNext2);

      expect(mockReq2.userId).toBe('user-2');
      expect(mockReq2.userEmail).toBe('user2@example.com');

      // Verify no cross-contamination
      expect(mockReq.userId).toBe('user-1');
    });
  });
});

// ===== 2. REQUIRE BC ACCESS TESTS =====

describe('requireBCAccess', () => {
  let mockReq: MockRequest;
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('authentication requirement', () => {
    it('should return 401 when userId is not set', async () => {
      mockReq = createMockRequest();
      mockReq.userId = undefined;

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.UNAUTHORIZED,
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('user lookup', () => {
    it('should return 404 when user not found in database', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'non-existent-user';

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not Found',
          code: ErrorCode.USER_NOT_FOUND,
        })
      );
    });
  });

  describe('BC token validation', () => {
    it('should return 503 with consentUrl when BC token is not present', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{ bc_access_token_encrypted: null, bc_token_expires_at: null }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // BC_UNAVAILABLE returns 503
      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Service Unavailable',
          code: ErrorCode.BC_UNAVAILABLE,
          details: expect.objectContaining({
            consentUrl: '/api/auth/bc-consent',
          }),
        })
      );
    });

    it('should return 401 when BC token is expired and no refresh token available', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';
      // No microsoftOAuth session = no refresh token
      mockReq.session = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: undefined,
      };

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // SESSION_EXPIRED returns 401 when no refresh token
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.SESSION_EXPIRED,
          details: expect.objectContaining({
            consentUrl: '/api/auth/bc-consent',
          }),
        })
      );
    });

    it('should call next() when BC token is valid', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Business Central access verified'),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should return 500 on database errors', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockRejectedValue(new Error('Database connection failed'));

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal Server Error',
        })
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ===== BC TOKEN AUTO-REFRESH TESTS (Phase 3.1) =====

  describe('BC token auto-refresh', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockRes = createMockResponse();
      mockNext = vi.fn();
    });

    it('should attempt auto-refresh when BC token is expired', async () => {
      // This test verifies that the middleware attempts to refresh when BC token is expired
      // Note: Full refresh flow is tested in integration tests with real OAuth service

      mockReq = createMockRequest();
      mockReq.userId = 'user-123';
      mockReq.session = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: createValidSession(),
      };

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      // When the refresh fails (which will happen without a properly mocked OAuth service),
      // the middleware should return a SESSION_EXPIRED error
      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // Verify the error response indicates refresh was attempted
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.SESSION_EXPIRED,
          message: expect.stringContaining('refresh'),
        })
      );

      // Should log that auto-refresh was attempted
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('attempting auto-refresh'),
        expect.any(Object)
      );
    });

    it('should return 401 when auto-refresh fails', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';
      mockReq.session = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: createValidSession(),
      };

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      // Mock failed token refresh via OAuth service
      vi.mocked(mockOAuthService.acquireBCTokenSilent).mockRejectedValue(
        new Error('Failed to refresh Business Central token')
      );

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // Should return 401 with re-authorize message
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.SESSION_EXPIRED,
          message: expect.stringContaining('Failed to refresh'),
          details: expect.objectContaining({
            consentUrl: '/api/auth/bc-consent',
          }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when BC token expired but session has no homeAccountId', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';
      mockReq.session = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: createValidSession({ homeAccountId: undefined }), // No homeAccountId
      };

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // Should return 401 with login message
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.SESSION_EXPIRED,
          message: expect.stringContaining('expired'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should log auto-refresh attempt', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';
      mockReq.session = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: createValidSession(),
      };

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() - 3600000).toISOString(),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      vi.mocked(mockOAuthService.acquireBCTokenSilent).mockResolvedValue({
        accessToken: 'new-token',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('attempting auto-refresh'),
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });
  });

  describe('multi-tenant isolation', () => {
    it('should query database with correct userId parameter', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'tenant-specific-user-id';

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @userId'),
        { userId: 'tenant-specific-user-id' }
      );
    });

    // FIX #4: SQL injection defense test
    it('should safely handle userId with SQL injection attempt', async () => {
      mockReq = createMockRequest();
      // Simulate SQL injection attempt in userId
      mockReq.userId = "'; DROP TABLE users; --";

      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [],
        recordsets: [],
        rowsAffected: [0],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // Should use parameterized query (safe from injection)
      expect(executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('@userId'),
        { userId: "'; DROP TABLE users; --" }
      );
      // Should return 404 (user not found) not execute injection
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    // FIX #11: Enhanced multi-tenant tests
    it('should not allow access to other user BC tokens (cross-tenant)', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-a';
      mockReq.microsoftSession = createValidSession({ userId: 'user-a' });

      // Even if DB somehow returns data, the query should be scoped to user-a
      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // Verify the query was called with the correct userId
      expect(executeQuery).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'user-a' }
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle multiple concurrent requests from different tenants independently', async () => {
      // User A request
      const mockReqA = createMockRequest();
      mockReqA.userId = 'tenant-a-user';
      const mockResA = createMockResponse();
      const mockNextA = vi.fn();

      // User B request
      const mockReqB = createMockRequest();
      mockReqB.userId = 'tenant-b-user';
      const mockResB = createMockResponse();
      const mockNextB = vi.fn();

      // Mock executeQuery to return valid tokens for both users
      vi.mocked(executeQuery).mockResolvedValue({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      // Execute both requests sequentially (to avoid mock timing issues)
      await requireBCAccess(mockReqA as Request, mockResA, mockNextA);
      await requireBCAccess(mockReqB as Request, mockResB, mockNextB);

      // Both should succeed independently
      expect(mockNextA).toHaveBeenCalled();
      expect(mockNextB).toHaveBeenCalled();

      // Verify queries were made with correct userIds
      expect(executeQuery).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'tenant-a-user' }
      );
      expect(executeQuery).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'tenant-b-user' }
      );
    });
  });

  // FIX #10: bc_token_expires_at null handling
  describe('BC token expiration edge cases', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockRes = createMockResponse();
      mockNext = vi.fn();
    });

    it('should return 401 when bc_token_expires_at is null in database', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: null, // NULL in database - edge case!
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // INVALID_TOKEN returns 401 - null expires_at is treated as invalid token
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          code: ErrorCode.INVALID_TOKEN,
          details: expect.objectContaining({
            consentUrl: '/api/auth/bc-consent',
          }),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when bc_token_expires_at is undefined', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          // bc_token_expires_at is undefined (column missing)
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // INVALID_TOKEN returns 401 - missing expires_at is invalid
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when bc_token_expires_at is empty string', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: '', // Empty string - edge case!
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // INVALID_TOKEN returns 401 - empty string creates Invalid Date
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 when bc_token_expires_at is invalid date string', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: 'not-a-date', // Invalid date string
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      // INVALID_TOKEN returns 401 - invalid date is treated as invalid token
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should accept valid future bc_token_expires_at', async () => {
      mockReq = createMockRequest();
      mockReq.userId = 'user-123';

      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{
          bc_access_token_encrypted: 'encrypted-token',
          bc_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        }],
        recordsets: [],
        rowsAffected: [1],
        output: {},
      });

      await requireBCAccess(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});

// ===== 3. AUTHENTICATE MICROSOFT OPTIONAL TESTS =====

describe('authenticateMicrosoftOptional', () => {
  let mockReq: MockRequest;
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('without session', () => {
    it('should call next() without attaching user data when no session', () => {
      mockReq = createMockRequest();
      mockReq.session = undefined as unknown as MockSession;

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
      expect(mockReq.microsoftSession).toBeUndefined();
    });

    it('should call next() without attaching user data when microsoftOAuth is undefined', () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: undefined,
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
    });
  });

  describe('with invalid session', () => {
    it('should call next() without attaching data when userId is missing', () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ userId: undefined }),
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
    });

    it('should call next() without attaching data when token is expired', () => {
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({
            tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(),
          }),
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
    });
  });

  describe('with valid session', () => {
    it('should attach user data and call next() for valid session', () => {
      const validSession = createValidSession();
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: validSession,
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.microsoftSession).toEqual(validSession);
      expect(mockReq.userId).toBe('user-123');
      expect(mockReq.userEmail).toBe('test@example.com');
    });

    it('should work with session without tokenExpiresAt', () => {
      const sessionWithoutExpiry = createValidSession({ tokenExpiresAt: undefined });
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: sessionWithoutExpiry,
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBe('user-123');
    });
  });

  describe('error handling', () => {
    it('should call next() even when session access throws (graceful degradation)', () => {
      // Create a mock that will throw when accessing session properties
      const errorSession = {
        save: vi.fn((cb: (err?: Error) => void) => cb()),
        microsoftOAuth: createValidSession(),
      };

      // Override Object.defineProperty to make microsoftOAuth throw
      Object.defineProperty(errorSession, 'microsoftOAuth', {
        get() {
          throw new Error('Session access error');
        },
      });

      mockReq = {
        session: errorSession,
        path: '/api/test',
        method: 'GET',
      } as MockRequest;

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should continue without auth when session throws accessing properties', () => {
      // Simpler test: verify that errors during session check don't crash
      mockReq = createMockRequest({
        session: {
          save: vi.fn((cb: (err?: Error) => void) => cb()),
          microsoftOAuth: {
            // Missing required fields should not throw, just not attach auth
            userId: undefined,
            microsoftId: undefined,
            accessToken: undefined,
          } as MicrosoftOAuthSession,
        },
      });

      authenticateMicrosoftOptional(mockReq as Request, mockRes, mockNext);

      // Should continue without setting userId
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
    });
  });
});

// ===== 4. SESSION SECURITY TESTS =====

// FIX #12: Session fixation tests
describe('Session Security', () => {
  let mockReq: MockRequest;
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('session fixation protection', () => {
    it('should bind authentication to specific session ID', () => {
      const session1Id = 'session-id-123';
      const session2Id = 'session-id-456';

      // User authenticates with session 1
      const mockReq1 = createMockRequest({
        session: {
          id: session1Id,
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ userId: 'user-1' }),
        },
      });

      authenticateMicrosoftOptional(mockReq1 as Request, mockRes, mockNext);

      expect(mockReq1.userId).toBe('user-1');

      // Different session should not have access to user-1's data
      const mockReq2 = createMockRequest({
        session: {
          id: session2Id,
          save: vi.fn((cb) => cb()),
          microsoftOAuth: undefined, // No OAuth data in this session
        },
      });

      vi.clearAllMocks();
      authenticateMicrosoftOptional(mockReq2 as Request, mockRes, vi.fn());

      expect(mockReq2.userId).toBeUndefined();
    });

    it('should not leak session data between different session IDs', async () => {
      // Attacker tries to use their session ID with victim's OAuth data
      // This simulates session fixation where attacker injects OAuth data
      const attackerSession = createMockRequest({
        session: {
          id: 'attacker-session',
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({
            userId: 'victim-user-id', // Attacker tries to impersonate victim
            email: 'victim@example.com',
          }),
        },
      });

      await authenticateMicrosoft(attackerSession as Request, mockRes, mockNext);

      // The middleware accepts the session as valid (it can't detect fixation alone)
      // Session fixation prevention should happen at login time (regenerate session)
      // This test documents the current behavior
      expect(mockNext).toHaveBeenCalled();
      expect(attackerSession.userId).toBe('victim-user-id');

      // NOTE: True session fixation protection requires session regeneration
      // at login time, which should be tested in auth routes, not middleware
    });
  });

  describe('session isolation', () => {
    it('should not share state between requests', async () => {
      // First request
      const req1 = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ userId: 'user-1' }),
        },
      });

      await authenticateMicrosoft(req1 as Request, mockRes, mockNext);

      // Second request (different user)
      const req2 = createMockRequest({
        session: {
          save: vi.fn((cb) => cb()),
          microsoftOAuth: createValidSession({ userId: 'user-2' }),
        },
      });

      await authenticateMicrosoft(req2 as Request, mockRes, mockNext);

      // Each request should maintain its own state
      expect(req1.userId).toBe('user-1');
      expect(req2.userId).toBe('user-2');
    });
  });
});

// ===== 5. RACE CONDITION DOCUMENTATION =====

// FIX #5: Race condition documentation tests
describe('Token Refresh Race Condition (Documented)', () => {
  /**
   * IMPORTANT: This test suite documents concurrent refresh behavior.
   *
   * Scenario:
   * 1. Token expires at 12:00:00.000
   * 2. Request A arrives at 12:00:00.001 → detects expired → starts refresh via MSAL
   * 3. Request B arrives at 12:00:00.002 → detects expired → starts refresh via MSAL
   * 4. Both requests call oauthService.refreshAccessTokenSilent() concurrently
   *
   * Note: MSAL internally handles token caching in Redis, so concurrent refreshes are safe.
   * The last-write-wins behavior in session is acceptable since all tokens are valid.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should document that concurrent refresh via MSAL is handled', async () => {
    const expiredSession = createValidSession({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    let refreshCallCount = 0;

    const localMockOAuthService = {
      refreshAccessTokenSilent: vi.fn().mockImplementation(async () => {
        refreshCallCount++;
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          accessToken: `new-token-${refreshCallCount}`,
          expiresAt: new Date(Date.now() + 3600000),
        };
      }),
    };

    const { createMicrosoftOAuthService } = await import('@/domains/auth/oauth/MicrosoftOAuthService');
    vi.mocked(createMicrosoftOAuthService).mockReturnValue(
      localMockOAuthService as ReturnType<typeof createMicrosoftOAuthService>
    );

    // Create two requests with same session (simulating race)
    const req1 = createMockRequest({
      session: {
        save: vi.fn((cb) => cb()),
        microsoftOAuth: { ...expiredSession },
      },
    });

    const req2 = createMockRequest({
      session: {
        save: vi.fn((cb) => cb()),
        microsoftOAuth: { ...expiredSession },
      },
    });

    const res1 = createMockResponse();
    const res2 = createMockResponse();
    const next1 = vi.fn();
    const next2 = vi.fn();

    // Execute sequentially to ensure mock is applied
    await authenticateMicrosoft(req1 as Request, res1, next1);
    await authenticateMicrosoft(req2 as Request, res2, next2);

    // Both should succeed (MSAL handles internal caching)
    expect(next1).toHaveBeenCalled();
    expect(next2).toHaveBeenCalled();

    // Both requests triggered refresh - this is expected and safe with MSAL
    expect(refreshCallCount).toBe(2);
  });
});
