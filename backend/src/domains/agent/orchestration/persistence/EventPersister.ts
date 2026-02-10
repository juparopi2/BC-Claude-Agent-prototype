/**
 * @module domains/agent/orchestration/persistence/EventPersister
 *
 * Handles event persistence based on persistence strategy.
 * Extracted from AgentOrchestrator.persistSyncEvent() and persistAsyncEvent().
 *
 * ## Persistence Strategies
 *
 * - sync_required: Persist BEFORE emission (thinking, assistant_message)
 * - async_allowed: Persist AFTER emission (tool_request, tool_response)
 * - transient: No persistence (session_start, complete, error)
 *
 * ## Tool Lifecycle
 *
 * Tool events use ToolLifecycleManager for unified persistence:
 * - tool_request: Register in memory with pre-allocated sequence
 * - tool_response: Combine with stored request, persist with complete data
 *
 * @example
 * ```typescript
 * const persister = new EventPersister(persistenceCoordinator, logger);
 *
 * // For sync_required events
 * const result = await persister.persistSyncEvent(event, sessionId, messageId, preAllocSeq);
 *
 * // For async_allowed events
 * persister.persistAsyncEvent(event, sessionId, ctx, preAllocSeq);
 * ```
 */

import type {
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
} from '@bc-agent/shared';
import type {
  IPersistenceCoordinator,
  PersistedEvent,
  ToolExecution as PersistenceToolExecution,
} from '@domains/agent/persistence';
import type { ExecutionContextSync } from '../ExecutionContextSync';
import { normalizeToolArgs } from '@domains/agent/tools';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'EventPersister' });

/**
 * Persist an event synchronously (for sync_required events).
 * Uses pre-allocated sequence number if provided for deterministic ordering.
 *
 * @param event - Normalized event to persist
 * @param sessionId - Session ID
 * @param agentMessageId - Agent message ID for thinking events
 * @param persistenceCoordinator - Persistence coordinator instance
 * @param preAllocatedSeq - Pre-allocated sequence number
 * @returns PersistedEvent with sequenceNumber for updating the emitted event
 */
export async function persistSyncEvent(
  event: NormalizedAgentEvent,
  sessionId: string,
  agentMessageId: string,
  persistenceCoordinator: IPersistenceCoordinator,
  preAllocatedSeq?: number,
  agentId?: string
): Promise<PersistedEvent | undefined> {
  switch (event.type) {
    case 'thinking': {
      const thinkingEvent = event as NormalizedThinkingEvent;
      const result = await persistenceCoordinator.persistThinking(
        sessionId,
        {
          messageId: agentMessageId,
          content: thinkingEvent.content,
          tokenUsage: thinkingEvent.tokenUsage ?? {
            inputTokens: 0,
            outputTokens: 0,
          },
          agentId,
        },
        preAllocatedSeq
      );
      return result;
    }

    case 'assistant_message': {
      const msgEvent = event as NormalizedAssistantMessageEvent;
      const persistResult = await persistenceCoordinator.persistAgentMessage(
        sessionId,
        {
          messageId: msgEvent.messageId,
          content: msgEvent.content,
          stopReason: msgEvent.stopReason,
          model: msgEvent.model,
          tokenUsage: {
            inputTokens: msgEvent.tokenUsage.inputTokens,
            outputTokens: msgEvent.tokenUsage.outputTokens,
          },
          agentId,
        },
        preAllocatedSeq
      );

      // Wait for BullMQ to complete DB write
      if (persistResult.jobId) {
        try {
          await persistenceCoordinator.awaitPersistence(persistResult.jobId, 10000);
        } catch (err) {
          logger.warn({ sessionId, jobId: persistResult.jobId, err }, 'Timeout awaiting persistence');
        }
      }
      return persistResult;
    }

    default:
      return undefined;
  }
}

/**
 * Persist an event asynchronously (for async_allowed events).
 * Uses ToolLifecycleManager for unified tool persistence.
 *
 * @param event - Normalized event to persist
 * @param sessionId - Session ID
 * @param ctx - Execution context containing ToolLifecycleManager
 * @param persistenceCoordinator - Persistence coordinator instance
 * @param preAllocatedSeq - Pre-allocated sequence number
 */
export function persistAsyncEvent(
  event: NormalizedAgentEvent,
  sessionId: string,
  ctx: ExecutionContextSync,
  persistenceCoordinator: IPersistenceCoordinator,
  preAllocatedSeq?: number
): void {
  // Handle tool_request: Register in lifecycle manager with pre-allocated seq
  if (event.type === 'tool_request') {
    const toolReqEvent = event as NormalizedToolRequestEvent;

    // Normalize args to ensure they are always an object
    const normalizedArgs = normalizeToolArgs(toolReqEvent.args, toolReqEvent.toolName);

    // Register tool request in memory - will be combined with response later
    ctx.toolLifecycleManager.onToolRequested(
      sessionId,
      toolReqEvent.toolUseId,
      toolReqEvent.toolName,
      normalizedArgs,
      preAllocatedSeq
    );

    logger.debug(
      {
        toolUseId: toolReqEvent.toolUseId,
        toolName: toolReqEvent.toolName,
        preAllocatedSeq,
      },
      'Tool request registered in lifecycle manager (awaiting response)'
    );
    return; // DO NOT persist yet - wait for tool_response
  }

  // Handle tool_response: Complete and persist with unified input+output
  if (event.type === 'tool_response') {
    const toolRespEvent = event as NormalizedToolResponseEvent;

    // Complete the tool lifecycle and get unified state
    const completeState = ctx.toolLifecycleManager.onToolCompleted(
      sessionId,
      toolRespEvent.toolUseId,
      toolRespEvent.result ?? '',
      toolRespEvent.success,
      toolRespEvent.error,
      preAllocatedSeq
    );

    if (completeState) {
      // NOW persist with complete input+output
      const persistenceExec: PersistenceToolExecution = {
        toolUseId: completeState.toolUseId,
        toolName: completeState.toolName,
        toolInput: completeState.args,
        toolOutput: completeState.result ?? '',
        success: completeState.state === 'completed',
        error: completeState.error,
        timestamp: completeState.completedAt?.toISOString() ?? new Date().toISOString(),
        preAllocatedToolUseSeq: completeState.preAllocatedToolUseSeq,
        preAllocatedToolResultSeq: completeState.preAllocatedToolResultSeq,
      };

      // Fire-and-forget persistence
      persistenceCoordinator.persistToolEventsAsync(sessionId, [persistenceExec]);

      logger.debug(
        {
          toolUseId: completeState.toolUseId,
          toolName: completeState.toolName,
          hasInput: Object.keys(completeState.args).length > 0,
          hasOutput: !!completeState.result,
          success: completeState.state === 'completed',
          preAllocatedToolUseSeq: completeState.preAllocatedToolUseSeq,
          preAllocatedToolResultSeq: completeState.preAllocatedToolResultSeq,
        },
        'Tool persisted with unified input+output and pre-allocated sequences'
      );
    } else {
      // Orphan response - tool_response without matching tool_request
      logger.warn(
        { toolUseId: toolRespEvent.toolUseId },
        'Tool response without matching request - skipping persistence'
      );
    }
  }
}

/**
 * Determine if an event requires synchronous persistence.
 *
 * @param event - Normalized event
 * @returns true if event needs sync persistence before emission
 */
export function requiresSyncPersistence(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'sync_required';
}

/**
 * Determine if an event allows asynchronous persistence.
 *
 * @param event - Normalized event
 * @returns true if event can be persisted after emission
 */
export function allowsAsyncPersistence(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'async_allowed';
}

/**
 * Determine if an event is transient (no persistence needed).
 *
 * @param event - Normalized event
 * @returns true if event should not be persisted
 */
export function isTransient(event: NormalizedAgentEvent): boolean {
  return event.persistenceStrategy === 'transient';
}
