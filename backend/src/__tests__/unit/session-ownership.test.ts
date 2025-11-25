/**
 * Session Ownership Validation Tests
 *
 * Tests for multi-tenant security utilities that validate
 * users can only access sessions they own.
 *
 * Security Coverage:
 * 1. validateSessionOwnership - Core ownership validation
 * 2. validateUserIdMatch - User ID matching for direct access
 * 3. requireSessionOwnership - Throw-on-failure variant
 * 4. requireSessionOwnershipMiddleware - Express middleware
 *
 * @module __tests__/unit/session-ownership.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database module - use vi.fn() inside factory
vi.mock('@config/database', () => ({
  executeQuery: vi.fn(),
}));

// Mock logger to avoid output during tests
vi.mock('@/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  validateSessionOwnership,
  validateUserIdMatch,
  requireSessionOwnership,
  requireSessionOwnershipMiddleware,
} from '@/utils/session-ownership';
import { executeQuery } from '@config/database';

// Get the mocked version
const mockExecuteQuery = vi.mocked(executeQuery);

describe('Session Ownership Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateSessionOwnership', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ownerUserId = 'user-owner-123';
    const otherUserId = 'user-other-456';

    it('should return isOwner=true when user owns the session', async () => {
      // Arrange: Session exists and user is owner
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act
      const result = await validateSessionOwnership(validSessionId, ownerUserId);

      // Assert
      expect(result.isOwner).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT user_id FROM sessions'),
        { sessionId: validSessionId }
      );
    });

    it('should return isOwner=false with NOT_OWNER error when user does not own session', async () => {
      // Arrange: Session exists but different owner
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act
      const result = await validateSessionOwnership(validSessionId, otherUserId);

      // Assert
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('NOT_OWNER');
      expect(result.actualOwner).toBe(ownerUserId); // For debugging
    });

    it('should return isOwner=false with SESSION_NOT_FOUND error when session does not exist', async () => {
      // Arrange: Session not found
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
        output: {},
        recordsets: [],
      });

      // Act
      const result = await validateSessionOwnership('non-existent-session', ownerUserId);

      // Assert
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });

    it('should return isOwner=false with INVALID_INPUT error when sessionId is empty', async () => {
      // Act
      const result = await validateSessionOwnership('', ownerUserId);

      // Assert
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should return isOwner=false with INVALID_INPUT error when userId is empty', async () => {
      // Act
      const result = await validateSessionOwnership(validSessionId, '');

      // Assert
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('should return isOwner=false with DATABASE_ERROR error when query fails', async () => {
      // Arrange: Database error
      mockExecuteQuery.mockRejectedValueOnce(new Error('Connection failed'));

      // Act
      const result = await validateSessionOwnership(validSessionId, ownerUserId);

      // Assert
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('DATABASE_ERROR');
    });
  });

  describe('validateUserIdMatch', () => {
    const userId = 'user-123';

    it('should return true when IDs match', () => {
      expect(validateUserIdMatch(userId, userId)).toBe(true);
    });

    it('should return false when IDs do not match', () => {
      expect(validateUserIdMatch(userId, 'different-user')).toBe(false);
    });

    it('should return false when requested userId is empty', () => {
      expect(validateUserIdMatch('', userId)).toBe(false);
    });

    it('should return false when authenticated userId is undefined', () => {
      expect(validateUserIdMatch(userId, undefined)).toBe(false);
    });

    it('should return false when both are empty', () => {
      expect(validateUserIdMatch('', '')).toBe(false);
    });
  });

  describe('requireSessionOwnership', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ownerUserId = 'user-owner-123';
    const otherUserId = 'user-other-456';

    it('should not throw when user owns the session', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act & Assert
      await expect(requireSessionOwnership(validSessionId, ownerUserId)).resolves.not.toThrow();
    });

    it('should throw "Unauthorized" error when user does not own session', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act & Assert
      await expect(requireSessionOwnership(validSessionId, otherUserId))
        .rejects.toThrow('Unauthorized: Session does not belong to user');
    });

    it('should throw "not found" error when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
        output: {},
        recordsets: [],
      });

      // Act & Assert
      await expect(requireSessionOwnership('non-existent', ownerUserId))
        .rejects.toThrow('Session non-existent not found');
    });

    it('should throw error for invalid input', async () => {
      // Act & Assert
      await expect(requireSessionOwnership('', ownerUserId))
        .rejects.toThrow('Invalid session ID or user ID');
    });
  });

  describe('requireSessionOwnershipMiddleware', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ownerUserId = 'user-owner-123';
    const otherUserId = 'user-other-456';

    it('should call next() when user owns the session', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      const middleware = requireSessionOwnershipMiddleware('sessionId');
      const req = { params: { sessionId: validSessionId }, userId: ownerUserId };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user does not own the session', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      const middleware = requireSessionOwnershipMiddleware('sessionId');
      const req = { params: { sessionId: validSessionId }, userId: otherUserId };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
        output: {},
        recordsets: [],
      });

      const middleware = requireSessionOwnershipMiddleware('sessionId');
      const req = { params: { sessionId: 'non-existent' }, userId: ownerUserId };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Session not found',
      });
    });

    it('should return 401 when user is not authenticated', async () => {
      // Arrange
      const middleware = requireSessionOwnershipMiddleware('sessionId');
      const req = { params: { sessionId: validSessionId }, userId: undefined };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'User not authenticated',
      });
    });

    it('should return 400 when sessionId parameter is missing', async () => {
      // Arrange
      const middleware = requireSessionOwnershipMiddleware('sessionId');
      const req = { params: {}, userId: ownerUserId };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Missing sessionId parameter',
      });
    });

    it('should use custom parameter name when specified', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: ownerUserId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      const middleware = requireSessionOwnershipMiddleware('customSessionId');
      const req = { params: { customSessionId: validSessionId }, userId: ownerUserId };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      // Act
      await middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalled();
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        { sessionId: validSessionId }
      );
    });
  });

  describe('Multi-Tenant Security Scenarios', () => {
    it('should prevent User A from accessing User B session via ownership check', async () => {
      // Arrange: User B owns the session
      const userAId = 'user-a-attacker';
      const userBId = 'user-b-victim';
      const userBSessionId = 'session-belongs-to-user-b';

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: userBId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act: User A tries to access User B's session
      const result = await validateSessionOwnership(userBSessionId, userAId);

      // Assert: Access denied
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('NOT_OWNER');
    });

    it('should prevent impersonation via direct user ID validation', () => {
      // Arrange
      const authenticatedUserId = 'real-user-123';
      const impersonatedUserId = 'victim-user-456';

      // Act: Attacker tries to impersonate victim
      const isValid = validateUserIdMatch(impersonatedUserId, authenticatedUserId);

      // Assert: Impersonation detected
      expect(isValid).toBe(false);
    });

    it('should allow legitimate access when IDs match', async () => {
      // Arrange
      const userId = 'legitimate-user';
      const sessionId = 'legitimate-session';

      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ user_id: userId }],
        rowsAffected: [1],
        output: {},
        recordsets: [],
      });

      // Act
      const ownershipResult = await validateSessionOwnership(sessionId, userId);
      const idMatchResult = validateUserIdMatch(userId, userId);

      // Assert
      expect(ownershipResult.isOwner).toBe(true);
      expect(idMatchResult).toBe(true);
    });
  });
});
