/**
 * @module domains/agent/tools/types
 *
 * Type definitions for tool-related classes.
 * Tool deduplication only - tool execution is handled by AgentOrchestrator.
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
 */
export interface IToolEventDeduplicator {
  checkAndMark(toolUseId: string): DeduplicationResult;
  hasSeen(toolUseId: string): boolean;
  getStats(): DeduplicationStats;
  reset(): void;
}
