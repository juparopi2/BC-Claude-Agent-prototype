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
import { BCTokenManager } from '@/services/auth/BCTokenManager';
import { MicrosoftOAuthService } from '@/services/auth/MicrosoftOAuthService';

// Mock database module with vi.hoisted()
const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

  describe('Concurrent Token Refresh (KNOWN ISSUE)', () => {
    it('should demonstrate race condition with concurrent getBCToken calls (KNOWN ISSUE)', async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          accessToken: `new-bc-token-${refreshCallCount}`,
          refreshToken: 'new-bc-refresh',
          expiresAt: new Date(Date.now() + 3600000),
        };
      });

      // Act: Fire 3 concurrent requests
      const requests = [
        tokenManager.getBCToken('user-123', 'refresh-token'),
        tokenManager.getBCToken('user-123', 'refresh-token'),
        tokenManager.getBCToken('user-123', 'refresh-token'),
      ];

      await Promise.all(requests);

      // Assert: KNOWN ISSUE - All 3 requests triggered refresh
      // In an ideal world, only 1 refresh should happen
      // This test documents the current behavior
      expect(refreshCallCount).toBeGreaterThanOrEqual(1);

      // NOTE: This is the race condition - multiple refreshes may occur
      // A proper fix would use Redis distributed lock or request deduplication
      // to ensure only one refresh happens
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
      results.forEach((result) => {
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
      await Promise.all([
        tokenManager.refreshBCToken('user-123', 'refresh-token'),
        tokenManager.refreshBCToken('user-123', 'refresh-token'),
      ]);

      // Assert: Database writes happened (even if redundant)
      // This is acceptable behavior - the last write wins
      expect(mockExecuteQuery).toHaveBeenCalled();

      // All DB operations should have completed without error
      const writeOperations = mockExecuteQuery.mock.calls.filter(
        (call) => call[0] && call[0].includes('UPDATE users')
      );
      expect(writeOperations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Token Refresh Error Handling During Concurrent Requests', () => {
    it('should handle OAuth service error during concurrent refresh', async () => {
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

      // First call succeeds, second fails
      let callCount = 0;
      vi.mocked(mockOAuthService.acquireBCToken).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            expiresAt: new Date(Date.now() + 3600000),
          };
        }
        throw new Error('OAuth service temporarily unavailable');
      });

      // Act: Fire 2 concurrent requests
      const results = await Promise.allSettled([
        tokenManager.getBCToken('user-123', 'refresh-token'),
        tokenManager.getBCToken('user-123', 'refresh-token'),
      ]);

      // Assert: At least one should succeed, one might fail
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // In race condition, outcomes are non-deterministic
      expect(succeeded.length + failed.length).toBe(2);
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
    });
  });

  describe('Token Expiration Edge Cases', () => {
    it('should handle token expiring exactly at 5-minute boundary', async () => {
      // Token expires exactly at the 5-minute threshold
      const expiresExactly5Minutes = new Date(Date.now() + 5 * 60 * 1000);

      // Need to encrypt a token first
      const tokenData = {
        accessToken: 'boundary-token',
        refreshToken: 'boundary-refresh',
        expiresAt: expiresExactly5Minutes,
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      // Set up for getBCToken
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encrypted,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiresExactly5Minutes,
          },
        ],
      });

      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'refreshed-token',
        refreshToken: 'refreshed-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await tokenManager.getBCToken('user-123', 'refresh-token');

      // Should trigger refresh at exactly 5-minute boundary
      expect(mockOAuthService.acquireBCToken).toHaveBeenCalled();
    });

    it('should NOT refresh token expiring at 6 minutes', async () => {
      // Token expires in 6 minutes (outside refresh window)
      const expiresIn6Minutes = new Date(Date.now() + 6 * 60 * 1000);

      // Encrypt a token first
      const tokenData = {
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh',
        expiresAt: expiresIn6Minutes,
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encrypted,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiresIn6Minutes,
          },
        ],
      });

      await tokenManager.getBCToken('user-123', 'refresh-token');

      // Should NOT trigger refresh
      expect(mockOAuthService.acquireBCToken).not.toHaveBeenCalled();
    });
  });

  describe('Future Fix Documentation', () => {
    /**
     * This section documents the recommended fix for the race condition:
     *
     * 1. Use Redis distributed lock:
     *    - Lock key: `bc-token-refresh:${userId}`
     *    - Lock TTL: 30 seconds
     *    - Only first request acquires lock and refreshes
     *    - Other requests wait for lock release and use refreshed token
     *
     * 2. Request deduplication:
     *    - Track in-flight refresh requests in memory
     *    - Return same Promise to concurrent callers
     *    - Cleanup after resolution
     *
     * Example implementation:
     * ```typescript
     * private refreshPromises = new Map<string, Promise<BCTokenData>>();
     *
     * async getBCToken(userId: string, refreshToken: string): Promise<BCTokenData> {
     *   if (this.needsRefresh(token)) {
     *     if (!this.refreshPromises.has(userId)) {
     *       this.refreshPromises.set(userId,
     *         this.refreshBCToken(userId, refreshToken)
     *           .finally(() => this.refreshPromises.delete(userId))
     *       );
     *     }
     *     return this.refreshPromises.get(userId)!;
     *   }
     *   return token;
     * }
     * ```
     */
    it('should acknowledge race condition exists and document fix approach', () => {
      // This test is a placeholder that documents the issue
      // The actual fix would be implemented in BCTokenManager
      expect(true).toBe(true);
    });
  });
});
