/**
 * Retry Utility
 *
 * Provides exponential backoff retry logic for unreliable operations.
 * Useful for network calls, database operations, external APIs, etc.
 *
 * @module utils/retry
 */

import { logger } from './logger';

/**
 * Retry Options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;

  /** Maximum delay cap in milliseconds (default: 10000) */
  maxDelay?: number;

  /** Exponential factor (default: 2 for exponential backoff) */
  factor?: number;

  /** Jitter factor (0-1, adds randomness to prevent thundering herd, default: 0.1) */
  jitter?: number;

  /** Predicate function to determine if error is retryable (default: retry all errors) */
  isRetryable?: (error: Error) => boolean;

  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, nextDelay: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  factor: 2,
  jitter: 0.1,
  isRetryable: () => true,
  onRetry: (attempt, error, nextDelay) => {
    logger.warn('Retrying operation', {
      attempt,
      error: error.message,
      nextDelayMs: nextDelay,
    });
  },
};

/**
 * Retry with Exponential Backoff
 *
 * Executes a function with automatic retry and exponential backoff.
 *
 * Delay calculation:
 * - Attempt 1: baseDelay
 * - Attempt 2: baseDelay * factor
 * - Attempt 3: baseDelay * factor^2
 * - etc., capped at maxDelay
 *
 * Jitter adds randomness to prevent thundering herd:
 * - actualDelay = delay * (1 - jitter + random(0, 2 * jitter))
 *
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Promise that resolves with function result
 * @throws Last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * // Retry fetch with exponential backoff
 * const data = await retryWithBackoff(
 *   async () => {
 *     const response = await fetch('https://api.example.com/data');
 *     if (!response.ok) throw new Error('HTTP error');
 *     return response.json();
 *   },
 *   {
 *     maxRetries: 5,
 *     baseDelay: 1000,
 *     isRetryable: (error) => error.message.includes('timeout'),
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      // Try executing the function
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const isLastAttempt = attempt === opts.maxRetries;
      const shouldRetry = opts.isRetryable(lastError);

      if (isLastAttempt || !shouldRetry) {
        // No more retries or error is not retryable
        throw lastError;
      }

      // Calculate next delay with exponential backoff
      const exponentialDelay = opts.baseDelay * Math.pow(opts.factor, attempt);
      const cappedDelay = Math.min(exponentialDelay, opts.maxDelay);

      // Add jitter to prevent thundering herd
      const jitterAmount = cappedDelay * opts.jitter;
      const jitterRange = jitterAmount * 2;
      const jitter = Math.random() * jitterRange - jitterAmount;
      const delay = Math.max(0, Math.round(cappedDelay + jitter));

      // Call onRetry callback
      opts.onRetry(attempt + 1, lastError, delay);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!;
}

/**
 * Retry with Linear Backoff
 *
 * Similar to retryWithBackoff but uses linear delay increase instead of exponential.
 *
 * Delay calculation:
 * - Attempt 1: baseDelay
 * - Attempt 2: baseDelay * 2
 * - Attempt 3: baseDelay * 3
 * - etc.
 *
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Promise that resolves with function result
 */
export async function retryWithLinearBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options, factor: 1 };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt === opts.maxRetries;
      const shouldRetry = opts.isRetryable(lastError);

      if (isLastAttempt || !shouldRetry) {
        throw lastError;
      }

      // Linear backoff: baseDelay * (attempt + 1)
      const delay = Math.min(opts.baseDelay * (attempt + 1), opts.maxDelay);

      opts.onRetry(attempt + 1, lastError, delay);

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Retry with Fixed Delay
 *
 * Retries with a fixed delay between attempts (no backoff).
 *
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Promise that resolves with function result
 */
export async function retryWithFixedDelay<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt === opts.maxRetries;
      const shouldRetry = opts.isRetryable(lastError);

      if (isLastAttempt || !shouldRetry) {
        throw lastError;
      }

      opts.onRetry(attempt + 1, lastError, opts.baseDelay);

      await sleep(opts.baseDelay);
    }
  }

  throw lastError!;
}

/**
 * Common Retry Predicates
 *
 * Predefined functions to determine if an error is retryable.
 */
export const RetryPredicates = {
  /**
   * Retry network errors (ETIMEDOUT, ECONNREFUSED, etc.)
   */
  isNetworkError: (error: Error): boolean => {
    const networkErrors = [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'ENETUNREACH',
      'EAI_AGAIN',
    ];
    return networkErrors.some((code) => error.message.includes(code));
  },

  /**
   * Retry HTTP 5xx server errors (but not 4xx client errors)
   */
  isServerError: (error: Error): boolean => {
    const match = error.message.match(/HTTP (\d{3})/);
    if (!match || !match[1]) return false;  // ⭐ Validate match[1] exists
    const statusCode = parseInt(match[1], 10);
    return statusCode >= 500 && statusCode < 600;
  },

  /**
   * Retry HTTP 429 (rate limit) errors
   */
  isRateLimitError: (error: Error): boolean => {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
  },

  /**
   * Retry transient database errors
   */
  isDatabaseError: (error: Error): boolean => {
    const dbErrors = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'connection timeout',
      'deadlock',
      'lock timeout',
    ];
    return dbErrors.some((code) => error.message.toLowerCase().includes(code.toLowerCase()));
  },

  /**
   * Combine multiple predicates with OR logic
   */
  any: (...predicates: Array<(error: Error) => boolean>) => {
    return (error: Error): boolean => predicates.some((pred) => pred(error));
  },

  /**
   * Combine multiple predicates with AND logic
   */
  all: (...predicates: Array<(error: Error) => boolean>) => {
    return (error: Error): boolean => predicates.every((pred) => pred(error));
  },
};

/**
 * Sleep Helper
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry decorator (for class methods)
 *
 * @param options - Retry options
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class ApiClient {
 *   @Retry({ maxRetries: 3, baseDelay: 1000 })
 *   async fetchData(): Promise<Data> {
 *     const response = await fetch('https://api.example.com/data');
 *     return response.json();
 *   }
 * }
 * ```
 */
export function Retry(options?: RetryOptions) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return retryWithBackoff(
        () => originalMethod.apply(this, args),
        options
      );
    };

    return descriptor;
  };
}
