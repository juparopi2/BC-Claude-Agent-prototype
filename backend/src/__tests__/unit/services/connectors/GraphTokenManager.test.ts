/**
 * GraphTokenManager Unit Tests (PRD-100)
 *
 * Tests AES-256-GCM token encryption/decryption, storage, and revocation
 * for Microsoft Graph API connections.
 *
 * Covers:
 * - Constructor validation (key length)
 * - getValidToken: happy path, no token, expired token
 * - storeTokens: encrypts and persists
 * - revokeTokens: clears all token fields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    connections: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks
import {
  GraphTokenManager,
  ConnectionTokenExpiredError,
  __resetGraphTokenManager,
} from '@/services/connectors/GraphTokenManager';

// ============================================================================
// TEST HELPERS
// ============================================================================

/** 32-byte key encoded as base64 (matches BCTokenManager pattern) */
const VALID_KEY = Buffer.alloc(32, 'test').toString('base64');
const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('GraphTokenManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGraphTokenManager();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('Constructor', () => {
    it('initializes successfully with a valid 32-byte key', () => {
      expect(() => new GraphTokenManager(VALID_KEY)).not.toThrow();
    });

    it('throws if the key decodes to fewer than 32 bytes', () => {
      const shortKey = Buffer.alloc(16, 'x').toString('base64');

      expect(() => new GraphTokenManager(shortKey)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });

    it('throws if the key decodes to more than 32 bytes', () => {
      const longKey = Buffer.alloc(64, 'x').toString('base64');

      expect(() => new GraphTokenManager(longKey)).toThrow('ENCRYPTION_KEY must be 32 bytes');
    });
  });

  // ==========================================================================
  // getValidToken
  // ==========================================================================

  describe('getValidToken', () => {
    it('returns decrypted token when valid token exists and has not expired', async () => {
      const manager = new GraphTokenManager(VALID_KEY);
      const plaintext = 'my-access-token-value';

      // Store first to get a real encrypted value
      mockUpdate.mockResolvedValue({});
      await manager.storeTokens(CONNECTION_ID, {
        accessToken: plaintext,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      });

      // Capture the encrypted value written to the DB
      const storedData = mockUpdate.mock.calls[0]?.[0] as {
        data: { access_token_encrypted: string; token_expires_at: Date };
      };
      const encryptedToken = storedData.data.access_token_encrypted;
      const expiresAt = storedData.data.token_expires_at;

      // Now set up getValidToken to return that encrypted token
      mockFindUnique.mockResolvedValue({
        access_token_encrypted: encryptedToken,
        token_expires_at: expiresAt,
        status: 'connected',
      });

      const result = await manager.getValidToken(CONNECTION_ID);

      expect(result).toBe(plaintext);
    });

    it('throws ConnectionTokenExpiredError when access_token_encrypted is null', async () => {
      const manager = new GraphTokenManager(VALID_KEY);

      mockFindUnique.mockResolvedValue({
        access_token_encrypted: null,
        token_expires_at: null,
        status: 'disconnected',
      });

      await expect(manager.getValidToken(CONNECTION_ID)).rejects.toThrow(
        ConnectionTokenExpiredError
      );
    });

    it('throws ConnectionTokenExpiredError when token is expired (past expiry minus buffer)', async () => {
      const manager = new GraphTokenManager(VALID_KEY);

      // Expired 10 minutes ago (past the 5-minute buffer)
      const expiredAt = new Date(Date.now() - 10 * 60 * 1000);

      mockFindUnique.mockResolvedValue({
        access_token_encrypted: 'someencryptedvalue:data:authtag',
        token_expires_at: expiredAt,
        status: 'expired',
      });

      await expect(manager.getValidToken(CONNECTION_ID)).rejects.toThrow(
        ConnectionTokenExpiredError
      );
    });

    it('throws Error when connection is not found', async () => {
      const manager = new GraphTokenManager(VALID_KEY);

      mockFindUnique.mockResolvedValue(null);

      await expect(manager.getValidToken(CONNECTION_ID)).rejects.toThrow(
        `Connection not found: ${CONNECTION_ID}`
      );
    });
  });

  // ==========================================================================
  // storeTokens
  // ==========================================================================

  describe('storeTokens', () => {
    it('encrypts and stores access token and expiry', async () => {
      const manager = new GraphTokenManager(VALID_KEY);
      const expiresAt = new Date(Date.now() + 3600 * 1000);

      mockUpdate.mockResolvedValue({});

      await manager.storeTokens(CONNECTION_ID, {
        accessToken: 'my-token',
        expiresAt,
      });

      expect(mockUpdate).toHaveBeenCalledOnce();
      const call = mockUpdate.mock.calls[0]?.[0] as {
        where: { id: string };
        data: {
          access_token_encrypted: string;
          token_expires_at: Date;
          status: string;
        };
      };

      expect(call.where.id).toBe(CONNECTION_ID);
      // Encrypted value should follow iv:data:authTag format (3 colon-separated base64 parts)
      expect(call.data.access_token_encrypted).toMatch(
        /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/
      );
      expect(call.data.token_expires_at).toEqual(expiresAt);
      expect(call.data.status).toBe('connected');
    });

    it('also encrypts and stores refresh token when provided', async () => {
      const manager = new GraphTokenManager(VALID_KEY);

      mockUpdate.mockResolvedValue({});

      await manager.storeTokens(CONNECTION_ID, {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const call = mockUpdate.mock.calls[0]?.[0] as {
        data: { refresh_token_encrypted?: string };
      };

      expect(call.data.refresh_token_encrypted).toBeDefined();
      expect(call.data.refresh_token_encrypted).toMatch(
        /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/
      );
    });
  });

  // ==========================================================================
  // revokeTokens
  // ==========================================================================

  describe('revokeTokens', () => {
    it('clears all token fields and sets status to disconnected', async () => {
      const manager = new GraphTokenManager(VALID_KEY);

      mockUpdate.mockResolvedValue({});

      await manager.revokeTokens(CONNECTION_ID);

      expect(mockUpdate).toHaveBeenCalledOnce();
      const call = mockUpdate.mock.calls[0]?.[0] as {
        where: { id: string };
        data: {
          access_token_encrypted: null;
          refresh_token_encrypted: null;
          token_expires_at: null;
          status: string;
        };
      };

      expect(call.where.id).toBe(CONNECTION_ID);
      expect(call.data.access_token_encrypted).toBeNull();
      expect(call.data.refresh_token_encrypted).toBeNull();
      expect(call.data.token_expires_at).toBeNull();
      expect(call.data.status).toBe('disconnected');
    });
  });
});
