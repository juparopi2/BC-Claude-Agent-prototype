/**
 * Error Constants
 *
 * Centralized error codes, messages, and HTTP status mappings.
 * Provides type-safe, consistent error handling across all routes.
 *
 * Multi-tenant Safety:
 * - All messages are generic (no user IDs, session IDs, or internal details)
 * - Error codes enable programmatic handling by API clients
 * - No stack traces or internal error messages exposed
 *
 * @module constants/errors
 */

/**
 * Error Codes
 *
 * Machine-readable error codes for API clients.
 * Use these codes for programmatic error handling instead of parsing messages.
 *
 * Naming Convention:
 * - SCREAMING_SNAKE_CASE
 * - Category prefix for related errors (e.g., SESSION_, APPROVAL_)
 * - Specific enough to identify the error type
 */
export enum ErrorCode {
  // ============================================
  // 400 Bad Request - Client input errors
  // ============================================
  /** Generic bad request */
  BAD_REQUEST = 'BAD_REQUEST',
  /** Zod/schema validation failed */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Parameter has invalid format or value */
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  /** Required field missing from request */
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  /** Parameter outside allowed range (e.g., months 1-24) */
  PARAMETER_OUT_OF_RANGE = 'PARAMETER_OUT_OF_RANGE',
  /** Invalid decision value for approval */
  INVALID_DECISION = 'INVALID_DECISION',

  // ============================================
  // 401 Unauthorized - Authentication errors
  // ============================================
  /** User not authenticated */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** Session has expired, re-login required */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  /** Token is invalid or expired */
  INVALID_TOKEN = 'INVALID_TOKEN',
  /** User ID not found in session */
  USER_ID_NOT_IN_SESSION = 'USER_ID_NOT_IN_SESSION',

  // ============================================
  // 403 Forbidden - Authorization errors
  // ============================================
  /** Generic access denied */
  FORBIDDEN = 'FORBIDDEN',
  /** User doesn't have access to this resource */
  ACCESS_DENIED = 'ACCESS_DENIED',
  /** User lacks required permissions */
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  /** User can only access their own data */
  OWN_DATA_ONLY = 'OWN_DATA_ONLY',
  /** User doesn't own this session */
  SESSION_ACCESS_DENIED = 'SESSION_ACCESS_DENIED',
  /** User doesn't own this approval */
  APPROVAL_ACCESS_DENIED = 'APPROVAL_ACCESS_DENIED',

  // ============================================
  // 404 Not Found - Resource not found
  // ============================================
  /** Generic resource not found */
  NOT_FOUND = 'NOT_FOUND',
  /** Session not found or deleted */
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  /** User not found */
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  /** Approval request not found */
  APPROVAL_NOT_FOUND = 'APPROVAL_NOT_FOUND',
  /** Token usage data not found */
  TOKEN_USAGE_NOT_FOUND = 'TOKEN_USAGE_NOT_FOUND',
  /** MCP tool not found */
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',

  // ============================================
  // 409 Conflict - State conflicts
  // ============================================
  /** Generic resource conflict */
  CONFLICT = 'CONFLICT',
  /** Resource already exists */
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  /** Approval already approved/rejected */
  ALREADY_RESOLVED = 'ALREADY_RESOLVED',
  /** Operation conflicts with current state */
  STATE_CONFLICT = 'STATE_CONFLICT',

  // ============================================
  // 410 Gone - Resource no longer available
  // ============================================
  /** Generic resource expired */
  EXPIRED = 'EXPIRED',
  /** Approval request has expired */
  APPROVAL_EXPIRED = 'APPROVAL_EXPIRED',

  // ============================================
  // 429 Too Many Requests - Rate limiting
  // ============================================
  /** Generic rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  /** Session rate limit exceeded (100 jobs/hour) */
  SESSION_RATE_LIMIT_EXCEEDED = 'SESSION_RATE_LIMIT_EXCEEDED',

  // ============================================
  // 500 Internal Server Error - Server errors
  // ============================================
  /** Generic internal error (safe message) */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** Database operation failed */
  DATABASE_ERROR = 'DATABASE_ERROR',
  /** External service call failed */
  SERVICE_ERROR = 'SERVICE_ERROR',
  /** Failed to create session */
  SESSION_CREATE_ERROR = 'SESSION_CREATE_ERROR',
  /** Failed to process message */
  MESSAGE_PROCESSING_ERROR = 'MESSAGE_PROCESSING_ERROR',

  // ============================================
  // 503 Service Unavailable - Temporary issues
  // ============================================
  /** Generic service unavailable */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** Agent is processing another request */
  AGENT_BUSY = 'AGENT_BUSY',
  /** Business Central API unavailable */
  BC_UNAVAILABLE = 'BC_UNAVAILABLE',
  /** Approval system not ready */
  APPROVAL_NOT_READY = 'APPROVAL_NOT_READY',
  /** MCP service not available */
  MCP_UNAVAILABLE = 'MCP_UNAVAILABLE',
}

/**
 * HTTP Status Names
 *
 * Human-readable names for HTTP status codes.
 * Used in the `error` field of API responses.
 */
export const HTTP_STATUS_NAMES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
} as const;

/**
 * Error Messages
 *
 * Human-readable, user-safe error messages.
 *
 * Rules:
 * 1. Sentence case (capitalize first word only)
 * 2. No trailing periods
 * 3. No internal details, stack traces, or technical jargon
 * 4. Multi-tenant safe (no user IDs, session IDs, or PII)
 * 5. Actionable when possible ("Try again", "Log in again")
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  // 400 Bad Request
  [ErrorCode.BAD_REQUEST]: 'Invalid request',
  [ErrorCode.VALIDATION_ERROR]: 'Request validation failed',
  [ErrorCode.INVALID_PARAMETER]: 'Invalid parameter value',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Required field is missing',
  [ErrorCode.PARAMETER_OUT_OF_RANGE]: 'Parameter value is out of allowed range',
  [ErrorCode.INVALID_DECISION]: 'Decision must be either "approved" or "rejected"',

  // 401 Unauthorized
  [ErrorCode.UNAUTHORIZED]: 'Authentication required',
  [ErrorCode.SESSION_EXPIRED]: 'Your session has expired, please log in again',
  [ErrorCode.INVALID_TOKEN]: 'Invalid or expired token',
  [ErrorCode.USER_ID_NOT_IN_SESSION]: 'User ID not found in session',

  // 403 Forbidden
  [ErrorCode.FORBIDDEN]: 'Access denied',
  [ErrorCode.ACCESS_DENIED]: 'You do not have access to this resource',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'You do not have permission for this action',
  [ErrorCode.OWN_DATA_ONLY]: 'You can only access your own data',
  [ErrorCode.SESSION_ACCESS_DENIED]: 'You do not have access to this session',
  [ErrorCode.APPROVAL_ACCESS_DENIED]: 'You do not have permission to respond to this approval',

  // 404 Not Found
  [ErrorCode.NOT_FOUND]: 'Resource not found',
  [ErrorCode.SESSION_NOT_FOUND]: 'Session not found',
  [ErrorCode.USER_NOT_FOUND]: 'User not found',
  [ErrorCode.APPROVAL_NOT_FOUND]: 'Approval request not found',
  [ErrorCode.TOKEN_USAGE_NOT_FOUND]: 'No token usage data found',
  [ErrorCode.TOOL_NOT_FOUND]: 'Tool not found',

  // 409 Conflict
  [ErrorCode.CONFLICT]: 'Resource conflict',
  [ErrorCode.ALREADY_EXISTS]: 'Resource already exists',
  [ErrorCode.ALREADY_RESOLVED]: 'This approval has already been processed',
  [ErrorCode.STATE_CONFLICT]: 'Operation conflicts with current state',

  // 410 Gone
  [ErrorCode.EXPIRED]: 'This resource has expired',
  [ErrorCode.APPROVAL_EXPIRED]: 'This approval request has expired',

  // 429 Rate Limit
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests, please try again later',
  [ErrorCode.SESSION_RATE_LIMIT_EXCEEDED]: 'Session rate limit exceeded, please wait before sending more messages',

  // 500 Internal Server Error
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred',
  [ErrorCode.DATABASE_ERROR]: 'A database error occurred',
  [ErrorCode.SERVICE_ERROR]: 'A service error occurred',
  [ErrorCode.SESSION_CREATE_ERROR]: 'Failed to create session',
  [ErrorCode.MESSAGE_PROCESSING_ERROR]: 'Failed to process message',

  // 503 Service Unavailable
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
  [ErrorCode.AGENT_BUSY]: 'Agent is currently processing another request',
  [ErrorCode.BC_UNAVAILABLE]: 'Business Central is temporarily unavailable',
  [ErrorCode.APPROVAL_NOT_READY]: 'Approval system is not ready',
  [ErrorCode.MCP_UNAVAILABLE]: 'MCP service is temporarily unavailable',
} as const;

/**
 * HTTP Status Codes
 *
 * Maps each ErrorCode to its corresponding HTTP status code.
 * Ensures consistent status code usage across all routes.
 */
export const ERROR_STATUS_CODES: Readonly<Record<ErrorCode, number>> = {
  // 400 Bad Request
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_PARAMETER]: 400,
  [ErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ErrorCode.PARAMETER_OUT_OF_RANGE]: 400,
  [ErrorCode.INVALID_DECISION]: 400,

  // 401 Unauthorized
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.USER_ID_NOT_IN_SESSION]: 401,

  // 403 Forbidden
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.ACCESS_DENIED]: 403,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCode.OWN_DATA_ONLY]: 403,
  [ErrorCode.SESSION_ACCESS_DENIED]: 403,
  [ErrorCode.APPROVAL_ACCESS_DENIED]: 403,

  // 404 Not Found
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.SESSION_NOT_FOUND]: 404,
  [ErrorCode.USER_NOT_FOUND]: 404,
  [ErrorCode.APPROVAL_NOT_FOUND]: 404,
  [ErrorCode.TOKEN_USAGE_NOT_FOUND]: 404,
  [ErrorCode.TOOL_NOT_FOUND]: 404,

  // 409 Conflict
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.ALREADY_RESOLVED]: 409,
  [ErrorCode.STATE_CONFLICT]: 409,

  // 410 Gone
  [ErrorCode.EXPIRED]: 410,
  [ErrorCode.APPROVAL_EXPIRED]: 410,

  // 429 Rate Limit
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.SESSION_RATE_LIMIT_EXCEEDED]: 429,

  // 500 Internal Server Error
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.SERVICE_ERROR]: 500,
  [ErrorCode.SESSION_CREATE_ERROR]: 500,
  [ErrorCode.MESSAGE_PROCESSING_ERROR]: 500,

  // 503 Service Unavailable
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.AGENT_BUSY]: 503,
  [ErrorCode.BC_UNAVAILABLE]: 503,
  [ErrorCode.APPROVAL_NOT_READY]: 503,
  [ErrorCode.MCP_UNAVAILABLE]: 503,
} as const;

/**
 * Get HTTP status name from code
 *
 * @param statusCode - HTTP status code (e.g., 404)
 * @returns Human-readable status name (e.g., "Not Found")
 */
export function getHttpStatusName(statusCode: number): string {
  return HTTP_STATUS_NAMES[statusCode] ?? 'Unknown Error';
}

/**
 * Get error message for code
 *
 * @param code - ErrorCode enum value
 * @returns Human-readable error message
 */
export function getErrorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

/**
 * Get HTTP status code for error code
 *
 * @param code - ErrorCode enum value
 * @returns HTTP status code (e.g., 404)
 */
export function getErrorStatusCode(code: ErrorCode): number {
  return ERROR_STATUS_CODES[code];
}

/**
 * Validate that all ErrorCodes have corresponding messages and status codes
 *
 * Call this on startup to catch configuration errors early.
 * This is a compile-time safety check made explicit.
 *
 * @throws Error if any ErrorCode is missing a message or status code
 */
export function validateErrorConstants(): void {
  const allCodes = Object.values(ErrorCode);

  for (const code of allCodes) {
    if (!(code in ERROR_MESSAGES)) {
      throw new Error(`ErrorCode ${code} is missing from ERROR_MESSAGES`);
    }
    if (!(code in ERROR_STATUS_CODES)) {
      throw new Error(`ErrorCode ${code} is missing from ERROR_STATUS_CODES`);
    }
  }
}
