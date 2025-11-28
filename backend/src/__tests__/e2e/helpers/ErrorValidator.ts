/**
 * ErrorValidator - Validates Error Responses in E2E Tests
 *
 * Provides utilities for validating that error responses have the
 * correct structure, status codes, and messages.
 *
 * @module __tests__/e2e/helpers/ErrorValidator
 */

import type { E2EHttpResponse } from './E2ETestClient';

/**
 * Expected error structure
 */
export interface ExpectedError {
  status: number;
  code?: string;
  messageContains?: string;
  hasField?: string;
  bodyContains?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ErrorValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Standard error response structure
 */
export interface StandardErrorResponse {
  error?: string;
  message?: string;
  code?: string;
  timestamp?: string;
  details?: unknown;
  field?: string;
  resource?: string;
}

/**
 * ErrorValidator - Validates error responses
 */
export class ErrorValidator {
  /**
   * Validate a 400 Bad Request response
   */
  static validateBadRequest(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      field?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 400,
      code: expected?.code || 'INVALID_INPUT',
      messageContains: expected?.messageContains,
      hasField: expected?.field ? 'field' : undefined,
    });
  }

  /**
   * Validate a 401 Unauthorized response
   */
  static validateUnauthorized(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 401,
      code: expected?.code || 'UNAUTHORIZED',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Validate a 403 Forbidden response
   */
  static validateForbidden(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 403,
      code: expected?.code || 'FORBIDDEN',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Validate a 404 Not Found response
   */
  static validateNotFound(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      resource?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 404,
      code: expected?.code || 'NOT_FOUND',
      messageContains: expected?.messageContains,
      bodyContains: expected?.resource ? { resource: expected.resource } : undefined,
    });
  }

  /**
   * Validate a 413 Payload Too Large response
   */
  static validatePayloadTooLarge(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 413,
      code: expected?.code || 'PAYLOAD_TOO_LARGE',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Validate a 415 Unsupported Media Type response
   */
  static validateUnsupportedMediaType(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 415,
      code: expected?.code || 'UNSUPPORTED_MEDIA_TYPE',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Validate a 429 Too Many Requests response
   */
  static validateTooManyRequests(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
      hasRetryAfter?: boolean;
    }
  ): ErrorValidationResult {
    const result = this.validateError(response, {
      status: 429,
      code: expected?.code || 'RATE_LIMIT_EXCEEDED',
      messageContains: expected?.messageContains,
    });

    if (expected?.hasRetryAfter) {
      const retryAfter = response.headers.get('Retry-After');
      if (!retryAfter) {
        result.errors.push('Expected Retry-After header but not found');
        result.valid = false;
      }
    }

    return result;
  }

  /**
   * Validate a 500 Internal Server Error response
   */
  static validateInternalError(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
      noStackTrace?: boolean;
    }
  ): ErrorValidationResult {
    const result = this.validateError(response, {
      status: 500,
      code: expected?.code || 'INTERNAL_ERROR',
      messageContains: expected?.messageContains,
    });

    // Ensure no stack trace is leaked
    if (expected?.noStackTrace !== false) {
      const body = response.body;
      const bodyStr = JSON.stringify(body);
      if (bodyStr.includes('at ') && bodyStr.includes('.ts:')) {
        result.errors.push('Stack trace leaked in error response');
        result.valid = false;
      }
    }

    return result;
  }

  /**
   * Validate a 502 Bad Gateway response
   */
  static validateBadGateway(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 502,
      code: expected?.code || 'BAD_GATEWAY',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Validate a 503 Service Unavailable response
   */
  static validateServiceUnavailable(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    return this.validateError(response, {
      status: 503,
      code: expected?.code || 'SERVICE_UNAVAILABLE',
      messageContains: expected?.messageContains,
    });
  }

  /**
   * Generic error validation
   */
  static validateError(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected: ExpectedError
  ): ErrorValidationResult {
    const errors: string[] = [];

    // Check status code
    if (response.status !== expected.status) {
      errors.push(
        `Expected status ${expected.status} but got ${response.status}`
      );
    }

    const body = response.body;

    // Check error code
    if (expected.code) {
      const actualCode = body.code || body.error;
      if (actualCode !== expected.code) {
        errors.push(
          `Expected error code '${expected.code}' but got '${actualCode}'`
        );
      }
    }

    // Check message contains
    if (expected.messageContains) {
      const message = body.message || body.error || '';
      if (!message.toLowerCase().includes(expected.messageContains.toLowerCase())) {
        errors.push(
          `Expected message to contain '${expected.messageContains}' but got '${message}'`
        );
      }
    }

    // Check has field
    if (expected.hasField) {
      if (!(expected.hasField in body)) {
        errors.push(`Expected field '${expected.hasField}' in response body`);
      }
    }

    // Check body contains
    if (expected.bodyContains) {
      for (const [key, value] of Object.entries(expected.bodyContains)) {
        const actualValue = (body as Record<string, unknown>)[key];
        if (actualValue !== value) {
          errors.push(
            `Expected body.${key} = '${value}' but got '${actualValue}'`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a WebSocket error event
   */
  static validateWebSocketError(
    event: { type: string; code?: string; error?: string; message?: string },
    expected?: {
      code?: string;
      messageContains?: string;
    }
  ): ErrorValidationResult {
    const errors: string[] = [];

    // Check it's an error event
    if (event.type !== 'error') {
      errors.push(`Expected error event but got '${event.type}'`);
    }

    // Check error code
    if (expected?.code && event.code !== expected.code) {
      errors.push(
        `Expected error code '${expected.code}' but got '${event.code}'`
      );
    }

    // Check message contains
    if (expected?.messageContains) {
      const message = event.message || event.error || '';
      if (!message.toLowerCase().includes(expected.messageContains.toLowerCase())) {
        errors.push(
          `Expected message to contain '${expected.messageContains}' but got '${message}'`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Assert error is valid (throws on failure)
   */
  static assertValidError(
    response: E2EHttpResponse<StandardErrorResponse>,
    expected: ExpectedError
  ): void {
    const result = this.validateError(response, expected);
    if (!result.valid) {
      throw new Error(`Error validation failed:\n${result.errors.join('\n')}`);
    }
  }

  /**
   * Check if response is an error (4xx or 5xx)
   */
  static isError(response: E2EHttpResponse): boolean {
    return response.status >= 400;
  }

  /**
   * Check if response is a client error (4xx)
   */
  static isClientError(response: E2EHttpResponse): boolean {
    return response.status >= 400 && response.status < 500;
  }

  /**
   * Check if response is a server error (5xx)
   */
  static isServerError(response: E2EHttpResponse): boolean {
    return response.status >= 500;
  }
}
