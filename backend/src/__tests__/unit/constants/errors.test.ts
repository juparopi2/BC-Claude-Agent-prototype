/**
 * Error Constants Unit Tests
 *
 * Tests for error code constants, messages, and helper functions.
 * Ensures consistency and completeness of error handling infrastructure.
 *
 * @module __tests__/unit/constants/errors.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  HTTP_STATUS_NAMES,
  getHttpStatusName,
  getErrorMessage,
  getErrorStatusCode,
  validateErrorConstants,
} from '@/constants/errors';

describe('Error Constants', () => {
  describe('ErrorCode enum', () => {
    it('should have all expected 400 error codes', () => {
      expect(ErrorCode.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCode.INVALID_PARAMETER).toBe('INVALID_PARAMETER');
      expect(ErrorCode.MISSING_REQUIRED_FIELD).toBe('MISSING_REQUIRED_FIELD');
      expect(ErrorCode.PARAMETER_OUT_OF_RANGE).toBe('PARAMETER_OUT_OF_RANGE');
      expect(ErrorCode.INVALID_DECISION).toBe('INVALID_DECISION');
    });

    it('should have all expected 401 error codes', () => {
      expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ErrorCode.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
      expect(ErrorCode.INVALID_TOKEN).toBe('INVALID_TOKEN');
      expect(ErrorCode.USER_ID_NOT_IN_SESSION).toBe('USER_ID_NOT_IN_SESSION');
    });

    it('should have all expected 403 error codes', () => {
      expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN');
      expect(ErrorCode.ACCESS_DENIED).toBe('ACCESS_DENIED');
      expect(ErrorCode.INSUFFICIENT_PERMISSIONS).toBe('INSUFFICIENT_PERMISSIONS');
      expect(ErrorCode.OWN_DATA_ONLY).toBe('OWN_DATA_ONLY');
      expect(ErrorCode.SESSION_ACCESS_DENIED).toBe('SESSION_ACCESS_DENIED');
      expect(ErrorCode.APPROVAL_ACCESS_DENIED).toBe('APPROVAL_ACCESS_DENIED');
    });

    it('should have all expected 404 error codes', () => {
      expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
      expect(ErrorCode.SESSION_NOT_FOUND).toBe('SESSION_NOT_FOUND');
      expect(ErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
      expect(ErrorCode.APPROVAL_NOT_FOUND).toBe('APPROVAL_NOT_FOUND');
      expect(ErrorCode.TOKEN_USAGE_NOT_FOUND).toBe('TOKEN_USAGE_NOT_FOUND');
      expect(ErrorCode.TOOL_NOT_FOUND).toBe('TOOL_NOT_FOUND');
    });

    it('should have all expected 409 error codes', () => {
      expect(ErrorCode.CONFLICT).toBe('CONFLICT');
      expect(ErrorCode.ALREADY_EXISTS).toBe('ALREADY_EXISTS');
      expect(ErrorCode.ALREADY_RESOLVED).toBe('ALREADY_RESOLVED');
      expect(ErrorCode.STATE_CONFLICT).toBe('STATE_CONFLICT');
    });

    it('should have all expected 410 error codes', () => {
      expect(ErrorCode.EXPIRED).toBe('EXPIRED');
      expect(ErrorCode.APPROVAL_EXPIRED).toBe('APPROVAL_EXPIRED');
    });

    it('should have all expected 429 error codes', () => {
      expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
      expect(ErrorCode.SESSION_RATE_LIMIT_EXCEEDED).toBe('SESSION_RATE_LIMIT_EXCEEDED');
    });

    it('should have all expected 500 error codes', () => {
      expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
      expect(ErrorCode.DATABASE_ERROR).toBe('DATABASE_ERROR');
      expect(ErrorCode.SERVICE_ERROR).toBe('SERVICE_ERROR');
      expect(ErrorCode.SESSION_CREATE_ERROR).toBe('SESSION_CREATE_ERROR');
      expect(ErrorCode.MESSAGE_PROCESSING_ERROR).toBe('MESSAGE_PROCESSING_ERROR');
    });

    it('should have all expected 503 error codes', () => {
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
      expect(ErrorCode.AGENT_BUSY).toBe('AGENT_BUSY');
      expect(ErrorCode.BC_UNAVAILABLE).toBe('BC_UNAVAILABLE');
      expect(ErrorCode.APPROVAL_NOT_READY).toBe('APPROVAL_NOT_READY');
      expect(ErrorCode.MCP_UNAVAILABLE).toBe('MCP_UNAVAILABLE');
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have a message for every ErrorCode', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        expect(ERROR_MESSAGES[code]).toBeDefined();
        expect(typeof ERROR_MESSAGES[code]).toBe('string');
        expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
      }
    });

    it('should have messages in sentence case (first letter uppercase)', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        const message = ERROR_MESSAGES[code];
        const firstChar = message.charAt(0);
        expect(firstChar).toBe(firstChar.toUpperCase());
      }
    });

    it('should not have trailing periods in messages', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        const message = ERROR_MESSAGES[code];
        expect(message.endsWith('.')).toBe(false);
      }
    });

    it('should not contain stack traces or internal details', () => {
      const forbiddenPatterns = [
        /at \w+\s+\(/,  // Stack trace pattern
        /Error:/,        // Error prefix
        /undefined/,     // JavaScript undefined
        /null pointer/,  // Null pointer references
        /SQL/,           // SQL keywords
        /database connection/i,
      ];

      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        const message = ERROR_MESSAGES[code];
        for (const pattern of forbiddenPatterns) {
          expect(pattern.test(message)).toBe(false);
        }
      }
    });
  });

  describe('ERROR_STATUS_CODES', () => {
    it('should have a status code for every ErrorCode', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        expect(ERROR_STATUS_CODES[code]).toBeDefined();
        expect(typeof ERROR_STATUS_CODES[code]).toBe('number');
      }
    });

    it('should map 400 error codes to 400 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.BAD_REQUEST]).toBe(400);
      expect(ERROR_STATUS_CODES[ErrorCode.VALIDATION_ERROR]).toBe(400);
      expect(ERROR_STATUS_CODES[ErrorCode.INVALID_PARAMETER]).toBe(400);
      expect(ERROR_STATUS_CODES[ErrorCode.MISSING_REQUIRED_FIELD]).toBe(400);
      expect(ERROR_STATUS_CODES[ErrorCode.PARAMETER_OUT_OF_RANGE]).toBe(400);
    });

    it('should map 401 error codes to 401 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.UNAUTHORIZED]).toBe(401);
      expect(ERROR_STATUS_CODES[ErrorCode.SESSION_EXPIRED]).toBe(401);
      expect(ERROR_STATUS_CODES[ErrorCode.INVALID_TOKEN]).toBe(401);
    });

    it('should map 403 error codes to 403 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.FORBIDDEN]).toBe(403);
      expect(ERROR_STATUS_CODES[ErrorCode.ACCESS_DENIED]).toBe(403);
      expect(ERROR_STATUS_CODES[ErrorCode.OWN_DATA_ONLY]).toBe(403);
    });

    it('should map 404 error codes to 404 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.NOT_FOUND]).toBe(404);
      expect(ERROR_STATUS_CODES[ErrorCode.SESSION_NOT_FOUND]).toBe(404);
      expect(ERROR_STATUS_CODES[ErrorCode.USER_NOT_FOUND]).toBe(404);
    });

    it('should map 409 error codes to 409 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.CONFLICT]).toBe(409);
      expect(ERROR_STATUS_CODES[ErrorCode.ALREADY_RESOLVED]).toBe(409);
    });

    it('should map 410 error codes to 410 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.EXPIRED]).toBe(410);
      expect(ERROR_STATUS_CODES[ErrorCode.APPROVAL_EXPIRED]).toBe(410);
    });

    it('should map 429 error codes to 429 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.RATE_LIMIT_EXCEEDED]).toBe(429);
      expect(ERROR_STATUS_CODES[ErrorCode.SESSION_RATE_LIMIT_EXCEEDED]).toBe(429);
    });

    it('should map 500 error codes to 500 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.INTERNAL_ERROR]).toBe(500);
      expect(ERROR_STATUS_CODES[ErrorCode.DATABASE_ERROR]).toBe(500);
    });

    it('should map 503 error codes to 503 status', () => {
      expect(ERROR_STATUS_CODES[ErrorCode.SERVICE_UNAVAILABLE]).toBe(503);
      expect(ERROR_STATUS_CODES[ErrorCode.AGENT_BUSY]).toBe(503);
    });
  });

  describe('HTTP_STATUS_NAMES', () => {
    it('should have names for all common status codes', () => {
      expect(HTTP_STATUS_NAMES[400]).toBe('Bad Request');
      expect(HTTP_STATUS_NAMES[401]).toBe('Unauthorized');
      expect(HTTP_STATUS_NAMES[403]).toBe('Forbidden');
      expect(HTTP_STATUS_NAMES[404]).toBe('Not Found');
      expect(HTTP_STATUS_NAMES[409]).toBe('Conflict');
      expect(HTTP_STATUS_NAMES[410]).toBe('Gone');
      expect(HTTP_STATUS_NAMES[429]).toBe('Too Many Requests');
      expect(HTTP_STATUS_NAMES[500]).toBe('Internal Server Error');
      expect(HTTP_STATUS_NAMES[503]).toBe('Service Unavailable');
    });
  });

  describe('getHttpStatusName', () => {
    it('should return correct status name for valid codes', () => {
      expect(getHttpStatusName(400)).toBe('Bad Request');
      expect(getHttpStatusName(401)).toBe('Unauthorized');
      expect(getHttpStatusName(404)).toBe('Not Found');
      expect(getHttpStatusName(500)).toBe('Internal Server Error');
    });

    it('should return "Unknown Error" for unknown status codes', () => {
      expect(getHttpStatusName(999)).toBe('Unknown Error');
      expect(getHttpStatusName(0)).toBe('Unknown Error');
      expect(getHttpStatusName(-1)).toBe('Unknown Error');
    });
  });

  describe('getErrorMessage', () => {
    it('should return correct message for error code', () => {
      expect(getErrorMessage(ErrorCode.NOT_FOUND)).toBe('Resource not found');
      expect(getErrorMessage(ErrorCode.UNAUTHORIZED)).toBe('Authentication required');
      expect(getErrorMessage(ErrorCode.INTERNAL_ERROR)).toBe('An unexpected error occurred');
    });
  });

  describe('getErrorStatusCode', () => {
    it('should return correct status code for error code', () => {
      expect(getErrorStatusCode(ErrorCode.NOT_FOUND)).toBe(404);
      expect(getErrorStatusCode(ErrorCode.UNAUTHORIZED)).toBe(401);
      expect(getErrorStatusCode(ErrorCode.INTERNAL_ERROR)).toBe(500);
    });
  });

  describe('validateErrorConstants', () => {
    it('should not throw when all constants are valid', () => {
      expect(() => validateErrorConstants()).not.toThrow();
    });
  });

  describe('Completeness checks', () => {
    it('should have the same number of entries in ERROR_MESSAGES and ERROR_STATUS_CODES', () => {
      const messageCount = Object.keys(ERROR_MESSAGES).length;
      const statusCount = Object.keys(ERROR_STATUS_CODES).length;
      expect(messageCount).toBe(statusCount);
    });

    it('should have entries matching the ErrorCode enum count', () => {
      const enumCount = Object.values(ErrorCode).length;
      const messageCount = Object.keys(ERROR_MESSAGES).length;
      const statusCount = Object.keys(ERROR_STATUS_CODES).length;

      expect(messageCount).toBe(enumCount);
      expect(statusCount).toBe(enumCount);
    });
  });
});
