/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: Real database via setupDatabaseForTests()
 * - Encryption: Real AES-256-GCM via crypto.randomBytes()
 *
 * Purpose:
 * Validates that BC token storage and clearing work correctly with real database.
 *
 * Note: Token refresh is handled by MSAL (MicrosoftOAuthService.acquireBCTokenSilent).
 * This manager only handles encrypted storage of access tokens.
 *
 * Updated: 2026-02-02 - Simplified to test only storeBCToken and clearBCToken
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCTokenManager } from '../../../services/auth/BCTokenManager';
import { executeQuery } from '@/infrastructure/database/database';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import crypto from 'crypto';

describe('BCTokenManager Integration', () => {
  // Setup database connection (skip Redis as we don't need it)
  setupDatabaseForTests({ skipRedis: true });

  let tokenManager: BCTokenManager;
  const testEncryptionKey = crypto.randomBytes(32).toString('base64');
  // Generate unique testUserId for each test file run (UPPERCASE per CLAUDE.md)
  const testUserId = crypto.randomUUID().toUpperCase();
  // Generate unique email to avoid conflicts with parallel tests
  const testEmail = `test-bc-token-${Date.now()}-${Math.random().toString(36).substring(7)}@bcagent.test`;

  beforeEach(async () => {
    // Initialize service with real encryption key
    tokenManager = new BCTokenManager(testEncryptionKey);

    // Clean up test user if exists (including usage_events references)
    await executeQuery('DELETE FROM usage_events WHERE user_id = @id', { id: testUserId });
    await executeQuery('DELETE FROM users WHERE id = @id', { id: testUserId });

    // Create test user with unique email
    await executeQuery(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (@id, @email, 'Test BC Token User', GETDATE(), GETDATE())`,
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

  it('should store encrypted BC token in database', async () => {
    // ========== ARRANGE ==========
    const tokenData = {
      accessToken: 'test_access_token_12345',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    };

    // ========== ACT ==========
    await tokenManager.storeBCToken(testUserId, tokenData);

    // ========== ASSERT: Token persisted encrypted in database ==========
    const dbResult = await executeQuery<{
      bc_access_token_encrypted: string;
      bc_token_expires_at: Date;
    }>(
      'SELECT bc_access_token_encrypted, bc_token_expires_at FROM users WHERE id = @id',
      { id: testUserId }
    );

    const user = dbResult.recordset[0];
    expect(user).toBeTruthy();
    expect(user!.bc_access_token_encrypted).toBeTruthy();
    expect(user!.bc_token_expires_at).toBeTruthy();

    // Validate token is encrypted (has iv:data:authTag format)
    const encryptedParts = user!.bc_access_token_encrypted.split(':');
    expect(encryptedParts).toHaveLength(3);

    // All parts should be base64
    encryptedParts.forEach(part => {
      expect(part).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    // Plaintext should NOT be stored
    expect(user!.bc_access_token_encrypted).not.toContain('test_access_token_12345');
  });

  it('should update existing token when storing again', async () => {
    // ========== ARRANGE: Store initial token ==========
    const initialToken = {
      accessToken: 'initial_token',
      expiresAt: new Date(Date.now() + 3600000),
    };
    await tokenManager.storeBCToken(testUserId, initialToken);

    // Get initial encrypted value
    const initialResult = await executeQuery<{ bc_access_token_encrypted: string }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    const initialEncrypted = initialResult.recordset[0]!.bc_access_token_encrypted;

    // ========== ACT: Store new token ==========
    const newToken = {
      accessToken: 'updated_token',
      expiresAt: new Date(Date.now() + 7200000), // 2 hours
    };
    await tokenManager.storeBCToken(testUserId, newToken);

    // ========== ASSERT: Token was updated ==========
    const updatedResult = await executeQuery<{ bc_access_token_encrypted: string }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    const updatedEncrypted = updatedResult.recordset[0]!.bc_access_token_encrypted;

    // Encrypted value should be different (different plaintext + different IV)
    expect(updatedEncrypted).not.toBe(initialEncrypted);
  });

  it('should clear BC token from database', async () => {
    // ========== ARRANGE: Store a token first ==========
    const tokenData = {
      accessToken: 'token_to_clear',
      expiresAt: new Date(Date.now() + 3600000),
    };
    await tokenManager.storeBCToken(testUserId, tokenData);

    // Verify token was stored
    const beforeClear = await executeQuery<{ bc_access_token_encrypted: string | null }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    expect(beforeClear.recordset[0]!.bc_access_token_encrypted).toBeTruthy();

    // ========== ACT ==========
    await tokenManager.clearBCToken(testUserId);

    // ========== ASSERT: Token fields are NULL ==========
    const afterClear = await executeQuery<{
      bc_access_token_encrypted: string | null;
      bc_token_expires_at: Date | null;
    }>(
      'SELECT bc_access_token_encrypted, bc_token_expires_at FROM users WHERE id = @id',
      { id: testUserId }
    );

    const user = afterClear.recordset[0];
    expect(user!.bc_access_token_encrypted).toBeNull();
    expect(user!.bc_token_expires_at).toBeNull();
  });

  it('should handle encryption with different key lengths correctly', () => {
    // Valid 32-byte key (base64 encoded)
    const validKey = crypto.randomBytes(32).toString('base64');
    expect(() => new BCTokenManager(validKey)).not.toThrow();

    // Invalid: 16-byte key
    const shortKey = crypto.randomBytes(16).toString('base64');
    expect(() => new BCTokenManager(shortKey)).toThrow('ENCRYPTION_KEY must be 32 bytes');

    // Invalid: 64-byte key
    const longKey = crypto.randomBytes(64).toString('base64');
    expect(() => new BCTokenManager(longKey)).toThrow('ENCRYPTION_KEY must be 32 bytes');
  });

  it('should produce different ciphertext for same plaintext (semantic security)', async () => {
    // ========== ARRANGE ==========
    const tokenData = {
      accessToken: 'identical_token_value',
      expiresAt: new Date(Date.now() + 3600000),
    };

    // ========== ACT: Store same token twice ==========
    await tokenManager.storeBCToken(testUserId, tokenData);

    const firstResult = await executeQuery<{ bc_access_token_encrypted: string }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    const firstEncrypted = firstResult.recordset[0]!.bc_access_token_encrypted;

    // Store again (overwrites)
    await tokenManager.storeBCToken(testUserId, tokenData);

    const secondResult = await executeQuery<{ bc_access_token_encrypted: string }>(
      'SELECT bc_access_token_encrypted FROM users WHERE id = @id',
      { id: testUserId }
    );
    const secondEncrypted = secondResult.recordset[0]!.bc_access_token_encrypted;

    // ========== ASSERT: Different ciphertext due to random IV ==========
    expect(firstEncrypted).not.toBe(secondEncrypted);
  });
});
