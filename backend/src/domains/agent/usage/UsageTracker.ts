/**
 * @module domains/agent/usage/UsageTracker
 *
 * Accumulates token usage during Claude streaming.
 * Extracted from DirectAgentService.runGraph() usage tracking logic.
 *
 * Usage events can arrive multiple times during a run (per turn, per tool call).
 * This class accumulates totals and provides statistics.
 *
 * @example
 * ```typescript
 * const tracker = new UsageTracker();
 *
 * // During streaming
 * tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
 * tracker.addUsage({ inputTokens: 200, outputTokens: 100 });
 *
 * const totals = tracker.getAccumulated();
 * console.log(totals.totalTokens); // 450
 * ```
 */

import type { IUsageTracker, UsageData, AccumulatedUsage } from './types';

/**
 * Accumulates token usage during agent runs.
 * Thread-safe within single Node.js event loop iteration.
 */
export class UsageTracker implements IUsageTracker {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private eventCount = 0;

  /**
   * Add usage from a single event.
   * Accumulates to running totals.
   *
   * @param data - Usage data with inputTokens and outputTokens
   */
  addUsage(data: UsageData): void {
    const inputTokens = data.inputTokens || 0;
    const outputTokens = data.outputTokens || 0;

    // Only count if there's actual usage
    if (inputTokens > 0 || outputTokens > 0) {
      this.totalInputTokens += inputTokens;
      this.totalOutputTokens += outputTokens;
      this.eventCount++;
    }
  }

  /**
   * Get accumulated usage statistics.
   */
  getAccumulated(): AccumulatedUsage {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      eventCount: this.eventCount,
    };
  }

  /**
   * Check if any usage has been accumulated.
   */
  hasUsage(): boolean {
    return this.eventCount > 0;
  }

  /**
   * Get total input tokens.
   */
  getInputTokens(): number {
    return this.totalInputTokens;
  }

  /**
   * Get total output tokens.
   */
  getOutputTokens(): number {
    return this.totalOutputTokens;
  }

  /**
   * Get total tokens (input + output).
   */
  getTotalTokens(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }

  /**
   * Reset tracker for new run.
   */
  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.eventCount = 0;
  }
}

/**
 * Factory function to create UsageTracker.
 * Each agent run needs its own tracker.
 *
 * @returns New UsageTracker instance
 */
export function createUsageTracker(): UsageTracker {
  return new UsageTracker();
}
