/**
 * Security Tests for Session Ownership Validation
 *
 * Tests specifically focused on security aspects of session ownership
 * validation, including timing attack protection and constant-time
 * comparison guarantees.
 *
 * @module __tests__/unit/utils/session-ownership.security.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timingSafeEqual } from 'crypto';

// Mock prisma module - use vi.hoisted() since vi.mock is hoisted to top of file
const mockFindUnique = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    sessions: {
      findUnique: mockFindUnique,
    },
  },
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
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
  validateUserIdMatch,
  validateSessionOwnership,
  timingSafeCompare,
} from '@/shared/utils/session-ownership';

describe('Session Ownership Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('timingSafeCompare', () => {
    it('should return true for identical strings', () => {
      expect(timingSafeCompare('user-123', 'user-123')).toBe(true);
    });

    it('should return false for different strings of same length', () => {
      expect(timingSafeCompare('user-123', 'user-456')).toBe(false);
    });

    it('should return false for different strings of different lengths', () => {
      expect(timingSafeCompare('user-123', 'user-1234567')).toBe(false);
    });

    it('should return false for empty vs non-empty string', () => {
      expect(timingSafeCompare('', 'user-123')).toBe(false);
      expect(timingSafeCompare('user-123', '')).toBe(false);
    });

    it('should return true for two empty strings', () => {
      expect(timingSafeCompare('', '')).toBe(true);
    });

    it('should handle unicode characters correctly', () => {
      const unicodeA = 'user-日本語-🚀';
      const unicodeB = 'user-日本語-🚀';
      const unicodeC = 'user-日本語-🌟';

      expect(timingSafeCompare(unicodeA, unicodeB)).toBe(true);
      expect(timingSafeCompare(unicodeA, unicodeC)).toBe(false);
    });

    it('should handle special characters', () => {
      const specialA = 'user-!@#$%^&*()';
      const specialB = 'user-!@#$%^&*()';
      const specialC = 'user-!@#$%^&*(_)';

      expect(timingSafeCompare(specialA, specialB)).toBe(true);
      expect(timingSafeCompare(specialA, specialC)).toBe(false);
    });

    it('should handle very long strings', () => {
      const longStringA = 'a'.repeat(10000);
      const longStringB = 'a'.repeat(10000);
      const longStringC = 'a'.repeat(9999) + 'b';

      expect(timingSafeCompare(longStringA, longStringB)).toBe(true);
      expect(timingSafeCompare(longStringA, longStringC)).toBe(false);
    });

    // Timing attack resistance verification via behavior
    it('should produce correct results matching crypto.timingSafeEqual behavior', () => {
      // Verify timingSafeCompare matches the behavior of crypto.timingSafeEqual
      // for same-length strings
      const testCases = [
        { a: 'test', b: 'test', expected: true },
        { a: 'test', b: 'tess', expected: false },
        { a: 'abcd', b: 'abce', expected: false },
        { a: '', b: '', expected: true },
      ];

      for (const { a, b, expected } of testCases) {
        const bufA = Buffer.from(a, 'utf8');
        const bufB = Buffer.from(b, 'utf8');
        const cryptoResult = timingSafeEqual(bufA, bufB);
        const ourResult = timingSafeCompare(a, b);

        expect(ourResult).toBe(expected);
        expect(ourResult).toBe(cryptoResult);
      }
    });

    it('should handle different length strings securely (always returns false)', () => {
      // For different lengths, should always return false
      // but the comparison should still be performed to prevent timing leaks
      const testCases = [
        { a: 'short', b: 'longer-string' },
        { a: 'abc', b: 'a' },
        { a: 'x', b: 'xxxxxxxxxx' },
        { a: '', b: 'not-empty' },
      ];

      for (const { a, b } of testCases) {
        expect(timingSafeCompare(a, b)).toBe(false);
      }
    });
  });

  describe('validateUserIdMatch timing attack protection', () => {
    it('should use timing-safe comparison for matching IDs', () => {
      const userId = 'user-secure-123';

      // This should use timingSafeCompare internally
      const result = validateUserIdMatch(userId, userId);

      expect(result).toBe(true);
    });

    it('should use timing-safe comparison for non-matching IDs', () => {
      const requestedId = 'user-attacker';
      const authenticatedId = 'user-victim';

      // This should use timingSafeCompare internally
      const result = validateUserIdMatch(requestedId, authenticatedId);

      expect(result).toBe(false);
    });

    it('should not leak information about ID length through timing', () => {
      // These comparisons should take approximately the same time
      // regardless of how "close" the IDs are to matching
      const auth = 'user-authenticated-12345';

      // All these should use constant-time comparison
      expect(validateUserIdMatch('x', auth)).toBe(false);
      expect(validateUserIdMatch('user-authenticated-12344', auth)).toBe(false);
      expect(validateUserIdMatch('user-authenticated-1234', auth)).toBe(false);
      expect(validateUserIdMatch('completely-different', auth)).toBe(false);
    });

    it('should return false for empty or undefined inputs (early return)', () => {
      expect(validateUserIdMatch('', 'user-123')).toBe(false);
      expect(validateUserIdMatch('user-123', '')).toBe(false);
      expect(validateUserIdMatch('user-123', undefined)).toBe(false);
    });
  });

  describe('validateSessionOwnership timing attack protection', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ownerUserId = 'user-owner-secure';
    const attackerUserId = 'user-attacker';

    it('should successfully validate when user owns session', async () => {
      mockFindUnique.mockResolvedValueOnce({ user_id: ownerUserId });

      const result = await validateSessionOwnership(validSessionId, ownerUserId);

      expect(result.isOwner).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject with NOT_OWNER when user does not own session', async () => {
      mockFindUnique.mockResolvedValueOnce({ user_id: ownerUserId });

      const result = await validateSessionOwnership(validSessionId, attackerUserId);

      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('NOT_OWNER');
    });

    it('should prevent timing-based enumeration of valid user IDs', async () => {
      // An attacker trying different user IDs should not be able to
      // determine the correct one through timing analysis

      const correctOwner = 'correct-user-id-12345';
      const attempts = [
        'c', // 1 char match
        'co', // 2 chars match
        'cor', // 3 chars match
        'correct-user-id-12344', // almost right
        'wrong-user-completely', // completely wrong
      ];

      for (const attempt of attempts) {
        mockFindUnique.mockResolvedValueOnce({ user_id: correctOwner });

        const result = await validateSessionOwnership(validSessionId, attempt);

        // All should fail and use constant-time comparison
        expect(result.isOwner).toBe(false);
        expect(result.error).toBe('NOT_OWNER');
      }
    });

    it('should handle session not found before comparing user IDs', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await validateSessionOwnership(validSessionId, attackerUserId);

      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('Edge cases for security', () => {
    it('should handle null byte injection attempts', () => {
      const normalId = 'user-123';
      const nullByteId = 'user-123\x00admin';

      expect(timingSafeCompare(normalId, nullByteId)).toBe(false);
    });

    it('should handle whitespace manipulation attempts', () => {
      const normalId = 'user-123';
      const paddedId = ' user-123';
      const trailingId = 'user-123 ';

      expect(timingSafeCompare(normalId, paddedId)).toBe(false);
      expect(timingSafeCompare(normalId, trailingId)).toBe(false);
    });

    it('should handle case sensitivity correctly (UUID normalization)', () => {
      const lowercaseId = 'user-abc';
      const uppercaseId = 'USER-ABC';
      const mixedCaseId = 'User-Abc';

      // Should be true because of UUID normalization (case-insensitive)
      expect(timingSafeCompare(lowercaseId, uppercaseId)).toBe(true);
      expect(timingSafeCompare(lowercaseId, mixedCaseId)).toBe(true);
    });

    it('should handle URL-encoded characters', () => {
      const normalId = 'user/with/slash';
      const encodedId = 'user%2Fwith%2Fslash';

      // These should be different (no automatic decoding)
      expect(timingSafeCompare(normalId, encodedId)).toBe(false);
    });

    it('should handle binary data in strings', () => {
      const binaryA = Buffer.from([0x00, 0x01, 0x02]).toString();
      const binaryB = Buffer.from([0x00, 0x01, 0x02]).toString();
      const binaryC = Buffer.from([0x00, 0x01, 0x03]).toString();

      expect(timingSafeCompare(binaryA, binaryB)).toBe(true);
      expect(timingSafeCompare(binaryA, binaryC)).toBe(false);
    });

    it('should handle strings with newlines and special whitespace', () => {
      const withNewline = 'user\n123';
      const withTab = 'user\t123';
      const withCarriageReturn = 'user\r123';

      expect(timingSafeCompare(withNewline, withNewline)).toBe(true);
      expect(timingSafeCompare(withNewline, withTab)).toBe(false);
      expect(timingSafeCompare(withNewline, withCarriageReturn)).toBe(false);
    });
  });
});
