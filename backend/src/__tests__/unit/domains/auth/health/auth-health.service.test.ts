/**
 * @module auth-health.service.test
 * Unit tests for AuthHealthService.
 * Tests the session health calculation functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAuthHealthService,
  type AuthHealthService,
  type SessionHealthInput,
} from '@/domains/auth/health/auth-health.service';
import { AUTH_SESSION_STATUS, AUTH_TIME_MS } from '@bc-agent/shared';

describe('AuthHealthService', () => {
  let service: AuthHealthService;

  beforeEach(() => {
    service = createAuthHealthService();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateHealth', () => {
    it('should return unauthenticated when session is null', () => {
      const result = service.calculateHealth(null);

      expect(result.status).toBe(AUTH_SESSION_STATUS.UNAUTHENTICATED);
      expect(result.needsRefresh).toBe(false);
      expect(result.userId).toBeUndefined();
      expect(result.timestamp).toBeDefined();
    });

    it('should return unauthenticated when userId is missing', () => {
      const session: SessionHealthInput = {
        accessToken: 'some-token',
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.UNAUTHENTICATED);
      expect(result.needsRefresh).toBe(false);
    });

    it('should return unauthenticated when accessToken is missing', () => {
      const session: SessionHealthInput = {
        userId: 'USER-123',
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.UNAUTHENTICATED);
      expect(result.needsRefresh).toBe(false);
    });

    it('should return authenticated when token is valid and not expiring', () => {
      // Token expires in 30 minutes (beyond all thresholds)
      const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        tokenExpiresAt: futureDate,
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.AUTHENTICATED);
      expect(result.needsRefresh).toBe(false);
      expect(result.userId).toBe('USER-123');
      expect(result.tokenExpiresAt).toBe(futureDate);
      expect(result.tokenExpiresIn).toBeGreaterThan(AUTH_TIME_MS.REFRESH_THRESHOLD);
    });

    it('should return expiring when token expires within warning threshold', () => {
      // Token expires in 3 minutes (within 5 min warning threshold)
      const nearFuture = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        tokenExpiresAt: nearFuture,
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.EXPIRING);
      expect(result.needsRefresh).toBe(true);
      expect(result.tokenExpiresIn).toBeLessThanOrEqual(AUTH_TIME_MS.EXPIRY_WARNING_THRESHOLD);
    });

    it('should return expired when token is past expiration', () => {
      // Token expired 1 second ago
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'expired-token',
        tokenExpiresAt: pastDate,
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.EXPIRED);
      expect(result.needsRefresh).toBe(true);
      expect(result.tokenExpiresIn).toBe(0);
    });

    it('should set needsRefresh true when within refresh threshold but not expiring', () => {
      // Token expires in 8 minutes (within 10 min refresh threshold, beyond 5 min warning)
      const date = new Date(Date.now() + 8 * 60 * 1000).toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        tokenExpiresAt: date,
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.AUTHENTICATED);
      expect(result.needsRefresh).toBe(true);
      expect(result.tokenExpiresIn).toBeGreaterThan(AUTH_TIME_MS.EXPIRY_WARNING_THRESHOLD);
      expect(result.tokenExpiresIn).toBeLessThanOrEqual(AUTH_TIME_MS.REFRESH_THRESHOLD);
    });

    it('should handle session without tokenExpiresAt', () => {
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        // No tokenExpiresAt
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.AUTHENTICATED);
      expect(result.needsRefresh).toBe(false);
      expect(result.tokenExpiresAt).toBeUndefined();
      expect(result.tokenExpiresIn).toBeUndefined();
    });

    it('should include timestamp in response', () => {
      const result = service.calculateHealth(null);

      expect(result.timestamp).toBe('2025-01-15T12:00:00.000Z');
    });

    it('should handle edge case where token expires exactly at threshold', () => {
      // Token expires exactly at warning threshold (5 minutes)
      const exactThreshold = new Date(Date.now() + AUTH_TIME_MS.EXPIRY_WARNING_THRESHOLD).toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        tokenExpiresAt: exactThreshold,
      };

      const result = service.calculateHealth(session);

      // At exactly the threshold, should be expiring
      expect(result.status).toBe(AUTH_SESSION_STATUS.EXPIRING);
      expect(result.needsRefresh).toBe(true);
    });

    it('should handle token that expires exactly now', () => {
      const now = new Date().toISOString();
      const session: SessionHealthInput = {
        userId: 'USER-123',
        accessToken: 'valid-token',
        tokenExpiresAt: now,
      };

      const result = service.calculateHealth(session);

      expect(result.status).toBe(AUTH_SESSION_STATUS.EXPIRED);
      expect(result.needsRefresh).toBe(true);
      expect(result.tokenExpiresIn).toBe(0);
    });
  });
});
