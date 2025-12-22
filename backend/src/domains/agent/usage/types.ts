/**
 * @module domains/agent/usage/types
 *
 * Type definitions for token usage tracking.
 * Integrates with UsageTrackingService and TokenUsageService.
 */

/**
 * Token usage data from a single event.
 */
export interface UsageData {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
}

/**
 * Accumulated usage statistics for a run.
 */
export interface AccumulatedUsage {
  /** Total input tokens across all events */
  totalInputTokens: number;
  /** Total output tokens across all events */
  totalOutputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Number of usage events accumulated */
  eventCount: number;
}

/**
 * Context for recording usage.
 */
export interface UsageRecordContext {
  /** User ID (required for billing) */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Model used (e.g., 'claude-3-5-sonnet') */
  model: string;
  /** Whether extended thinking was enabled */
  enableThinking?: boolean;
  /** Thinking budget in tokens */
  thinkingBudget?: number;
  /** Number of files attached */
  fileCount?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of recording usage.
 */
export interface UsageRecordResult {
  /** Whether analytics tracking succeeded */
  analyticsSuccess: boolean;
  /** Whether billing recording succeeded */
  billingSuccess: boolean;
  /** Error message if any */
  error?: string;
}

/**
 * Interface for UsageTracker.
 * Accumulates and records token usage during agent runs.
 */
export interface IUsageTracker {
  /**
   * Add usage from a single event.
   * @param data - Usage data from event
   */
  addUsage(data: UsageData): void;

  /**
   * Get accumulated usage statistics.
   */
  getAccumulated(): AccumulatedUsage;

  /**
   * Check if any usage has been accumulated.
   */
  hasUsage(): boolean;

  /**
   * Reset tracker for new run.
   */
  reset(): void;
}
