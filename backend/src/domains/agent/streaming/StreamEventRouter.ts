/**
 * @module domains/agent/streaming/StreamEventRouter
 *
 * Routes LangGraph stream events to appropriate processors.
 * Separates:
 * - Adapter events (on_chat_model_stream) → GraphStreamProcessor via normalized events
 * - Chain events (on_chain_end with toolExecutions) → ToolExecutionProcessor
 *
 * @example
 * ```typescript
 * const router = createStreamEventRouter();
 * const adapter = StreamAdapterFactory.create('anthropic', sessionId);
 *
 * for await (const routed of router.route(eventStream, adapter)) {
 *   if (routed.type === 'normalized') {
 *     // Process with GraphStreamProcessor
 *   } else if (routed.type === 'tool_executions') {
 *     // Process with ToolExecutionProcessor
 *   }
 * }
 * ```
 */

import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { IStreamAdapter } from '@shared/providers/interfaces/IStreamAdapter';
import type { RawToolExecution } from '@domains/agent/tools/types';
import type { RoutedEvent, IStreamEventRouter } from './types';
import { createChildLogger } from '@/shared/utils/logger';

/**
 * Routes LangGraph stream events to appropriate processors.
 */
export class StreamEventRouter implements IStreamEventRouter {
  private readonly logger = createChildLogger({ service: 'StreamEventRouter' });

  /**
   * Route events from LangGraph stream.
   * @param eventStream - Raw LangGraph streamEvents
   * @param adapter - StreamAdapter for normalizing chat model events
   * @yields RoutedEvent - Either normalized event or tool executions
   */
  async *route(
    eventStream: AsyncIterable<StreamEvent>,
    adapter: IStreamAdapter
  ): AsyncGenerator<RoutedEvent> {
    for await (const event of eventStream) {
      // 1. Try to normalize via adapter (on_chat_model_stream events)
      const normalized = adapter.processChunk(event);
      if (normalized) {
        yield { type: 'normalized', event: normalized };
        continue;
      }

      // 2. Check for on_chain_end with toolExecutions
      // Skip LangGraph internal events and __end__ (final graph completion)
      if (event.event === 'on_chain_end' && event.name !== 'LangGraph' && event.name !== '__end__') {
        const toolExecutions = this.extractToolExecutions(event);
        if (toolExecutions.length > 0) {
          this.logger.debug({
            agentName: event.name,
            executionsCount: toolExecutions.length,
          }, 'Routing tool executions from agent chain end');

          yield {
            type: 'tool_executions',
            executions: toolExecutions,
            agentName: event.name,
          };
        }
      }
    }
  }

  /**
   * Extract tool executions from on_chain_end event.
   * Maps LangGraph format to RawToolExecution format.
   */
  private extractToolExecutions(event: StreamEvent): RawToolExecution[] {
    const output = event.data?.output as Record<string, unknown> | undefined;
    const toolExecutions = output?.toolExecutions;

    if (!toolExecutions || !Array.isArray(toolExecutions)) {
      return [];
    }

    return toolExecutions.map((exec: Record<string, unknown>): RawToolExecution => ({
      toolUseId: String(exec.toolUseId ?? ''),
      toolName: String(exec.toolName ?? ''),
      args: (exec.args as Record<string, unknown>) ?? {},
      result: String(exec.result ?? ''),
      success: exec.success !== false,
      error: exec.error ? String(exec.error) : undefined,
    }));
  }
}

/**
 * Factory function to create StreamEventRouter instances.
 * Each agent run should have its own router.
 *
 * @returns New StreamEventRouter instance
 */
export function createStreamEventRouter(): StreamEventRouter {
  return new StreamEventRouter();
}
