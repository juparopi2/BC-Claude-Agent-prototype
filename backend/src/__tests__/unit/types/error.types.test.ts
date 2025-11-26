/**
 * Error Types Unit Tests
 *
 * Tests for error type interfaces and type guards.
 *
 * @module __tests__/unit/types/error.types.test.ts
 */

import { describe, it, expect } from 'vitest';
import { isApiErrorResponse, isValidErrorCode } from '@/types/error.types';
import { ErrorCode } from '@/constants/errors';

describe('Error Types', () => {
  describe('isApiErrorResponse', () => {
    it('should return true for valid ApiErrorResponse', () => {
      const validResponse = {
        error: 'Not Found',
        message: 'Resource not found',
        code: ErrorCode.NOT_FOUND,
      };

      expect(isApiErrorResponse(validResponse)).toBe(true);
    });

    it('should return true for ApiErrorResponse with details', () => {
      const validResponse = {
        error: 'Bad Request',
        message: 'Parameter out of range',
        code: ErrorCode.PARAMETER_OUT_OF_RANGE,
        details: {
          field: 'months',
          min: 1,
          max: 24,
        },
      };

      expect(isApiErrorResponse(validResponse)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isApiErrorResponse(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isApiErrorResponse(undefined)).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect(isApiErrorResponse('string')).toBe(false);
      expect(isApiErrorResponse(123)).toBe(false);
      expect(isApiErrorResponse(true)).toBe(false);
      expect(isApiErrorResponse([])).toBe(false);
    });

    it('should return false for object missing error field', () => {
      const invalidResponse = {
        message: 'Resource not found',
        code: ErrorCode.NOT_FOUND,
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object missing message field', () => {
      const invalidResponse = {
        error: 'Not Found',
        code: ErrorCode.NOT_FOUND,
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object missing code field', () => {
      const invalidResponse = {
        error: 'Not Found',
        message: 'Resource not found',
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object with invalid error type', () => {
      const invalidResponse = {
        error: 123,
        message: 'Resource not found',
        code: ErrorCode.NOT_FOUND,
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object with invalid message type', () => {
      const invalidResponse = {
        error: 'Not Found',
        message: 123,
        code: ErrorCode.NOT_FOUND,
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object with invalid code value', () => {
      const invalidResponse = {
        error: 'Not Found',
        message: 'Resource not found',
        code: 'INVALID_CODE_NOT_IN_ENUM',
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });

    it('should return false for object with non-string code', () => {
      const invalidResponse = {
        error: 'Not Found',
        message: 'Resource not found',
        code: 404,
      };

      expect(isApiErrorResponse(invalidResponse)).toBe(false);
    });
  });

  describe('isValidErrorCode', () => {
    it('should return true for all valid ErrorCode values', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        expect(isValidErrorCode(code)).toBe(true);
      }
    });

    it('should return false for invalid error codes', () => {
      expect(isValidErrorCode('INVALID_CODE')).toBe(false);
      expect(isValidErrorCode('NOT_AN_ERROR')).toBe(false);
      expect(isValidErrorCode('')).toBe(false);
      expect(isValidErrorCode('not_found')).toBe(false); // Case sensitive
    });

    it('should return true for specific codes', () => {
      expect(isValidErrorCode('NOT_FOUND')).toBe(true);
      expect(isValidErrorCode('UNAUTHORIZED')).toBe(true);
      expect(isValidErrorCode('BAD_REQUEST')).toBe(true);
      expect(isValidErrorCode('INTERNAL_ERROR')).toBe(true);
    });
  });
});
