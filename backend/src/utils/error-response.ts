/**
 * Error Response Utilities
 *
 * Helper functions for sending standardized error responses.
 * All routes should use these functions instead of manual res.status().json().
 *
 * Multi-tenant Safety:
 * - Never logs or returns user-specific identifiers in error messages
 * - All messages are generic and safe for any user to see
 *
 * @module utils/error-response
 */

import { Response } from 'express';
import {
  ErrorCode,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  HTTP_STATUS_NAMES,
} from '@/constants/errors';
import type { ApiErrorResponse, ErrorResponseWithStatus } from '@/types/error.types';

/**
 * Send standardized error response
 *
 * Primary function for sending error responses from routes.
 * Ensures consistent format and prevents exposing internal details.
 *
 * @param res - Express response object
 * @param code - ErrorCode enum value
 * @param customMessage - Optional: Override default message
 * @param details - Optional: Additional error details (never include sensitive data!)
 *
 * @example
 * // Basic usage - uses default message for the error code
 * sendError(res, ErrorCode.NOT_FOUND);
 * // Response: { error: "Not Found", message: "Resource not found", code: "NOT_FOUND" }
 *
 * @example
 * // With custom message
 * sendError(res, ErrorCode.SESSION_NOT_FOUND);
 * // Response: { error: "Not Found", message: "Session not found", code: "SESSION_NOT_FOUND" }
 *
 * @example
 * // With details (for validation errors)
 * sendError(res, ErrorCode.PARAMETER_OUT_OF_RANGE, undefined, {
 *   field: 'months',
 *   min: 1,
 *   max: 24,
 *   received: 30
 * });
 * // Response: { error: "Bad Request", message: "...", code: "...", details: {...} }
 */
export function sendError(
  res: Response,
  code: ErrorCode,
  customMessage?: string,
  details?: Record<string, string | number | boolean>
): void {
  const statusCode = ERROR_STATUS_CODES[code];
  const statusName = HTTP_STATUS_NAMES[statusCode] ?? 'Error';
  const message = customMessage ?? ERROR_MESSAGES[code];

  const response: ApiErrorResponse = {
    error: statusName,
    message,
    code,
  };

  if (details !== undefined) {
    response.details = details;
  }

  res.status(statusCode).json(response);
}

/**
 * Create error response object without sending
 *
 * Useful for:
 * - Unit testing error responses
 * - Composing responses in middleware
 * - Pre-computing error responses
 *
 * @param code - ErrorCode enum value
 * @param customMessage - Optional: Override default message
 * @param details - Optional: Additional error details
 * @returns Object with statusCode and body
 *
 * @example
 * const { statusCode, body } = createErrorResponse(ErrorCode.FORBIDDEN);
 * // statusCode: 403
 * // body: { error: "Forbidden", message: "Access denied", code: "FORBIDDEN" }
 */
export function createErrorResponse(
  code: ErrorCode,
  customMessage?: string,
  details?: Record<string, string | number | boolean>
): ErrorResponseWithStatus {
  const statusCode = ERROR_STATUS_CODES[code];
  const statusName = HTTP_STATUS_NAMES[statusCode] ?? 'Error';
  const message = customMessage ?? ERROR_MESSAGES[code];

  const body: ApiErrorResponse = {
    error: statusName,
    message,
    code,
  };

  if (details !== undefined) {
    body.details = details;
  }

  return { statusCode, body };
}

/**
 * Send 400 Bad Request error
 *
 * Convenience function for validation errors.
 *
 * @param res - Express response object
 * @param message - Specific validation error message
 * @param field - Optional: Field that failed validation
 */
export function sendBadRequest(
  res: Response,
  message: string,
  field?: string
): void {
  const details = field ? { field } : undefined;
  sendError(res, ErrorCode.BAD_REQUEST, message, details);
}

/**
 * Send 401 Unauthorized error
 *
 * Convenience function for authentication errors.
 *
 * @param res - Express response object
 * @param code - Specific unauthorized error code (defaults to UNAUTHORIZED)
 */
export function sendUnauthorized(
  res: Response,
  code: ErrorCode = ErrorCode.UNAUTHORIZED
): void {
  sendError(res, code);
}

/**
 * Send 403 Forbidden error
 *
 * Convenience function for authorization errors.
 *
 * @param res - Express response object
 * @param code - Specific forbidden error code (defaults to FORBIDDEN)
 */
export function sendForbidden(
  res: Response,
  code: ErrorCode = ErrorCode.FORBIDDEN
): void {
  sendError(res, code);
}

/**
 * Send 404 Not Found error
 *
 * Convenience function for resource not found errors.
 *
 * @param res - Express response object
 * @param code - Specific not found error code (defaults to NOT_FOUND)
 */
export function sendNotFound(
  res: Response,
  code: ErrorCode = ErrorCode.NOT_FOUND
): void {
  sendError(res, code);
}

/**
 * Send 409 Conflict error
 *
 * Convenience function for state conflict errors.
 *
 * @param res - Express response object
 * @param code - Specific conflict error code (defaults to CONFLICT)
 */
export function sendConflict(
  res: Response,
  code: ErrorCode = ErrorCode.CONFLICT
): void {
  sendError(res, code);
}

/**
 * Send 500 Internal Server Error
 *
 * Convenience function for internal errors.
 * NEVER pass the actual error message - use the safe default.
 *
 * @param res - Express response object
 * @param code - Specific error code (defaults to INTERNAL_ERROR)
 *
 * @example
 * // In a catch block
 * try {
 *   await someOperation();
 * } catch (error) {
 *   logger.error('Operation failed', { error }); // Log the real error
 *   sendInternalError(res); // Send safe generic message
 * }
 */
export function sendInternalError(
  res: Response,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR
): void {
  sendError(res, code);
}

/**
 * Send 503 Service Unavailable error
 *
 * Convenience function for service unavailability.
 *
 * @param res - Express response object
 * @param code - Specific unavailable error code (defaults to SERVICE_UNAVAILABLE)
 */
export function sendServiceUnavailable(
  res: Response,
  code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE
): void {
  sendError(res, code);
}
