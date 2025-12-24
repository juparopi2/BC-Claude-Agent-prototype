/**
 * @module domains/agent/tools/types
 *
 * Type definitions for tool-related classes.
 * Tool execution, deduplication, and approval handling.
 *
 * ## Stateless Architecture
 *
 * ToolExecutionProcessor is STATELESS - deduplication uses ctx.seenToolIds
 * which is shared with GraphStreamProcessor. This ensures a single source
 * of truth for tool deduplication across all processors.
 */

import type { AgentEvent } from '@bc-agent/shared';
import type { ExecutionContext } from '@domains/agent/orchestration/ExecutionContext';

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
 * @deprecated Use ExecutionContext.seenToolIds directly
 */
export interface IToolEventDeduplicator {
  checkAndMark(toolUseId: string): DeduplicationResult;
  hasSeen(toolUseId: string): boolean;
  getStats(): DeduplicationStats;
  reset(): void;
}

// === ToolExecutionProcessor Types ===

/**
 * Context for tool execution processing.
 * @deprecated Use ExecutionContext directly
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
 * Optional - only used for debugging/monitoring.
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
 * Interface for ToolExecutionProcessor (Stateless).
 * Processes tool executions: deduplicates, emits events, persists async.
 *
 * Pattern: Emit-first, persist-async (for UI responsiveness)
 *
 * ## Deduplication
 *
 * Uses ctx.seenToolIds which is SHARED with GraphStreamProcessor.
 * This ensures a tool_use_id is only processed once, regardless of
 * which processor sees it first.
 */
export interface IToolExecutionProcessor {
  /**
   * Process an array of tool executions.
   * For each unique execution:
   * 1. Check deduplication via ctx.seenToolIds (skip if duplicate)
   * 2. Emit tool_use event (immediate)
   * 3. Emit tool_result event (immediate)
   * 4. Queue async persistence (batch)
   *
   * @param executions - Tool executions from LangGraph
   * @param ctx - Execution context with seenToolIds and callback
   * @returns Array of tool names that were processed (non-duplicate)
   */
  processExecutions(
    executions: RawToolExecution[],
    ctx: ExecutionContext
  ): Promise<string[]>;
}
