/**
 * @module domains/agent/tools/ToolExecutionProcessor
 *
 * Processes tool executions from LangGraph streaming events.
 * Extracted from DirectAgentService.runGraph() lines 683-828.
 *
 * ## Stateless Architecture
 *
 * This processor is STATELESS - deduplication uses ctx.seenToolIds which is
 * SHARED with GraphStreamProcessor. This ensures a single source of truth
 * for tool deduplication across all processors.
 *
 * This enables:
 * - Multi-tenant isolation (no shared state between executions)
 * - Horizontal scaling in Azure Container Apps
 * - Guaranteed deduplication (one Map for both processors)
 *
 * Responsibilities:
 * 1. Deduplication - Prevents duplicate tool events via ctx.seenToolIds
 * 2. Event emission - Emits tool_use and tool_result to WebSocket immediately
 * 3. Async persistence - Queues persistence via PersistenceCoordinator
 *
 * Pattern: Emit-first, persist-async (for UI responsiveness)
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContext(sessionId, userId, callback, options);
 * const processor = getToolExecutionProcessor();
 *
 * const toolsUsed = await processor.processExecutions(
 *   agentOutput.toolExecutions,
 *   ctx
 * );
 * ```
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import type { AgentEvent, ToolUseEvent, ToolResultEvent } from '@bc-agent/shared';
import type { IPersistenceCoordinator, ToolExecution } from '../persistence/types';
import { getPersistenceCoordinator } from '../persistence';
import type { IToolExecutionProcessor, RawToolExecution } from './types';
import type { ExecutionContext } from '@domains/agent/orchestration/ExecutionContext';
import { markToolSeen } from '@domains/agent/orchestration/ExecutionContext';

/**
 * Processes tool executions from LangGraph streaming events.
 * STATELESS - all deduplication state lives in ExecutionContext.
 */
export class ToolExecutionProcessor implements IToolExecutionProcessor {
  private readonly logger = createChildLogger({ service: 'ToolExecutionProcessor' });

  // NO instance fields for deduplication - uses ctx.seenToolIds

  constructor(
    private readonly persistenceCoordinator: IPersistenceCoordinator = getPersistenceCoordinator()
  ) {}

  /**
   * Process an array of tool executions.
   * Uses ctx.seenToolIds for deduplication (shared with GraphStreamProcessor).
   */
  async processExecutions(
    executions: RawToolExecution[],
    ctx: ExecutionContext
  ): Promise<string[]> {
    const { sessionId, callback } = ctx;
    const toolsUsed: string[] = [];
    const executionsToPersist: ToolExecution[] = [];

    if (!executions || executions.length === 0) {
      return toolsUsed;
    }

    this.logger.debug({
      sessionId,
      executionId: ctx.executionId,
      executionsCount: executions.length,
    }, 'Processing tool executions');

    for (const exec of executions) {
      // 1. DEDUPLICATION CHECK (shared with GraphStreamProcessor)
      const dedupResult = markToolSeen(ctx, exec.toolUseId);

      if (dedupResult.isDuplicate) {
        this.logger.debug({
          toolUseId: exec.toolUseId,
          toolName: exec.toolName,
          firstSeenAt: dedupResult.firstSeenAt,
        }, 'Skipping duplicate tool event');
        continue;
      }

      // 2. CREATE EVENT IDs
      const toolUseEventId = randomUUID();
      const toolResultEventId = randomUUID();
      const timestamp = new Date().toISOString();

      // 3. EMIT tool_use EVENT (immediate)
      const toolUseEvent: ToolUseEvent = {
        type: 'tool_use',
        sessionId,
        toolName: exec.toolName,
        toolUseId: exec.toolUseId,
        args: exec.args,
        timestamp,
        eventId: toolUseEventId,
        persistenceState: 'pending',
      };

      this.safeEmit(callback, toolUseEvent, ctx);

      // 4. EMIT tool_result EVENT (immediate)
      const toolResultEvent: ToolResultEvent = {
        type: 'tool_result',
        sessionId,
        toolName: exec.toolName,
        toolUseId: exec.toolUseId,
        args: exec.args,
        result: exec.result,
        success: exec.success,
        error: exec.error,
        timestamp,
        eventId: toolResultEventId,
        persistenceState: 'pending',
      };

      this.safeEmit(callback, toolResultEvent, ctx);

      this.logger.debug({
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        success: exec.success,
      }, 'Tool events emitted (persistence pending)');

      // 5. COLLECT FOR BATCH PERSISTENCE
      executionsToPersist.push({
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        toolInput: exec.args,
        toolOutput: exec.result,
        success: exec.success,
        error: exec.error,
        timestamp,
      });

      toolsUsed.push(exec.toolName);
    }

    // 6. INITIATE ASYNC PERSISTENCE (fire-and-forget)
    if (executionsToPersist.length > 0) {
      try {
        this.persistenceCoordinator.persistToolEventsAsync(sessionId, executionsToPersist);
      } catch (err) {
        // Fire-and-forget: log error but don't fail the stream
        this.logger.error({
          err,
          sessionId,
          executionsCount: executionsToPersist.length,
        }, 'Error initiating tool persistence');
      }
    }

    return toolsUsed;
  }

  /**
   * Safely emit an event with eventIndex, catching any callback errors.
   */
  private safeEmit(
    callback: ((event: AgentEvent) => void) | undefined,
    event: AgentEvent,
    ctx: ExecutionContext
  ): void {
    if (!callback) return;

    try {
      const eventWithIndex = {
        ...event,
        eventIndex: ctx.eventIndex++,
      };
      callback(eventWithIndex);
    } catch (err) {
      this.logger.error({
        err,
        eventType: event.type,
        toolUseId: 'toolUseId' in event ? event.toolUseId : undefined,
      }, 'Error in event emission callback');
    }
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let instance: ToolExecutionProcessor | null = null;

/**
 * Get the singleton ToolExecutionProcessor instance.
 * Safe for concurrent use because all state lives in ExecutionContext.
 */
export function getToolExecutionProcessor(): ToolExecutionProcessor {
  if (!instance) {
    instance = new ToolExecutionProcessor();
  }
  return instance;
}

/**
 * Create a new ToolExecutionProcessor instance.
 * @deprecated Use getToolExecutionProcessor() for production.
 * Only use this for testing with dependency injection.
 */
export function createToolExecutionProcessor(
  persistenceCoordinator?: IPersistenceCoordinator
): ToolExecutionProcessor {
  return new ToolExecutionProcessor(persistenceCoordinator);
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetToolExecutionProcessor(): void {
  instance = null;
}
