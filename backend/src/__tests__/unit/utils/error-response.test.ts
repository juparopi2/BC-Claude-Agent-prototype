/**
 * Error Response Utilities Unit Tests
 *
 * Tests for sendError, createErrorResponse, and convenience functions.
 * Ensures error responses are formatted correctly and consistently.
 *
 * @module __tests__/unit/utils/error-response.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import {
  sendError,
  createErrorResponse,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendInternalError,
  sendServiceUnavailable,
} from '@/utils/error-response';
import { ErrorCode } from '@/constants/errors';

// Mock Express Response
function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('Error Response Utilities', () => {
  describe('sendError', () => {
    let mockRes: Response;

    beforeEach(() => {
      mockRes = createMockResponse();
    });

    it('should send 404 Not Found with correct format', () => {
      sendError(mockRes, ErrorCode.NOT_FOUND);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Resource not found',
        code: 'NOT_FOUND',
      });
    });

    it('should send 400 Bad Request with correct format', () => {
      sendError(mockRes, ErrorCode.BAD_REQUEST);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Invalid request',
        code: 'BAD_REQUEST',
      });
    });

    it('should send 401 Unauthorized with correct format', () => {
      sendError(mockRes, ErrorCode.UNAUTHORIZED);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    });

    it('should send 403 Forbidden with correct format', () => {
      sendError(mockRes, ErrorCode.FORBIDDEN);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Access denied',
        code: 'FORBIDDEN',
      });
    });

    it('should send 409 Conflict with correct format', () => {
      sendError(mockRes, ErrorCode.CONFLICT);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Conflict',
        message: 'Resource conflict',
        code: 'CONFLICT',
      });
    });

    it('should send 410 Gone with correct format', () => {
      sendError(mockRes, ErrorCode.EXPIRED);

      expect(mockRes.status).toHaveBeenCalledWith(410);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Gone',
        message: 'This resource has expired',
        code: 'EXPIRED',
      });
    });

    it('should send 429 Too Many Requests with correct format', () => {
      sendError(mockRes, ErrorCode.RATE_LIMIT_EXCEEDED);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Too Many Requests',
        message: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    });

    it('should send 500 Internal Server Error with correct format', () => {
      sendError(mockRes, ErrorCode.INTERNAL_ERROR);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
      });
    });

    it('should send 503 Service Unavailable with correct format', () => {
      sendError(mockRes, ErrorCode.SERVICE_UNAVAILABLE);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
      });
    });

    it('should use custom message when provided', () => {
      sendError(mockRes, ErrorCode.NOT_FOUND, 'Session not found');

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Session not found',
        code: 'NOT_FOUND',
      });
    });

    it('should include details when provided', () => {
      sendError(mockRes, ErrorCode.PARAMETER_OUT_OF_RANGE, undefined, {
        field: 'months',
        min: 1,
        max: 24,
      });

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Parameter value is out of allowed range',
        code: 'PARAMETER_OUT_OF_RANGE',
        details: {
          field: 'months',
          min: 1,
          max: 24,
        },
      });
    });

    it('should include both custom message and details', () => {
      sendError(mockRes, ErrorCode.VALIDATION_ERROR, 'Email is invalid', {
        field: 'email',
      });

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Email is invalid',
        code: 'VALIDATION_ERROR',
        details: {
          field: 'email',
        },
      });
    });

    it('should not include details property when not provided', () => {
      sendError(mockRes, ErrorCode.NOT_FOUND);

      const jsonCall = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(jsonCall).not.toHaveProperty('details');
    });
  });

  describe('createErrorResponse', () => {
    it('should create response object with correct statusCode and body', () => {
      const result = createErrorResponse(ErrorCode.NOT_FOUND);

      expect(result.statusCode).toBe(404);
      expect(result.body).toEqual({
        error: 'Not Found',
        message: 'Resource not found',
        code: 'NOT_FOUND',
      });
    });

    it('should use custom message when provided', () => {
      const result = createErrorResponse(ErrorCode.SESSION_NOT_FOUND);

      expect(result.statusCode).toBe(404);
      expect(result.body.message).toBe('Session not found');
    });

    it('should include details when provided', () => {
      const result = createErrorResponse(ErrorCode.VALIDATION_ERROR, undefined, {
        field: 'title',
      });

      expect(result.body.details).toEqual({ field: 'title' });
    });
  });

  describe('Convenience Functions', () => {
    let mockRes: Response;

    beforeEach(() => {
      mockRes = createMockResponse();
    });

    describe('sendBadRequest', () => {
      it('should send 400 with custom message', () => {
        sendBadRequest(mockRes, 'Invalid email format');

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Bad Request',
          message: 'Invalid email format',
          code: 'BAD_REQUEST',
        });
      });

      it('should include field in details when provided', () => {
        sendBadRequest(mockRes, 'Invalid email format', 'email');

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Bad Request',
          message: 'Invalid email format',
          code: 'BAD_REQUEST',
          details: { field: 'email' },
        });
      });
    });

    describe('sendUnauthorized', () => {
      it('should send 401 with default code', () => {
        sendUnauthorized(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
        });
      });

      it('should send 401 with custom error code', () => {
        sendUnauthorized(mockRes, ErrorCode.SESSION_EXPIRED);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Your session has expired, please log in again',
          code: 'SESSION_EXPIRED',
        });
      });
    });

    describe('sendForbidden', () => {
      it('should send 403 with default code', () => {
        sendForbidden(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Access denied',
          code: 'FORBIDDEN',
        });
      });

      it('should send 403 with OWN_DATA_ONLY code', () => {
        sendForbidden(mockRes, ErrorCode.OWN_DATA_ONLY);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'You can only access your own data',
          code: 'OWN_DATA_ONLY',
        });
      });
    });

    describe('sendNotFound', () => {
      it('should send 404 with default code', () => {
        sendNotFound(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Not Found',
          message: 'Resource not found',
          code: 'NOT_FOUND',
        });
      });

      it('should send 404 with SESSION_NOT_FOUND code', () => {
        sendNotFound(mockRes, ErrorCode.SESSION_NOT_FOUND);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Not Found',
          message: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      });
    });

    describe('sendConflict', () => {
      it('should send 409 with default code', () => {
        sendConflict(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(409);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'Resource conflict',
          code: 'CONFLICT',
        });
      });

      it('should send 409 with ALREADY_RESOLVED code', () => {
        sendConflict(mockRes, ErrorCode.ALREADY_RESOLVED);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'This approval has already been processed',
          code: 'ALREADY_RESOLVED',
        });
      });
    });

    describe('sendInternalError', () => {
      it('should send 500 with default code', () => {
        sendInternalError(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
        });
      });

      it('should send 500 with DATABASE_ERROR code', () => {
        sendInternalError(mockRes, ErrorCode.DATABASE_ERROR);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Internal Server Error',
          message: 'A database error occurred',
          code: 'DATABASE_ERROR',
        });
      });
    });

    describe('sendServiceUnavailable', () => {
      it('should send 503 with default code', () => {
        sendServiceUnavailable(mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(503);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Service Unavailable',
          message: 'Service temporarily unavailable',
          code: 'SERVICE_UNAVAILABLE',
        });
      });

      it('should send 503 with AGENT_BUSY code', () => {
        sendServiceUnavailable(mockRes, ErrorCode.AGENT_BUSY);

        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Service Unavailable',
          message: 'Agent is currently processing another request',
          code: 'AGENT_BUSY',
        });
      });
    });
  });

  describe('Response Format Validation', () => {
    let mockRes: Response;

    beforeEach(() => {
      mockRes = createMockResponse();
    });

    it('should always include error, message, and code fields', () => {
      const testCodes = [
        ErrorCode.BAD_REQUEST,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.NOT_FOUND,
        ErrorCode.CONFLICT,
        ErrorCode.INTERNAL_ERROR,
        ErrorCode.SERVICE_UNAVAILABLE,
      ];

      for (const code of testCodes) {
        mockRes = createMockResponse();
        sendError(mockRes, code);

        const jsonCall = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
        expect(jsonCall).toHaveProperty('error');
        expect(jsonCall).toHaveProperty('message');
        expect(jsonCall).toHaveProperty('code');
        expect(typeof jsonCall.error).toBe('string');
        expect(typeof jsonCall.message).toBe('string');
        expect(typeof jsonCall.code).toBe('string');
      }
    });

    it('should return code that matches ErrorCode enum value', () => {
      sendError(mockRes, ErrorCode.SESSION_ACCESS_DENIED);

      const jsonCall = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(jsonCall.code).toBe('SESSION_ACCESS_DENIED');
      expect(Object.values(ErrorCode)).toContain(jsonCall.code);
    });
  });
});
