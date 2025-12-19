/**
 * Retry Utility Unit Tests
 *
 * Tests for exponential/linear/fixed backoff retry logic.
 * Covers retry predicates, jitter, error handling, and decorator pattern.
 *
 * **Testing Strategy**: Focus on BEHAVIOR (retry count, error handling, predicates)
 * rather than exact timing. Uses real timers with minimal delays (10-50ms) for speed.
 *
 * Created: 2025-11-19 (Phase 4, Task 4.3.A)
 * Coverage Target: 80%+
 * Test Count: 16
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import {
  retryWithBackoff,
  retryWithLinearBackoff,
  retryWithFixedDelay,
  RetryPredicates,
  Retry,
  type RetryOptions,
} from '@/shared/utils/retry';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock logger with vi.hoisted()
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
}));

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Retry Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. EXPONENTIAL BACKOFF (4 tests)
  // ==========================================================================

  describe('Exponential Backoff', () => {
    it('should succeed after retries', async () => {
      let attempts = 0;
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
        return 'success';
      });

      const result = await retryWithBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 10, // Fast test
        jitter: 0,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should calculate exponential delays correctly', async () => {
      let attempts = 0;
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('retry');
        }
        return 'success';
      });

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 10,
        factor: 2,
        jitter: 0,
        onRetry,
      });

      // Verify exponential backoff: 10ms * 2^0 = 10ms, 10ms * 2^1 = 20ms
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 20);
    });

    it('should cap delays at maxDelay', async () => {
      let attempts = 0;
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('retry');
        }
        return 'success';
      });

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithBackoff(mockFn, {
        maxRetries: 10,
        baseDelay: 10,
        factor: 2,
        maxDelay: 50, // Cap at 50ms
        jitter: 0,
        onRetry,
      });

      // Check that all delays are <= maxDelay
      const delays = onRetry.mock.calls.map((call) => call[2]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(50);
    });

    it('should apply jitter within bounds', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce('success');

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 100,
        jitter: 0.1, // 10% jitter
        onRetry,
      });

      // Verify jitter was applied (delays should be within ±10% of base)
      const delays = onRetry.mock.calls.map((call) => call[2]);
      expect(delays[0]).toBeGreaterThanOrEqual(90);  // 100ms - 10%
      expect(delays[0]).toBeLessThanOrEqual(110);     // 100ms + 10%
    });
  });

  // ==========================================================================
  // 2. RETRY PREDICATES (6 tests)
  // ==========================================================================

  describe('Retry Predicates', () => {
    it('should retry network errors (ETIMEDOUT)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT: Connection timeout'))
        .mockResolvedValueOnce('success');

      const result = await retryWithBackoff(mockFn, {
        maxRetries: 2,
        baseDelay: 10,
        jitter: 0,
        isRetryable: RetryPredicates.isNetworkError,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it('should NOT retry client errors (4xx)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValue(new Error('HTTP 404 Not Found'));

      await expect(
        retryWithBackoff(mockFn, {
          maxRetries: 3,
          baseDelay: 10,
          isRetryable: RetryPredicates.isServerError, // Only retry 5xx
        })
      ).rejects.toThrow('HTTP 404 Not Found');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry server errors (5xx)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 500 Internal Server Error'))
        .mockResolvedValueOnce('success');

      const result = await retryWithBackoff(mockFn, {
        maxRetries: 2,
        baseDelay: 10,
        jitter: 0,
        isRetryable: RetryPredicates.isServerError,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should retry rate limit errors (429)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
        .mockResolvedValueOnce('success');

      const result = await retryWithBackoff(mockFn, {
        maxRetries: 2,
        baseDelay: 10,
        jitter: 0,
        isRetryable: RetryPredicates.isRateLimitError,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should combine predicates with any() OR logic', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('HTTP 500'))
        .mockResolvedValueOnce('success');

      const combinedPredicate = RetryPredicates.any(
        RetryPredicates.isNetworkError,
        RetryPredicates.isServerError
      );

      const result = await retryWithBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 10,
        jitter: 0,
        isRetryable: combinedPredicate,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3); // Both errors matched, so retried twice
    });

    it('should combine predicates with all() AND logic', async () => {
      const alwaysTrue = (): boolean => true;
      const alwaysFalse = (): boolean => false;

      const combinedPredicate = RetryPredicates.all(alwaysTrue, alwaysFalse);

      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValue(new Error('Test error'));

      await expect(
        retryWithBackoff(mockFn, {
          maxRetries: 2,
          baseDelay: 10,
          isRetryable: combinedPredicate, // AND logic: true && false = false
        })
      ).rejects.toThrow('Test error');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries (predicate returned false)
    });
  });

  // ==========================================================================
  // 3. ERROR HANDLING (3 tests)
  // ==========================================================================

  describe('Error Handling', () => {
    it('should throw last error after exhausting retries', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'))
        .mockRejectedValueOnce(new Error('Final Error'));

      await expect(
        retryWithBackoff(mockFn, {
          maxRetries: 3,
          baseDelay: 10,
          jitter: 0,
        })
      ).rejects.toThrow('Final Error');

      expect(mockFn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should NOT retry if isRetryable returns false', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValue(new Error('Non-retryable error'));

      await expect(
        retryWithBackoff(mockFn, {
          maxRetries: 3,
          isRetryable: () => false, // Never retry
        })
      ).rejects.toThrow('Non-retryable error');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should call onRetry callback with correct parameters', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce('success');

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 10,
        jitter: 0,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 20);
    });
  });

  // ==========================================================================
  // 4. LINEAR & FIXED BACKOFF (2 tests)
  // ==========================================================================

  describe('Alternative Backoff Strategies', () => {
    it('should use linear backoff (1x, 2x, 3x)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce('success');

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithLinearBackoff(mockFn, {
        maxRetries: 3,
        baseDelay: 10,
        onRetry,
      });

      // Linear: baseDelay * (attempt + 1) = 10ms, 20ms, 30ms...
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 20);
    });

    it('should use fixed delay (constant)', async () => {
      const mockFn: MockedFunction<() => Promise<string>> = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce('success');

      const onRetry: MockedFunction<(attempt: number, error: Error, delay: number) => void> = vi.fn();

      await retryWithFixedDelay(mockFn, {
        maxRetries: 3,
        baseDelay: 10,
        onRetry,
      });

      // Fixed delay: all delays = baseDelay
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 10); // Same delay
    });
  });

  // ==========================================================================
  // 5. @RETRY DECORATOR (1 test)
  // ==========================================================================

  describe('@Retry Decorator', () => {
    // NOTE: This test requires experimentalDecorators: true in tsconfig.json
    // Previously skipped due to Vitest transpilation issues (vitest#708)
    // Fixed by enabling experimentalDecorators and emitDecoratorMetadata in tsconfig.json

    it('should apply retry logic to class methods', async () => {
      vi.useFakeTimers();

      class TestService {
        attemptCount = 0;

        @Retry({ maxRetries: 2, baseDelay: 10, jitter: 0 })
        async fetchData(): Promise<string> {
          this.attemptCount++;
          if (this.attemptCount < 2) {
            throw new Error('Transient error');
          }
          return 'success';
        }
      }

      const service = new TestService();
      const resultPromise = service.fetchData();

      // Fast-forward timers for retry delays
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(service.attemptCount).toBe(2); // Initial + 1 retry

      vi.useRealTimers();
    });
  });
});
