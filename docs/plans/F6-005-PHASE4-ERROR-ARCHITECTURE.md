# F6-005 Phase 4: Error Message Standardization Architecture

**Version**: 1.0
**Date**: 2025-11-25
**Author**: Claude Code
**Status**: APPROVED FOR IMPLEMENTATION

---

## 1. Executive Summary

This document defines the complete architecture for standardizing error messages across the BC Claude Agent backend. The solution provides:

- **Type-safe error codes** with TypeScript enums
- **Consistent response format** across all endpoints
- **Multi-tenant safe messages** (no data leakage)
- **API client-friendly error codes** for programmatic handling
- **Scalable pattern** for future endpoint additions

---

## 2. Current State Analysis

### 2.1 Error Message Inventory (74 unique messages)

| HTTP Status | Count | Issue |
|-------------|-------|-------|
| 400 Bad Request | 22 | Inconsistent wording, some expose internals |
| 401 Unauthorized | 5 | Mix of "Unauthorized" and "User not authenticated" |
| 403 Forbidden | 10 | Different phrasings for same concept |
| 404 Not Found | 15 | Inconsistent "not found" vs "Not Found" |
| 409 Conflict | 5 | Good consistency |
| 410 Gone | 1 | Good |
| 500 Internal Server Error | 12 | Some expose `error.message` |
| 503 Service Unavailable | 4 | Good consistency |

### 2.2 Key Problems Identified

1. **No error codes**: Clients must parse messages (brittle)
2. **Inconsistent casing**: "Not Found" vs "not found"
3. **Leaking internals**: `error instanceof Error ? error.message : 'Unknown'`
4. **Mixed semantics**: Session access denied returns 403 in some routes, 404 in others
5. **No i18n support**: Messages hardcoded in English

---

## 3. Proposed Architecture

### 3.1 File Structure

```
backend/src/
├── constants/
│   ├── errors.ts          # Error codes, messages, types (NEW)
│   ├── queue.ts           # Existing
│   └── tools.ts           # Existing
├── types/
│   ├── error.types.ts     # Error response interfaces (NEW)
│   └── ... existing ...
├── utils/
│   └── error-response.ts  # Helper functions (NEW)
└── routes/
    └── ... refactored to use new constants ...
```

### 3.2 Error Code Design

```typescript
// Enum with string values for API clients
export enum ErrorCode {
  // 400 Bad Request
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  PARAMETER_OUT_OF_RANGE = 'PARAMETER_OUT_OF_RANGE',

  // 401 Unauthorized
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',

  // 403 Forbidden
  FORBIDDEN = 'FORBIDDEN',
  ACCESS_DENIED = 'ACCESS_DENIED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // 404 Not Found
  NOT_FOUND = 'NOT_FOUND',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  APPROVAL_NOT_FOUND = 'APPROVAL_NOT_FOUND',

  // 409 Conflict
  CONFLICT = 'CONFLICT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  ALREADY_RESOLVED = 'ALREADY_RESOLVED',
  STATE_CONFLICT = 'STATE_CONFLICT',

  // 410 Gone
  EXPIRED = 'EXPIRED',
  APPROVAL_EXPIRED = 'APPROVAL_EXPIRED',

  // 500 Internal Server Error
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  SERVICE_ERROR = 'SERVICE_ERROR',

  // 503 Service Unavailable
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  AGENT_BUSY = 'AGENT_BUSY',
  BC_UNAVAILABLE = 'BC_UNAVAILABLE',
}
```

### 3.3 Standard Error Response Format

```typescript
/**
 * Standard API Error Response
 *
 * All error responses follow this format for consistency.
 * API clients can programmatically handle errors using the `code` field.
 */
export interface ApiErrorResponse {
  /** HTTP status category (e.g., "Bad Request", "Not Found") */
  error: string;

  /** Human-readable error message (safe for display) */
  message: string;

  /** Machine-readable error code for programmatic handling */
  code: ErrorCode;

  /** Optional: Additional details (never includes sensitive data) */
  details?: Record<string, string | number | boolean>;

  /** Optional: Request ID for support/debugging */
  requestId?: string;
}
```

### 3.4 Error Messages Mapping

```typescript
/**
 * Standardized error messages
 *
 * Rules:
 * 1. Sentence case (capitalize first word only)
 * 2. No trailing periods
 * 3. No internal details exposed
 * 4. Multi-tenant safe (no user IDs, session IDs)
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // 400
  [ErrorCode.BAD_REQUEST]: 'Invalid request',
  [ErrorCode.VALIDATION_ERROR]: 'Request validation failed',
  [ErrorCode.INVALID_PARAMETER]: 'Invalid parameter value',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Required field is missing',
  [ErrorCode.PARAMETER_OUT_OF_RANGE]: 'Parameter value is out of allowed range',

  // 401
  [ErrorCode.UNAUTHORIZED]: 'Authentication required',
  [ErrorCode.SESSION_EXPIRED]: 'Session has expired',
  [ErrorCode.INVALID_TOKEN]: 'Invalid or expired token',

  // 403
  [ErrorCode.FORBIDDEN]: 'Access denied',
  [ErrorCode.ACCESS_DENIED]: 'You do not have access to this resource',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions for this action',

  // 404
  [ErrorCode.NOT_FOUND]: 'Resource not found',
  [ErrorCode.SESSION_NOT_FOUND]: 'Session not found',
  [ErrorCode.USER_NOT_FOUND]: 'User not found',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'The requested resource was not found',
  [ErrorCode.APPROVAL_NOT_FOUND]: 'Approval request not found',

  // 409
  [ErrorCode.CONFLICT]: 'Resource conflict',
  [ErrorCode.ALREADY_EXISTS]: 'Resource already exists',
  [ErrorCode.ALREADY_RESOLVED]: 'This request has already been processed',
  [ErrorCode.STATE_CONFLICT]: 'Operation conflicts with current state',

  // 410
  [ErrorCode.EXPIRED]: 'Resource has expired',
  [ErrorCode.APPROVAL_EXPIRED]: 'Approval request has expired',

  // 500
  [ErrorCode.INTERNAL_ERROR]: 'An internal error occurred',
  [ErrorCode.DATABASE_ERROR]: 'A database error occurred',
  [ErrorCode.SERVICE_ERROR]: 'A service error occurred',

  // 503
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
  [ErrorCode.AGENT_BUSY]: 'Agent is currently processing another request',
  [ErrorCode.BC_UNAVAILABLE]: 'Business Central is temporarily unavailable',
};
```

### 3.5 HTTP Status Code Mapping

```typescript
/**
 * HTTP status codes for each error code
 * Ensures consistent status code usage
 */
export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  // 400 Bad Request
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_PARAMETER]: 400,
  [ErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ErrorCode.PARAMETER_OUT_OF_RANGE]: 400,

  // 401 Unauthorized
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,

  // 403 Forbidden
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.ACCESS_DENIED]: 403,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,

  // 404 Not Found
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.SESSION_NOT_FOUND]: 404,
  [ErrorCode.USER_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.APPROVAL_NOT_FOUND]: 404,

  // 409 Conflict
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.ALREADY_RESOLVED]: 409,
  [ErrorCode.STATE_CONFLICT]: 409,

  // 410 Gone
  [ErrorCode.EXPIRED]: 410,
  [ErrorCode.APPROVAL_EXPIRED]: 410,

  // 500 Internal Server Error
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.SERVICE_ERROR]: 500,

  // 503 Service Unavailable
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.AGENT_BUSY]: 503,
  [ErrorCode.BC_UNAVAILABLE]: 503,
};
```

### 3.6 Error Response Helper

```typescript
// utils/error-response.ts

import { Response } from 'express';
import {
  ErrorCode,
  ERROR_MESSAGES,
  ERROR_STATUS_CODES,
  HTTP_STATUS_NAMES
} from '@/constants/errors';
import { ApiErrorResponse } from '@/types/error.types';

/**
 * Send standardized error response
 *
 * @param res - Express response object
 * @param code - ErrorCode enum value
 * @param customMessage - Optional: Override default message
 * @param details - Optional: Additional error details
 * @returns void (sends response)
 *
 * @example
 * // Basic usage
 * sendError(res, ErrorCode.NOT_FOUND);
 *
 * @example
 * // With custom message
 * sendError(res, ErrorCode.VALIDATION_ERROR, 'Email format is invalid');
 *
 * @example
 * // With details
 * sendError(res, ErrorCode.PARAMETER_OUT_OF_RANGE, undefined, {
 *   field: 'months',
 *   min: 1,
 *   max: 24
 * });
 */
export function sendError(
  res: Response,
  code: ErrorCode,
  customMessage?: string,
  details?: Record<string, string | number | boolean>
): void {
  const statusCode = ERROR_STATUS_CODES[code];
  const message = customMessage ?? ERROR_MESSAGES[code];

  const response: ApiErrorResponse = {
    error: HTTP_STATUS_NAMES[statusCode],
    message,
    code,
  };

  if (details) {
    response.details = details;
  }

  res.status(statusCode).json(response);
}

/**
 * Create error response object without sending
 * Useful for testing or composing responses
 */
export function createErrorResponse(
  code: ErrorCode,
  customMessage?: string,
  details?: Record<string, string | number | boolean>
): { statusCode: number; body: ApiErrorResponse } {
  const statusCode = ERROR_STATUS_CODES[code];
  const message = customMessage ?? ERROR_MESSAGES[code];

  const body: ApiErrorResponse = {
    error: HTTP_STATUS_NAMES[statusCode],
    message,
    code,
  };

  if (details) {
    body.details = details;
  }

  return { statusCode, body };
}
```

---

## 4. Migration Strategy

### 4.1 Phase 1: Create New Files (Non-Breaking)

1. Create `backend/src/constants/errors.ts`
2. Create `backend/src/types/error.types.ts`
3. Create `backend/src/utils/error-response.ts`
4. Add unit tests for new utilities

### 4.2 Phase 2: Migrate Routes (Breaking Change)

Routes to migrate in order of complexity:

| Priority | Route File | Endpoints | Current Errors | Notes |
|----------|------------|-----------|----------------|-------|
| 1 | `logs.ts` | 1 | 2 | Simple, good test case |
| 2 | `token-usage.ts` | 6 | 12 | Well-structured |
| 3 | `sessions.ts` | 6 | 15 | Complex transforms |
| 4 | `auth-oauth.ts` | 6 | 14 | OAuth edge cases |
| 5 | `server.ts` (inline) | 15+ | 25+ | Most complex |

### 4.3 Breaking Changes Justification

| Change | Before | After | Justification |
|--------|--------|-------|---------------|
| Add `code` field | `{ error, message }` | `{ error, message, code }` | Enables programmatic error handling |
| Standardize messages | Inconsistent | Consistent | Better UX, easier testing |
| Remove internal details | `error.message` exposed | Generic messages | Security (no stack traces) |

---

## 5. Testing Strategy

### 5.1 Unit Tests for Error Utilities

```typescript
// __tests__/unit/utils/error-response.test.ts

describe('sendError', () => {
  it('should send correct status code for each error code', () => {});
  it('should include error code in response body', () => {});
  it('should use default message when custom not provided', () => {});
  it('should use custom message when provided', () => {});
  it('should include details when provided', () => {});
  it('should not include details when not provided', () => {});
});

describe('createErrorResponse', () => {
  it('should create response object without sending', () => {});
  it('should return correct statusCode and body', () => {});
});
```

### 5.2 Integration Tests for Routes

Each route file will need updated assertions:

```typescript
// Before
expect(response.body).toEqual({
  error: 'Not Found',
  message: 'Session not found',
});

// After
expect(response.body).toEqual({
  error: 'Not Found',
  message: 'Session not found',
  code: 'SESSION_NOT_FOUND',
});
```

---

## 6. Rollback Plan

If issues are discovered post-deployment:

1. **Revert to previous code** - All changes are in isolated files
2. **Feature flag** (optional) - Can add `USE_NEW_ERROR_FORMAT` env var
3. **Backward compatible** - `code` field is additive, won't break existing clients

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| All routes using `sendError` | 100% | Grep for `res.status(...).json` |
| Test coverage for error utils | >95% | Vitest coverage report |
| No `error.message` exposure | 0 occurrences | Grep for pattern |
| Consistent error format | 100% | All responses have `code` field |
| Build passes | Yes | `npm run build` |
| Lint passes | Yes | `npm run lint` |
| Type-check passes | Yes | `npm run type-check` |

---

## 8. Appendix: HTTP Status Name Mapping

```typescript
export const HTTP_STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};
```

---

## 9. Approval

| Role | Name | Date | Status |
|------|------|------|--------|
| Architect | Claude Code | 2025-11-25 | APPROVED |
| QA Master | Pending | - | - |
| Tech Lead | Pending | - | - |
