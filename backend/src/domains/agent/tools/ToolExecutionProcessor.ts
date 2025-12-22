/**
 * @module domains/agent/tools/ToolExecutionProcessor
 *
 * Processes tool executions from LangGraph streaming events.
 * Extracted from DirectAgentService.runGraph() lines 683-828.
 *
 * Responsibilities:
 * 1. Deduplication - Prevents duplicate tool events via ToolEventDeduplicator
 * 2. Event emission - Emits tool_use and tool_result to WebSocket immediately
 * 3. Async persistence - Queues persistence via PersistenceCoordinator
 *
 * Pattern: Emit-first, persist-async (for UI responsiveness)
 *
 * @example
 * ```typescript
 * const processor = createToolExecutionProcessor();
 *
 * const toolsUsed = await processor.processExecutions(
 *   agentOutput.toolExecutions,
 *   { sessionId, userId, onEvent: emitEvent }
 * );
 *
 * console.log('Tools used:', toolsUsed);
 * console.log('Stats:', processor.getStats());
 * ```
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import type { AgentEvent, ToolUseEvent, ToolResultEvent } from '@bc-agent/shared';
import type { IPersistenceCoordinator, ToolExecution } from '../persistence/types';
import { getPersistenceCoordinator } from '../persistence';
import type {
  IToolExecutionProcessor,
  IToolEventDeduplicator,
  ToolProcessorContext,
  RawToolExecution,
  ToolProcessorStats,
} from './types';
import { ToolEventDeduplicator } from './ToolEventDeduplicator';

/**
 * Processes tool executions from LangGraph streaming events.
 */
export class ToolExecutionProcessor implements IToolExecutionProcessor {
  private readonly logger = createChildLogger({ service: 'ToolExecutionProcessor' });

  private totalReceived = 0;
  private duplicatesSkipped = 0;
  private eventsEmitted = 0;
  private persistenceInitiated = 0;

  constructor(
    private readonly deduplicator: IToolEventDeduplicator = new ToolEventDeduplicator(),
    private readonly persistenceCoordinator: IPersistenceCoordinator = getPersistenceCoordinator()
  ) {}

  /**
   * Process an array of tool executions.
   */
  async processExecutions(
    executions: RawToolExecution[],
    context: ToolProcessorContext
  ): Promise<string[]> {
    const { sessionId, onEvent } = context;
    const toolsUsed: string[] = [];
    const executionsToPersist: ToolExecution[] = [];

    if (!executions || executions.length === 0) {
      return toolsUsed;
    }

    this.totalReceived += executions.length;

    this.logger.debug({
      sessionId,
      executionsCount: executions.length,
    }, 'Processing tool executions');

    for (const exec of executions) {
      // 1. DEDUPLICATION CHECK
      const dedupResult = this.deduplicator.checkAndMark(exec.toolUseId);

      if (dedupResult.isDuplicate) {
        this.duplicatesSkipped++;
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

      this.safeEmit(onEvent, toolUseEvent);
      this.eventsEmitted++;

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

      this.safeEmit(onEvent, toolResultEvent);
      this.eventsEmitted++;

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
      this.persistenceInitiated++;
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
   * Safely emit an event, catching any callback errors.
   */
  private safeEmit(onEvent: (event: AgentEvent) => void, event: AgentEvent): void {
    try {
      onEvent(event);
    } catch (err) {
      this.logger.error({
        err,
        eventType: event.type,
        toolUseId: 'toolUseId' in event ? event.toolUseId : undefined,
      }, 'Error in event emission callback');
    }
  }

  /**
   * Get processing statistics.
   */
  getStats(): ToolProcessorStats {
    return {
      totalReceived: this.totalReceived,
      duplicatesSkipped: this.duplicatesSkipped,
      eventsEmitted: this.eventsEmitted,
      persistenceInitiated: this.persistenceInitiated,
    };
  }

  /**
   * Reset processor state for new agent run.
   */
  reset(): void {
    this.deduplicator.reset();
    this.totalReceived = 0;
    this.duplicatesSkipped = 0;
    this.eventsEmitted = 0;
    this.persistenceInitiated = 0;
  }
}

/**
 * Factory function to create ToolExecutionProcessor.
 * Each agent run should have its own processor.
 *
 * @returns New ToolExecutionProcessor instance
 */
export function createToolExecutionProcessor(): ToolExecutionProcessor {
  return new ToolExecutionProcessor();
}
