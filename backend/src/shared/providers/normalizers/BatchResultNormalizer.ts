/**
 * Batch Result Normalizer
 *
 * Normalizes LangGraph invoke() results into NormalizedAgentEvent[].
 * This is the central normalization logic that replaces ResultExtractor.
 *
 * ## Design
 *
 * The normalizer processes AgentState in a specific order:
 * 1. Extract events from messages (thinking, text, tool_use)
 * 2. Merge tool_response events from state.toolExecutions
 * 3. Sort all events by originalIndex
 *
 * ## Key Differences from ResultExtractor
 *
 * ResultExtractor (old):
 * - Returns { thinking, content, toolExecutions, stopReason, usage }
 * - Caller must decide what to emit and when
 * - Conditional logic lives in orchestrator
 *
 * BatchResultNormalizer (new):
 * - Returns NormalizedAgentEvent[]
 * - All decisions made during normalization
 * - Orchestrator just iterates and emits
 *
 * @module shared/providers/normalizers/BatchResultNormalizer
 */

import { randomUUID } from 'crypto';
import type { BaseMessage } from '@langchain/core/messages';
import { createChildLogger } from '@/shared/utils/logger';
import type { AgentState, ToolExecution } from '@/modules/agents/orchestrator/state';
import type {
  NormalizedAgentEvent,
  NormalizedToolResponseEvent,
  NormalizedCompleteEvent,
  NormalizedStopReason,
} from '@bc-agent/shared';
import type { IProviderAdapter } from '../interfaces/IProviderAdapter';
import type { IBatchResultNormalizer, BatchNormalizerOptions } from '../interfaces/IBatchResultNormalizer';

const logger = createChildLogger({ service: 'BatchResultNormalizer' });

// Re-export for backwards compatibility
export type { BatchNormalizerOptions };

/**
 * Normalizes LangGraph AgentState into ordered NormalizedAgentEvent[].
 *
 * Implements IBatchResultNormalizer for dependency injection and testing.
 *
 * ## Example
 * ```typescript
 * const normalizer = new BatchResultNormalizer();
 * const adapter = new AnthropicAdapter(sessionId);
 * const events = normalizer.normalize(state, adapter);
 *
 * for (const event of events) {
 *   await emit(event);
 *   await persist(event);
 * }
 * ```
 */
export class BatchResultNormalizer implements IBatchResultNormalizer {
  /**
   * Normalize AgentState into event array.
   *
   * Processing order:
   * 1. Find all AI messages in state.messages
   * 2. Use adapter to extract events from each message
   * 3. Create tool_response events from state.toolExecutions
   * 4. Interleave tool_response after corresponding tool_request
   * 5. Sort by originalIndex
   *
   * @param state - LangGraph AgentState from invoke()
   * @param adapter - Provider-specific adapter
   * @param options - Normalization options
   * @returns Sorted array of normalized events
   */
  normalize(
    state: AgentState,
    adapter: IProviderAdapter,
    options?: BatchNormalizerOptions
  ): NormalizedAgentEvent[] {
    const allEvents: NormalizedAgentEvent[] = [];
    const timestamp = new Date().toISOString();
    let indexCounter = 0;

    logger.debug({
      sessionId: adapter.sessionId,
      messageCount: state.messages?.length ?? 0,
      toolExecutionCount: state.toolExecutions?.length ?? 0,
    }, 'Starting batch normalization');

    // 1. Process ALL AI messages in order (not just last)
    // This enables proper ReAct loop support where multiple AI messages
    // contain thinking, tool_requests, and final responses
    const messages = state.messages ?? [];
    let lastAIMessageIndex = -1;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const msgType = msg._getType?.();

      if (msgType === 'ai' || msgType === 'assistant') {
        lastAIMessageIndex = i;

        // Normalize with error handling - don't abort entire batch on single message failure
        let messageEvents: NormalizedAgentEvent[] = [];
        try {
          messageEvents = adapter.normalizeMessage(msg, i);
        } catch (error) {
          logger.error(
            {
              sessionId: adapter.sessionId,
              messageIndex: i,
              error: error instanceof Error
                ? { message: error.message, stack: error.stack, name: error.name }
                : { value: String(error) },
            },
            'Failed to normalize message - skipping'
          );
          // Continue processing remaining messages
          continue;
        }

        // WARN: AI message that produced no events = potential data loss
        if (messageEvents.length === 0) {
          logger.warn({
            sessionId: adapter.sessionId,
            messageIndex: i,
            messageType: msgType,
            contentType: typeof msg.content,
            contentIsArray: Array.isArray(msg.content),
            contentLength: Array.isArray(msg.content) ? msg.content.length : (typeof msg.content === 'string' ? msg.content.length : 0),
          }, 'RAW_ANTHROPIC: AI message produced ZERO events - possible data loss');
        }

        // Reindex events with global counter
        for (const event of messageEvents) {
          allEvents.push({
            ...event,
            originalIndex: indexCounter++,
          });
        }
      }
    }

    // 2. Create tool_response events from state.toolExecutions
    // These need to be interleaved with tool_request events
    const toolExecutions = state.toolExecutions ?? [];
    const toolResponseMap = this.createToolResponseMap(
      toolExecutions,
      adapter.sessionId,
      timestamp
    );

    // 3. Interleave tool_response events after their corresponding tool_request
    const interleavedEvents: NormalizedAgentEvent[] = [];
    for (const event of allEvents) {
      interleavedEvents.push(event);

      // If this is a tool_request, insert the corresponding tool_response
      if (event.type === 'tool_request') {
        const toolResponse = toolResponseMap.get(event.toolUseId);
        if (toolResponse) {
          interleavedEvents.push({
            ...toolResponse,
            originalIndex: event.originalIndex + 0.5, // Between request and next event
          });
        }
      }
    }

    // 4. Optional: complete event
    if (options?.includeComplete) {
      const lastAIMessage = lastAIMessageIndex >= 0 ? messages[lastAIMessageIndex] : null;
      const stopReason = lastAIMessage
        ? this.extractStopReasonFromMessage(lastAIMessage, adapter)
        : 'end_turn';

      interleavedEvents.push(this.createCompleteEvent(
        adapter.sessionId,
        timestamp,
        stopReason,
        indexCounter++,
        state.usedModel ?? undefined
      ));
    }

    // 5. Sort by originalIndex to ensure correct order
    interleavedEvents.sort((a, b) => a.originalIndex - b.originalIndex);

    // 6. Reassign sequential indices
    const finalEvents = interleavedEvents.map((event, idx) => ({
      ...event,
      originalIndex: idx,
    }));

    // Count AI messages processed
    const aiMessageCount = messages.filter(m => {
      const t = m._getType?.();
      return t === 'ai' || t === 'assistant';
    }).length;

    logger.info({
      sessionId: adapter.sessionId,
      eventCount: finalEvents.length,
      aiMessageCount,
      usedModel: state.usedModel ?? 'unknown',
      eventTypes: finalEvents.map(e => e.type),
    }, 'Batch normalization complete');

    return finalEvents;
  }

  /**
   * Create a map of toolUseId -> tool_response event.
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
   * Extract stop reason from message using adapter.
   */
  private extractStopReasonFromMessage(
    message: BaseMessage,
    adapter: IProviderAdapter
  ): NormalizedStopReason {
    const meta = (message as {
      response_metadata?: { stop_reason?: string };
    }).response_metadata;
    return adapter.normalizeStopReason(meta?.stop_reason);
  }

  /**
   * Create a complete event.
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
   *
   * Mapping:
   * - max_tokens → max_turns (token limit reached)
   * - error → error
   * - cancelled → user_cancelled
   * - end_turn, tool_use, etc. → success
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
let instance: BatchResultNormalizer | null = null;

/**
 * Get singleton BatchResultNormalizer instance.
 */
export function getBatchResultNormalizer(): BatchResultNormalizer {
  if (!instance) {
    instance = new BatchResultNormalizer();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 * @internal
 */
export function __resetBatchResultNormalizer(): void {
  instance = null;
}
