/**
 * BCTokenManager Race Condition Tests
 *
 * Documents and tests the known race condition in token refresh logic.
 * These tests demonstrate the issue and provide regression protection
 * for any future fix implementation.
 *
 * KNOWN ISSUE: When multiple concurrent requests check token expiration
 * and all trigger refresh, multiple refresh operations can occur.
 * A proper fix would require Redis distributed locks or request deduplication.
 *
 * @see docs/qa-reports/QA-MASTER-REVIEW-F6-005.md Section 2.2
 * @module __tests__/unit/services/auth/BCTokenManager.raceCondition.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCTokenManager } from '../../../../services/auth/BCTokenManager';
import { MicrosoftOAuthService } from '../../../../services/auth/MicrosoftOAuthService';
import { BCTokenData } from '../../../../types/microsoft.types';

// Mock database module with vi.hoisted()
const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger
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

describe('BCTokenManager Race Condition', () => {
  let tokenManager: BCTokenManager;
  let mockOAuthService: MicrosoftOAuthService;
  const testEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 bytes base64

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock OAuth service
    mockOAuthService = {
      acquireBCToken: vi.fn(),
    } as unknown as MicrosoftOAuthService;

    // Create token manager instance
    tokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Concurrent Token Refresh (Fixed Race Condition)', () => {
    it('should deduplicate concurrent getBCToken calls', async () => {
      // Arrange: Token expiring in 3 minutes (within 5-minute refresh window)
      const expiresIn3Minutes = new Date(Date.now() + 3 * 60 * 1000);

      // First call returns expiring token
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: 'encrypted-token',
            bc_refresh_token_encrypted: 'encrypted-refresh',
            bc_token_expires_at: expiresIn3Minutes,
          },
        ],
      });

      // Mock OAuth service to track refresh calls
      let refreshCallCount = 0;
      vi.mocked(mockOAuthService.acquireBCToken).mockImplementation(async () => {
        refreshCallCount++;
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          accessToken: `new-bc-token-${refreshCallCount}`,
          refreshToken: 'new-bc-refresh',
          expiresAt: new Date(Date.now() + 3600000),
        };
      });

      // Act: Fire 10 concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        tokenManager.getBCToken('user-123', 'refresh-token')
      );

      const results = await Promise.all(promises);

      // Assert: Only 1 refresh should happen (Deduplication)
      expect(refreshCallCount).toBe(1);

      // Assert: All results are identical
      const firstResult = results[0];
      results.forEach((result: BCTokenData) => {
        expect(result).toEqual(firstResult);
        expect(result.accessToken).toBe('new-bc-token-1');
      });

      // Assert: Map should be cleaned up
      // Access private property for testing
      expect(tokenManager['refreshPromises'].size).toBe(0);
    });

    it('should handle concurrent refresh without data corruption', async () => {
      // Arrange: Token expiring soon
      const expiringToken = new Date(Date.now() + 2 * 60 * 1000);

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: 'encrypted-token',
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiringToken,
          },
        ],
      });

      // Mock OAuth service
      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Act: Fire multiple concurrent requests
      const results = await Promise.all([
        tokenManager.getBCToken('user-123', 'refresh-token'),
        tokenManager.getBCToken('user-123', 'refresh-token'),
      ]);

      // Assert: All requests complete successfully (no crashes or errors)
      expect(results).toHaveLength(2);
      results.forEach((result: BCTokenData) => {
        expect(result).toBeDefined();
        expect(result.accessToken).toBeDefined();
      });
    });

    it('should not corrupt database during concurrent writes', async () => {
      // Arrange
      const expiringToken = new Date(Date.now() + 1 * 60 * 1000);

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: 'old-token',
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiringToken,
          },
        ],
      });

      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'concurrent-new-token',
        refreshToken: 'concurrent-new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Act: Concurrent refreshes
      // Note: refreshBCToken is the direct call, getBCToken uses deduplication
      // Testing direct calls to ensure DB safety even if deduplication is bypassed
      await Promise.all([
        tokenManager.refreshBCToken('user-123', 'refresh-token'),
        tokenManager.refreshBCToken('user-123', 'refresh-token'),
      ]);

      // Assert: Database writes happened
      expect(mockExecuteQuery).toHaveBeenCalled();

      // All DB operations should have completed without error
      const writeOperations = mockExecuteQuery.mock.calls.filter(
        (call) => call[0] && call[0].includes('UPDATE users')
      );
      expect(writeOperations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Token Refresh Error Handling During Concurrent Requests', () => {
    it('should reject all concurrent callers if refresh fails', async () => {
      const expiringToken = new Date(Date.now() + 2 * 60 * 1000);

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: 'old-token',
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiringToken,
          },
        ],
      });

      // OAuth service fails
      vi.mocked(mockOAuthService.acquireBCToken).mockRejectedValue(
        new Error('OAuth service temporarily unavailable')
      );

      // Act: Fire 5 concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        tokenManager.getBCToken('user-123', 'refresh-token')
      );

      // Assert: All should reject with the same error
      await expect(Promise.all(promises)).rejects.toThrow('Failed to retrieve Business Central token');

      // Assert: Map should be cleaned up even on error
      expect(tokenManager['refreshPromises'].size).toBe(0);
    });

    it('should handle database error during concurrent token storage', async () => {
      const expiringToken = new Date(Date.now() + 2 * 60 * 1000);

      // First query (get token) succeeds
      mockExecuteQuery
        .mockResolvedValueOnce({
          recordset: [
            {
              bc_access_token_encrypted: 'old-token',
              bc_refresh_token_encrypted: null,
              bc_token_expires_at: expiringToken,
            },
          ],
        })
        // Second query (store new token) fails
        .mockRejectedValueOnce(new Error('Database deadlock'));

      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      // Act & Assert: Should handle database errors gracefully
      await expect(tokenManager.getBCToken('user-123', 'refresh-token')).rejects.toThrow(
        'Failed to retrieve Business Central token'
      );
      
      // Map cleanup check
      expect(tokenManager['refreshPromises'].size).toBe(0);
    });
  });

  describe('User Isolation', () => {
    it('should isolate refreshes per user', async () => {
      const expiringToken = new Date(Date.now() + 2 * 60 * 1000);

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: 'old-token',
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiringToken,
          },
        ],
      });

      // Mock OAuth to return different tokens
      vi.mocked(mockOAuthService.acquireBCToken).mockImplementation(async (refreshToken: string) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          accessToken: `token-for-${refreshToken}`,
          refreshToken: `refresh-for-${refreshToken}`,
          expiresAt: new Date(Date.now() + 3600000),
        };
      });

      // Act: Concurrent requests for DIFFERENT users
      const user1Promise = tokenManager.getBCToken('user-1', 'refresh-1');
      const user2Promise = tokenManager.getBCToken('user-2', 'refresh-2');

      const [result1, result2] = await Promise.all([user1Promise, user2Promise]);

      // Assert: Should be 2 distinct calls
      expect(mockOAuthService.acquireBCToken).toHaveBeenCalledTimes(2);
      expect(result1.accessToken).toBe('token-for-refresh-1');
      expect(result2.accessToken).toBe('token-for-refresh-2');
      
      // Map cleanup
      expect(tokenManager['refreshPromises'].size).toBe(0);
    });
  });
});
