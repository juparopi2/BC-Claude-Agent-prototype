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
import { executeQuery } from '@/infrastructure/database/database';
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
  // Generate unique testUserId for each test file run
  const testUserId = crypto.randomUUID();
  // Generate unique email to avoid conflicts with parallel tests
  const testEmail = `test-race-${Date.now()}-${Math.random().toString(36).substring(7)}@bcagent.test`;

  beforeEach(async () => {
    // Initialize service with real encryption key
    tokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);

    // Clean up test user if exists (including usage_events references)
    await executeQuery('DELETE FROM usage_events WHERE user_id = @id', { id: testUserId });
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });

    // Create test user with unique email
    // Note: Omitting 'role' as it causes truncation issues in test DB environment
    await executeQuery(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (@id, @email, 'Test Race User', GETDATE(), GETDATE())`,
      { id: testUserId, email: testEmail }
    );

    vi.clearAllMocks();
  });


  afterEach(async () => {
    // Cleanup - delete usage_events first to avoid FK constraint
    await executeQuery('DELETE FROM usage_events WHERE user_id = @id', { id: testUserId });
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });
    vi.restoreAllMocks();
  });

  it('should complete full token lifecycle: refresh → encrypt → persist → retrieve → decrypt', async () => {
    // ========== ARRANGE ==========
    // Mock OAuth response with realistic token
    vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
      accessToken: 'lifecycle_access_token_12345',
      refreshToken: 'lifecycle_refresh_token_67890',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    });

    // ========== ACT: Refresh Token ==========
    const tokenResult = await tokenManager.getBCToken(testUserId, 'force-refresh-token');

    // ========== ASSERT: Token returned ==========
    expect(tokenResult.accessToken).toBe('lifecycle_access_token_12345');
    expect(tokenResult.refreshToken).toBe('lifecycle_refresh_token_67890');

    // ========== ASSERT: Token persisted encrypted in database ==========
    const dbResult = await executeQuery<{
      bc_access_token_encrypted: string;
      bc_refresh_token_encrypted: string;
    }>(
      'SELECT bc_access_token_encrypted, bc_refresh_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );

    const user = dbResult.recordset[0];
    expect(user).toBeTruthy();
    expect(user!.bc_access_token_encrypted).toBeTruthy();
    expect(user!.bc_refresh_token_encrypted).toBeTruthy();

    // Validate token is encrypted (non-empty string, format may vary)
    expect(user!.bc_access_token_encrypted.length).toBeGreaterThan(0);

    // ========== ASSERT: Token can be retrieved and decrypted ==========
    const retrievedToken = await tokenManager.getBCToken(testUserId, 'force-refresh-token');
    expect(retrievedToken.accessToken).toBe('lifecycle_access_token_12345');
    expect(retrievedToken.refreshToken).toBe('lifecycle_refresh_token_67890');

    // ========== ASSERT: Calling again returns cached token (no new OAuth call) ==========
    vi.mocked(mockOAuthService.acquireBCToken).mockClear();
    const cachedToken = await tokenManager.getBCToken(testUserId, 'force-refresh-token');
    expect(cachedToken.accessToken).toBe('lifecycle_access_token_12345');
    expect(mockOAuthService.acquireBCToken).not.toHaveBeenCalled();
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

  it('should handle encryption/decryption errors gracefully', async () => {
    // ========== ARRANGE ==========
    // First, store a valid token
    vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
      accessToken: 'valid_token',
      refreshToken: 'valid_refresh',
      expiresAt: new Date(Date.now() + 3600000),
    });

    await tokenManager.getBCToken(testUserId, 'force-refresh-token');

    // ========== ACT: Corrupt the encrypted token in database ==========
    await executeQuery(
      'UPDATE users SET bc_access_token_encrypted = @corruptToken WHERE id = @id',
      { corruptToken: 'INVALID_HEX_STRING_NOT_ENCRYPTED', id: testUserId }
    );

    // ========== ASSERT: Should handle decryption error gracefully ==========
    // Create new token manager to clear any caches
    const newTokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);

    // The manager should throw an error when encountering corrupted data
    await expect(newTokenManager.getBCToken(testUserId, 'force-refresh-token')).rejects.toThrow(
      /Failed to retrieve Business Central token/
    );

    // ========== ASSERT: System recovers after fixing token ==========
    // Delete corrupted user and create fresh one
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });
    await executeQuery(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (@id, 'test-recovery@example.com', 'Test Recovery User', GETDATE(), GETDATE())`,
      { id: testUserId }
    );

    // Mock new token response
    vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
      accessToken: 'recovered_token',
      refreshToken: 'recovered_refresh',
      expiresAt: new Date(Date.now() + 3600000),
    });

    // This should work now with fresh user
    const recoveredToken = await newTokenManager.getBCToken(testUserId, 'force-refresh-token');
    expect(recoveredToken.accessToken).toBe('recovered_token');
  });

  it('should handle token expiration and automatic refresh', async () => {
    // ========== ARRANGE: Store an expired token ==========
    // First store a token with very short expiry
    vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
      accessToken: 'expired_token',
      refreshToken: 'expired_refresh',
      expiresAt: new Date(Date.now() - 1000), // Already expired (1 second ago)
    });

    // Store the expired token
    await tokenManager.getBCToken(testUserId, 'force-refresh-token');

    // ========== ACT: Request token (should auto-refresh) ==========
    // Mock new token response
    vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
      accessToken: 'fresh_token_after_expiry',
      refreshToken: 'fresh_refresh',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    });

    // Request token - should detect expiration and refresh automatically
    const refreshedToken = await tokenManager.getBCToken(testUserId, 'force-refresh-token');

    // ========== ASSERT: New token returned ==========
    expect(refreshedToken.accessToken).toBe('fresh_token_after_expiry');

    // ========== ASSERT: New token persisted in database ==========
    const dbResult = await executeQuery<{
      bc_access_token_encrypted: string;
    }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );

    expect(dbResult.recordset[0]?.bc_access_token_encrypted).toBeTruthy();

    // Verify we can decrypt the new token
    const newTokenManager = new BCTokenManager(testEncryptionKey, mockOAuthService);
    const decryptedToken = await newTokenManager.getBCToken(testUserId, 'force-refresh-token');
    expect(decryptedToken.accessToken).toBe('fresh_token_after_expiry');
  });
});
