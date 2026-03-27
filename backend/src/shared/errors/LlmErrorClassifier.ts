/**
 * LLM Error Classifier
 *
 * Centralized error classification for LLM provider errors.
 * Detects Anthropic SDK error types (via instanceof and string fallback for LangChain-wrapped errors)
 * and maps them to user-friendly ErrorCodes with retry metadata.
 *
 * @module shared/errors/LlmErrorClassifier
 */

import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  RateLimitError,
  AuthenticationError,
  BadRequestError,
} from '@anthropic-ai/sdk';
import { ErrorCode, ERROR_MESSAGES } from '@bc-agent/shared';

/**
 * Classified LLM error with user-friendly message and retry metadata.
 */
export interface ClassifiedLlmError {
  /** Machine-readable error code */
  code: ErrorCode;
  /** User-friendly message (no JSON, no status codes, no stack traces) */
  userMessage: string;
  /** Technical message for logging/debugging */
  technicalMessage: string;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Suggested delay in ms before retrying */
  retryAfterMs?: number;
}

/**
 * Parse retry-after header value to milliseconds.
 * Handles both seconds (numeric) and date formats.
 */
function parseRetryAfterMs(headers: Record<string, string | undefined> | undefined): number | undefined {
  const retryAfter = headers?.['retry-after'];
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (!isNaN(seconds)) {
    return Math.ceil(seconds * 1000);
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return undefined;
}

/**
 * Classify an error from LLM execution into a user-friendly error with retry metadata.
 *
 * Detection order (inheritance matters — check subclasses before base classes):
 * 0. ConnectionTokenExpiredError (connector error from mention resolution) → CONNECTION_TOKEN_EXPIRED
 * 1. AbortSignal TimeoutError → LLM_TIMEOUT
 * 2. APIConnectionTimeoutError (extends APIConnectionError) → LLM_TIMEOUT
 * 3. APIConnectionError → LLM_CONNECTION_ERROR
 * 4. RateLimitError (extends APIError) → LLM_RATE_LIMITED
 * 5. AuthenticationError (extends APIError) → LLM_AUTH_ERROR
 * 6. BadRequestError (extends APIError) → LLM_BAD_REQUEST
 * 7. APIError status=529 or type=overloaded_error → LLM_OVERLOADED
 * 8. APIError status>=500 → LLM_SERVER_ERROR
 * 9. String fallback for LangChain-wrapped errors
 * 10. Generic fallback → AGENT_EXECUTION_FAILED
 */
export function classifyLlmError(error: unknown): ClassifiedLlmError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // 0. Connection token expired (Microsoft Graph / OneDrive / SharePoint)
  // This is NOT an LLM error — it's a connector error that bubbled up from mention resolution.
  // Retryable: user reconnects via existing UI, then re-sends the message.
  if (error instanceof Error && error.name === 'ConnectionTokenExpiredError') {
    return {
      code: ErrorCode.CONNECTION_TOKEN_EXPIRED,
      userMessage: ERROR_MESSAGES[ErrorCode.CONNECTION_TOKEN_EXPIRED],
      technicalMessage: `Connection token expired: ${errorMessage}`,
      retryable: true,
    };
  }

  // 1. AbortSignal TimeoutError (DOMException with name "TimeoutError")
  // This is OUR pipeline timeout (AbortSignal.timeout()) — the agent was actively working.
  // NOT retryable: retrying restarts the entire agent execution (e.g., file analysis).
  // Different from APIConnectionTimeoutError which is a network-level timeout (retryable).
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return {
      code: ErrorCode.LLM_TIMEOUT,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_TIMEOUT],
      technicalMessage: `Request aborted: ${errorMessage}`,
      retryable: false,
    };
  }

  // Also catch AbortError from AbortSignal.abort() — pipeline cancellation.
  // Same rationale: this is our pipeline signal, not a transient network issue.
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: ErrorCode.LLM_TIMEOUT,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_TIMEOUT],
      technicalMessage: `Request aborted: ${errorMessage}`,
      retryable: false,
    };
  }

  // 2. APIConnectionTimeoutError (must check before APIConnectionError — it's a subclass)
  if (error instanceof APIConnectionTimeoutError) {
    return {
      code: ErrorCode.LLM_TIMEOUT,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_TIMEOUT],
      technicalMessage: `API connection timeout: ${errorMessage}`,
      retryable: true,
      retryAfterMs: 5000,
    };
  }

  // 3. APIConnectionError
  if (error instanceof APIConnectionError) {
    return {
      code: ErrorCode.LLM_CONNECTION_ERROR,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_CONNECTION_ERROR],
      technicalMessage: `API connection error: ${errorMessage}`,
      retryable: true,
      retryAfterMs: 3000,
    };
  }

  // 4. RateLimitError (must check before generic APIError — it's a subclass)
  if (error instanceof RateLimitError) {
    const retryAfterMs = parseRetryAfterMs(error.headers as unknown as Record<string, string | undefined>) ?? 30000;
    return {
      code: ErrorCode.LLM_RATE_LIMITED,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_RATE_LIMITED],
      technicalMessage: `Rate limited: ${errorMessage}`,
      retryable: true,
      retryAfterMs,
    };
  }

  // 5. AuthenticationError
  if (error instanceof AuthenticationError) {
    return {
      code: ErrorCode.LLM_AUTH_ERROR,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_AUTH_ERROR],
      technicalMessage: `Authentication error: ${errorMessage}`,
      retryable: false,
    };
  }

  // 6. BadRequestError
  if (error instanceof BadRequestError) {
    return {
      code: ErrorCode.LLM_BAD_REQUEST,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_BAD_REQUEST],
      technicalMessage: `Bad request: ${errorMessage}`,
      retryable: false,
    };
  }

  // 7-8. Generic APIError (check status and type)
  if (error instanceof APIError) {
    const apiError = error;

    // 7. Overloaded (status 529 or type overloaded_error)
    if (apiError.status === 529 || (apiError as unknown as Record<string, unknown>).type === 'overloaded_error') {
      return {
        code: ErrorCode.LLM_OVERLOADED,
        userMessage: ERROR_MESSAGES[ErrorCode.LLM_OVERLOADED],
        technicalMessage: `API overloaded (${apiError.status}): ${errorMessage}`,
        retryable: true,
        retryAfterMs: 15000,
      };
    }

    // 8. Server error (5xx)
    if (apiError.status && apiError.status >= 500) {
      return {
        code: ErrorCode.LLM_SERVER_ERROR,
        userMessage: ERROR_MESSAGES[ErrorCode.LLM_SERVER_ERROR],
        technicalMessage: `API server error (${apiError.status}): ${errorMessage}`,
        retryable: true,
        retryAfterMs: 10000,
      };
    }
  }

  // 9. String fallback for LangChain-wrapped errors
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes('overloaded') || lowerMessage.includes('529')) {
    return {
      code: ErrorCode.LLM_OVERLOADED,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_OVERLOADED],
      technicalMessage: `LLM overloaded (string match): ${errorMessage}`,
      retryable: true,
      retryAfterMs: 15000,
    };
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('too many requests')) {
    return {
      code: ErrorCode.LLM_RATE_LIMITED,
      userMessage: ERROR_MESSAGES[ErrorCode.LLM_RATE_LIMITED],
      technicalMessage: `Rate limited (string match): ${errorMessage}`,
      retryable: true,
      retryAfterMs: 30000,
    };
  }

  // 10. Generic fallback — not retryable by default.
  // Unknown errors should not trigger graph-level retries that re-execute entire agent pipelines.
  // The Anthropic SDK already retries transient API errors internally.
  return {
    code: ErrorCode.AGENT_EXECUTION_FAILED,
    userMessage: ERROR_MESSAGES[ErrorCode.AGENT_EXECUTION_FAILED],
    technicalMessage: errorMessage,
    retryable: false,
  };
}

/**
 * Predicate for use with retryWithBackoff's isRetryable option.
 * Returns true if the error is a retryable LLM error.
 */
export function isRetryableLlmError(error: Error): boolean {
  return classifyLlmError(error).retryable;
}
