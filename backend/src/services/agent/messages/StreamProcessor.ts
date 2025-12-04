/**
 * Stream Processor
 *
 * Handles Anthropic SDK streaming events and converts them to processed blocks.
 * Extracted from DirectAgentService for cleaner separation of concerns.
 *
 * This is a pure stream processor with NO side effects:
 * - No persistence logic
 * - No WebSocket emission
 * - No sequence number management
 *
 * Responsibilities:
 * 1. Process each Anthropic stream event
 * 2. Delegate accumulation to ContentBlockAccumulator
 * 3. Yield processed events (chunks, completed blocks, etc.)
 * 4. Track token usage and stop reason
 */

import type {
  MessageStreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ThinkingDelta,
  CitationsDelta,
  SignatureDelta,
} from '@anthropic-ai/sdk/resources/messages';
import { ContentBlockAccumulator } from './ContentBlockAccumulator';
import type {
  TurnResult,
  CompletedBlock,
} from './types';
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';

/**
 * Events yielded during stream processing
 * These are intermediate events for real-time display
 */
export type StreamEvent =
  | { type: 'message_start'; messageId: string; model: string; inputTokens: number; cacheTokens?: { creation: number; read: number } }
  | { type: 'text_chunk'; index: number; chunk: string }
  | { type: 'thinking_chunk'; index: number; chunk: string }
  | { type: 'tool_start'; index: number; toolId: string; toolName: string }
  | { type: 'tool_input_chunk'; index: number; partialJson: string }
  | { type: 'block_complete'; block: CompletedBlock }
  | { type: 'message_delta'; stopReason: string; outputTokens: number }
  | { type: 'message_stop' };

/**
 * Options for stream processing
 */
export interface StreamProcessorOptions {
  /** Session ID for logging context */
  sessionId?: string;
  /** Turn number for logging context */
  turnCount?: number;
}

export class StreamProcessor {
  private accumulator: ContentBlockAccumulator;
  private logger: Logger;

  // Message-level state
  private messageId: string | null = null;
  private model: string | null = null;
  private stopReason: string | null = null;
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private cacheCreationInputTokens: number = 0;
  private cacheReadInputTokens: number = 0;

  constructor(options: StreamProcessorOptions = {}) {
    this.accumulator = new ContentBlockAccumulator();
    this.logger = createChildLogger({
      service: 'StreamProcessor',
      sessionId: options.sessionId,
      turnCount: options.turnCount,
    });
  }

  /**
   * Process an Anthropic stream and yield events
   *
   * @param stream - AsyncIterable of Anthropic MessageStreamEvents
   * @yields StreamEvent for each significant event
   */
  async *processStream(
    stream: AsyncIterable<MessageStreamEvent>
  ): AsyncGenerator<StreamEvent, TurnResult, unknown> {
    this.reset();

    for await (const event of stream) {
      const streamEvents = this.handleEvent(event);
      for (const streamEvent of streamEvents) {
        yield streamEvent;
      }
    }

    // Return final turn result
    return this.getTurnResult();
  }

  /**
   * Handle a single stream event
   * Returns array of StreamEvents to yield (most events yield 0-1)
   */
  private handleEvent(event: MessageStreamEvent): StreamEvent[] {
    switch (event.type) {
      case 'message_start':
        return this.handleMessageStart(event);

      case 'content_block_start':
        return this.handleContentBlockStart(event);

      case 'content_block_delta':
        return this.handleContentBlockDelta(event);

      case 'content_block_stop':
        return this.handleContentBlockStop(event);

      case 'message_delta':
        return this.handleMessageDelta(event);

      case 'message_stop':
        return [{ type: 'message_stop' }];

      default:
        this.logger.debug({ eventType: (event as MessageStreamEvent).type }, 'Unknown event type');
        return [];
    }
  }

  /**
   * Handle message_start event
   */
  private handleMessageStart(event: MessageStreamEvent & { type: 'message_start' }): StreamEvent[] {
    this.messageId = event.message.id;
    this.model = event.message.model;
    this.inputTokens = event.message.usage.input_tokens;

    // Capture cache tokens if available
    const usage = event.message.usage as {
      input_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };

    if (usage.cache_creation_input_tokens) {
      this.cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens) {
      this.cacheReadInputTokens = usage.cache_read_input_tokens;
    }

    this.logger.info({
      messageId: this.messageId,
      model: this.model,
      inputTokens: this.inputTokens,
      cacheRead: this.cacheReadInputTokens,
      cacheCreate: this.cacheCreationInputTokens,
    }, 'Message started');

    return [{
      type: 'message_start',
      messageId: this.messageId,
      model: this.model,
      inputTokens: this.inputTokens,
      cacheTokens: (this.cacheCreationInputTokens > 0 || this.cacheReadInputTokens > 0)
        ? { creation: this.cacheCreationInputTokens, read: this.cacheReadInputTokens }
        : undefined,
    }];
  }

  /**
   * Handle content_block_start event
   */
  private handleContentBlockStart(event: MessageStreamEvent & { type: 'content_block_start' }): StreamEvent[] {
    const { index, content_block } = event;
    const events: StreamEvent[] = [];

    this.logger.debug({
      index,
      blockType: content_block.type,
    }, 'Content block started');

    if (content_block.type === 'text') {
      this.accumulator.startBlock(index, 'text');
    } else if (content_block.type === 'thinking') {
      this.accumulator.startBlock(index, 'thinking');
    } else if (content_block.type === 'tool_use') {
      // Validate tool use ID from Anthropic
      let toolUseId = content_block.id;

      if (!toolUseId || toolUseId === 'undefined' || typeof toolUseId !== 'string' || toolUseId.trim() === '') {
        toolUseId = `toolu_fallback_${randomUUID()}`;
        this.logger.error({
          index,
          originalId: content_block.id,
          fallbackId: toolUseId,
        }, 'SDK did not provide valid tool_use_id - using fallback');
      }

      this.accumulator.startBlock(index, 'tool_use', {
        id: toolUseId,
        name: content_block.name,
      });

      events.push({
        type: 'tool_start',
        index,
        toolId: toolUseId,
        toolName: content_block.name,
      });
    }

    return events;
  }

  /**
   * Handle content_block_delta event
   */
  private handleContentBlockDelta(event: MessageStreamEvent & { type: 'content_block_delta' }): StreamEvent[] {
    const { index, delta } = event;
    const events: StreamEvent[] = [];

    if (delta.type === 'text_delta') {
      const chunk = delta.text;
      this.accumulator.appendDelta(index, 'text_delta', chunk);

      if (chunk) {
        events.push({ type: 'text_chunk', index, chunk });
      }
    } else if (delta.type === 'thinking_delta') {
      const thinkingDelta = delta as ThinkingDelta;
      const chunk = thinkingDelta.thinking;
      this.accumulator.appendDelta(index, 'thinking_delta', chunk);

      if (chunk) {
        events.push({ type: 'thinking_chunk', index, chunk });
      }
    } else if (delta.type === 'input_json_delta') {
      const partialJson = delta.partial_json;
      this.accumulator.appendDelta(index, 'input_json_delta', partialJson);

      if (partialJson) {
        events.push({ type: 'tool_input_chunk', index, partialJson });
      }
    } else if (delta.type === 'citations_delta') {
      const citationsDelta = delta as CitationsDelta;
      this.accumulator.appendDelta(index, 'citations_delta', citationsDelta.citation);
    } else if (delta.type === 'signature_delta') {
      const signatureDelta = delta as SignatureDelta;
      this.accumulator.appendDelta(index, 'signature_delta', signatureDelta.signature);
    }

    return events;
  }

  /**
   * Handle content_block_stop event
   */
  private handleContentBlockStop(event: MessageStreamEvent & { type: 'content_block_stop' }): StreamEvent[] {
    const { index } = event;
    const completedBlock = this.accumulator.completeBlock(index);

    if (completedBlock) {
      this.logger.debug({
        index,
        type: completedBlock.type,
      }, 'Content block completed');

      return [{ type: 'block_complete', block: completedBlock }];
    }

    return [];
  }

  /**
   * Handle message_delta event
   */
  private handleMessageDelta(event: MessageStreamEvent & { type: 'message_delta' }): StreamEvent[] {
    if (event.delta.stop_reason) {
      this.stopReason = event.delta.stop_reason;
    }

    if (event.usage) {
      this.outputTokens = event.usage.output_tokens;
    }

    this.logger.info({
      stopReason: this.stopReason,
      outputTokens: this.outputTokens,
    }, 'Message delta received');

    return [{
      type: 'message_delta',
      stopReason: this.stopReason || 'unknown',
      outputTokens: this.outputTokens,
    }];
  }

  /**
   * Reset processor state for a new turn
   */
  reset(): void {
    this.accumulator.clear();
    this.messageId = null;
    this.model = null;
    this.stopReason = null;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheCreationInputTokens = 0;
    this.cacheReadInputTokens = 0;

    this.logger.debug('Processor state reset');
  }

  /**
   * Get the final turn result after stream completes
   */
  getTurnResult(): TurnResult {
    const blocks = this.accumulator.getBlocksInAnthropicOrder();

    this.logger.info({
      messageId: this.messageId,
      model: this.model,
      stopReason: this.stopReason,
      blocksCount: blocks.length,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    }, 'Turn completed');

    return {
      messageId: this.messageId,
      model: this.model,
      stopReason: this.stopReason,
      blocks,
      usage: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        cacheCreationInputTokens: this.cacheCreationInputTokens > 0 ? this.cacheCreationInputTokens : undefined,
        cacheReadInputTokens: this.cacheReadInputTokens > 0 ? this.cacheReadInputTokens : undefined,
      },
    };
  }

  /**
   * Get accumulated text content (for real-time display)
   */
  getAccumulatedText(): string {
    return this.accumulator.getAccumulatedText();
  }

  /**
   * Get current message ID
   */
  getMessageId(): string | null {
    return this.messageId;
  }

  /**
   * Get current model name
   */
  getModel(): string | null {
    return this.model;
  }

  /**
   * Get current stop reason
   */
  getStopReason(): string | null {
    return this.stopReason;
  }

  /**
   * Get content block accumulator for advanced access
   */
  getAccumulator(): ContentBlockAccumulator {
    return this.accumulator;
  }

  /**
   * Get state summary for debugging
   */
  getStateSummary(): {
    messageId: string | null;
    model: string | null;
    stopReason: string | null;
    inputTokens: number;
    outputTokens: number;
    accumulatorState: ReturnType<ContentBlockAccumulator['getStateSummary']>;
  } {
    return {
      messageId: this.messageId,
      model: this.model,
      stopReason: this.stopReason,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      accumulatorState: this.accumulator.getStateSummary(),
    };
  }
}

/**
 * Convert completed blocks to Anthropic SDK format for conversation history
 * This maintains compatibility with the existing DirectAgentService pattern
 */
export function blocksToAnthropicFormat(blocks: CompletedBlock[]): Array<ThinkingBlock | TextBlock | ToolUseBlock> {
  const result: Array<ThinkingBlock | TextBlock | ToolUseBlock> = [];

  for (const block of blocks) {
    if (block.content.type === 'thinking') {
      result.push({
        type: 'thinking',
        thinking: block.content.thinking,
        signature: block.content.signature,
      });
    } else if (block.content.type === 'text') {
      result.push({
        type: 'text',
        text: block.content.text,
        citations: block.content.citations,
      });
    } else if (block.content.type === 'tool_use') {
      result.push({
        type: 'tool_use',
        id: block.content.id,
        name: block.content.name,
        input: block.content.input,
      });
    }
  }

  return result;
}
