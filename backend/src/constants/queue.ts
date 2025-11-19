/**
 * Queue Configuration Constants
 *
 * Multi-tenant rate limiting and queue behavior configuration.
 * Values loaded from environment variables for production flexibility.
 *
 * @module constants/queue
 */

/**
 * Queue Configuration
 *
 * Centralized configuration for BullMQ message queues.
 * All values are configurable via environment variables.
 *
 * Multi-tenant Safety:
 * - MAX_JOBS_PER_SESSION: Prevents single tenant from saturating queue
 * - RATE_LIMIT_WINDOW_SECONDS: Time window for rate limiting (1 hour default)
 * - Concurrency limits prevent resource exhaustion
 *
 * Production Tuning:
 * - Increase concurrency for higher throughput
 * - Decrease rate limits for tighter control
 * - All values hot-reloadable via env vars (no code deploy needed)
 */
export const QUEUE_CONFIG = {
  /**
   * Maximum Jobs Per Session
   *
   * Limits number of messages a single session can queue per hour.
   * Prevents queue saturation from single tenant.
   *
   * Default: 100 jobs/hour
   * Production: 500-1000 for high-traffic tenants
   */
  MAX_JOBS_PER_SESSION: parseInt(
    process.env.QUEUE_MAX_JOBS_PER_SESSION || '100',
    10
  ),

  /**
   * Rate Limit Window (seconds)
   *
   * Time window for rate limiting calculations.
   *
   * Default: 3600 seconds (1 hour)
   * Production: 3600 (recommended), 1800 for tighter control
   */
  RATE_LIMIT_WINDOW_SECONDS: parseInt(
    process.env.QUEUE_RATE_LIMIT_WINDOW_SECONDS || '3600',
    10
  ),

  /**
   * Message Persistence Concurrency
   *
   * Number of message persistence jobs processed in parallel.
   *
   * Default: 10 (balanced)
   * Production: 20-50 for high write throughput
   */
  MESSAGE_PERSISTENCE_CONCURRENCY: parseInt(
    process.env.QUEUE_MESSAGE_CONCURRENCY || '10',
    10
  ),

  /**
   * Tool Execution Concurrency
   *
   * Number of tool execution jobs processed in parallel.
   *
   * Default: 5 (conservative - tools can be expensive)
   * Production: 10-20 if tools are lightweight
   */
  TOOL_EXECUTION_CONCURRENCY: parseInt(
    process.env.QUEUE_TOOL_CONCURRENCY || '5',
    10
  ),

  /**
   * Event Processing Concurrency
   *
   * Number of event processing jobs handled in parallel.
   *
   * Default: 10 (balanced)
   * Production: 20-50 for event-heavy workloads
   */
  EVENT_PROCESSING_CONCURRENCY: parseInt(
    process.env.QUEUE_EVENT_CONCURRENCY || '10',
    10
  ),

  /**
   * Job Retry Configuration
   */
  RETRY: {
    /**
     * Max Retry Attempts
     *
     * Number of times to retry failed jobs.
     */
    MAX_ATTEMPTS: parseInt(process.env.QUEUE_MAX_RETRY_ATTEMPTS || '3', 10),

    /**
     * Initial Backoff Delay (ms)
     *
     * Starting delay for exponential backoff: 1s, 2s, 4s, ...
     */
    INITIAL_DELAY_MS: parseInt(
      process.env.QUEUE_RETRY_INITIAL_DELAY || '1000',
      10
    ),
  },

  /**
   * Job Cleanup Configuration
   */
  CLEANUP: {
    /**
     * Completed Jobs Retention
     *
     * Keep last N completed jobs for debugging.
     */
    KEEP_COMPLETED_COUNT: parseInt(
      process.env.QUEUE_KEEP_COMPLETED || '100',
      10
    ),

    /**
     * Completed Jobs TTL (seconds)
     *
     * Remove completed jobs after this time.
     */
    COMPLETED_TTL_SECONDS: parseInt(
      process.env.QUEUE_COMPLETED_TTL || '3600',
      10
    ),

    /**
     * Failed Jobs Retention
     *
     * Keep last N failed jobs for debugging.
     */
    KEEP_FAILED_COUNT: parseInt(process.env.QUEUE_KEEP_FAILED || '500', 10),

    /**
     * Failed Jobs TTL (seconds)
     *
     * Remove failed jobs after this time.
     */
    FAILED_TTL_SECONDS: parseInt(
      process.env.QUEUE_FAILED_TTL || '86400',
      10
    ),
  },
} as const;

/**
 * Validate Queue Configuration
 *
 * Ensures all configuration values are within safe ranges.
 * Call this on startup to catch configuration errors early.
 *
 * @throws Error if configuration is invalid
 */
export function validateQueueConfig(): void {
  const { MAX_JOBS_PER_SESSION, RATE_LIMIT_WINDOW_SECONDS } = QUEUE_CONFIG;

  if (MAX_JOBS_PER_SESSION <= 0) {
    throw new Error(
      'QUEUE_MAX_JOBS_PER_SESSION must be positive (got: ' +
        MAX_JOBS_PER_SESSION +
        ')'
    );
  }

  if (RATE_LIMIT_WINDOW_SECONDS <= 0) {
    throw new Error(
      'QUEUE_RATE_LIMIT_WINDOW_SECONDS must be positive (got: ' +
        RATE_LIMIT_WINDOW_SECONDS +
        ')'
    );
  }

  if (MAX_JOBS_PER_SESSION > 10000) {
    console.warn(
      '⚠️  QUEUE_MAX_JOBS_PER_SESSION is very high (' +
        MAX_JOBS_PER_SESSION +
        '). Consider lowering to prevent queue saturation.'
    );
  }
}
