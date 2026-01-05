/**
 * @module domains/agent/tools/ToolLifecycleManager
 *
 * Manages tool lifecycle state to ensure unified persistence.
 * Fixes the bug where tool_request and tool_response were persisted separately,
 * resulting in 5+ events per tool instead of 2.
 *
 * ## Solution
 *
 * 1. tool_request → Store args in memory (NO persistence)
 * 2. tool_response → Combine with stored args → Return for unified persistence
 * 3. End of execution → Persist any orphaned tools as 'tool_incomplete'
 */

import { createChildLogger } from '@/shared/utils/logger';
import type {
  IToolLifecycleManager,
  IToolPersistenceCoordinator,
  ToolState,
  ToolLifecycleStats,
} from './types';

const logger = createChildLogger({ service: 'ToolLifecycleManager' });

/**
 * Manages tool lifecycle state to ensure unified persistence.
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
 *
 * ## Usage
 *
 * ```typescript
 * const manager = createToolLifecycleManager();
 *
 * // On tool_request event
 * manager.onToolRequested(sessionId, toolUseId, toolName, args);
 *
 * // On tool_response event
 * const completeState = manager.onToolCompleted(sessionId, toolUseId, result, success);
 * if (completeState) {
 *   persistenceCoordinator.persistToolEventsAsync(sessionId, [toToolExecution(completeState)]);
 * }
 *
 * // At end of execution
 * await manager.finalizeAndPersistOrphans(sessionId, persistenceCoordinator);
 * ```
 */
export class ToolLifecycleManager implements IToolLifecycleManager {
  /** Map of toolUseId -> ToolState for pending tools */
  private pendingTools = new Map<string, ToolState>();

  /** Statistics tracking */
  private stats: ToolLifecycleStats = {
    pending: 0,
    completed: 0,
    failed: 0,
    orphaned: 0,
  };

  /**
   * Register a new tool request.
   * Stores in memory without persistence.
   */
  onToolRequested(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    args: Record<string, unknown>
  ): void {
    // Check for duplicate request (should not happen but defensive)
    if (this.pendingTools.has(toolUseId)) {
      logger.warn(
        { toolUseId, toolName, sessionId },
        'Duplicate tool request received, ignoring'
      );
      return;
    }

    const toolState: ToolState = {
      toolUseId,
      sessionId,
      toolName,
      state: 'requested',
      args,
      requestedAt: new Date(),
    };

    this.pendingTools.set(toolUseId, toolState);
    this.stats.pending++;

    logger.debug(
      { toolUseId, toolName, sessionId, pendingCount: this.stats.pending },
      'Tool request registered'
    );
  }

  /**
   * Complete a tool execution.
   * Returns complete state with input+output for unified persistence.
   */
  onToolCompleted(
    sessionId: string,
    toolUseId: string,
    result: string,
    success: boolean,
    error?: string
  ): ToolState | null {
    const pendingTool = this.pendingTools.get(toolUseId);

    if (!pendingTool) {
      // Orphan response - tool_response without matching tool_request
      logger.warn(
        { toolUseId, sessionId, success },
        'Tool response received without matching request (orphan response)'
      );
      return null;
    }

    // Verify session matches
    if (pendingTool.sessionId !== sessionId) {
      logger.error(
        {
          toolUseId,
          expectedSessionId: pendingTool.sessionId,
          actualSessionId: sessionId,
        },
        'Session mismatch in tool completion'
      );
      return null;
    }

    // Update state to completed/failed
    const completedState: ToolState = {
      ...pendingTool,
      state: success ? 'completed' : 'failed',
      result,
      error: success ? undefined : error,
      completedAt: new Date(),
    };

    // Remove from pending
    this.pendingTools.delete(toolUseId);
    this.stats.pending--;

    if (success) {
      this.stats.completed++;
    } else {
      this.stats.failed++;
    }

    const durationMs =
      completedState.completedAt!.getTime() - completedState.requestedAt.getTime();

    logger.debug(
      {
        toolUseId,
        toolName: completedState.toolName,
        sessionId,
        success,
        hasError: !!error,
        durationMs,
      },
      'Tool execution completed'
    );

    return completedState;
  }

  /**
   * Check if a tool request exists.
   */
  hasPendingTool(toolUseId: string): boolean {
    return this.pendingTools.has(toolUseId);
  }

  /**
   * Persist orphaned tools at execution end.
   * Tools that received request but no response are persisted with incomplete status.
   */
  async finalizeAndPersistOrphans(
    sessionId: string,
    persistenceCoordinator: IToolPersistenceCoordinator
  ): Promise<void> {
    const orphanedTools = Array.from(this.pendingTools.values()).filter(
      (tool) => tool.sessionId === sessionId
    );

    if (orphanedTools.length === 0) {
      logger.debug({ sessionId }, 'No orphaned tools to persist');
      return;
    }

    logger.warn(
      {
        sessionId,
        orphanCount: orphanedTools.length,
        toolUseIds: orphanedTools.map((t) => t.toolUseId),
      },
      'Persisting orphaned tools as incomplete'
    );

    // Convert to ToolExecution format for persistence
    const executions = orphanedTools.map((tool) => ({
      toolUseId: tool.toolUseId,
      toolName: tool.toolName,
      toolInput: tool.args,
      toolOutput: '[INCOMPLETE: No response received]',
      success: false,
      error: 'Tool execution did not complete - no response received',
      timestamp: tool.requestedAt.toISOString(),
    }));

    // Persist orphans (fire-and-forget is fine here)
    persistenceCoordinator.persistToolEventsAsync(sessionId, executions);

    // Update stats and clean up
    this.stats.orphaned += orphanedTools.length;
    this.stats.pending -= orphanedTools.length;

    for (const tool of orphanedTools) {
      this.pendingTools.delete(tool.toolUseId);
    }
  }

  /**
   * Get lifecycle statistics.
   */
  getStats(): ToolLifecycleStats {
    return { ...this.stats };
  }

  /**
   * Reset all state (for testing).
   */
  reset(): void {
    this.pendingTools.clear();
    this.stats = {
      pending: 0,
      completed: 0,
      failed: 0,
      orphaned: 0,
    };
  }
}

/**
 * Factory function to create ToolLifecycleManager.
 * Creates new instance per execution (NOT a singleton).
 */
export function createToolLifecycleManager(): ToolLifecycleManager {
  return new ToolLifecycleManager();
}
