/**
 * BCTokenManager Unit Tests
 *
 * Tests for Business Central token encryption, storage, and management.
 * Covers AES-256-GCM encryption/decryption, token storage, auto-refresh logic,
 * and database persistence.
 *
 * Created: 2025-11-19 (Phase 3, Task 3.2)
 * Coverage Target: 80%+
 * Test Count: 25
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCTokenManager } from '@/services/auth/BCTokenManager';
import { MicrosoftOAuthService } from '@/domains/auth/oauth/MicrosoftOAuthService';
import type { TokenAcquisitionResult, BCTokenData } from '@/types/microsoft.types';

// ============================================================================
// MOCKS SETUP
// ============================================================================

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
}));

// Mock crypto for predictable testing (but also test real crypto)
const mockCrypto = {
  randomBytes: vi.fn(),
  createCipheriv: vi.fn(),
  createDecipheriv: vi.fn(),
};

// ============================================================================
// TEST SUITE
// ============================================================================

describe('BCTokenManager', () => {
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

  // ==========================================================================
  // 1. INITIALIZATION & VALIDATION (3 tests)
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize with valid 32-byte encryption key', () => {
      expect(() => new BCTokenManager(testEncryptionKey, mockOAuthService)).not.toThrow();
    });

    it('should throw error if encryption key is not 32 bytes', () => {
      const shortKey = 'c2hvcnRrZXk='; // Short key (base64)

      expect(() => new BCTokenManager(shortKey, mockOAuthService)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });

    it('should throw error if encryption key is missing', () => {
      expect(() => new BCTokenManager('', mockOAuthService)).toThrow();
    });
  });

  // ==========================================================================
  // 2. TOKEN ENCRYPTION (8 tests)
  // ==========================================================================

  describe('Token Encryption', () => {
    it('should encrypt token using AES-256-GCM', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-123',
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresAt: tokenData.expiresAt,
        })
      );

      // Verify encrypted tokens have correct format (iv:encrypted:authTag)
      const callArgs = mockExecuteQuery.mock.calls[0][1] as Record<string, string>;
      expect(callArgs.accessToken).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
      expect(callArgs.refreshToken).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('should generate unique IV for each encryption', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'same-token',
        refreshToken: 'same-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      // Encrypt twice with same input
      await tokenManager.storeBCToken('user-1', tokenData);
      await tokenManager.storeBCToken('user-2', tokenData);

      const call1Args = mockExecuteQuery.mock.calls[0][1] as Record<string, string>;
      const call2Args = mockExecuteQuery.mock.calls[1][1] as Record<string, string>;

      // Different ciphertext due to different IVs
      expect(call1Args.accessToken).not.toBe(call2Args.accessToken);
    });

    it('should store encrypted token in correct format (iv:encrypted:authTag)', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      const callArgs = mockExecuteQuery.mock.calls[0][1] as Record<string, string>;
      const parts = callArgs.accessToken.split(':');

      // Should have exactly 3 parts
      expect(parts).toHaveLength(3);

      // All parts should be base64
      parts.forEach(part => {
        expect(part).toMatch(/^[A-Za-z0-9+/=]+$/);
      });
    });

    it('should handle large tokens (>1KB)', async () => {
      const largeToken = 'x'.repeat(2000); // 2KB token
      const tokenData: TokenAcquisitionResult = {
        accessToken: largeToken,
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await expect(tokenManager.storeBCToken('user-123', tokenData)).resolves.not.toThrow();
    });

    it('should handle NULL refresh token', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        refreshToken: undefined, // No refresh token
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      const callArgs = mockExecuteQuery.mock.calls[0][1] as Record<string, string | null>;
      expect(callArgs.refreshToken).toBeNull();
    });

    it('should throw error on encryption failure', async () => {
      // Force encryption error by using invalid key length internally (simulate corruption)
      const invalidManager = new BCTokenManager(testEncryptionKey, mockOAuthService);

      // Mock crypto to throw error
      const cryptoSpy = vi.spyOn(require('crypto'), 'createCipheriv').mockImplementation(() => {
        throw new Error('Crypto error');
      });

      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      // The error is wrapped by storeBCToken
      await expect(invalidManager.storeBCToken('user-123', tokenData)).rejects.toThrow('Failed to store Business Central tokens');

      cryptoSpy.mockRestore();
    });

    it('should validate encryption key length (32 bytes)', () => {
      const key31Bytes = Buffer.from('a'.repeat(31)).toString('base64');
      const key33Bytes = Buffer.from('a'.repeat(33)).toString('base64');

      expect(() => new BCTokenManager(key31Bytes, mockOAuthService)).toThrow('ENCRYPTION_KEY must be 32 bytes');
      expect(() => new BCTokenManager(key33Bytes, mockOAuthService)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });

    it('should produce different ciphertext for same plaintext (due to IV)', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'identical-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      // Store same token twice
      await tokenManager.storeBCToken('user-1', tokenData);
      await tokenManager.storeBCToken('user-2', tokenData);

      const call1 = mockExecuteQuery.mock.calls[0][1] as Record<string, string>;
      const call2 = mockExecuteQuery.mock.calls[1][1] as Record<string, string>;

      // Encrypted values should be different
      expect(call1.accessToken).not.toBe(call2.accessToken);
    });
  });

  // ==========================================================================
  // 3. TOKEN DECRYPTION (6 tests)
  // ==========================================================================

  describe('Token Decryption', () => {
    it('should decrypt token correctly (encrypt-decrypt round trip)', async () => {
      const originalToken = 'my-secret-token-12345';
      const tokenData: TokenAcquisitionResult = {
        accessToken: originalToken,
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      // Store (encrypt)
      await tokenManager.storeBCToken('user-123', tokenData);

      const encryptedToken = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      // Simulate retrieval from database
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encryptedToken,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: new Date(Date.now() + 7200000), // 2 hours from now
          },
        ],
      });

      // Get (decrypt)
      const result = await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(result.accessToken).toBe(originalToken);
    });

    it('should parse 3-part format correctly (iv:encrypted:authTag)', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      // Should have 3 parts
      expect(encrypted.split(':')).toHaveLength(3);

      // Decryption should work
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encrypted,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: new Date(Date.now() + 7200000),
          },
        ],
      });

      await expect(tokenManager.getBCToken('user-123', 'refresh-token')).resolves.toBeTruthy();
    });

    it('should throw error on invalid ciphertext format (wrong number of parts)', async () => {
      // Invalid format: only 2 parts instead of 3
      const invalidCiphertext = 'part1:part2';

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: invalidCiphertext,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: new Date(Date.now() + 7200000),
          },
        ],
      });

      await expect(tokenManager.getBCToken('user-123', 'refresh-token')).rejects.toThrow('Failed to retrieve Business Central token');
    });

    it('should throw error on corrupted ciphertext', async () => {
      // Valid format but corrupted data
      const corruptedCiphertext = 'AAAA:BBBB:CCCC'; // Invalid base64/data

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: corruptedCiphertext,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: new Date(Date.now() + 7200000),
          },
        ],
      });

      await expect(tokenManager.getBCToken('user-123', 'refresh-token')).rejects.toThrow('Failed to retrieve Business Central token');
    });

    it('should throw error on invalid auth tag', async () => {
      // Encrypt token first
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      // Corrupt the auth tag
      const [iv, data, authTag] = encrypted.split(':');
      const corruptedAuthTag = authTag.split('').reverse().join(''); // Reverse authTag
      const corruptedCiphertext = `${iv}:${data}:${corruptedAuthTag}`;

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: corruptedCiphertext,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: new Date(Date.now() + 7200000),
          },
        ],
      });

      await expect(tokenManager.getBCToken('user-123', 'refresh-token')).rejects.toThrow('Failed to retrieve Business Central token');
    });

    it('should handle empty refresh token (NULL in DB)', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encrypted,
            bc_refresh_token_encrypted: null, // NULL refresh token
            bc_token_expires_at: new Date(Date.now() + 7200000),
          },
        ],
      });

      const result = await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(result.refreshToken).toBe('');
    });
  });

  // ==========================================================================
  // 4. TOKEN STORAGE (4 tests)
  // ==========================================================================

  describe('Token Storage', () => {
    it('should store encrypted tokens in users table', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: new Date('2025-12-31T23:59:59Z'),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-456', tokenData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-456',
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresAt: tokenData.expiresAt,
        })
      );
    });

    it('should update existing tokens for user', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.any(Object)
      );
    });

    it('should handle database write errors', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(),
      };

      mockExecuteQuery.mockRejectedValue(new Error('Database connection failed'));

      await expect(tokenManager.storeBCToken('user-123', tokenData)).rejects.toThrow('Failed to store Business Central tokens');
    });

    it('should store token expiration time', async () => {
      const expiresAt = new Date('2025-12-25T10:00:00Z');
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt,
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      const callArgs = mockExecuteQuery.mock.calls[0][1] as Record<string, Date>;
      expect(callArgs.expiresAt).toEqual(expiresAt);
    });
  });

  // ==========================================================================
  // 5. AUTO-REFRESH LOGIC (5 tests)
  // ==========================================================================

  describe('Auto-Refresh Logic', () => {
    it('should auto-refresh when no token stored', async () => {
      // No token in database
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: null,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: null,
          },
        ],
      });

      // Mock OAuth service to return new token
      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-bc-token',
        refreshToken: 'new-bc-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ bc_access_token_encrypted: null }] });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] }); // For storeBCToken

      await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(mockOAuthService.acquireBCToken).toHaveBeenCalledWith('user-refresh-token');
    });

    it('should auto-refresh when token expires within 5 minutes', async () => {
      const expiresIn4Minutes = new Date(Date.now() + 4 * 60 * 1000);

      // Token expiring soon
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            bc_access_token_encrypted: 'encrypted-token',
            bc_refresh_token_encrypted: 'encrypted-refresh',
            bc_token_expires_at: expiresIn4Minutes,
          },
        ],
      });

      // Mock OAuth service
      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-bc-token',
        refreshToken: 'new-bc-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] }); // For storeBCToken

      await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(mockOAuthService.acquireBCToken).toHaveBeenCalled();
    });

    it('should NOT refresh when token has >5 minutes remaining', async () => {
      const expiresIn10Minutes = new Date(Date.now() + 10 * 60 * 1000);

      // Encrypt a token first to have valid encrypted data
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh',
        expiresAt: expiresIn10Minutes,
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });
      await tokenManager.storeBCToken('user-123', tokenData);

      const encrypted = (mockExecuteQuery.mock.calls[0][1] as Record<string, string>).accessToken;

      // Token still valid
      mockExecuteQuery.mockResolvedValue({
        recordset: [
          {
            bc_access_token_encrypted: encrypted,
            bc_refresh_token_encrypted: null,
            bc_token_expires_at: expiresIn10Minutes,
          },
        ],
      });

      await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(mockOAuthService.acquireBCToken).not.toHaveBeenCalled();
    });

    it('should auto-refresh when token is already expired', async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          {
            bc_access_token_encrypted: 'encrypted-token',
            bc_refresh_token_encrypted: 'encrypted-refresh',
            bc_token_expires_at: expiredDate,
          },
        ],
      });

      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-bc-token',
        refreshToken: 'new-bc-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });

      await tokenManager.getBCToken('user-123', 'user-refresh-token');

      expect(mockOAuthService.acquireBCToken).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [] }); // Empty result

      await expect(tokenManager.getBCToken('non-existent-user', 'refresh-token')).rejects.toThrow('Failed to retrieve Business Central token');
    });
  });

  // ==========================================================================
  // 6. REFRESH BC TOKEN (2 tests)
  // ==========================================================================

  describe('Refresh BC Token', () => {
    it('should refresh BC token using OAuth service', async () => {
      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue({
        accessToken: 'new-bc-access-token',
        refreshToken: 'new-bc-refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      const result = await tokenManager.refreshBCToken('user-789', 'user-refresh-token');

      expect(mockOAuthService.acquireBCToken).toHaveBeenCalledWith('user-refresh-token');
      expect(result.accessToken).toBe('new-bc-access-token');
      expect(result.refreshToken).toBe('new-bc-refresh-token');
    });

    it('should store refreshed token in database', async () => {
      const newToken: TokenAcquisitionResult = {
        accessToken: 'refreshed-token',
        refreshToken: 'refreshed-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      };

      vi.mocked(mockOAuthService.acquireBCToken).mockResolvedValue(newToken);
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.refreshBCToken('user-123', 'user-refresh-token');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });
  });

  // ==========================================================================
  // 7. CLEAR BC TOKEN (2 tests)
  // ==========================================================================

  describe('Clear BC Token', () => {
    it('should clear all BC token fields to NULL', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.clearBCToken('user-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('bc_access_token_encrypted = NULL'),
        { userId: 'user-123' }
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('bc_refresh_token_encrypted = NULL'),
        { userId: 'user-123' }
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('bc_token_expires_at = NULL'),
        { userId: 'user-123' }
      );
    });

    it('should handle database errors on clear', async () => {
      mockExecuteQuery.mockRejectedValue(new Error('Database error'));

      await expect(tokenManager.clearBCToken('user-123')).rejects.toThrow('Failed to clear Business Central tokens');
    });
  });
});
