/**
 * BCTokenManager Unit Tests
 *
 * Tests for Business Central token encryption, storage, and management.
 * Covers AES-256-GCM encryption/decryption, token storage, and clearing.
 *
 * Note: Token refresh is handled by MSAL (MicrosoftOAuthService.acquireBCTokenSilent).
 * This manager only handles encrypted storage of access tokens.
 *
 * Created: 2025-11-19 (Phase 3, Task 3.2)
 * Updated: 2026-02-02 - Removed tests for dead code (getBCToken, refreshBCToken)
 * Coverage Target: 80%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCTokenManager } from '@/services/auth/BCTokenManager';
import type { TokenAcquisitionResult } from '@/types/microsoft.types';

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

describe('BCTokenManager', () => {
  let tokenManager: BCTokenManager;
  const testEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 bytes base64

  beforeEach(() => {
    vi.clearAllMocks();

    // Create token manager instance
    tokenManager = new BCTokenManager(testEncryptionKey);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. INITIALIZATION & VALIDATION (3 tests)
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize with valid 32-byte encryption key', () => {
      expect(() => new BCTokenManager(testEncryptionKey)).not.toThrow();
    });

    it('should throw error if encryption key is not 32 bytes', () => {
      const shortKey = 'c2hvcnRrZXk='; // Short key (base64)

      expect(() => new BCTokenManager(shortKey)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });

    it('should throw error if encryption key is missing', () => {
      expect(() => new BCTokenManager('')).toThrow();
    });
  });

  // ==========================================================================
  // 2. TOKEN ENCRYPTION (6 tests)
  // ==========================================================================

  describe('Token Encryption', () => {
    it('should encrypt token using AES-256-GCM', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-access-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-123', tokenData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-123',
          accessToken: expect.any(String),
          expiresAt: tokenData.expiresAt,
        })
      );

      // Verify encrypted token has correct format (iv:encrypted:authTag)
      const callArgs = mockExecuteQuery.mock.calls[0][1] as Record<string, string>;
      expect(callArgs.accessToken).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('should generate unique IV for each encryption', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'same-token',
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

    it('should throw error on encryption failure', async () => {
      // Force encryption error by mocking crypto to throw
      const cryptoSpy = vi.spyOn(require('crypto'), 'createCipheriv').mockImplementation(() => {
        throw new Error('Crypto error');
      });

      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-token',
        expiresAt: new Date(),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await expect(tokenManager.storeBCToken('user-123', tokenData)).rejects.toThrow('Failed to store Business Central token');

      cryptoSpy.mockRestore();
    });

    it('should validate encryption key length (32 bytes)', () => {
      const key31Bytes = Buffer.from('a'.repeat(31)).toString('base64');
      const key33Bytes = Buffer.from('a'.repeat(33)).toString('base64');

      expect(() => new BCTokenManager(key31Bytes)).toThrow('ENCRYPTION_KEY must be 32 bytes');
      expect(() => new BCTokenManager(key33Bytes)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });
  });

  // ==========================================================================
  // 3. TOKEN STORAGE (4 tests)
  // ==========================================================================

  describe('Token Storage', () => {
    it('should store encrypted token in users table', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'test-access-token',
        expiresAt: new Date('2025-12-31T23:59:59Z'),
      };

      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.storeBCToken('user-456', tokenData);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.objectContaining({
          userId: 'user-456',
          accessToken: expect.any(String),
          expiresAt: tokenData.expiresAt,
        })
      );
    });

    it('should update existing token for user', async () => {
      const tokenData: TokenAcquisitionResult = {
        accessToken: 'new-token',
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

      await expect(tokenManager.storeBCToken('user-123', tokenData)).rejects.toThrow('Failed to store Business Central token');
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
  // 4. CLEAR BC TOKEN (2 tests)
  // ==========================================================================

  describe('Clear BC Token', () => {
    it('should clear BC token fields to NULL', async () => {
      mockExecuteQuery.mockResolvedValue({ recordset: [], rowsAffected: [1] });

      await tokenManager.clearBCToken('user-123');

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('bc_access_token_encrypted = NULL'),
        { userId: 'user-123' }
      );

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('bc_token_expires_at = NULL'),
        { userId: 'user-123' }
      );
    });

    it('should handle database errors on clear', async () => {
      mockExecuteQuery.mockRejectedValue(new Error('Database error'));

      await expect(tokenManager.clearBCToken('user-123')).rejects.toThrow('Failed to clear Business Central token');
    });
  });
});
