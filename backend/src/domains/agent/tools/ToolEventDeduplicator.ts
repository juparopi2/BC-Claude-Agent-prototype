/**
 * @module domains/agent/tools/ToolEventDeduplicator
 *
 * Prevents duplicate tool events from being emitted during streaming.
 * Extracted from DirectAgentService.runGraph() emittedToolUseIds Set.
 *
 * LangGraph can emit the same tool execution multiple times through different
 * event paths (on_chain_end, direct callbacks). This class ensures each
 * tool_use_id is only processed once per agent run.
 *
 * @example
 * ```typescript
 * const deduplicator = new ToolEventDeduplicator();
 *
 * const result1 = deduplicator.checkAndMark('toolu_123');
 * console.log(result1.isDuplicate); // false (first time)
 *
 * const result2 = deduplicator.checkAndMark('toolu_123');
 * console.log(result2.isDuplicate); // true (duplicate!)
 * ```
 */

import type {
  IToolEventDeduplicator,
  DeduplicationResult,
  DeduplicationStats,
} from './types';

/**
 * Tracks seen tool_use_ids to prevent duplicate event emission.
 * Thread-safe within single Node.js event loop iteration.
 */
export class ToolEventDeduplicator implements IToolEventDeduplicator {
  /** Set of tool_use_ids that have been seen */
  private seenIds = new Map<string, string>(); // toolUseId -> firstSeenAt timestamp
  /** Counter for duplicate prevention */
  private duplicateCount = 0;

  /**
   * Check if tool_use_id has been seen and mark it.
   * Atomic check-and-set operation.
   *
   * @param toolUseId - The tool_use_id to check
   * @returns Result with isDuplicate flag
   */
  checkAndMark(toolUseId: string): DeduplicationResult {
    const now = new Date().toISOString();

    const existingTimestamp = this.seenIds.get(toolUseId);
    if (existingTimestamp !== undefined) {
      this.duplicateCount++;
      return {
        isDuplicate: true,
        toolUseId,
        firstSeenAt: existingTimestamp,
      };
    }

    this.seenIds.set(toolUseId, now);
    return {
      isDuplicate: false,
      toolUseId,
      firstSeenAt: now,
    };
  }

  /**
   * Check if tool_use_id has been seen without marking.
   * Use this for read-only checks.
   *
   * @param toolUseId - The tool_use_id to check
   * @returns true if already seen
   */
  hasSeen(toolUseId: string): boolean {
    return this.seenIds.has(toolUseId);
  }

  /**
   * Get deduplication statistics.
   */
  getStats(): DeduplicationStats {
    return {
      totalTracked: this.seenIds.size,
      duplicatesPrevented: this.duplicateCount,
    };
  }

  /**
   * Reset tracker for new session/run.
   */
  reset(): void {
    this.seenIds.clear();
    this.duplicateCount = 0;
  }
}

/**
 * Factory function to create ToolEventDeduplicator.
 * Each agent run needs its own deduplicator.
 *
 * @returns New ToolEventDeduplicator instance
 */
export function createToolEventDeduplicator(): ToolEventDeduplicator {
  return new ToolEventDeduplicator();
}
