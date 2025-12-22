/**
 * @module domains/agent/tools/types
 *
 * Type definitions for tool-related classes.
 * Tool execution, deduplication, and approval handling.
 */

/**
 * Result of checking if a tool event is duplicate.
 */
export interface DeduplicationResult {
  /** Whether this is a duplicate (already seen) */
  isDuplicate: boolean;
  /** The tool_use_id that was checked */
  toolUseId: string;
  /** First seen timestamp if duplicate, current if new */
  firstSeenAt: string;
}

/**
 * Statistics about deduplication activity.
 */
export interface DeduplicationStats {
  /** Total tool_use_ids tracked */
  totalTracked: number;
  /** Number of duplicates prevented */
  duplicatesPrevented: number;
}

/**
 * Interface for tool event deduplication.
 * Prevents duplicate tool_use events from being emitted.
 *
 * LangGraph can emit the same tool execution multiple times through different
 * event paths (on_chain_end, tool execution callbacks, etc.). This tracker
 * ensures each tool_use_id is only processed once per session.
 */
export interface IToolEventDeduplicator {
  /**
   * Check if a tool_use_id has been seen and mark it as seen.
   * @param toolUseId - The tool_use_id to check
   * @returns Deduplication result with isDuplicate flag
   */
  checkAndMark(toolUseId: string): DeduplicationResult;

  /**
   * Check if a tool_use_id has been seen without marking it.
   * @param toolUseId - The tool_use_id to check
   * @returns true if already seen
   */
  hasSeen(toolUseId: string): boolean;

  /**
   * Get deduplication statistics.
   */
  getStats(): DeduplicationStats;

  /**
   * Reset tracker for new session.
   */
  reset(): void;
}
