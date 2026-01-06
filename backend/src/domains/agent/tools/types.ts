/**
 * @module domains/agent/tools/types
 *
 * Type definitions for tool-related classes.
 * - Tool deduplication (ToolEventDeduplicator)
 * - Tool lifecycle management (ToolLifecycleManager)
 */

// ============================================================================
// TOOL EVENT DEDUPLICATION TYPES
// ============================================================================

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

// ============================================================================
// TOOL LIFECYCLE MANAGEMENT TYPES
// ============================================================================

/**
 * Lifecycle state of a tool execution.
 * - 'requested': Tool request received, awaiting result
 * - 'completed': Tool finished successfully with result
 * - 'failed': Tool execution failed with error
 */
export type ToolLifecycleState = 'requested' | 'completed' | 'failed';

/**
 * Complete state of a tool execution across its lifecycle.
 * Tracks both request and response data for unified persistence.
 */
export interface ToolState {
  /** Unique identifier for this tool execution (Anthropic format: toolu_...) */
  toolUseId: string;

  /** Session this tool belongs to */
  sessionId: string;

  /** Name of the tool being executed */
  toolName: string;

  /** Current lifecycle state */
  state: ToolLifecycleState;

  /** Tool input arguments from tool_request */
  args: Record<string, unknown>;

  /** Tool output from tool_response (undefined until completed) */
  result?: string;

  /** Error message if state is 'failed' */
  error?: string;

  /** Timestamp when tool was requested */
  requestedAt: Date;

  /** Timestamp when tool completed/failed (undefined until done) */
  completedAt?: Date;

  /**
   * Pre-allocated sequence number for tool_use_requested event.
   * Set when tool_request is registered with pre-allocated sequence.
   */
  preAllocatedToolUseSeq?: number;

  /**
   * Pre-allocated sequence number for tool_use_completed event.
   * Set when tool_response completes the lifecycle.
   */
  preAllocatedToolResultSeq?: number;
}

/**
 * Statistics about tool lifecycle management.
 */
export interface ToolLifecycleStats {
  /** Number of tools currently awaiting results */
  pending: number;

  /** Number of tools that completed successfully */
  completed: number;

  /** Number of tools that failed */
  failed: number;

  /** Number of orphaned tools (persisted as incomplete) */
  orphaned: number;
}

/**
 * Interface for PersistenceCoordinator tool persistence method.
 * Used by ToolLifecycleManager for persisting orphaned tools.
 */
export interface IToolPersistenceCoordinator {
  persistToolEventsAsync(
    sessionId: string,
    executions: Array<{
      toolUseId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolOutput: string;
      success: boolean;
      error?: string;
      timestamp: string;
      /** Pre-allocated sequence for tool_use_requested event */
      preAllocatedToolUseSeq?: number;
      /** Pre-allocated sequence for tool_use_completed event */
      preAllocatedToolResultSeq?: number;
    }>
  ): void;
}

/**
 * Interface for ToolLifecycleManager.
 * Manages tool state across request/response lifecycle for unified persistence.
 *
 * ## Design Principles
 *
 * 1. **Per-Execution Scope**: Each execution creates a new instance.
 *    This aligns with the ExecutionContextSync pattern.
 *
 * 2. **Memory-Only Until Complete**: tool_request is held in memory until
 *    tool_response arrives, then returned for persistence as a single unit.
 *
 * 3. **Orphan Handling**: At execution end, any pending tools are persisted
 *    as 'tool_incomplete' to maintain audit trail.
 */
export interface IToolLifecycleManager {
  /**
   * Register a new tool request.
   * Called when tool_request event is received.
   * Does NOT persist - just tracks state in memory.
   *
   * @param sessionId - Session ID
   * @param toolUseId - Unique tool execution ID
   * @param toolName - Name of the tool
   * @param args - Tool input arguments
   * @param preAllocatedSeq - Pre-allocated sequence number for tool_use_requested event
   */
  onToolRequested(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    args: Record<string, unknown>,
    preAllocatedSeq?: number
  ): void;

  /**
   * Complete a tool execution and return complete state for persistence.
   * Called when tool_response event is received.
   * Returns the complete ToolState with input+output for persistence.
   * Returns null if tool_request was never received (orphan response).
   *
   * @param sessionId - Session ID
   * @param toolUseId - Unique tool execution ID
   * @param result - Tool output/result
   * @param success - Whether tool succeeded
   * @param error - Error message if failed
   * @param preAllocatedSeq - Pre-allocated sequence number for tool_use_completed event
   */
  onToolCompleted(
    sessionId: string,
    toolUseId: string,
    result: string,
    success: boolean,
    error?: string,
    preAllocatedSeq?: number
  ): ToolState | null;

  /**
   * Check if a tool request exists for the given ID.
   */
  hasPendingTool(toolUseId: string): boolean;

  /**
   * Finalize execution and persist any orphaned tools as 'tool_incomplete'.
   * Called at the end of agent execution.
   * Tools that received request but no response are persisted with error state.
   */
  finalizeAndPersistOrphans(
    sessionId: string,
    persistenceCoordinator: IToolPersistenceCoordinator
  ): Promise<void>;

  /**
   * Get current statistics about tool lifecycle.
   */
  getStats(): ToolLifecycleStats;

  /**
   * Reset all state (for testing).
   */
  reset(): void;
}
