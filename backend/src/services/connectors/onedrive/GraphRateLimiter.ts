/**
 * GraphRateLimiter (PRD-101 Step 3)
 *
 * In-memory token-bucket rate limiter scoped per Microsoft tenant.
 *
 * Design:
 *  - Each tenant gets its own bucket, created lazily on first use.
 *  - Tokens refill continuously at `refillRatePerMinute / 60_000` per millisecond.
 *  - `acquire()` waits (polls) until a token is available, with a 30-second
 *    hard timeout to prevent callers from hanging indefinitely.
 *  - `onThrottled()` is called by GraphHttpClient on a 429 response to drain
 *    the bucket, forcing subsequent acquires to wait for natural refill.
 *  - Logs a warning when a tenant's bucket drops below 20% capacity.
 *  - Singleton via getGraphRateLimiter() / __resetGraphRateLimiter().
 *
 * @module services/connectors/onedrive
 */

import { createChildLogger } from '@/shared/utils/logger';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 2500;
const DEFAULT_REFILL_RATE_PER_MINUTE = 2500;

/** Maximum time acquire() will wait before throwing. */
const ACQUIRE_TIMEOUT_MS = 30_000;

/** How often the polling loop wakes up to check token availability. */
const POLL_INTERVAL_MS = 100;

/** Warn when available tokens drop below this fraction of maxTokens. */
const WARN_CAPACITY_THRESHOLD = 0.2;

const logger = createChildLogger({ service: 'GraphRateLimiter' });

// ============================================================================
// Types
// ============================================================================

interface BucketConfig {
  maxTokens: number;
  refillRatePerMinute: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  /** When non-null, no tokens will be issued until this timestamp. */
  pausedUntil: number | null;
}

// ============================================================================
// GraphRateLimiter
// ============================================================================

export class GraphRateLimiter {
  private readonly maxTokens: number;
  private readonly refillRatePerMinute: number;

  /** Tokens added per millisecond (derived from refillRatePerMinute). */
  private readonly refillRatePerMs: number;

  /** Lazy-initialised bucket map: tenantId → Bucket */
  private readonly buckets = new Map<string, Bucket>();

  constructor(config?: BucketConfig) {
    this.maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.refillRatePerMinute = config?.refillRatePerMinute ?? DEFAULT_REFILL_RATE_PER_MINUTE;
    this.refillRatePerMs = this.refillRatePerMinute / 60_000;

    logger.info(
      { maxTokens: this.maxTokens, refillRatePerMinute: this.refillRatePerMinute },
      'GraphRateLimiter initialised'
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Acquire one token for the given tenant.
   *
   * Blocks (polls with async sleep) until a token is available.
   * Throws if the tenant's bucket remains empty for more than 30 seconds.
   *
   * @param tenantId  The Azure AD tenant ID (UPPERCASE as per convention).
   * @throws          {Error} if no token becomes available within 30 seconds.
   */
  async acquire(tenantId: string): Promise<void> {
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const bucket = this.getOrCreateBucket(tenantId);
      this.refillBucket(bucket);

      // If the bucket is paused (post-throttle hold-off), wait.
      if (bucket.pausedUntil !== null) {
        if (Date.now() < bucket.pausedUntil) {
          const waitRemaining = bucket.pausedUntil - Date.now();
          logger.debug(
            { tenantId, waitRemaining },
            'Bucket paused after throttle, waiting'
          );
          await this.sleep(Math.min(waitRemaining, POLL_INTERVAL_MS));
          continue;
        }
        // Pause expired
        bucket.pausedUntil = null;
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;

        const capacityFraction = bucket.tokens / this.maxTokens;
        if (capacityFraction < WARN_CAPACITY_THRESHOLD) {
          logger.warn(
            {
              tenantId,
              tokensRemaining: Math.floor(bucket.tokens),
              maxTokens: this.maxTokens,
              capacityPercent: Math.floor(capacityFraction * 100),
            },
            'GraphRateLimiter: tenant bucket below 20% capacity'
          );
        }

        return; // Token acquired
      }

      // No tokens available — wait for the next poll interval.
      logger.debug(
        { tenantId, tokensRemaining: bucket.tokens },
        'Rate limiter waiting for token refill'
      );
      await this.sleep(POLL_INTERVAL_MS);
    }

    logger.error(
      { tenantId, timeoutMs: ACQUIRE_TIMEOUT_MS },
      'GraphRateLimiter: acquire timed out — tenant bucket exhausted'
    );
    throw new Error(
      `GraphRateLimiter: timed out waiting for rate-limit token for tenant ${tenantId}`
    );
  }

  /**
   * Signal that the Graph API returned a 429 for this tenant.
   *
   * Drains the bucket to zero and prevents any new acquisitions for the
   * duration specified by the Retry-After header.
   *
   * @param tenantId      The Azure AD tenant ID.
   * @param retryAfterMs  Number of milliseconds to pause (from Retry-After header).
   */
  onThrottled(tenantId: string, retryAfterMs: number): void {
    const bucket = this.getOrCreateBucket(tenantId);

    bucket.tokens = 0;
    bucket.pausedUntil = Date.now() + retryAfterMs;

    logger.warn(
      { tenantId, retryAfterMs, pausedUntil: new Date(bucket.pausedUntil).toISOString() },
      'GraphRateLimiter: tenant throttled by Graph API 429'
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Return the bucket for a tenant, creating it at full capacity if absent.
   */
  private getOrCreateBucket(tenantId: string): Bucket {
    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefillAt: Date.now(),
        pausedUntil: null,
      };
      this.buckets.set(tenantId, bucket);
      logger.debug({ tenantId, initialTokens: this.maxTokens }, 'Created new rate-limit bucket');
    }
    return bucket;
  }

  /**
   * Add tokens to the bucket based on elapsed time since last refill.
   * Caps tokens at maxTokens.
   */
  private refillBucket(bucket: Bucket): void {
    const now = Date.now();
    const elapsedMs = now - bucket.lastRefillAt;

    if (elapsedMs > 0) {
      const tokensToAdd = elapsedMs * this.refillRatePerMs;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefillAt = now;
    }
  }

  /** Tiny async sleep helper, kept as an instance method for easy mocking in tests. */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GraphRateLimiter | undefined;

/**
 * Get the GraphRateLimiter singleton.
 */
export function getGraphRateLimiter(): GraphRateLimiter {
  if (!instance) {
    instance = new GraphRateLimiter();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetGraphRateLimiter(): void {
  instance = undefined;
}
