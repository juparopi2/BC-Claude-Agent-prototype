/**
 * GraphRateLimiter Unit Tests (PRD-101 Step 3)
 *
 * Tests the token-bucket rate limiter scoped per Microsoft tenant.
 *
 * Covers:
 * - acquire(): immediate success when bucket is full, token decrement, per-tenant isolation
 * - onThrottled(): drains bucket, sets pausedUntil in the future
 * - Refill logic: tokens accumulate over elapsed time
 * - Timeout: acquire throws after 30 seconds with no tokens available
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks
import {
  GraphRateLimiter,
  __resetGraphRateLimiter,
} from '@/services/connectors/onedrive/GraphRateLimiter';

// ============================================================================
// CONSTANTS
// ============================================================================

const TENANT_A = 'TENANT-AAAAAAAA-1111-2222-3333-444455556666';
const TENANT_B = 'TENANT-BBBBBBBB-1111-2222-3333-444455556666';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Run an acquire that is expected to time out.
 *
 * The rejection handler must be registered BEFORE advancing fake timers,
 * otherwise Node emits "PromiseRejectionHandledWarning" (the promise was
 * already rejected by the time the `rejects` assertion attaches its handler).
 *
 * Pattern: attach `.catch` immediately, advance time, then check the error.
 */
async function expectAcquireTimeout(promise: Promise<void>, tenantId?: string): Promise<void> {
  // Attach rejection handler immediately so Node treats it as handled
  let caughtError: unknown;
  const caught = promise.catch(err => {
    caughtError = err;
  });

  // Let the event loop run the timeout
  await vi.advanceTimersByTimeAsync(31_000);
  await caught;

  expect(caughtError).toBeInstanceOf(Error);
  expect((caughtError as Error).message).toContain('timed out');
  if (tenantId) {
    expect((caughtError as Error).message).toContain(tenantId);
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('GraphRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGraphRateLimiter();
  });

  afterEach(() => {
    // Ensure real timers are always restored even if a test fails mid-way
    vi.useRealTimers();
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('Constructor', () => {
    it('accepts custom config without throwing', () => {
      expect(() => new GraphRateLimiter({ maxTokens: 10, refillRatePerMinute: 10 })).not.toThrow();
    });

    it('uses defaults when no config is provided', () => {
      expect(() => new GraphRateLimiter()).not.toThrow();
    });
  });

  // ==========================================================================
  // acquire()
  // ==========================================================================

  describe('acquire()', () => {
    it('acquires a token immediately when bucket is full (new tenant)', async () => {
      const limiter = new GraphRateLimiter({ maxTokens: 5, refillRatePerMinute: 60 });

      await expect(limiter.acquire(TENANT_A)).resolves.toBeUndefined();
    });

    it('decreases available tokens after each acquire', async () => {
      // Bucket of size 3 with no refill so we can drain it deterministically
      const limiter = new GraphRateLimiter({ maxTokens: 3, refillRatePerMinute: 0 });

      await limiter.acquire(TENANT_A);
      await limiter.acquire(TENANT_A);
      await limiter.acquire(TENANT_A);

      // Bucket is now empty — next acquire must time out
      vi.useFakeTimers();
      await expectAcquireTimeout(limiter.acquire(TENANT_A));
    });

    it('creates separate independent buckets per tenant', async () => {
      // One token each, no refill
      const limiter = new GraphRateLimiter({ maxTokens: 1, refillRatePerMinute: 0 });

      // First acquire for each tenant succeeds independently
      await expect(limiter.acquire(TENANT_A)).resolves.toBeUndefined();
      await expect(limiter.acquire(TENANT_B)).resolves.toBeUndefined();

      // Both are now exhausted — each subsequent acquire should time out
      vi.useFakeTimers();

      const promiseA = limiter.acquire(TENANT_A);
      const promiseB = limiter.acquire(TENANT_B);

      // Attach handlers before advancing time
      let errorA: unknown;
      let errorB: unknown;
      const caughtA = promiseA.catch(err => { errorA = err; });
      const caughtB = promiseB.catch(err => { errorB = err; });

      await vi.advanceTimersByTimeAsync(31_000);
      await caughtA;
      await caughtB;

      expect((errorA as Error).message).toContain('timed out');
      expect((errorB as Error).message).toContain('timed out');
    });
  });

  // ==========================================================================
  // onThrottled()
  // ==========================================================================

  describe('onThrottled()', () => {
    it('drains the bucket to zero tokens', async () => {
      const limiter = new GraphRateLimiter({ maxTokens: 100, refillRatePerMinute: 0 });

      // Signal throttle — bucket drained, pause set for 60 seconds
      limiter.onThrottled(TENANT_A, 60_000);

      // Bucket is empty and paused: acquire should block and eventually time out
      vi.useFakeTimers();
      await expectAcquireTimeout(limiter.acquire(TENANT_A));
    });

    it('sets pausedUntil in the future so subsequent acquires are blocked', async () => {
      const limiter = new GraphRateLimiter({ maxTokens: 5, refillRatePerMinute: 0 });

      // Throttle with a 10-second pause
      limiter.onThrottled(TENANT_A, 10_000);

      vi.useFakeTimers();

      // Acquire should be blocked during and after the pause (no refill either)
      await expectAcquireTimeout(limiter.acquire(TENANT_A));
    });
  });

  // ==========================================================================
  // Refill logic
  // ==========================================================================

  describe('Refill logic', () => {
    it('refills tokens over time so a previously empty bucket can be acquired from', async () => {
      // 60 tokens per minute = 1 token per second
      const limiter = new GraphRateLimiter({ maxTokens: 5, refillRatePerMinute: 60 });

      vi.useFakeTimers();

      // Drain the bucket completely (5 acquires)
      for (let i = 0; i < 5; i++) {
        await limiter.acquire(TENANT_A);
      }

      // Advance time by 5 seconds — should refill ~5 tokens
      await vi.advanceTimersByTimeAsync(5_000);

      // Acquire should now succeed because tokens have been refilled
      await expect(limiter.acquire(TENANT_A)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Timeout
  // ==========================================================================

  describe('Timeout', () => {
    it('throws with "timed out" message when no tokens are available within 30 seconds', async () => {
      vi.useFakeTimers();

      // maxTokens=0 → bucket starts empty; refillRatePerMinute=0 → no refill ever
      const limiter = new GraphRateLimiter({ maxTokens: 0, refillRatePerMinute: 0 });

      await expectAcquireTimeout(limiter.acquire(TENANT_A));
    });

    it('includes the tenant ID in the timeout error message', async () => {
      vi.useFakeTimers();

      const limiter = new GraphRateLimiter({ maxTokens: 0, refillRatePerMinute: 0 });

      await expectAcquireTimeout(limiter.acquire(TENANT_A), TENANT_A);
    });
  });
});
