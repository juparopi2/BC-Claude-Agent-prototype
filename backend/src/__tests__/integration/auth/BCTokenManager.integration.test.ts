/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: Real database via setupDatabaseForTests()
 * - Encryption: Real AES-256-GCM via crypto.randomBytes()
 * - Promise Map: Real Map for deduplication
 *
 * Mocks allowed:
 * - Microsoft OAuth API (external service)
 *
 * NO MOCKS of:
 * - BCTokenManager service logic
 * - Database operations (encrypt, persist, retrieve)
 * - Promise deduplication mechanism
 *
 * Purpose:
 * Validates that concurrent refresh token requests are correctly
 * deduplicated, persisted to database, and encrypted securely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCTokenManager } from '../../../services/auth/BCTokenManager';
import { MicrosoftOAuthService } from '../../../services/auth/MicrosoftOAuthService';
import { executeQuery } from '../../../config/database';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import crypto from 'crypto';

// Mock only external OAuth service
const mockOAuthService = {
  acquireBCToken: vi.fn(),
} as unknown as MicrosoftOAuthService;

describe('BCTokenManager Integration - Race Condition', () => {
  // Setup database connection (skip Redis as we don't need it)
  setupDatabaseForTests({ skipRedis: true });

  let tokenManager: BCTokenManager;
  const testEncryptionKey = crypto.randomBytes(32).toString('base64');
  const testUserId = crypto.randomUUID();

  beforeEach(async () => {
    // Initialize service with real encryption key
    tokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);
    
    // Clean up test user if exists
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });
    
    // Create test user
    // Note: Omitting 'role' as it causes truncation issues in test DB environment
    await executeQuery(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (@id, 'test-race@example.com', 'Test Race User', GETDATE(), GETDATE())`,
      { id: testUserId }
    );
    
    vi.clearAllMocks();
  });


  afterEach(async () => {
    // Cleanup
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });
    vi.restoreAllMocks();
  });

  it('should deduplicate concurrent refreshes with REAL database', async () => {
    // Arrange: Mock OAuth response
    let callCount = 0;
    vi.mocked(mockOAuthService.acquireBCToken).mockImplementation(async () => {
      callCount++;
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        accessToken: `real-db-token-${callCount}`,
        refreshToken: 'real-db-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      };
    });

    // Act: 10 concurrent refreshes
    // We use 'refresh' mode or ensure no token exists to force refresh
    const promises = Array.from({ length: 10 }, () =>
      tokenManager.getBCToken(testUserId, 'force-refresh-token')
    );

    const results = await Promise.all(promises);

    // Validate: Only 1 OAuth call
    expect(mockOAuthService.acquireBCToken).toHaveBeenCalledTimes(1);

    // Validate: All results are identical
    const firstResult = results[0];
    results.forEach(result => {
      expect(result.accessToken).toBe('real-db-token-1');
    });

    // Validate: Token persisted in REAL database
    const dbResult = await executeQuery(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    
    expect(dbResult.recordset[0].bc_access_token_encrypted).toBeTruthy();
    
    // Validate: Can decrypt the stored token
    // We create a new instance to ensure we read from DB, not memory cache (if any)
    const newTokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);
    // Mock OAuth again to ensure it's NOT called this time (should use DB)
    vi.mocked(mockOAuthService.acquireBCToken).mockClear();
    
    const storedToken = await newTokenManager.getBCToken(testUserId, 'force-refresh-token');
    expect(storedToken.accessToken).toBe('real-db-token-1');
    expect(mockOAuthService.acquireBCToken).not.toHaveBeenCalled();
  });
});
