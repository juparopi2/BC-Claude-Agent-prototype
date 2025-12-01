/**
 * Error Response Type Definitions
 *
 * Types for standardized API error responses.
 * All error responses across the application should follow these interfaces.
 *
 * Shared types are imported from @bc-agent/shared.
 *
 * @module types/error.types
 */

// ============================================
// Re-export ALL shared Error types
// ============================================
export type {
  ApiErrorResponse,
  ErrorResponseWithStatus,
  ValidationErrorDetail,
  RangeErrorDetail,
} from '@bc-agent/shared';

// Type guards (runtime functions)
export { isApiErrorResponse, isValidErrorCode } from '@bc-agent/shared';
