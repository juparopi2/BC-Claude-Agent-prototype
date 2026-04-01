/**
 * Delta Normalizer
 *
 * Normalizes a single graph step's delta messages into NormalizedAgentEvent[].
 * Used by the progressive delivery pipeline to produce events incrementally
 * at each graph node boundary, rather than waiting for full execution to complete.
 *
 * ## Design
 *
 * Normalizes a single graph step's delta messages. Operates on a
 * pre-sliced delta instead of the full AgentState. Key differences:
 * - Input: BaseMessage[] slice + ToolExecution[] matched to this delta
 * - Does NOT apply skipMessages (caller handles the slice)
 * - Does NOT produce a complete event unless isLastStep + includeComplete
 * - Tool responses come from delta.toolExecutions (same pairing logic as batch)
 *
 * @module shared/providers/normalizers/DeltaNormalizer
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import type { ToolExecution } from '@/modules/agents/orchestrator/state';
import type {
  NormalizedAgentEvent,
  NormalizedToolResponseEvent,
  NormalizedCompleteEvent,
  NormalizedStopReason,
} from '@bc-agent/shared';
import { isInternalTool } from '@bc-agent/shared';
import { normalizeAIMessage, normalizeStopReason } from './MessageNormalizer';
import type { IDeltaNormalizer, DeltaSlice, DeltaNormalizerOptions } from '../interfaces/IDeltaNormalizer';

const logger = createChildLogger({ service: 'DeltaNormalizer' });

/**
 * Normalizes a delta slice of BaseMessage[] into NormalizedAgentEvent[].
 *
 * Implements IDeltaNormalizer for progressive event delivery.
 *
 * ## Example
 * ```typescript
 * const normalizer = getDeltaNormalizer();
 * const events = normalizer.normalizeDelta(
 *   { messages: [aiMessage], toolExecutions: [], isLastStep: false },
 *   sessionId
 * );
 * ```
 */
export class DeltaNormalizer implements IDeltaNormalizer {
  /**
   * Normalize a delta slice of messages from one graph step.
   *
   * Processing order:
   * 1. Extract events from AI messages (thinking, text, tool_use) via normalizeAIMessage
   * 2. Create tool_response events from delta.toolExecutions
   * 3. Interleave tool_response after corresponding tool_request
   * 4. Mark internal tool events as isInternal
   * 5. Sort by originalIndex and reassign sequential indices
   * 6. Optionally append complete event (only when isLastStep && includeComplete)
   *
   * @param delta - Delta slice: new messages, tool executions, and isLastStep flag
   * @param sessionId - Session ID for event context
   * @param options - Optional normalization options
   * @returns Sorted array of normalized events for this delta
   */
  normalizeDelta(
    delta: DeltaSlice,
    sessionId: string,
    options?: DeltaNormalizerOptions
  ): NormalizedAgentEvent[] {
    const { messages, toolExecutions, isLastStep } = delta;
    const timestamp = new Date().toISOString();

    if (messages.length === 0) {
      logger.debug({ sessionId }, 'Delta has no messages — returning empty event array');
      return [];
    }

    logger.debug({
      sessionId,
      messageCount: messages.length,
      toolExecutionCount: toolExecutions.length,
      isLastStep,
    }, 'Starting delta normalization');

    const allEvents: NormalizedAgentEvent[] = [];
    const toolResponseFromMessages = new Map<string, NormalizedToolResponseEvent>();
    let indexCounter = 0;
    let lastAIMessageIndex = -1;

    // 1. Process AI/assistant messages AND ToolMessages
    // ToolMessages in the delta represent tool execution results. In the streaming path,
    // toolExecutions on the graph state is NOT populated (that's derived data from
    // adaptSupervisorResult in the batch path). So we extract tool_response events
    // directly from ToolMessage instances in the delta.
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const msgType = msg._getType?.();

      if (msgType === 'ai' || msgType === 'assistant') {
        lastAIMessageIndex = i;

        let messageEvents: NormalizedAgentEvent[] = [];
        try {
          messageEvents = normalizeAIMessage(msg, i, sessionId);
        } catch (error) {
          logger.error(
            {
              sessionId,
              messageIndex: i,
              error: error instanceof Error
                ? { message: error.message, stack: error.stack, name: error.name }
                : { value: String(error) },
            },
            'Failed to normalize delta message — skipping'
          );
          continue;
        }

        if (messageEvents.length === 0) {
          logger.warn({
            sessionId,
            messageIndex: i,
            messageType: msgType,
            contentType: typeof msg.content,
            contentIsArray: Array.isArray(msg.content),
          }, 'AI message in delta produced ZERO events — possible data loss');
        }

        for (const event of messageEvents) {
          allEvents.push({
            ...event,
            originalIndex: indexCounter++,
          });
        }
      } else if (msgType === 'tool') {
        // ToolMessages represent tool execution results.
        // Extract tool_response events directly — no need for toolExecutions array.
        const toolCallId = (msg as unknown as { tool_call_id?: string }).tool_call_id;
        const toolName = (msg as unknown as { name?: string }).name ?? 'unknown';

        if (toolCallId) {
          const resultContent = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
          const isError = typeof msg.content === 'string' && msg.content.startsWith('Error');

          const toolResponseEvent: NormalizedToolResponseEvent = {
            type: 'tool_response',
            eventId: randomUUID(),
            sessionId,
            timestamp,
            originalIndex: indexCounter++,
            persistenceStrategy: 'async_allowed',
            toolUseId: toolCallId,
            toolName,
            success: !isError,
            result: resultContent,
          };

          // Add directly to toolResponseMap for interleaving with matching tool_request
          toolResponseFromMessages.set(toolCallId, toolResponseEvent);
        }
      }
      // HumanMessage, SystemMessage, and other types are inputs — skip them
    }

    // 2. Create tool_response events from delta.toolExecutions (batch compatibility)
    //    AND merge with tool_response events extracted from ToolMessages above.
    //    ToolMessages are the PRIMARY source in the streaming path; toolExecutions
    //    is the PRIMARY source in the batch path. Both maps are merged.
    const toolResponseMap = this.createToolResponseMap(toolExecutions, sessionId, timestamp);
    // Merge ToolMessage-derived responses (streaming path) — these take precedence
    for (const [toolCallId, response] of toolResponseFromMessages) {
      if (!toolResponseMap.has(toolCallId)) {
        toolResponseMap.set(toolCallId, response);
      }
    }

    // 3. Interleave tool_response events after their corresponding tool_request
    const interleavedEvents: NormalizedAgentEvent[] = [];
    for (const event of allEvents) {
      interleavedEvents.push(event);

      if (event.type === 'tool_request') {
        const toolUseId = (event as { toolUseId: string }).toolUseId;
        const toolResponse = toolResponseMap.get(toolUseId);
        if (toolResponse) {
          interleavedEvents.push({
            ...toolResponse,
            originalIndex: event.originalIndex + 0.5, // Between request and next event
            sourceAgentId: event.sourceAgentId,       // Inherit agent attribution
          });
        }
      }
    }

    // 4. Mark internal tool events (transfer_to_*, transfer_back_to_*)
    for (const event of interleavedEvents) {
      if (
        (event.type === 'tool_request' || event.type === 'tool_response') &&
        'toolName' in event &&
        isInternalTool((event as { toolName: string }).toolName)
      ) {
        (event as { persistenceStrategy: string }).persistenceStrategy = 'async_allowed';
        (event as { isInternal: boolean }).isInternal = true;
      }
    }

    // 5. Sort by originalIndex and reassign sequential indices
    interleavedEvents.sort((a, b) => a.originalIndex - b.originalIndex);
    const finalEvents: NormalizedAgentEvent[] = interleavedEvents.map((event, idx) => ({
      ...event,
      originalIndex: idx,
    }));

    // 6. Optionally append complete event (only on last step)
    if (options?.includeComplete && isLastStep) {
      const lastAIMessage = lastAIMessageIndex >= 0 ? messages[lastAIMessageIndex] : null;
      const stopReason = lastAIMessage
        ? this.extractStopReasonFromMessage(lastAIMessage)
        : 'end_turn';

      finalEvents.push(this.createCompleteEvent(
        sessionId,
        timestamp,
        stopReason,
        finalEvents.length,
        options.usedModel ?? undefined
      ));
    }

    logger.debug({
      sessionId,
      eventCount: finalEvents.length,
      eventTypes: finalEvents.map(e => e.type),
    }, 'Delta normalization complete');

    return finalEvents;
  }

  /**
   * Create a map of toolUseId -> tool_response event.
   * Create a map of toolUseId -> tool_response event from ToolExecution array.
   */
  private createToolResponseMap(
    executions: ToolExecution[],
    sessionId: string,
    timestamp: string
  ): Map<string, NormalizedToolResponseEvent> {
    const map = new Map<string, NormalizedToolResponseEvent>();

    for (const exec of executions) {
      map.set(exec.toolUseId, {
        type: 'tool_response',
        eventId: randomUUID(),
        sessionId,
        timestamp,
        originalIndex: 0, // Will be reassigned during interleaving
        persistenceStrategy: 'async_allowed',
        toolUseId: exec.toolUseId,
        toolName: exec.toolName,
        success: exec.success,
        result: exec.result,
        error: exec.error,
      });
    }

    return map;
  }

  /**
   * Extract stop reason from message using provider-agnostic normalizer.
   * Extract stop reason from message using provider-agnostic normalizer.
   */
  private extractStopReasonFromMessage(
    message: import('@langchain/core/messages').BaseMessage
  ): NormalizedStopReason {
    const meta = (message as {
      response_metadata?: { stop_reason?: string; finish_reason?: string };
    }).response_metadata;
    return normalizeStopReason(meta?.stop_reason ?? meta?.finish_reason);
  }

  /**
   * Create a complete event.
   * Create a complete event signaling end of agent execution.
   */
  private createCompleteEvent(
    sessionId: string,
    timestamp: string,
    stopReason: NormalizedStopReason,
    originalIndex: number,
    usedModel?: string
  ): NormalizedCompleteEvent {
    return {
      type: 'complete',
      eventId: randomUUID(),
      sessionId,
      timestamp,
      originalIndex,
      persistenceStrategy: 'transient',
      reason: this.mapStopReasonToCompletionReason(stopReason),
      stopReason,
      usedModel,
    };
  }

  /**
   * Map provider stop reason to UI completion reason.
   * Map provider stop reason to UI completion reason.
   */
  private mapStopReasonToCompletionReason(
    stopReason: NormalizedStopReason
  ): 'success' | 'error' | 'max_turns' | 'user_cancelled' {
    switch (stopReason) {
      case 'max_tokens':
        return 'max_turns';
      case 'error':
        return 'error';
      case 'cancelled':
        return 'user_cancelled';
      default:
        return 'success';
    }
  }
}

// Singleton instance
let instance: DeltaNormalizer | null = null;

/**
 * Get singleton DeltaNormalizer instance.
 */
export function getDeltaNormalizer(): DeltaNormalizer {
  if (!instance) {
    instance = new DeltaNormalizer();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 * @internal
 */
export function __resetDeltaNormalizer(): void {
  instance = null;
}

