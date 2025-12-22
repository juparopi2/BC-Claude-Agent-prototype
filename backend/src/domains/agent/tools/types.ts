/**
 * @module domains/agent/tools/types
 *
 * Type definitions for tool-related classes.
 * Tool execution, deduplication, and approval handling.
 */

import type { AgentEvent } from '@bc-agent/shared';

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

// === ToolExecutionProcessor Types ===

/**
 * Context for tool execution processing.
 * Contains session info and event emission callback.
 */
export interface ToolProcessorContext {
  /** Session ID for logging and persistence */
  sessionId: string;

  /** User ID for logging */
  userId: string;

  /** Callback to emit events to WebSocket */
  onEvent: (event: AgentEvent) => void;
}

/**
 * Input format for tool executions from LangGraph.
 * Matches the shape from agentOutput.toolExecutions in on_chain_end.
 *
 * Note: Uses 'args' (from LangGraph) not 'toolInput' (persistence format).
 */
export interface RawToolExecution {
  /** Unique tool use ID for correlation */
  toolUseId: string;

  /** Name of the tool executed */
  toolName: string;

  /** Tool arguments (from LangGraph) */
  args: Record<string, unknown>;

  /** Tool result output */
  result: string;

  /** Whether tool execution succeeded */
  success: boolean;

  /** Error message if tool failed */
  error?: string;
}

/**
 * Statistics about tool execution processing.
 */
export interface ToolProcessorStats {
  /** Total executions received */
  totalReceived: number;

  /** Executions skipped due to deduplication */
  duplicatesSkipped: number;

  /** Events emitted (tool_use + tool_result pairs) */
  eventsEmitted: number;

  /** Persistence operations initiated */
  persistenceInitiated: number;
}

/**
 * Interface for ToolExecutionProcessor.
 * Processes tool executions: deduplicates, emits events, persists async.
 *
 * Pattern: Emit-first, persist-async (for UI responsiveness)
 */
export interface IToolExecutionProcessor {
  /**
   * Process an array of tool executions.
   * For each unique execution:
   * 1. Check deduplication (skip if duplicate)
   * 2. Emit tool_use event (immediate)
   * 3. Emit tool_result event (immediate)
   * 4. Queue async persistence (batch)
   *
   * @param executions - Tool executions from LangGraph
   * @param context - Session context and event callback
   * @returns Array of tool names that were processed (non-duplicate)
   */
  processExecutions(
    executions: RawToolExecution[],
    context: ToolProcessorContext
  ): Promise<string[]>;

  /**
   * Get processing statistics.
   */
  getStats(): ToolProcessorStats;

  /**
   * Reset processor state (deduplicator + stats).
   * Call this at the start of a new agent run.
   */
  reset(): void;
}
