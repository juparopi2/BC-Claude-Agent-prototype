import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { createChildLogger } from '@/shared/utils/logger';
import {
  IStreamAdapter,
  INormalizedStreamEvent,
  ProviderType,
  NormalizedToolCall,
  NormalizedUsage,
  NormalizedCitation
} from '../interfaces';

const logger = createChildLogger({ service: 'AnthropicStreamAdapter' });

/**
 * Adapter for Anthropic (Claude) stream events.
 * Handles normalization of:
 * - Text/Message chunks -> content_delta
 * - Thinking blocks -> reasoning_delta
 * - Citations -> citation
 * - Tool usage -> tool_call
 * - Usage -> usage
 */
export class AnthropicStreamAdapter implements IStreamAdapter {
  readonly provider: ProviderType = 'anthropic';
  private blockCounter = 0;

  constructor(private sessionId: string) {}

  reset(): void {
    this.blockCounter = 0;
    logger.debug({ sessionId: this.sessionId }, 'AnthropicStreamAdapter: Reset');
  }

  getCurrentBlockIndex(): number {
    return this.blockCounter;
  }

  private getNextBlockIndex(): number {
    return this.blockCounter++;
  }

  processChunk(event: StreamEvent): INormalizedStreamEvent | null {
    const eventType = event.event;

    // 1. Handle Chat Model Stream (Content)
    if (eventType === 'on_chat_model_stream') {
      return this.handleStreamChunk(event);
    }

    // 2. Handle Chat Model End (Usage)
    if (eventType === 'on_chat_model_end') {
      return this.handleStreamEnd(event);
    }

    // 3. Skip other events (on_tool_start, etc.)
    // We intentionally skip LangChain's tool events because they use internal run IDs
    // instead of the provider's tool IDs, causing mismatches.
    return null;
  }

  private handleStreamChunk(event: StreamEvent): INormalizedStreamEvent | null {
    const chunk = event.data.chunk;
    
    // Safety checks
    if (!chunk || (Array.isArray(chunk.content) && chunk.content.length === 0)) {
      return null;
    }

    // Common metadata
    const messageId = (chunk.id || event.run_id)?.toString();
    const isStreaming = true; // By definition in on_chat_model_stream

    const baseMetadata = {
      blockIndex: 0, // Overwritten by createEvent
      messageId,
      isStreaming,
      isFinal: false
    };

    // Handle Content Array (Rich blocks: thinking, tool_use, citations)
    if (Array.isArray(chunk.content)) {
      for (const block of chunk.content) {
        // A. Extended Thinking (thinking_delta)
        if (block.type === 'thinking' && block.thinking) {
          return this.createEvent('reasoning_delta', {
            reasoning: block.thinking,
            metadata: baseMetadata
          });
        }

        // B. Text Content (text_delta) + Citations
        if ((block.type === 'text' || block.type === 'text_delta') && block.text) {
          // Check for citations
          let citation: NormalizedCitation | undefined;
          if (block.citations && block.citations.length > 0) {
            // Note: Currently handling first citation if multiple. 
            // In a robust implementation, we might need to emit multiple events, 
            // but the interface return type is single event. 
            // For now, attaching the first one or we'd need to change architecture to return arrays.
            // Given streaming nature, usually they come one by one or close enough.
            const c = block.citations[0];
            citation = {
              text: c.cited_text,
              source: c.document_title || 'unknown',
              documentIndex: c.document_index,
              location: {
                start: c.start_char_index,
                end: c.end_char_index
              }
            };
          }

          return this.createEvent('content_delta', {
            content: block.text,
            citation,
            metadata: baseMetadata
          });
        }

        // C. Tool Use (tool_use block from Anthropic)
        if (block.type === 'tool_use') {
          // NormalizedToolCall creation
          // block.id IS the Anthropic ID (e.g. toolu_01...)
          const toolCall: NormalizedToolCall = {
            id: block.id, 
            name: block.name,
            input: block.input || {},
            providerId: block.id // Redundant but explicit
          };

          return this.createEvent('tool_call', {
            toolCall,
            metadata: baseMetadata
          });
        }
      }
      return null;
    }

    // Handle Simple String Content
    if (typeof chunk.content === 'string' && chunk.content) {
      return this.createEvent('content_delta', {
        content: chunk.content,
        metadata: baseMetadata
      });
    }

    return null;
  }

  private handleStreamEnd(event: StreamEvent): INormalizedStreamEvent | null {
    const output = event.data.output;
    if (output?.llmOutput?.usage) {
      const u = output.llmOutput.usage;
      
      const usage: NormalizedUsage = {
        inputTokens: u.input_tokens || 0,
        outputTokens: u.output_tokens || 0,
        // Optional provider specific tokens could be mapped here
      };

      return this.createEvent('usage', {
        usage,
        metadata: {
          blockIndex: 0,
          messageId: event.run_id,
          isStreaming: false,
          isFinal: true
        }
      });
    }
    return null;
  }

  private createEvent(
    type: INormalizedStreamEvent['type'],
    data: Partial<INormalizedStreamEvent>
  ): INormalizedStreamEvent {
    const blockIndex = this.getNextBlockIndex();

    // Spread data first, then override with calculated metadata
    // This ensures blockIndex is correctly incremented
    return {
      type,
      provider: this.provider,
      timestamp: new Date(),
      ...data,
      metadata: {
        blockIndex,
        messageId: data.metadata?.messageId,
        isStreaming: data.metadata?.isStreaming ?? true,
        isFinal: data.metadata?.isFinal ?? false
      }
    } as INormalizedStreamEvent;
  }
}
