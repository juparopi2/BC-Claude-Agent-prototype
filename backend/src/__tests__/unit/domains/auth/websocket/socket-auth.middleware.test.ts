/**
 * @module socket-auth.middleware.test
 * Unit tests for Socket Auth Middleware.
 * Tests WebSocket authentication with auto-refresh functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Socket } from 'socket.io';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';
import {
  createSocketAuthMiddleware,
  type SocketAuthDependencies,
} from '@/domains/auth/websocket/socket-auth.middleware';

// Mock socket factory
function createMockSocket(session: MicrosoftOAuthSession | null): Socket {
  const mockSession = session ? {
    microsoftOAuth: session,
    save: vi.fn((cb: (err?: Error) => void) => cb()),
  } : null;

  return {
    id: 'socket-123',
    request: {
      session: mockSession,
    },
    emit: vi.fn(),
  } as unknown as Socket;
}

describe('SocketAuthMiddleware', () => {
  let mockDeps: SocketAuthDependencies;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

    mockDeps = {
      oauthService: {
        refreshAccessToken: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Session Validation', () => {
    it('should reject when no session exists', async () => {
      const mockSocket = createMockSocket(null);
      const middleware = createSocketAuthMiddleware(mockDeps);

      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe('Authentication required');
    });

    it('should reject when userId is missing', async () => {
      const mockSocket = createMockSocket({
        email: 'test@example.com',
        accessToken: 'token',
      } as MicrosoftOAuthSession);
      const middleware = createSocketAuthMiddleware(mockDeps);

      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe('Invalid session');
    });
  });

  describe('Valid Token', () => {
    it('should allow connection with valid non-expired token', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: futureDate,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect((mockSocket as unknown as { userId: string }).userId).toBe('USER-123');
      expect((mockSocket as unknown as { userEmail: string }).userEmail).toBe('test@example.com');
    });

    it('should allow connection without tokenExpiresAt (no expiration check)', async () => {
      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('Token Refresh', () => {
    it('should attempt refresh when token is expired', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const newFutureDate = new Date(Date.now() + 60 * 60 * 1000);

      mockDeps.oauthService.refreshAccessToken = vi.fn().mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: newFutureDate,
      });

      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: pastDate,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockDeps.oauthService.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockDeps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Token expired'),
        expect.any(Object)
      );
    });

    it('should reject when refresh fails', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();

      mockDeps.oauthService.refreshAccessToken = vi.fn().mockRejectedValue(
        new Error('Refresh failed')
      );

      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: pastDate,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toContain('refresh failed');
    });

    it('should reject when expired and no refresh token', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();

      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'expired-token',
        // No refreshToken
        tokenExpiresAt: pastDate,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe('Session expired');
    });
  });

  describe('Expiry Warning', () => {
    it('should emit expiring event when token expires within warning threshold', async () => {
      // Token expires in 3 minutes (within 5 min warning threshold)
      const nearFuture = new Date(Date.now() + 3 * 60 * 1000).toISOString();

      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: nearFuture,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith();

      // Advance timers to trigger the setTimeout
      vi.advanceTimersByTime(200);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'auth:expiring',
        expect.objectContaining({
          type: 'auth:expiring',
          expiresAt: nearFuture,
          message: 'Your session will expire soon',
        })
      );
    });

    it('should not emit expiring event when token has plenty of time', async () => {
      // Token expires in 30 minutes (well beyond warning threshold)
      const farFuture = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const mockSocket = createMockSocket({
        userId: 'USER-123',
        email: 'test@example.com',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: farFuture,
      } as MicrosoftOAuthSession);

      const middleware = createSocketAuthMiddleware(mockDeps);
      await middleware(mockSocket, mockNext);

      // Advance timers
      vi.advanceTimersByTime(200);

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });
});
