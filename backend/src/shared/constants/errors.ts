/**
 * Error Constants
 *
 * Centralized error codes, messages, and HTTP status mappings.
 * Provides type-safe, consistent error handling across all routes.
 *
 * Shared constants are imported from @bc-agent/shared.
 *
 * @module constants/errors
 */

// ============================================
// Re-export ALL shared Error constants
// ============================================
export {
  ErrorCode,
  HTTP_STATUS_NAMES,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  getHttpStatusName,
  getErrorMessage,
  getErrorStatusCode,
  validateErrorConstants,
} from '@bc-agent/shared';
