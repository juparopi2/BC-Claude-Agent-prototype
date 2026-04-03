/**
 * Rate Limits Configuration
 *
 * Anthropic API rate limits for the current organization tier.
 * Pure static constants — no runtime state, no env reads, no network calls.
 *
 * These constants drive the retry/backoff logic in retryLlmCall().
 * Update this file when the organization tier changes (e.g., Tier 1 → Tier 2).
 *
 * Current tier: Tier 1 (5 RPM per model, 10K input TPM, 4K output TPM)
 *
 * @see https://docs.anthropic.com/en/api/rate-limits
 * @module infrastructure/config/rate-limits
 */

// =============================================================================
// TIER 1 CONSTANTS
// Current Anthropic organization tier limits (per model, per minute)
// =============================================================================

/** Requests per minute per model (Tier 1) */
export const ANTHROPIC_TIER_1_RPM = 5;

/** Input tokens per minute, excluding cache reads (Tier 1) */
export const ANTHROPIC_TIER_1_INPUT_TPM = 10_000;

/** Output tokens per minute (Tier 1) */
export const ANTHROPIC_TIER_1_OUTPUT_TPM = 4_000;

// =============================================================================
// RETRY DEFAULTS
// Derived from tier limits — used by retryLlmCall()
// =============================================================================

/**
 * Default retry delay in milliseconds.
 * Derived: 60_000ms / 5 RPM = 12_000ms, rounded up to 12_500ms as safety margin.
 */
export const RATE_LIMIT_RETRY_DELAY_MS = 12_500;

/** Maximum retry delay cap (60 seconds). Prevents unbounded waits. */
export const RATE_LIMIT_MAX_RETRY_DELAY_MS = 60_000;

/** Maximum number of retry attempts. Total attempts = 1 + MAX_RETRIES = 4. */
export const RATE_LIMIT_MAX_RETRIES = 3;

// =============================================================================
// PER-MODEL-TIER LIMIT OBJECTS
// =============================================================================

/**
 * Rate limit profile for a model tier.
 * Encapsulates RPM, TPM, and retry delay for a specific model family.
 */
export interface ModelRateLimits {
  /** Requests per minute */
  readonly rpmLimit: number;
  /** Input tokens per minute (excluding cache reads) */
  readonly inputTpmLimit: number;
  /** Output tokens per minute */
  readonly outputTpmLimit: number;
  /** Recommended base retry delay in ms (derived from rpmLimit) */
  readonly retryDelayMs: number;
}

/**
 * Haiku-tier rate limits (Tier 1).
 * Applies to: claude-haiku-4-5-20251001 and similar lightweight models.
 */
export const HAIKU_RATE_LIMITS: ModelRateLimits = {
  rpmLimit: ANTHROPIC_TIER_1_RPM,
  inputTpmLimit: ANTHROPIC_TIER_1_INPUT_TPM,
  outputTpmLimit: ANTHROPIC_TIER_1_OUTPUT_TPM,
  retryDelayMs: RATE_LIMIT_RETRY_DELAY_MS,
};

/**
 * Sonnet-tier rate limits (Tier 1).
 * Applies to: claude-sonnet-4-6-20251220 and similar mid-tier models.
 *
 * At Tier 1, Haiku and Sonnet share the same limits.
 * Separate object for future tier upgrades where they may diverge.
 */
export const SONNET_RATE_LIMITS: ModelRateLimits = {
  rpmLimit: ANTHROPIC_TIER_1_RPM,
  inputTpmLimit: ANTHROPIC_TIER_1_INPUT_TPM,
  outputTpmLimit: ANTHROPIC_TIER_1_OUTPUT_TPM,
  retryDelayMs: RATE_LIMIT_RETRY_DELAY_MS,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the recommended base retry delay for a model.
 *
 * Dispatches by model string: sonnet-tier models return SONNET_RATE_LIMITS delay.
 * All others (including unknown models) fall back to HAIKU_RATE_LIMITS (fail-safe).
 *
 * @param modelId - Anthropic model string (e.g., 'claude-haiku-4-5-20251001')
 * @returns Retry delay in milliseconds
 */
export function getRetryDelayMs(modelId: string): number {
  if (modelId.toLowerCase().includes('sonnet')) {
    return SONNET_RATE_LIMITS.retryDelayMs;
  }
  return HAIKU_RATE_LIMITS.retryDelayMs;
}

/**
 * Get the RPM limit for a model.
 *
 * Same dispatch logic as getRetryDelayMs — fails safely to haiku limits.
 *
 * @param modelId - Anthropic model string
 * @returns Requests per minute limit
 */
export function getRpmLimit(modelId: string): number {
  if (modelId.toLowerCase().includes('sonnet')) {
    return SONNET_RATE_LIMITS.rpmLimit;
  }
  return HAIKU_RATE_LIMITS.rpmLimit;
}
