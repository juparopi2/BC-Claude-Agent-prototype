import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { AIMessageChunk } from '@langchain/core/messages';
import { AgentEvent, UsageEvent } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'StreamAdapter' });

/**
 * Adapter to convert LangChain stream events to our legacy AgentEvent format.
 * This ensures the frontend doesn't need to change immediately.
 */
export class StreamAdapter {
  // sessionId parameter reserved for future event tracking with session context
  constructor(_sessionId: string) {
    // Session context can be used for future enhancements
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
                  hasName: !!block.name
                }, 'StreamAdapter: Processing content block');

                // Skip tool input streaming (not user-visible)
                if (block.type === 'input_json_delta') {
                    logger.debug({ input: block.input }, 'StreamAdapter: Skipping input_json_delta (tool input streaming)');
                    continue;
                }

                // Handle thinking blocks (Extended Thinking)
                if (block.type === 'thinking' && block.thinking) {
                    return {
                        type: 'thinking',
                        content: block.thinking,
                        timestamp: new Date().toISOString(),
                        eventId: uuidv4(),
                        persistenceState: 'transient'
                    } as AgentEvent;
                }

                // Handle text blocks (both 'text' and 'text_delta')
                if ((block.type === 'text' || block.type === 'text_delta') && block.text) {
                    return {
                        type: 'message_chunk',
                        content: block.text,
                        timestamp: new Date().toISOString(),
                        eventId: uuidv4(),
                        persistenceState: 'transient'
                    };
                }

                // Handle tool_use blocks in content array
                if (block.type === 'tool_use' && block.name) {
                    return {
                        type: 'tool_use',
                        toolName: block.name,
                        args: block.input || {},
                        toolUseId: block.id || uuidv4(),
                        timestamp: new Date().toISOString(),
                        eventId: uuidv4(),
                        persistenceState: 'persisted'
                    };
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

            return {
                type: 'message_chunk',
                content: contentText,
                timestamp: new Date().toISOString(),
                eventId: uuidv4(),
                persistenceState: 'transient'
            };
        }

        // Log when no content is found
        logger.debug({
          hasContent: !!chunk.content,
          chunkKeys: Object.keys(chunk || {})
        }, 'StreamAdapter: No content extracted from on_chat_model_stream');
    }

    // 2. Tool Start
    if (eventType === 'on_tool_start') {
        logger.debug({
          toolName: event.name,
          argsPreview: JSON.stringify(event.data.input)?.substring(0, 200)
        }, 'StreamAdapter: Tool started');

        return {
            type: 'tool_use',
            toolName: event.name,
            args: event.data.input,
            toolUseId: event.run_id,
            timestamp: new Date().toISOString(),
            eventId: uuidv4(),
            persistenceState: 'persisted'
        };
    }

    // 3. Tool End
    if (eventType === 'on_tool_end') {
         // Output can be a string or object. legacy expects string usually.
         const output = typeof event.data.output === 'string'
            ? event.data.output
            : JSON.stringify(event.data.output);

        logger.debug({
          toolName: event.name,
          success: true,
          outputLength: output.length
        }, 'StreamAdapter: Tool completed');

        return {
            type: 'tool_result',
            toolName: event.name,
            result: output,
            success: true, // Assuming success if we reached here
            toolUseId: event.run_id,
            timestamp: new Date().toISOString(),
            eventId: uuidv4(),
            persistenceState: 'persisted'
        };
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
