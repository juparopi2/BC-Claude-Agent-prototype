/**
 * @module domains/agent/streaming/GraphStreamProcessor
 *
 * Processes normalized stream events from LangGraph and yields ProcessedStreamEvents.
 * Extracted from DirectAgentService.runGraph() streaming logic (lines 500-1200).
 *
 * ## Stateless Architecture
 *
 * This processor is STATELESS - all mutable state lives in ExecutionContext.
 * This enables:
 * - Multi-tenant isolation (no shared state between executions)
 * - Horizontal scaling in Azure Container Apps
 * - No cleanup required between executions
 *
 * State managed via ExecutionContext:
 * - ctx.thinkingChunks: Accumulated thinking content
 * - ctx.thinkingComplete: Flag when thinking phase ends
 * - ctx.contentChunks: Accumulated response content
 * - ctx.lastStopReason: Stop reason from stream
 * - ctx.seenToolIds: Tool deduplication (shared with ToolExecutionProcessor)
 */

import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type { ProcessedStreamEvent } from './types';
import type { ExecutionContext } from '@domains/agent/orchestration/ExecutionContext';
import { markToolSeen } from '@domains/agent/orchestration/ExecutionContext';

export interface IGraphStreamProcessor {
  process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    ctx: ExecutionContext
  ): AsyncGenerator<ProcessedStreamEvent>;
}

/**
 * Stateless stream processor.
 * All mutable state is stored in ExecutionContext, not in this class.
 */
export class GraphStreamProcessor implements IGraphStreamProcessor {
  // NO instance fields - completely stateless

  async *process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    ctx: ExecutionContext
  ): AsyncGenerator<ProcessedStreamEvent> {
    // No reset needed - ctx is fresh per execution

    for await (const event of normalizedEvents) {
      const processed = this.processEvent(event, ctx);
      if (processed) {
        // Handle both single events and arrays of events
        if (Array.isArray(processed)) {
          for (const evt of processed) {
            yield evt;
          }
        } else {
          yield processed;
        }
      }
    }
  }

  private processEvent(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): ProcessedStreamEvent | ProcessedStreamEvent[] | null {
    switch (event.type) {
      case 'reasoning_delta':
        return this.handleReasoningDelta(event, ctx);
      case 'content_delta':
        return this.handleContentDelta(event, ctx);
      case 'tool_call':
        return this.handleToolCall(event, ctx);
      case 'usage':
        return this.handleUsage(event);
      case 'stream_end':
        return this.handleStreamEnd(event, ctx);
      default:
        return null;
    }
  }

  private handleReasoningDelta(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): ProcessedStreamEvent {
    const content = event.reasoning || '';
    ctx.thinkingChunks.push(content);
    return {
      type: 'thinking_chunk',
      content,
      blockIndex: event.metadata?.blockIndex ?? 0,
    };
  }

  private handleContentDelta(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): ProcessedStreamEvent | ProcessedStreamEvent[] {
    // If we have thinking and it's not yet marked complete, emit thinking_complete
    if (ctx.thinkingChunks.length > 0 && !ctx.thinkingComplete) {
      ctx.thinkingComplete = true;

      const thinkingComplete: ProcessedStreamEvent = {
        type: 'thinking_complete',
        content: ctx.thinkingChunks.join(''),
        blockIndex: 0, // Thinking is always block 0
      };

      // Now process the content_delta
      const content = event.content || '';
      ctx.contentChunks.push(content);
      const messageChunk: ProcessedStreamEvent = {
        type: 'message_chunk',
        content,
        blockIndex: event.metadata?.blockIndex ?? 1,
      };

      return [thinkingComplete, messageChunk]; // Return array of events
    }

    // Normal content processing
    const content = event.content || '';
    ctx.contentChunks.push(content);
    return {
      type: 'message_chunk',
      content,
      blockIndex: event.metadata?.blockIndex ?? 1,
    };
  }

  private handleToolCall(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): ProcessedStreamEvent | null {
    const toolCall = event.toolCall;
    if (!toolCall) {
      return null;
    }

    // Deduplicate using shared ctx.seenToolIds
    const result = markToolSeen(ctx, toolCall.id);
    if (result.isDuplicate) {
      return null; // Skip duplicate
    }

    return {
      type: 'tool_execution',
      execution: {
        toolUseId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input,
        // output and error are set later by tool executor
      },
    };
  }

  private handleStreamEnd(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): ProcessedStreamEvent | ProcessedStreamEvent[] | null {
    const results: ProcessedStreamEvent[] = [];
    const stopReason = this.determineStopReason(event, ctx);

    // Emit usage if present on stream_end event (common pattern for on_chat_model_end)
    if (event.usage) {
      results.push({
        type: 'usage',
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
      });
    }

    // Emit thinking_complete if thinking wasn't completed yet (edge case)
    if (ctx.thinkingChunks.length > 0 && !ctx.thinkingComplete) {
      ctx.thinkingComplete = true;
      results.push({
        type: 'thinking_complete',
        content: ctx.thinkingChunks.join(''),
        blockIndex: 0,
      });
    }

    // Emit final_response if we have content
    if (ctx.contentChunks.length > 0) {
      results.push({
        type: 'final_response',
        content: ctx.contentChunks.join(''),
        stopReason,
      });
    }

    return results.length > 0 ? (results.length === 1 ? results[0] : results) : null;
  }

  private handleUsage(event: INormalizedStreamEvent): ProcessedStreamEvent | null {
    const usage = event.usage;
    if (!usage) {
      return null;
    }

    return {
      type: 'usage',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }

  private determineStopReason(
    event: INormalizedStreamEvent,
    ctx: ExecutionContext
  ): string {
    // Check if event has explicit stop reason in raw data
    if (event.raw && typeof event.raw === 'object') {
      const raw = event.raw as Record<string, unknown>;
      if (typeof raw['stop_reason'] === 'string') {
        ctx.lastStopReason = raw['stop_reason'];
        return raw['stop_reason'];
      }
    }

    // Use last tracked stop reason from context
    return ctx.lastStopReason;
  }
}

// ============================================================================
// Singleton Pattern
// ============================================================================

let instance: GraphStreamProcessor | null = null;

/**
 * Get the singleton GraphStreamProcessor instance.
 * Safe for concurrent use because all state lives in ExecutionContext.
 */
export function getGraphStreamProcessor(): GraphStreamProcessor {
  if (!instance) {
    instance = new GraphStreamProcessor();
  }
  return instance;
}

/**
 * Create a new GraphStreamProcessor instance.
 * @deprecated Use getGraphStreamProcessor() for production.
 * Only use this for testing with dependency injection.
 */
export function createGraphStreamProcessor(): GraphStreamProcessor {
  return new GraphStreamProcessor();
}

/**
 * Reset singleton for testing.
 * @internal Only for unit tests
 */
export function __resetGraphStreamProcessor(): void {
  instance = null;
}
