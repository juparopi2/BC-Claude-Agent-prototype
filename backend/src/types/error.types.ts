/**
 * Error Response Type Definitions
 *
 * Types for standardized API error responses.
 * All error responses across the application should follow these interfaces.
 *
 * @module types/error.types
 */

import { ErrorCode } from '@/constants/errors';

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
 *
 * @example
 * // Response body with details
 * {
 *   "error": "Bad Request",
 *   "message": "Parameter value is out of allowed range",
 *   "code": "PARAMETER_OUT_OF_RANGE",
 *   "details": {
 *     "field": "months",
 *     "min": 1,
 *     "max": 24,
 *     "received": 30
 *   }
 * }
 */
export interface ApiErrorResponse {
  /**
   * HTTP status category
   *
   * Human-readable status name (e.g., "Bad Request", "Not Found").
   * Always matches the HTTP status code sent in the response header.
   */
  error: string;

  /**
   * Human-readable error message
   *
   * Safe for display to end users.
   * Never contains sensitive data, stack traces, or internal details.
   */
  message: string;

  /**
   * Machine-readable error code
   *
   * Use this for programmatic error handling.
   * More stable than parsing the message string.
   *
   * @see ErrorCode enum in constants/errors.ts
   */
  code: ErrorCode;

  /**
   * Additional error details (optional)
   *
   * Provides context about the error without exposing sensitive data.
   * Common uses:
   * - Validation errors: field name, constraints
   * - Range errors: min, max, received values
   * - Conflict errors: resource type, identifier
   *
   * Never includes:
   * - User IDs, session IDs, or other identifiers
   * - Stack traces or internal error messages
   * - Database queries or connection strings
   */
  details?: Record<string, string | number | boolean>;

  /**
   * Request ID for support (optional)
   *
   * Unique identifier for this request.
   * Users can provide this when contacting support.
   * Not currently implemented but reserved for future use.
   */
  requestId?: string;
}

/**
 * Error Response with Status Code
 *
 * Used internally to create error responses without sending them.
 * Useful for testing or composing responses.
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
 * Used when VALIDATION_ERROR code is returned.
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
 * Used when PARAMETER_OUT_OF_RANGE code is returned.
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
 *
 * @param obj - Object to check
 * @returns True if object matches ApiErrorResponse structure
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
 *
 * @param code - String to check
 * @returns True if code is a valid ErrorCode
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCode).includes(code as ErrorCode);
}
