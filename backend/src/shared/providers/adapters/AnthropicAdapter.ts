/**
 * Anthropic Adapter for Batch Result Normalization
 *
 * Adapter for normalizing Anthropic/Claude batch results.
 * Handles message structures from @langchain/anthropic.
 *
 * Content block types:
 * - thinking: Extended thinking (Claude 3.5+)
 * - text / text_delta: Text content
 * - tool_use: Tool invocation
 *
 * @module shared/providers/adapters/AnthropicAdapter
 */

import { randomUUID } from 'crypto';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedAssistantMessageEvent,
  NormalizedToolRequestEvent,
  NormalizedStopReason,
  NormalizedTokenUsage,
} from '@bc-agent/shared';
import type { IProviderAdapter, ContentBlockType } from '../interfaces/IProviderAdapter';
import { createChildLogger } from '@/shared/utils/logger';
import { AnthropicModels } from '@/infrastructure/config/models';

const logger = createChildLogger({ service: 'AnthropicAdapter' });

/**
 * Content block interfaces for Anthropic API.
 */
interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface TextBlock {
  type: 'text' | 'text_delta';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Union type for known Anthropic content blocks.
 * Strict typing - unknown block types will fail type guards and be skipped.
 */
type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

/**
 * Type guard for thinking blocks.
 */
function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking' && 'thinking' in block;
}

/**
 * Type guard for text blocks.
 */
function isTextBlock(block: ContentBlock): block is TextBlock {
  return (block.type === 'text' || block.type === 'text_delta') && 'text' in block;
}

/**
 * Type guard for tool_use blocks.
 */
function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use' && 'id' in block && 'name' in block;
}

/**
 * Anthropic adapter for batch result normalization.
 *
 * Converts Claude message structures to NormalizedAgentEvent[].
 */
export class AnthropicAdapter implements IProviderAdapter {
  readonly provider = 'anthropic' as const;

  constructor(
    readonly sessionId: string,
    private readonly defaultModel: string = AnthropicModels.SONNET_4_5
  ) {}

  /**
   * Normalize a LangChain message into normalized events.
   *
   * Processing order:
   * 1. Extract thinking blocks -> NormalizedThinkingEvent
   * 2. Extract text blocks -> (accumulated for assistant_message)
   * 3. Extract tool_use blocks -> NormalizedToolRequestEvent[]
   * 4. Create final assistant_message with accumulated text
   */
  normalizeMessage(
    message: BaseMessage,
    messageIndex: number
  ): NormalizedAgentEvent[] {
    const events: NormalizedAgentEvent[] = [];
    const timestamp = new Date().toISOString();
    let eventIndex = 0;

    // Only process AI messages
    const messageType = message._getType?.();
    if (messageType !== 'ai' && messageType !== 'assistant') {
      return events;
    }

    const content = message.content;
    const messageId = this.extractMessageId(message);
    const usage = this.extractUsage(message);
    const stopReason = this.extractStopReason(message);
    const model = this.extractModel(message);

    // Handle string content (simple case)
    if (typeof content === 'string') {
      if (content.trim()) {
        events.push(this.createAssistantMessageEvent(
          messageId,
          content,
          stopReason,
          model,
          usage,
          timestamp,
          messageIndex * 100 + eventIndex++
        ));
      }
      return events;
    }

    // Handle array content (rich blocks)
    if (Array.isArray(content)) {
      // DEBUG: Log content blocks before processing
      logger.debug({
        sessionId: this.sessionId,
        messageIndex,
        blockCount: content.length,
        blocks: (content as ContentBlock[]).map((block, idx) => ({
          index: idx,
          type: block.type,
          hasText: 'text' in block,
          hasThinking: 'thinking' in block,
          toolName: 'name' in block ? (block as ToolUseBlock).name : undefined,
          toolId: 'id' in block ? (block as ToolUseBlock).id : undefined,
        })),
      }, 'RAW_ANTHROPIC: Content blocks to process');

      let thinkingContent = '';
      let textContent = '';
      const toolRequests: NormalizedToolRequestEvent[] = [];

      for (const block of content as ContentBlock[]) {
        const blockType = this.detectBlockType(block);

        switch (blockType) {
          case 'thinking':
            if (isThinkingBlock(block)) {
              thinkingContent += block.thinking;
            }
            break;

          case 'text':
            if (isTextBlock(block)) {
              textContent += block.text;
            }
            break;

          case 'tool_use': {
            if (isToolUseBlock(block)) {
              toolRequests.push(this.createToolRequestEvent(
                block,
                timestamp,
                messageIndex * 100 + eventIndex++
              ));
            }
            break;
          }
        }
      }

      // Emit thinking first (if present)
      if (thinkingContent) {
        events.push(this.createThinkingEvent(
          messageId,
          thinkingContent,
          usage?.thinkingTokens,
          timestamp,
          messageIndex * 100 + eventIndex++
        ));
      }

      // Emit tool requests
      events.push(...toolRequests);

      // Emit assistant message (if text content exists)
      if (textContent.trim()) {
        events.push(this.createAssistantMessageEvent(
          messageId,
          textContent,
          stopReason,
          model,
          usage,
          timestamp,
          messageIndex * 100 + eventIndex++
        ));
      }
    }

    return events;
  }

  /**
   * Detect content block type.
   * Uses type narrowing to safely determine block type.
   */
  detectBlockType(block: ContentBlock): ContentBlockType | null {
    switch (block.type) {
      case 'thinking':
        return 'thinking';
      case 'text':
      case 'text_delta':
        return 'text';
      case 'tool_use':
        return 'tool_use';
      default:
        return null;
    }
  }

  /**
   * Normalize Anthropic stop reason.
   */
  normalizeStopReason(stopReason: string | undefined): NormalizedStopReason {
    if (!stopReason) return 'end_turn';

    const mapping: Record<string, NormalizedStopReason> = {
      'end_turn': 'end_turn',
      'stop': 'end_turn',
      'max_tokens': 'max_tokens',
      'tool_use': 'tool_use',
      'stop_sequence': 'end_turn',
    };

    const normalized = mapping[stopReason];
    if (!normalized) {
      logger.warn(
        { sessionId: this.sessionId, stopReason },
        'Unknown Anthropic stop reason, defaulting to end_turn'
      );
      return 'end_turn';
    }

    return normalized;
  }

  /**
   * Extract token usage from response metadata.
   * Includes thinkingTokens extraction from extended thinking blocks.
   */
  extractUsage(message: BaseMessage): NormalizedTokenUsage | null {
    // Try response_metadata first
    const responseMeta = (message as {
      response_metadata?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    }).response_metadata;

    let usage: NormalizedTokenUsage | null = null;

    if (responseMeta?.usage) {
      usage = {
        inputTokens: responseMeta.usage.input_tokens ?? 0,
        outputTokens: responseMeta.usage.output_tokens ?? 0,
      };
    } else {
      // Try usage_metadata (LangChain 0.3+)
      const usageMeta = (message as {
        usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      }).usage_metadata;

      if (usageMeta) {
        usage = {
          inputTokens: usageMeta.input_tokens ?? 0,
          outputTokens: usageMeta.output_tokens ?? 0,
        };
      }
    }

    // Extract thinkingTokens from content blocks if present
    // Extended thinking blocks may include token count in the block metadata
    if (usage) {
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content as ContentBlock[]) {
          // Check for thinking_tokens in the block (Anthropic API may include this)
          const thinkingBlock = block as { type?: string; thinking_tokens?: number };
          if (thinkingBlock.type === 'thinking' && typeof thinkingBlock.thinking_tokens === 'number') {
            usage.thinkingTokens = thinkingBlock.thinking_tokens;
            break;
          }
        }
      }
    }

    return usage;
  }

  /**
   * Extract message ID from Anthropic response.
   */
  extractMessageId(message: BaseMessage): string {
    // Anthropic messages have ID in response_metadata or as property
    const id = (message as { id?: string }).id;
    if (id) return id;

    const responseMeta = (message as {
      response_metadata?: { id?: string };
    }).response_metadata;
    if (responseMeta?.id) return responseMeta.id;

    // Fallback to generated UUID - this indicates data loss risk
    logger.error(
      { sessionId: this.sessionId },
      'No message ID found in Anthropic response - generating UUID fallback. This may affect traceability.'
    );
    return randomUUID();
  }

  // =========================================================================
  // Private helper methods
  // =========================================================================

  /**
   * Extract stop reason from message metadata.
   */
  private extractStopReason(message: BaseMessage): NormalizedStopReason {
    const responseMeta = (message as {
      response_metadata?: { stop_reason?: string };
    }).response_metadata;

    const stopReason = responseMeta?.stop_reason;

    // Also check additional_kwargs as fallback
    if (!stopReason) {
      const additionalKwargs = (message as {
        additional_kwargs?: { stop_reason?: string };
      }).additional_kwargs;
      return this.normalizeStopReason(additionalKwargs?.stop_reason);
    }

    return this.normalizeStopReason(stopReason);
  }

  /**
   * Extract model from message metadata.
   */
  private extractModel(message: BaseMessage): string {
    const responseMeta = (message as {
      response_metadata?: { model?: string };
    }).response_metadata;

    return responseMeta?.model ?? this.defaultModel;
  }

  /**
   * Create a thinking event.
   */
  private createThinkingEvent(
    messageId: string,
    content: string,
    thinkingTokens: number | undefined,
    timestamp: string,
    originalIndex: number
  ): NormalizedThinkingEvent {
    return {
      type: 'thinking',
      eventId: randomUUID(),
      sessionId: this.sessionId,
      timestamp,
      originalIndex,
      persistenceStrategy: 'sync_required',
      provider: 'anthropic',
      messageId,
      content,
      tokenUsage: thinkingTokens !== undefined
        ? { inputTokens: 0, outputTokens: 0, thinkingTokens }
        : undefined,
    };
  }

  /**
   * Create a tool request event.
   */
  private createToolRequestEvent(
    block: ToolUseBlock,
    timestamp: string,
    originalIndex: number
  ): NormalizedToolRequestEvent {
    return {
      type: 'tool_request',
      eventId: randomUUID(),
      sessionId: this.sessionId,
      timestamp,
      originalIndex,
      persistenceStrategy: 'async_allowed',
      provider: 'anthropic',
      toolUseId: block.id,
      toolName: block.name,
      args: block.input,
    };
  }

  /**
   * Create an assistant message event.
   */
  private createAssistantMessageEvent(
    messageId: string,
    content: string,
    stopReason: NormalizedStopReason,
    model: string,
    usage: NormalizedTokenUsage | null,
    timestamp: string,
    originalIndex: number
  ): NormalizedAssistantMessageEvent {
    return {
      type: 'assistant_message',
      eventId: randomUUID(),
      sessionId: this.sessionId,
      timestamp,
      originalIndex,
      persistenceStrategy: 'sync_required',
      provider: 'anthropic',
      messageId,
      content,
      stopReason,
      model,
      tokenUsage: usage ?? { inputTokens: 0, outputTokens: 0 },
    };
  }
}
