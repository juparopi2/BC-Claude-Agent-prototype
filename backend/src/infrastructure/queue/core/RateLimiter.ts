/**
 * RateLimiter
 *
 * Redis-based rate limiting for multi-tenant queue safety.
 * Ensures no single session/user can saturate the queue.
 *
 * Design:
 * - Uses Redis INCR for atomic counter updates
 * - TTL-based sliding window (1 hour)
 * - Fail-open on Redis errors (allows requests)
 *
 * @module infrastructure/queue/core
 */

import type { Redis } from 'ioredis';
import { createChildLogger } from '@/shared/utils/logger';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';
import { RATE_LIMIT } from '../constants';

/**
 * Dependencies for RateLimiter
 */
export interface RateLimiterDependencies {
  redis: Redis;
  logger?: ILoggerMinimal;
  /** Override max jobs per session (default: 100) */
  maxJobsPerSession?: number;
  /** Override window in seconds (default: 3600) */
  windowSeconds?: number;
}

/**
 * Rate limit status returned by checkLimit and getStatus
 */
export interface RateLimitStatus {
  count: number;
  limit: number;
  remaining: number;
  withinLimit: boolean;
}

/**
 * RateLimiter - Redis-based rate limiting
 */
export class RateLimiter {
  private static instance: RateLimiter | null = null;

  private readonly redis: Redis;
  private readonly log: ILoggerMinimal;
  private readonly maxJobsPerSession: number;
  private readonly windowSeconds: number;
  private readonly keyPrefix: string;

  constructor(deps: RateLimiterDependencies) {
    this.redis = deps.redis;
    this.log = deps.logger ?? createChildLogger({ service: 'RateLimiter' });
    this.maxJobsPerSession = deps.maxJobsPerSession ?? RATE_LIMIT.MAX_JOBS_PER_SESSION;
    this.windowSeconds = deps.windowSeconds ?? RATE_LIMIT.WINDOW_SECONDS;
    this.keyPrefix = RATE_LIMIT.KEY_PREFIX;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(deps: RateLimiterDependencies): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter(deps);
    }
    return RateLimiter.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static resetInstance(): void {
    RateLimiter.instance = null;
  }

  /**
   * Check if a session is within rate limits
   *
   * Increments the counter atomically and checks against limit.
   * Fails open on Redis errors (returns true to allow request).
   *
   * @param key - Session ID or other rate limit key
   * @returns true if within limit, false if exceeded
   */
  async checkLimit(key: string): Promise<boolean> {
    const redisKey = `${this.keyPrefix}${key}`;

    try {
      // Increment counter atomically
      const count = await this.redis.incr(redisKey);

      // Set TTL only on first increment (count === 1)
      if (count === 1) {
        await this.redis.expire(redisKey, this.windowSeconds);
      }

      const withinLimit = count <= this.maxJobsPerSession;

      if (!withinLimit) {
        this.log.warn('Rate limit exceeded for session', {
          sessionId: key,
          count,
          limit: this.maxJobsPerSession,
        });
      }

      return withinLimit;
    } catch (error) {
      // Fail open - allow request if rate limit check fails
      this.log.error('Failed to check rate limit', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: key,
      });
      return true;
    }
  }

  /**
   * Get current rate limit status without incrementing
   *
   * @param key - Session ID or other rate limit key
   * @returns Current rate limit status
   */
  async getStatus(key: string): Promise<RateLimitStatus> {
    const redisKey = `${this.keyPrefix}${key}`;

    try {
      const countStr = await this.redis.get(redisKey);
      const count = countStr ? parseInt(countStr, 10) : 0;
      const remaining = Math.max(0, this.maxJobsPerSession - count);
      const withinLimit = count <= this.maxJobsPerSession;

      return { count, limit: this.maxJobsPerSession, remaining, withinLimit };
    } catch (error) {
      this.log.error('Failed to get rate limit status', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      // Return default (assume no usage) on error
      return {
        count: 0,
        limit: this.maxJobsPerSession,
        remaining: this.maxJobsPerSession,
        withinLimit: true,
      };
    }
  }

  /**
   * Get the configured limit value
   */
  getLimit(): number {
    return this.maxJobsPerSession;
  }
}

/**
 * Get RateLimiter singleton
 */
export function getRateLimiter(deps: RateLimiterDependencies): RateLimiter {
  return RateLimiter.getInstance(deps);
}

/**
 * Reset RateLimiter singleton (for testing)
 */
export function __resetRateLimiter(): void {
  RateLimiter.resetInstance();
}
