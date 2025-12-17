import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { AIMessageChunk } from '@langchain/core/messages';
import { AgentEvent, UsageEvent, Citation } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'StreamAdapter' });

/**
 * Adapter to convert LangChain stream events to our legacy AgentEvent format.
 * This ensures the frontend doesn't need to change immediately.
 *
 * FIX 2: Added blockIndex tracking for proper message ordering during streaming.
 * The blockIndex is used by the frontend to sort transient events before
 * they get their final sequence_number from persistence.
 *
 * @deprecated Use StreamAdapterFactory and AnthropicStreamAdapter instead.
 * This class is maintained for backward compatibility and reference but will be removed.
 */
export class StreamAdapter {
  // sessionId parameter reserved for future event tracking with session context
  private _sessionId: string;

  // FIX 2: Block counter for ordering events during streaming
  // Each content block (thinking, text, tool_use) gets a unique index
  // This allows the frontend to sort events correctly before persistence completes
  private blockCounter = 0;

  constructor(sessionId: string) {
    this._sessionId = sessionId;
  }

  /**
   * Reset the block counter (call when starting a new message/turn)
   */
  resetBlockCounter(): void {
    this.blockCounter = 0;
    logger.debug('StreamAdapter: Block counter reset');
  }

  /**
   * Get the current block index and increment for next use
   */
  private getNextBlockIndex(): number {
    return this.blockCounter++;
  }

  processChunk(event: StreamEvent): AgentEvent | UsageEvent | null {
    const eventType = event.event;

    // Log all events at debug level for tracing
    logger.debug({
      eventType,
      eventName: event.name,
      runId: event.run_id
    }, 'StreamAdapter: Processing event');

    // 1. Text Generation (Tokens)
    if (eventType === 'on_chat_model_stream') {
        const chunk = event.data.chunk;

        // Log detailed chunk information for debugging
        logger.debug({
          chunkType: chunk?.constructor?.name,
          isAIMessageChunk: chunk instanceof AIMessageChunk,
          contentType: typeof chunk?.content,
          isArray: Array.isArray(chunk?.content),
          contentLength: Array.isArray(chunk?.content) ? chunk?.content.length : undefined,
          contentPreview: JSON.stringify(chunk?.content)?.substring(0, 300),
        }, 'StreamAdapter: on_chat_model_stream chunk received');

        // Skip empty content arrays early
        if (Array.isArray(chunk.content) && chunk.content.length === 0) {
            logger.debug('StreamAdapter: Empty content array, skipping');
            return null;
        }

        // Handle content array (streaming blocks)
        if (Array.isArray(chunk.content)) {
            logger.debug({ blockCount: chunk.content.length }, 'StreamAdapter: Processing content array');

            for (const block of chunk.content) {
                logger.debug({
                  blockType: block.type,
                  hasThinking: !!block.thinking,
                  hasText: !!block.text,
                  hasInput: !!block.input,
                  hasName: !!block.name,
                  hasCitations: !!block.citations,
                  citationsCount: block.citations?.length
                }, 'StreamAdapter: Processing content block');

                // Skip tool input streaming (not user-visible)
                if (block.type === 'input_json_delta') {
                    logger.debug({ input: block.input }, 'StreamAdapter: Skipping input_json_delta (tool input streaming)');
                    continue;
                }

                // Handle thinking blocks (Extended Thinking)
                if (block.type === 'thinking' && block.thinking) {
                    // FIX 2: Include blockIndex for proper ordering during streaming
                    const blockIndex = this.getNextBlockIndex();
                    return {
                        type: 'thinking_chunk',
                        content: block.thinking,
                        blockIndex,  // FIX 2: Added for frontend sorting
                        timestamp: new Date(),
                        eventId: uuidv4(),
                        persistenceState: 'transient',
                        messageId: (chunk.id || event.run_id)?.toString()
                    } as unknown as AgentEvent;
                }

                // Handle text blocks (both 'text' and 'text_delta')
                // Also extract citations when present (for RAG source attribution)
                if ((block.type === 'text' || block.type === 'text_delta') && block.text) {
                    // FIX 2: Include blockIndex for proper ordering during streaming
                    const blockIndex = this.getNextBlockIndex();

                    // Extract citations if present (from Anthropic's citations_delta)
                    const citations = block.citations as Citation[] | undefined;
                    if (citations && citations.length > 0) {
                        logger.info({
                            citationsCount: citations.length,
                            blockIndex,
                        }, 'StreamAdapter: Citations found in text block');
                    }

                    return {
                        type: 'message_chunk',
                        content: block.text,
                        citations,  // Include citations for RAG source attribution
                        blockIndex,  // FIX 2: Added for frontend sorting
                        timestamp: new Date(),
                        eventId: uuidv4(),
                        persistenceState: 'transient',
                        messageId: (chunk.id || event.run_id)?.toString()
                    } as unknown as AgentEvent;
                }

                // Skip tool_use blocks in content array - they will be handled by on_tool_start
                // Emitting here caused duplicate tool_use events (one from streaming, one from tool start)
                if (block.type === 'tool_use') {
                    logger.debug({ toolName: block.name, blockId: block.id },
                        'StreamAdapter: Skipping tool_use from content block (will be handled by on_tool_start)');
                    continue;
                }
            }

            // If we processed array but found no content, return null (don't emit empty message_chunk)
            logger.debug('StreamAdapter: Content array processed but no extractable content found');
            return null;
        }

        // Check for content (standard text)
        // Handle different content types: string, array, or object
        if (chunk.content) {
            const contentText = typeof chunk.content === 'string'
                ? chunk.content
                : Array.isArray(chunk.content)
                    ? chunk.content.map((c: unknown) =>
                        typeof c === 'string' ? c : (c as { text?: string }).text || ''
                      ).join('')
                    : String(chunk.content);

            logger.debug({
              contentFound: true,
              contentType: typeof chunk.content,
              extractedLength: contentText.length,
              extractedPreview: contentText.substring(0, 100)
            }, 'StreamAdapter: Extracted content from chunk');

            // FIX 2: Include blockIndex for proper ordering during streaming
            const blockIndex = this.getNextBlockIndex();
            return {
                type: 'message_chunk',
                content: contentText,
                blockIndex,  // FIX 2: Added for frontend sorting
                timestamp: new Date(),
                eventId: uuidv4(),
                persistenceState: 'transient',
                messageId: (chunk.id || event.run_id)?.toString()
            } as unknown as AgentEvent;
        }

        // Log when no content is found
        logger.debug({
          hasContent: !!chunk.content,
          chunkKeys: Object.keys(chunk || {})
        }, 'StreamAdapter: No content extracted from on_chat_model_stream');
    }

    // 2. Tool Start - SKIP (handled by agent's toolExecutions with correct Anthropic IDs)
    // Note: LangGraph's run_id doesn't match Anthropic's toolCall.id, causing ID mismatches.
    // The agent's toolExecutions array has the correct IDs and is processed at chain end.
    if (eventType === 'on_tool_start') {
        logger.debug({
          toolName: event.name,
          runId: event.run_id,
        }, 'StreamAdapter: Skipping tool_start (will be handled by agent toolExecutions)');
        return null;
    }

    // 3. Tool End - SKIP (handled by agent's toolExecutions)
    if (eventType === 'on_tool_end') {
        logger.debug({
          toolName: event.name,
          runId: event.run_id,
        }, 'StreamAdapter: Skipping tool_end (will be handled by agent toolExecutions)');
        return null;
    }

    // 3b. Tool Error - SKIP (handled by agent's toolExecutions)
    if (eventType === 'on_tool_error') {
        logger.debug({
          toolName: event.name,
          runId: event.run_id,
        }, 'StreamAdapter: Skipping tool_error (will be handled by agent toolExecutions)');
        return null;
    }

    // 4. Chain End (Final Answer or Model End)
    if (eventType === 'on_chat_model_end') {
        const output = event.data.output;
        logger.debug({
          hasUsage: !!(output?.llmOutput?.usage),
          outputKeys: Object.keys(output || {})
        }, 'StreamAdapter: Chat model end');

        if (output && output.llmOutput && output.llmOutput.usage) {
            logger.debug({
              inputTokens: output.llmOutput.usage.input_tokens,
              outputTokens: output.llmOutput.usage.output_tokens
            }, 'StreamAdapter: Usage data extracted');

            return {
                type: 'usage', // Custom internal type, cast to any in service if needed or handle explicitly
                usage: output.llmOutput.usage,
                timestamp: new Date().toISOString(),
                eventId: uuidv4(),
                persistenceState: 'transient'
            } as UsageEvent;
        }
    }

    // Log when event is not handled
    logger.debug({
      eventType,
      eventName: event.name
    }, 'StreamAdapter: Event not handled, returning null');

    return null;
  }
}
