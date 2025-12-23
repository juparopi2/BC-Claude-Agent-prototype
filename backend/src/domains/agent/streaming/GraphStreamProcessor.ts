/**
 * @module domains/agent/streaming/GraphStreamProcessor
 *
 * Processes normalized stream events from LangGraph and yields ProcessedStreamEvents.
 * Extracted from DirectAgentService.runGraph() streaming logic (lines 500-1200).
 */

import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type {
  IThinkingAccumulator,
  IContentAccumulator,
  ProcessedStreamEvent,
} from './types';
import type { IToolEventDeduplicator } from '@domains/agent/tools/types';

export interface StreamProcessorContext {
  sessionId: string;
  userId: string;
  enableThinking?: boolean;
}

export interface IGraphStreamProcessor {
  process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    context: StreamProcessorContext
  ): AsyncGenerator<ProcessedStreamEvent>;
}

export class GraphStreamProcessor implements IGraphStreamProcessor {
  private lastStopReason: string = 'end_turn';

  constructor(
    private readonly thinkingAccumulator: IThinkingAccumulator,
    private readonly contentAccumulator: IContentAccumulator,
    private readonly toolEventDeduplicator?: IToolEventDeduplicator
  ) {}

  async *process(
    normalizedEvents: AsyncIterable<INormalizedStreamEvent>,
    context: StreamProcessorContext
  ): AsyncGenerator<ProcessedStreamEvent> {
    // Reset accumulators for new stream
    this.thinkingAccumulator.reset();
    this.contentAccumulator.reset();
    this.toolEventDeduplicator?.reset();
    this.lastStopReason = 'end_turn';

    for await (const event of normalizedEvents) {
      const processed = this.processEvent(event, context);
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
    _context: StreamProcessorContext
  ): ProcessedStreamEvent | ProcessedStreamEvent[] | null {
    switch (event.type) {
      case 'reasoning_delta':
        return this.handleReasoningDelta(event);
      case 'content_delta':
        return this.handleContentDelta(event);
      case 'tool_call':
        return this.handleToolCall(event);
      case 'usage':
        return this.handleUsage(event);
      case 'stream_end':
        return this.handleStreamEnd(event);
      default:
        return null;
    }
  }

  private handleReasoningDelta(
    event: INormalizedStreamEvent
  ): ProcessedStreamEvent {
    const content = event.reasoning || '';
    this.thinkingAccumulator.append(content);
    return {
      type: 'thinking_chunk',
      content,
      blockIndex: event.metadata.blockIndex,
    };
  }

  private handleContentDelta(
    event: INormalizedStreamEvent
  ): ProcessedStreamEvent | ProcessedStreamEvent[] {
    // If we have thinking and it's not yet marked complete, emit thinking_complete
    if (
      this.thinkingAccumulator.hasContent() &&
      !this.thinkingAccumulator.isComplete()
    ) {
      this.thinkingAccumulator.markComplete();

      const thinkingComplete: ProcessedStreamEvent = {
        type: 'thinking_complete',
        content: this.thinkingAccumulator.getContent(),
        blockIndex: 0, // Thinking is always block 0
      };

      // Now process the content_delta
      const content = event.content || '';
      this.contentAccumulator.append(content);
      const messageChunk: ProcessedStreamEvent = {
        type: 'message_chunk',
        content,
        blockIndex: event.metadata.blockIndex,
      };

      return [thinkingComplete, messageChunk]; // Return array of events
    }

    // Normal content processing
    const content = event.content || '';
    this.contentAccumulator.append(content);
    return {
      type: 'message_chunk',
      content,
      blockIndex: event.metadata.blockIndex,
    };
  }

  private handleToolCall(event: INormalizedStreamEvent): ProcessedStreamEvent | null {
    const toolCall = event.toolCall;
    if (!toolCall) {
      return null;
    }

    // Deduplicate if deduplicator is provided
    if (this.toolEventDeduplicator) {
      const result = this.toolEventDeduplicator.checkAndMark(toolCall.id);
      if (result.isDuplicate) {
        return null; // Skip duplicate
      }
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

  private handleStreamEnd(event: INormalizedStreamEvent): ProcessedStreamEvent | ProcessedStreamEvent[] | null {
    const results: ProcessedStreamEvent[] = [];
    const stopReason = this.determineStopReason(event);

    // Emit usage if present on stream_end event (common pattern for on_chat_model_end)
    if (event.usage) {
      results.push({
        type: 'usage',
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
      });
    }

    // Emit thinking_complete if thinking wasn't completed yet (edge case)
    if (this.thinkingAccumulator.hasContent() && !this.thinkingAccumulator.isComplete()) {
      this.thinkingAccumulator.markComplete();
      results.push({
        type: 'thinking_complete',
        content: this.thinkingAccumulator.getContent(),
        blockIndex: 0,
      });
    }

    // Emit final_response if we have content
    if (this.contentAccumulator.hasContent()) {
      results.push({
        type: 'final_response',
        content: this.contentAccumulator.getContent(),
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

  private determineStopReason(event: INormalizedStreamEvent): string {
    // Check if event has explicit stop reason in raw data
    if (event.raw && typeof event.raw === 'object') {
      const raw = event.raw as Record<string, unknown>;
      if (typeof raw['stop_reason'] === 'string') {
        return raw['stop_reason'];
      }
    }

    // Use last tracked stop reason or default
    return this.lastStopReason;
  }
}

// Factory function
export function createGraphStreamProcessor(
  thinkingAccumulator: IThinkingAccumulator,
  contentAccumulator: IContentAccumulator,
  toolEventDeduplicator?: IToolEventDeduplicator
): GraphStreamProcessor {
  return new GraphStreamProcessor(thinkingAccumulator, contentAccumulator, toolEventDeduplicator);
}
