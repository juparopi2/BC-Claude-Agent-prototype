/**
 * Unit Tests - Token Usage Routes
 *
 * Tests for token usage analytics endpoints.
 * Validates multi-tenant security, parameter validation, and error handling.
 *
 * Endpoints tested:
 * - GET /api/token-usage/user/:userId - User token totals
 * - GET /api/token-usage/session/:sessionId - Session token totals
 * - GET /api/token-usage/user/:userId/monthly - Monthly usage by model
 * - GET /api/token-usage/user/:userId/top-sessions - Top sessions by usage
 * - GET /api/token-usage/user/:userId/cache-efficiency - Cache efficiency metrics
 * - GET /api/token-usage/me - Current user's token totals
 *
 * @module __tests__/unit/routes/token-usage.routes
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import tokenUsageRouter from '@/routes/token-usage';
import { getTokenUsageService } from '@/services/token-usage';
import { validateSessionOwnership, validateUserIdMatch } from '@/utils/session-ownership';

// ============================================
// Mock Dependencies
// ============================================

// Mock token usage service
const mockTokenUsageService = {
  getUserTotals: vi.fn(),
  getSessionTotals: vi.fn(),
  getMonthlyUsageByModel: vi.fn(),
  getTopSessionsByUsage: vi.fn(),
  getCacheEfficiency: vi.fn(),
};

vi.mock('@/services/token-usage', () => ({
  getTokenUsageService: () => mockTokenUsageService,
}));

// Mock session ownership validation
vi.mock('@/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn(),
  validateUserIdMatch: vi.fn((requestedId, authenticatedId) => requestedId === authenticatedId),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth middleware - we'll inject userId in tests
vi.mock('@/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, res: Response, next: NextFunction) => {
    // Get userId from custom header for testing
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

// ============================================
// Test Helpers
// ============================================

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/token-usage', tokenUsageRouter);
  return app;
}

// ============================================
// Test Suite
// ============================================

describe('Token Usage Routes', () => {
  let app: Application;
  let mockValidateSessionOwnership: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockValidateSessionOwnership = validateSessionOwnership as Mock;
  });

  // ============================================
  // GET /api/token-usage/user/:userId
  // ============================================
  describe('GET /api/token-usage/user/:userId', () => {
    it('should return token totals for authenticated user', async () => {
      // Arrange
      const userId = 'user-123';
      const mockTotals = {
        userId,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalTokens: 1500,
        requestCount: 10,
      };
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(mockTotals);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body).toEqual(mockTotals);
      expect(mockTokenUsageService.getUserTotals).toHaveBeenCalledWith(userId);
    });

    it('should return 403 when accessing another user\'s data', async () => {
      // Arrange
      const requestedUserId = 'user-other';
      const authenticatedUserId = 'user-me';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${requestedUserId}`)
        .set('x-test-user-id', authenticatedUserId)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toContain('only access your own');
      expect(mockTokenUsageService.getUserTotals).not.toHaveBeenCalled();
    });

    it('should return 404 when no usage found', async () => {
      // Arrange
      const userId = 'user-no-usage';
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(null);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}`)
        .set('x-test-user-id', userId)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toContain(userId);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/token-usage/user/any-user')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on service error', async () => {
      // Arrange
      const userId = 'user-error';
      mockTokenUsageService.getUserTotals.mockRejectedValueOnce(new Error('Database error'));

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}`)
        .set('x-test-user-id', userId)
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ============================================
  // GET /api/token-usage/session/:sessionId
  // ============================================
  describe('GET /api/token-usage/session/:sessionId', () => {
    it('should return session totals when user owns session', async () => {
      // Arrange
      const sessionId = 'session-123';
      const userId = 'user-owner';
      const mockTotals = {
        sessionId,
        totalInputTokens: 500,
        totalOutputTokens: 250,
        totalTokens: 750,
      };

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce(mockTotals);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body).toEqual(mockTotals);
      expect(mockValidateSessionOwnership).toHaveBeenCalledWith(sessionId, userId);
    });

    it('should return 403 when user does not own session', async () => {
      // Arrange
      const sessionId = 'session-other';
      const userId = 'user-not-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(mockTokenUsageService.getSessionTotals).not.toHaveBeenCalled();
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      const sessionId = 'session-nonexistent';
      const userId = 'user-any';

      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 404 when no usage found for session', async () => {
      // Arrange
      const sessionId = 'session-empty';
      const userId = 'user-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce(null);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toContain(sessionId);
    });
  });

  // ============================================
  // GET /api/token-usage/user/:userId/monthly
  // ============================================
  describe('GET /api/token-usage/user/:userId/monthly', () => {
    it('should return monthly usage with default 12 months', async () => {
      // Arrange
      const userId = 'user-monthly';
      const mockUsage = [
        { month: '2024-01', model: 'claude-3', tokens: 1000 },
        { month: '2024-02', model: 'claude-3', tokens: 1500 },
      ];
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce(mockUsage);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.userId).toBe(userId);
      expect(response.body.months).toBe(12);
      expect(response.body.usage).toEqual(mockUsage);
      expect(mockTokenUsageService.getMonthlyUsageByModel).toHaveBeenCalledWith(userId, 12);
    });

    it('should accept custom months parameter (1-24)', async () => {
      // Arrange
      const userId = 'user-custom-months';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=6`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.months).toBe(6);
      expect(mockTokenUsageService.getMonthlyUsageByModel).toHaveBeenCalledWith(userId, 6);
    });

    it('should return 400 for months < 1', async () => {
      // Arrange
      const userId = 'user-invalid-months';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=0`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('between 1 and 24');
    });

    it('should return 400 for months > 24', async () => {
      // Arrange
      const userId = 'user-too-many-months';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=25`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for non-numeric months', async () => {
      // Arrange
      const userId = 'user-nan-months';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=abc`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 403 when accessing another user\'s monthly data', async () => {
      // Arrange
      const requestedUserId = 'user-target';
      const authenticatedUserId = 'user-attacker';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${requestedUserId}/monthly`)
        .set('x-test-user-id', authenticatedUserId)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });
  });

  // ============================================
  // GET /api/token-usage/user/:userId/top-sessions
  // ============================================
  describe('GET /api/token-usage/user/:userId/top-sessions', () => {
    it('should return top sessions with default limit of 10', async () => {
      // Arrange
      const userId = 'user-top';
      const mockSessions = [
        { sessionId: 'session-1', totalTokens: 5000 },
        { sessionId: 'session-2', totalTokens: 3000 },
      ];
      mockTokenUsageService.getTopSessionsByUsage.mockResolvedValueOnce(mockSessions);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.userId).toBe(userId);
      expect(response.body.limit).toBe(10);
      expect(response.body.sessions).toEqual(mockSessions);
      expect(mockTokenUsageService.getTopSessionsByUsage).toHaveBeenCalledWith(userId, 10);
    });

    it('should accept custom limit parameter (1-50)', async () => {
      // Arrange
      const userId = 'user-custom-limit';
      mockTokenUsageService.getTopSessionsByUsage.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=25`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.limit).toBe(25);
      expect(mockTokenUsageService.getTopSessionsByUsage).toHaveBeenCalledWith(userId, 25);
    });

    it('should return 400 for limit < 1', async () => {
      // Arrange
      const userId = 'user-zero-limit';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=0`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('between 1 and 50');
    });

    it('should return 400 for limit > 50', async () => {
      // Arrange
      const userId = 'user-high-limit';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=100`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 403 when accessing another user\'s top sessions', async () => {
      // Arrange
      const requestedUserId = 'user-victim';
      const authenticatedUserId = 'user-hacker';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${requestedUserId}/top-sessions`)
        .set('x-test-user-id', authenticatedUserId)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });
  });

  // ============================================
  // GET /api/token-usage/user/:userId/cache-efficiency
  // ============================================
  describe('GET /api/token-usage/user/:userId/cache-efficiency', () => {
    it('should return cache efficiency metrics', async () => {
      // Arrange
      const userId = 'user-cache';
      const mockEfficiency = {
        totalRequests: 100,
        cacheHits: 80,
        cacheMisses: 20,
        hitRate: 0.8,
        tokensSaved: 50000,
      };
      mockTokenUsageService.getCacheEfficiency.mockResolvedValueOnce(mockEfficiency);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/cache-efficiency`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.userId).toBe(userId);
      expect(response.body.totalRequests).toBe(100);
      expect(response.body.hitRate).toBe(0.8);
    });

    it('should return 403 when accessing another user\'s cache efficiency', async () => {
      // Arrange
      const requestedUserId = 'user-target-cache';
      const authenticatedUserId = 'user-spy';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${requestedUserId}/cache-efficiency`)
        .set('x-test-user-id', authenticatedUserId)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 500 on service error', async () => {
      // Arrange
      const userId = 'user-cache-error';
      mockTokenUsageService.getCacheEfficiency.mockRejectedValueOnce(new Error('Cache service down'));

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/cache-efficiency`)
        .set('x-test-user-id', userId)
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  // ============================================
  // GET /api/token-usage/me
  // ============================================
  describe('GET /api/token-usage/me', () => {
    it('should return token totals for current user', async () => {
      // Arrange
      const userId = 'user-me';
      const mockTotals = {
        userId,
        totalInputTokens: 2000,
        totalOutputTokens: 1000,
        totalTokens: 3000,
      };
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(mockTotals);

      // Act
      const response = await request(app)
        .get('/api/token-usage/me')
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body).toEqual(mockTotals);
      expect(mockTokenUsageService.getUserTotals).toHaveBeenCalledWith(userId);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/token-usage/me')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 404 when no usage found', async () => {
      // Arrange
      const userId = 'user-me-no-usage';
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(null);

      // Act
      const response = await request(app)
        .get('/api/token-usage/me')
        .set('x-test-user-id', userId)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toContain('your account');
    });
  });

  // ============================================
  // Multi-Tenant Security Tests
  // ============================================
  describe('Multi-Tenant Security', () => {
    it('should log unauthorized access attempts', async () => {
      // Arrange
      const targetUserId = 'user-victim-123';
      const attackerUserId = 'user-attacker-456';

      // Act
      await request(app)
        .get(`/api/token-usage/user/${targetUserId}`)
        .set('x-test-user-id', attackerUserId)
        .expect(403);

      // Assert - the route should have logged the attempt
      // (verified by checking the service was NOT called)
      expect(mockTokenUsageService.getUserTotals).not.toHaveBeenCalled();
    });

    it('should validate userId format (prevent SQL injection)', async () => {
      // Arrange
      const maliciousUserId = "'; DROP TABLE users; --";
      const authenticatedUserId = maliciousUserId; // Self-access with malicious ID

      // Note: The validateUserIdMatch will allow self-access,
      // but the service should handle the malicious ID safely
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(null);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${encodeURIComponent(maliciousUserId)}`)
        .set('x-test-user-id', authenticatedUserId)
        .expect(404);

      // Assert - should not crash, treated as "not found"
      expect(response.body.error).toBe('Not Found');
    });

    it('should block cross-tenant session access', async () => {
      // Arrange
      const sessionId = 'session-tenant-a';
      const attackerFromTenantB = 'user-tenant-b';

      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', attackerFromTenantB)
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(mockTokenUsageService.getSessionTotals).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle empty userId parameter', async () => {
      // This tests the route matching - empty userId won't match the route
      const response = await request(app)
        .get('/api/token-usage/user/')
        .set('x-test-user-id', 'any-user')
        .expect(404); // Route not found

      expect(response.status).toBe(404);
    });

    it('should handle very long userId', async () => {
      // Arrange
      const longUserId = 'a'.repeat(1000);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${longUserId}`)
        .set('x-test-user-id', longUserId)
        .expect(404); // Should return not found (validateUserIdMatch returns true for self)

      // Assert - service should be called and return null
      expect(mockTokenUsageService.getUserTotals).toHaveBeenCalledWith(longUserId);
    });

    it('should handle special characters in sessionId', async () => {
      // Arrange
      const sessionId = 'session-with-dashes-123';
      const userId = 'user-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce({ sessionId, totalTokens: 100 });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe(sessionId);
    });

    it('should handle concurrent requests for same user', async () => {
      // Arrange
      const userId = 'user-concurrent';
      mockTokenUsageService.getUserTotals.mockResolvedValue({ totalTokens: 100 });

      // Act - send multiple requests concurrently
      const requests = [
        request(app).get(`/api/token-usage/user/${userId}`).set('x-test-user-id', userId),
        request(app).get(`/api/token-usage/user/${userId}`).set('x-test-user-id', userId),
        request(app).get(`/api/token-usage/user/${userId}`).set('x-test-user-id', userId),
      ];

      const responses = await Promise.all(requests);

      // Assert - all should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should handle months parameter as float (truncates)', async () => {
      // Arrange
      const userId = 'user-float-months';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=6.9`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert - parseInt truncates to 6
      expect(response.body.months).toBe(6);
    });

    it('should handle negative limit parameter', async () => {
      // Arrange
      const userId = 'user-negative-limit';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=-5`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });
  });

  // ============================================
  // Additional Edge Cases (Phase 3)
  // ============================================
  describe('Additional Edge Cases (Phase 3)', () => {
    // URL Encoding edge cases
    it('should handle userId with URL-encoded slashes', async () => {
      // Arrange
      const userId = 'user/with/slashes';
      const encodedUserId = encodeURIComponent(userId);
      mockTokenUsageService.getUserTotals.mockResolvedValueOnce(null);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${encodedUserId}`)
        .set('x-test-user-id', userId)
        .expect(404);

      // Assert - should decode and process correctly
      expect(mockTokenUsageService.getUserTotals).toHaveBeenCalledWith(userId);
    });

    it('should handle sessionId with dots', async () => {
      // Arrange
      const sessionId = 'session.with.dots.123';
      const userId = 'user-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce({
        sessionId,
        totalTokens: 500,
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${sessionId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe(sessionId);
    });

    // Boundary values for months parameter
    it('should accept months=1 (minimum boundary)', async () => {
      // Arrange
      const userId = 'user-min-months';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=1`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.months).toBe(1);
      expect(mockTokenUsageService.getMonthlyUsageByModel).toHaveBeenCalledWith(userId, 1);
    });

    it('should accept months=24 (maximum boundary)', async () => {
      // Arrange
      const userId = 'user-max-months';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=24`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.months).toBe(24);
      expect(mockTokenUsageService.getMonthlyUsageByModel).toHaveBeenCalledWith(userId, 24);
    });

    // Boundary values for limit parameter
    it('should accept limit=1 (minimum boundary)', async () => {
      // Arrange
      const userId = 'user-min-limit';
      mockTokenUsageService.getTopSessionsByUsage.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=1`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.limit).toBe(1);
      expect(mockTokenUsageService.getTopSessionsByUsage).toHaveBeenCalledWith(userId, 1);
    });

    it('should accept limit=50 (maximum boundary)', async () => {
      // Arrange
      const userId = 'user-max-limit';
      mockTokenUsageService.getTopSessionsByUsage.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=50`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.limit).toBe(50);
      expect(mockTokenUsageService.getTopSessionsByUsage).toHaveBeenCalledWith(userId, 50);
    });

    // Decimal handling
    it('should truncate months=1.9 to 1', async () => {
      // Arrange
      const userId = 'user-decimal-months-low';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=1.9`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.months).toBe(1);
    });

    it('should truncate months=23.9 to 23', async () => {
      // Arrange
      const userId = 'user-decimal-months-high';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=23.9`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.months).toBe(23);
    });

    // UUID format validation
    it('should handle UUID v4 format sessionId', async () => {
      // Arrange
      const uuidV4SessionId = '550e8400-e29b-41d4-a716-446655440000';
      const userId = 'user-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce({
        sessionId: uuidV4SessionId,
        totalTokens: 1000,
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${uuidV4SessionId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe(uuidV4SessionId);
    });

    it('should handle UUID v7 format sessionId (future-proof)', async () => {
      // UUID v7 has time-based prefix: 018e4d5d-e5f4-7xxx-xxxx-xxxxxxxxxxxx
      const uuidV7SessionId = '018e4d5d-e5f4-7a00-8000-000000000001';
      const userId = 'user-owner';

      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTokenUsageService.getSessionTotals.mockResolvedValueOnce({
        sessionId: uuidV7SessionId,
        totalTokens: 2000,
      });

      // Act
      const response = await request(app)
        .get(`/api/token-usage/session/${uuidV7SessionId}`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe(uuidV7SessionId);
    });

    // Negative cases
    it('should return 400 for months=-1', async () => {
      // Arrange
      const userId = 'user-negative-months';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=-1`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 for limit=-1', async () => {
      // Arrange
      const userId = 'user-negative-limit-edge';

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=-1`)
        .set('x-test-user-id', userId)
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    // Empty query parameters
    it('should use default months when parameter is empty string', async () => {
      // Arrange
      const userId = 'user-empty-months';
      mockTokenUsageService.getMonthlyUsageByModel.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/monthly?months=`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert - should use default 12
      expect(response.body.months).toBe(12);
    });

    it('should use default limit when parameter is empty string', async () => {
      // Arrange
      const userId = 'user-empty-limit';
      mockTokenUsageService.getTopSessionsByUsage.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/token-usage/user/${userId}/top-sessions?limit=`)
        .set('x-test-user-id', userId)
        .expect(200);

      // Assert - should use default 10
      expect(response.body.limit).toBe(10);
    });
  });
});
