/**
 * Error Response Type Definitions
 *
 * Types for standardized API error responses.
 * All error responses across the application should follow these interfaces.
 *
 * @module @bc-agent/shared/types/error
 */

import { ErrorCode } from '../constants/errors';

/**
 * Standard API Error Response
 *
 * All error responses from the API follow this format.
 * Clients can use the `code` field for programmatic error handling.
 *
 * @example
 * // Response body for a 404 error
 * {
 *   "error": "Not Found",
 *   "message": "Session not found",
 *   "code": "SESSION_NOT_FOUND"
 * }
 */
export interface ApiErrorResponse {
  /**
   * HTTP status category
   * Human-readable status name (e.g., "Bad Request", "Not Found").
   */
  error: string;

  /**
   * Human-readable error message
   * Safe for display to end users.
   */
  message: string;

  /**
   * Machine-readable error code
   * Use this for programmatic error handling.
   */
  code: ErrorCode;

  /**
   * Additional error details (optional)
   * Provides context about the error without exposing sensitive data.
   */
  details?: Record<string, string | number | boolean>;

  /**
   * Request ID for support (optional)
   */
  requestId?: string;
}

/**
 * Error Response with Status Code
 *
 * Used internally to create error responses without sending them.
 */
export interface ErrorResponseWithStatus {
  /** HTTP status code (e.g., 404, 500) */
  statusCode: number;

  /** Error response body */
  body: ApiErrorResponse;
}

/**
 * Validation Error Detail
 *
 * Specific structure for validation error details.
 */
export interface ValidationErrorDetail {
  /** Field that failed validation */
  field: string;

  /** Validation error message for this field */
  message: string;

  /** Expected type or format (optional) */
  expected?: string;

  /** Received value type (optional) */
  received?: string;
}

/**
 * Range Error Detail
 *
 * Specific structure for parameter out of range errors.
 */
export interface RangeErrorDetail {
  /** Field name */
  field: string;

  /** Minimum allowed value */
  min: number;

  /** Maximum allowed value */
  max: number;

  /** Value that was received */
  received: number;
}

/**
 * Type guard to check if an object is an ApiErrorResponse
 */
export function isApiErrorResponse(obj: unknown): obj is ApiErrorResponse {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate.error === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.code === 'string' &&
    Object.values(ErrorCode).includes(candidate.code as ErrorCode)
  );
}

/**
 * Type guard to check if error code exists
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCode).includes(code as ErrorCode);
}
