/**
 * MicrosoftOAuthService Unit Tests
 *
 * Tests for Microsoft Entra ID OAuth 2.0 authentication service.
 * Covers authorization code flow, token acquisition/refresh, user profile retrieval,
 * and Business Central API token acquisition.
 *
 * Created: 2025-11-19 (Phase 3, Task 3.1)
 * Coverage Target: 70%+
 * Test Count: 30
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthenticationResult } from '@azure/msal-node';
import { http, HttpResponse } from 'msw';
import { server } from '../../../mocks/server';
import { MicrosoftOAuthService } from '@/domains/auth/oauth/MicrosoftOAuthService';
import type { MicrosoftOAuthConfig, OAuthTokenResponse, TokenAcquisitionResult, MicrosoftUserProfile } from '@/types/microsoft.types';
import { BC_API_SCOPE, ALL_SCOPES } from '@/types/microsoft.types';

// ============================================================================
// MOCKS SETUP
// ============================================================================

const mockMsalClient = vi.hoisted(() => ({
  getAuthCodeUrl: vi.fn(),
  acquireTokenByCode: vi.fn(),
  acquireTokenByRefreshToken: vi.fn(),
}));

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: vi.fn(() => mockMsalClient),
}));

// Mock logger to avoid console output during tests
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ============================================================================
// TEST SUITE
// ============================================================================

describe('MicrosoftOAuthService', () => {
  let service: MicrosoftOAuthService;
  let mockConfig: MicrosoftOAuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tenantId: 'test-tenant-id',
      redirectUri: 'http://localhost:3002/api/auth/callback',
      scopes: ALL_SCOPES,
    };

    service = new MicrosoftOAuthService(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. AUTHORIZATION CODE FLOW (8 tests)
  // ==========================================================================

  describe('Authorization Code Flow', () => {
    describe('getAuthCodeUrl()', () => {
      it('should generate authorization URL with correct parameters', async () => {
        const mockAuthUrl = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize?client_id=test-client-id';
        mockMsalClient.getAuthCodeUrl.mockResolvedValue(mockAuthUrl);

        const state = 'random-state-123';
        const result = await service.getAuthCodeUrl(state);

        expect(result).toBe(mockAuthUrl);
        expect(mockMsalClient.getAuthCodeUrl).toHaveBeenCalledWith({
          scopes: ALL_SCOPES,
          redirectUri: mockConfig.redirectUri,
          state,
          prompt: 'select_account',
        });
      });

      it('should include required scopes (openid, profile, email, BC API)', async () => {
        const mockAuthUrl = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize';
        mockMsalClient.getAuthCodeUrl.mockResolvedValue(mockAuthUrl);

        await service.getAuthCodeUrl('state-123');

        const callArgs = mockMsalClient.getAuthCodeUrl.mock.calls[0][0];
        expect(callArgs.scopes).toContain('openid');
        expect(callArgs.scopes).toContain('profile');
        expect(callArgs.scopes).toContain('email');
        expect(callArgs.scopes).toContain('offline_access');
        expect(callArgs.scopes).toContain('User.Read');
        expect(callArgs.scopes).toContain(BC_API_SCOPE);
      });

      it('should use correct redirect URI', async () => {
        const mockAuthUrl = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize';
        mockMsalClient.getAuthCodeUrl.mockResolvedValue(mockAuthUrl);

        await service.getAuthCodeUrl('state-123');

        const callArgs = mockMsalClient.getAuthCodeUrl.mock.calls[0][0];
        expect(callArgs.redirectUri).toBe('http://localhost:3002/api/auth/callback');
      });

      it('should include prompt=select_account for account selection', async () => {
        const mockAuthUrl = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize';
        mockMsalClient.getAuthCodeUrl.mockResolvedValue(mockAuthUrl);

        await service.getAuthCodeUrl('state-123');

        const callArgs = mockMsalClient.getAuthCodeUrl.mock.calls[0][0];
        expect(callArgs.prompt).toBe('select_account');
      });

      it('should validate state parameter (CSRF protection)', async () => {
        const mockAuthUrl = 'https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/authorize';
        mockMsalClient.getAuthCodeUrl.mockResolvedValue(mockAuthUrl);

        const state = 'csrf-protection-state-456';
        await service.getAuthCodeUrl(state);

        const callArgs = mockMsalClient.getAuthCodeUrl.mock.calls[0][0];
        expect(callArgs.state).toBe(state);
      });

      it('should handle MSAL errors gracefully', async () => {
        mockMsalClient.getAuthCodeUrl.mockRejectedValue(new Error('MSAL error'));

        await expect(service.getAuthCodeUrl('state-123')).rejects.toThrow('Failed to generate Microsoft login URL');
      });

      it('should handle network errors', async () => {
        mockMsalClient.getAuthCodeUrl.mockRejectedValue(new Error('Network timeout'));

        await expect(service.getAuthCodeUrl('state-123')).rejects.toThrow('Failed to generate Microsoft login URL');
      });

      it('should handle invalid configuration errors', async () => {
        mockMsalClient.getAuthCodeUrl.mockRejectedValue(new Error('Invalid client credentials'));

        await expect(service.getAuthCodeUrl('state-123')).rejects.toThrow('Failed to generate Microsoft login URL');
      });
    });
  });

  // ==========================================================================
  // 2. TOKEN ACQUISITION (8 tests)
  // ==========================================================================

  describe('Token Acquisition', () => {
    describe('handleAuthCallback()', () => {
      it('should acquire access token with valid code', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'mock-access-token',
          idToken: 'mock-id-token',
          tokenType: 'Bearer',
          expiresOn: new Date(Date.now() + 3600000), // 1 hour from now
          scopes: ['openid', 'profile', 'email'],
          refreshToken: 'mock-refresh-token',
        };

        mockMsalClient.acquireTokenByCode.mockResolvedValue(mockResponse);

        const result = await service.handleAuthCallback('auth-code-123', 'state-456');

        expect(result).toEqual({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          id_token: 'mock-id-token',
          token_type: 'Bearer',
          expires_in: expect.any(Number),
          scope: 'openid profile email',
        });

        expect(mockMsalClient.acquireTokenByCode).toHaveBeenCalledWith({
          code: 'auth-code-123',
          scopes: ALL_SCOPES,
          redirectUri: mockConfig.redirectUri,
        });
      });

      it('should handle missing refresh token (type guard pattern)', async () => {
        // MSAL may not expose refreshToken in typed response
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'mock-access-token',
          idToken: 'mock-id-token',
          tokenType: 'Bearer',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: ['openid', 'profile'],
          // refreshToken NOT present
        };

        mockMsalClient.acquireTokenByCode.mockResolvedValue(mockResponse);

        const result = await service.handleAuthCallback('auth-code-123', 'state-456');

        expect(result.refresh_token).toBeUndefined();
      });

      it('should calculate expires_in from expiresOn', async () => {
        const futureDate = new Date(Date.now() + 7200000); // 2 hours from now
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'mock-access-token',
          idToken: 'mock-id-token',
          expiresOn: futureDate,
          scopes: ['openid'],
        };

        mockMsalClient.acquireTokenByCode.mockResolvedValue(mockResponse);

        const result = await service.handleAuthCallback('auth-code-123', 'state-456');

        // expires_in should be approximately 7200 seconds (allowing for small time diff)
        expect(result.expires_in).toBeGreaterThan(7100);
        expect(result.expires_in).toBeLessThan(7300);
      });

      it('should default to 3600 seconds if expiresOn is missing', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'mock-access-token',
          idToken: 'mock-id-token',
          scopes: ['openid'],
          // expiresOn NOT present
        };

        mockMsalClient.acquireTokenByCode.mockResolvedValue(mockResponse);

        const result = await service.handleAuthCallback('auth-code-123', 'state-456');

        expect(result.expires_in).toBe(3600);
      });

      it('should handle invalid authorization code', async () => {
        mockMsalClient.acquireTokenByCode.mockRejectedValue(new Error('Invalid authorization code'));

        await expect(service.handleAuthCallback('invalid-code', 'state-123')).rejects.toThrow('Failed to complete Microsoft login');
      });

      it('should handle expired authorization code', async () => {
        mockMsalClient.acquireTokenByCode.mockRejectedValue(new Error('Authorization code expired'));

        await expect(service.handleAuthCallback('expired-code', 'state-123')).rejects.toThrow('Failed to complete Microsoft login');
      });

      it('should handle missing access token in response', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          // accessToken missing
          idToken: 'mock-id-token',
          scopes: ['openid'],
        };

        mockMsalClient.acquireTokenByCode.mockResolvedValue(mockResponse);

        await expect(service.handleAuthCallback('auth-code-123', 'state-456')).rejects.toThrow('Failed to complete Microsoft login');
      });

      it('should handle rate limiting errors', async () => {
        mockMsalClient.acquireTokenByCode.mockRejectedValue(new Error('Rate limit exceeded'));

        await expect(service.handleAuthCallback('auth-code-123', 'state-456')).rejects.toThrow('Failed to complete Microsoft login');
      });
    });
  });

  // ==========================================================================
  // 3. TOKEN REFRESH (6 tests)
  // ==========================================================================

  describe('Token Refresh', () => {
    describe('refreshAccessToken()', () => {
      it('should refresh access token using refresh token', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'new-access-token',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: ['openid', 'profile'],
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.refreshAccessToken('old-refresh-token');

        expect(result).toEqual({
          accessToken: 'new-access-token',
          refreshToken: 'old-refresh-token', // Reused if not provided
          expiresAt: expect.any(Date),
        });

        expect(mockMsalClient.acquireTokenByRefreshToken).toHaveBeenCalledWith({
          refreshToken: 'old-refresh-token',
          scopes: ALL_SCOPES,
        });
      });

      it('should reuse input refresh token if MSAL does not return new one', async () => {
        // MSAL typically doesn't return new refresh token on refresh
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'new-access-token',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: ['openid'],
          // refreshToken NOT present
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.refreshAccessToken('original-refresh-token');

        expect(result.refreshToken).toBe('original-refresh-token');
      });

      it('should update token expiration time', async () => {
        const futureDate = new Date(Date.now() + 7200000); // 2 hours
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'new-access-token',
          expiresOn: futureDate,
          scopes: ['openid'],
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.refreshAccessToken('refresh-token');

        expect(result.expiresAt).toEqual(futureDate);
      });

      it('should handle expired refresh token', async () => {
        mockMsalClient.acquireTokenByRefreshToken.mockRejectedValue(new Error('Refresh token expired'));

        await expect(service.refreshAccessToken('expired-refresh-token')).rejects.toThrow('Failed to refresh Microsoft access token');
      });

      it('should handle revoked refresh token', async () => {
        mockMsalClient.acquireTokenByRefreshToken.mockRejectedValue(new Error('Refresh token revoked'));

        await expect(service.refreshAccessToken('revoked-token')).rejects.toThrow('Failed to refresh Microsoft access token');
      });

      it('should default to 1 hour expiry if expiresOn is missing', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'new-access-token',
          scopes: ['openid'],
          // expiresOn missing
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.refreshAccessToken('refresh-token');

        const expectedExpiry = Date.now() + 3600 * 1000;
        const actualExpiry = result.expiresAt.getTime();

        // Allow 1 second tolerance
        expect(actualExpiry).toBeGreaterThan(expectedExpiry - 1000);
        expect(actualExpiry).toBeLessThan(expectedExpiry + 1000);
      });
    });
  });

  // ==========================================================================
  // 4. USER PROFILE (4 tests)
  // ==========================================================================

  describe('User Profile', () => {
    describe('getUserProfile()', () => {
      it('should retrieve user profile from Microsoft Graph', async () => {
        // MSW handler is already set up in handlers.ts
        // Default response matches what we expect
        const result = await service.getUserProfile('access-token-123');

        expect(result.displayName).toBe('Test User');
        expect(result.mail).toBe('test.user@example.com');
        expect(result.userPrincipalName).toBe('test.user@example.com');
        expect(result.givenName).toBe('Test');
        expect(result.surname).toBe('User');
      });

      it('should parse user info (name, email, UPN)', async () => {
        // Override MSW handler for this specific test
        server.use(
          http.get('https://graph.microsoft.com/v1.0/me', () => {
            return HttpResponse.json({
              id: 'user-456',
              displayName: 'Jane Smith',
              givenName: 'Jane',
              surname: 'Smith',
              mail: 'jane.smith@example.com',
              userPrincipalName: 'jane.smith@example.com',
            });
          })
        );

        const result = await service.getUserProfile('access-token-456');

        expect(result.displayName).toBe('Jane Smith');
        expect(result.mail).toBe('jane.smith@example.com');
        expect(result.userPrincipalName).toBe('jane.smith@example.com');
      });

      it('should fallback to userPrincipalName if mail is missing', async () => {
        // Override MSW handler with missing mail field
        server.use(
          http.get('https://graph.microsoft.com/v1.0/me', () => {
            return HttpResponse.json({
              id: 'user-789',
              displayName: 'No Mail User',
              givenName: 'No',
              surname: 'Mail',
              userPrincipalName: 'nomail@example.com',
              // mail field missing
            });
          })
        );

        const result = await service.getUserProfile('access-token-789');

        expect(result.mail).toBe('nomail@example.com');
      });

      it('should handle Graph API errors', async () => {
        // Override MSW handler to return error
        server.use(
          http.get('https://graph.microsoft.com/v1.0/me', () => {
            return HttpResponse.json(
              { error: 'Unauthorized' },
              { status: 401 }
            );
          })
        );

        await expect(service.getUserProfile('invalid-token')).rejects.toThrow('Failed to retrieve user profile');
      });
    });

    describe('validateAccessToken()', () => {
      it('should return true for valid token', async () => {
        // MSW handler returns valid profile by default
        const result = await service.validateAccessToken('valid-token');

        expect(result).toBe(true);
      });

      it('should return false for invalid token (never throws)', async () => {
        // Override MSW handler to return error
        server.use(
          http.get('https://graph.microsoft.com/v1.0/me', () => {
            return HttpResponse.json(
              { error: 'Unauthorized' },
              { status: 401 }
            );
          })
        );

        const result = await service.validateAccessToken('invalid-token');

        expect(result).toBe(false);
      });
    });
  });

  // ==========================================================================
  // 5. BC TOKEN ACQUISITION (4 tests)
  // ==========================================================================

  describe('Business Central Token Acquisition', () => {
    describe('acquireBCToken()', () => {
      it('should acquire BC API token with delegated permissions', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'bc-access-token',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: [BC_API_SCOPE],
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.acquireBCToken('user-refresh-token');

        expect(result).toEqual({
          accessToken: 'bc-access-token',
          refreshToken: 'user-refresh-token', // Reused
          expiresAt: expect.any(Date),
        });

        expect(mockMsalClient.acquireTokenByRefreshToken).toHaveBeenCalledWith({
          refreshToken: 'user-refresh-token',
          scopes: [BC_API_SCOPE],
        });
      });

      it('should include BC scope (Financials.ReadWrite.All)', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'bc-token',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: [BC_API_SCOPE],
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        await service.acquireBCToken('refresh-token');

        const callArgs = mockMsalClient.acquireTokenByRefreshToken.mock.calls[0][0];
        expect(callArgs.scopes).toEqual([BC_API_SCOPE]);
        expect(callArgs.scopes[0]).toBe('https://api.businesscentral.dynamics.com/Financials.ReadWrite.All');
      });

      it('should reuse input refresh token if not returned', async () => {
        const mockResponse: Partial<AuthenticationResult> = {
          accessToken: 'bc-token',
          expiresOn: new Date(Date.now() + 3600000),
          scopes: [BC_API_SCOPE],
          // refreshToken NOT present
        };

        mockMsalClient.acquireTokenByRefreshToken.mockResolvedValue(mockResponse);

        const result = await service.acquireBCToken('original-refresh-token');

        expect(result.refreshToken).toBe('original-refresh-token');
      });

      it('should handle BC token acquisition errors', async () => {
        mockMsalClient.acquireTokenByRefreshToken.mockRejectedValue(new Error('BC scope not consented'));

        await expect(service.acquireBCToken('refresh-token')).rejects.toThrow('Failed to acquire Business Central access');
      });
    });
  });

  // ==========================================================================
  // 6. CONFIGURATION (1 test)
  // ==========================================================================

  describe('Configuration', () => {
    it('should return partial config for debugging (no secret)', () => {
      const config = service.getConfig();

      expect(config).toEqual({
        clientId: 'test-client-id',
        tenantId: 'test-tenant-id',
        redirectUri: 'http://localhost:3002/api/auth/callback',
        scopes: ALL_SCOPES,
      });

      // Ensure clientSecret is NOT exposed
      expect(config).not.toHaveProperty('clientSecret');
    });
  });
});
