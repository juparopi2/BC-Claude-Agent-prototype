/**
 * @module domains/agent/orchestration/events/EventConverter
 *
 * Converts NormalizedAgentEvent to AgentEvent for WebSocket emission.
 * Pure functions with no side effects - extracted from AgentOrchestrator.toAgentEvent().
 *
 * ## Mapping
 *
 * - NormalizedThinkingEvent -> thinking_complete
 * - NormalizedToolRequestEvent -> tool_use
 * - NormalizedToolResponseEvent -> tool_result
 * - NormalizedAssistantMessageEvent -> message
 * - NormalizedCompleteEvent -> complete
 *
 * @example
 * ```typescript
 * const agentEvent = convertToAgentEvent(normalizedEvent, ctx);
 * emitEventSync(ctx, agentEvent);
 * ```
 */

import type {
  StopReason,
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedCompleteEvent,
} from '@bc-agent/shared';
import type { ExecutionContextSync } from '../ExecutionContextSync';
import type { AgentEvent } from '../types';
import { normalizeToolArgs } from '@domains/agent/tools';

/**
 * Convert a NormalizedAgentEvent to AgentEvent for WebSocket emission.
 *
 * Pure function that transforms normalized events from BatchResultNormalizer
 * into the format expected by WebSocket clients.
 *
 * @param normalized - The normalized event from BatchResultNormalizer
 * @param ctx - Execution context for accessing citedSources
 * @returns AgentEvent ready for emission
 */
export function convertToAgentEvent(
  normalized: NormalizedAgentEvent,
  ctx: ExecutionContextSync
): AgentEvent {
  // Base event fields shared by all event types
  const baseEvent = {
    eventId: normalized.eventId,
    sessionId: normalized.sessionId,
    timestamp: normalized.timestamp,
    persistenceState: mapPersistenceStrategy(normalized.persistenceStrategy),
  };

  switch (normalized.type) {
    case 'thinking': {
      const thinkingEvent = normalized as NormalizedThinkingEvent;
      return {
        ...baseEvent,
        type: 'thinking_complete' as const,
        content: thinkingEvent.content,
      };
    }

    case 'tool_request': {
      const toolReqEvent = normalized as NormalizedToolRequestEvent;
      return {
        ...baseEvent,
        type: 'tool_use' as const,
        toolName: toolReqEvent.toolName,
        toolUseId: toolReqEvent.toolUseId,
        args: normalizeToolArgs(toolReqEvent.args, toolReqEvent.toolName),
      };
    }

    case 'tool_response': {
      const toolRespEvent = normalized as NormalizedToolResponseEvent;
      return {
        ...baseEvent,
        type: 'tool_result' as const,
        toolName: toolRespEvent.toolName,
        toolUseId: toolRespEvent.toolUseId,
        result: toolRespEvent.result ?? '',
        success: toolRespEvent.success,
        error: toolRespEvent.error,
      };
    }

    case 'assistant_message': {
      const msgEvent = normalized as NormalizedAssistantMessageEvent;
      return {
        ...baseEvent,
        type: 'message' as const,
        content: msgEvent.content,
        messageId: msgEvent.messageId,
        role: 'assistant' as const,
        stopReason: msgEvent.stopReason as StopReason,
        model: msgEvent.model,
        tokenUsage: {
          inputTokens: msgEvent.tokenUsage.inputTokens,
          outputTokens: msgEvent.tokenUsage.outputTokens,
        },
      };
    }

    case 'complete': {
      const completeEvent = normalized as NormalizedCompleteEvent;
      return {
        ...baseEvent,
        type: 'complete' as const,
        reason: completeEvent.reason,
        stopReason: completeEvent.stopReason,
        // Include cited files from RAG tool results (if any)
        citedFiles: ctx.citedSources.length > 0 ? ctx.citedSources : undefined,
        // Include messageId for citation association on frontend
        messageId: ctx.lastAssistantMessageId ?? undefined,
      };
    }

    default:
      // Fallback for other event types
      return baseEvent as AgentEvent;
  }
}

/**
 * Map persistence strategy to persistence state for emission.
 *
 * - transient -> 'transient' (not persisted)
 * - sync_required -> 'pending' (will be persisted before emission)
 * - async_allowed -> 'pending' (will be persisted after emission)
 *
 * @param strategy - The persistence strategy from normalized event
 * @returns The persistence state for AgentEvent
 */
function mapPersistenceStrategy(
  strategy: 'transient' | 'sync_required' | 'async_allowed'
): 'transient' | 'pending' {
  return strategy === 'transient' ? 'transient' : 'pending';
}
