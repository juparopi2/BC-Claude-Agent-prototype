/**
 * Streaming Mock Helpers for DirectAgentService Tests
 *
 * Provides utilities for mocking Anthropic SDK streaming responses with proper AsyncIterable types.
 * These helpers create realistic MessageStreamEvent sequences that match the SDK's streaming behavior.
 */

import type {
  MessageStreamEvent,
  Message,
  ContentBlock,
  MessageDeltaUsage
} from '@anthropic-ai/sdk/resources/messages';

/**
 * Creates a mock streaming response that properly implements AsyncIterable<MessageStreamEvent>
 *
 * This is the foundation for all streaming mocks. It takes an array of SDK events
 * and yields them one by one, simulating the actual streaming API behavior.
 *
 * @param events - Array of SDK MessageStreamEvent objects in order
 * @returns AsyncIterable compatible with SDK streaming API
 *
 * @example
 * ```typescript
 * const mockStream = createMockStreamingResponse([
 *   { type: 'message_start', message: {...} },
 *   { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
 *   { type: 'message_stop' }
 * ]);
 *
 * vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);
 * ```
 */
export async function* createMockStreamingResponse(
  events: MessageStreamEvent[]
): AsyncIterable<MessageStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Creates a simple text response stream (most common test case)
 *
 * Generates a complete streaming sequence for a plain text response:
 * 1. message_start - Initialize message with ID and usage
 * 2. content_block_start - Begin text content block
 * 3. content_block_delta - Deliver the actual text content
 * 4. content_block_stop - Close content block
 * 5. message_delta - Provide stop_reason and final usage
 * 6. message_stop - Complete the stream
 *
 * @param text - The text content to return
 * @param stopReason - 'end_turn' for final response, 'tool_use' for intermediate
 * @param messageId - Optional message ID (defaults to 'msg-test')
 * @returns AsyncIterable<MessageStreamEvent>
 *
 * @example
 * ```typescript
 * // Final response
 * const stream = createSimpleTextStream('Hello world', 'end_turn');
 *
 * // Intermediate response (triggers agentic loop to continue)
 * const stream = createSimpleTextStream('Thinking...', 'tool_use');
 * ```
 */
export function createSimpleTextStream(
  text: string,
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn',
  messageId: string = 'msg-test'
): AsyncIterable<MessageStreamEvent> {
  return createMockStreamingResponse([
    {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        } as Message['usage']
      }
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: [] } as ContentBlock
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: text }
    },
    {
      type: 'content_block_stop',
      index: 0
    },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        output_tokens: Math.ceil(text.length / 4),
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as MessageDeltaUsage
    },
    {
      type: 'message_stop'
    }
  ]);
}

/**
 * Creates a tool use stream (for testing agentic loop and approvals)
 *
 * Generates a streaming sequence where Claude requests to use a tool:
 * 1. message_start - Initialize message
 * 2. content_block_start - Begin tool_use content block with tool name and input
 * 3. content_block_stop - Close tool block
 * 4. message_delta - Set stop_reason to 'tool_use' (triggers loop continuation)
 * 5. message_stop - Complete the stream
 *
 * This simulates the intermediate messages in the agentic loop where Claude
 * decides to use a tool. The stop_reason='tool_use' signals that the conversation
 * should continue after tool execution.
 *
 * @param toolName - Name of the tool being invoked (e.g., 'list_all_entities')
 * @param toolInput - Arguments object for the tool
 * @param messageId - Optional message ID
 * @returns AsyncIterable<MessageStreamEvent>
 *
 * @example
 * ```typescript
 * // Read operation (no approval needed)
 * const stream = createToolUseStream('list_all_entities', {});
 *
 * // Write operation (requires approval)
 * const stream = createToolUseStream('create_customer', { name: 'ACME Corp' });
 * ```
 */
export function createToolUseStream(
  toolName: string,
  toolInput: Record<string, unknown>,
  messageId: string = 'msg-tool'
): AsyncIterable<MessageStreamEvent> {
  const events: MessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 120,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        } as Message['usage']
      }
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: `tool-use-${Date.now()}`,
        name: toolName,
        input: {} // Starts empty, will be populated via input_json_delta
      }
    }
  ];

  // Add input_json_delta event if tool has input
  if (Object.keys(toolInput).length > 0) {
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify(toolInput) // Stream the tool input as JSON
      }
    });
  }

  // Complete the stream
  events.push(
    {
      type: 'content_block_stop',
      index: 0
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: {
        output_tokens: 30,
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as MessageDeltaUsage
    },
    {
      type: 'message_stop'
    }
  );

  return createMockStreamingResponse(events);
}

/**
 * Creates a stream with thinking block (extended thinking feature)
 *
 * Generates a sequence that includes a thinking block before the text response.
 * Thinking blocks are used when the model needs to reason through complex problems.
 *
 * @param thinkingContent - Internal reasoning content
 * @param textContent - Final response content
 * @param stopReason - Stop reason for the message
 * @returns AsyncIterable<MessageStreamEvent>
 *
 * @example
 * ```typescript
 * const stream = createThinkingStream(
 *   'Let me analyze the customer data structure...',
 *   'I found 3 customers matching your criteria',
 *   'end_turn'
 * );
 * ```
 */
export function createThinkingStream(
  thinkingContent: string,
  textContent: string,
  stopReason: 'end_turn' | 'tool_use' = 'end_turn'
): AsyncIterable<MessageStreamEvent> {
  return createMockStreamingResponse([
    {
      type: 'message_start',
      message: {
        id: 'msg-thinking',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 150,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        } as Message['usage']
      }
    },
    // Thinking block
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' } as ContentBlock
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: thinkingContent }
    },
    {
      type: 'content_block_stop',
      index: 0
    },
    // Text block
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '', citations: [] } as ContentBlock
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: textContent }
    },
    {
      type: 'content_block_stop',
      index: 1
    },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        output_tokens: Math.ceil((thinkingContent.length + textContent.length) / 4),
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as MessageDeltaUsage
    },
    {
      type: 'message_stop'
    }
  ]);
}

/**
 * Creates a stream with multiple text chunks (simulates real streaming behavior)
 *
 * Instead of delivering all text at once, this splits it into multiple
 * content_block_delta events, more accurately simulating real streaming.
 *
 * @param textChunks - Array of text chunks to stream
 * @param stopReason - Stop reason for the message
 * @returns AsyncIterable<MessageStreamEvent>
 *
 * @example
 * ```typescript
 * const stream = createChunkedTextStream(
 *   ['Hello ', 'world', ', how ', 'can I ', 'help?'],
 *   'end_turn'
 * );
 * ```
 */
export function createChunkedTextStream(
  textChunks: string[],
  stopReason: 'end_turn' | 'tool_use' = 'end_turn'
): AsyncIterable<MessageStreamEvent> {
  const events: MessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg-chunked',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        } as Message['usage']
      }
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: [] } as ContentBlock
    }
  ];

  // Add delta events for each chunk
  for (const chunk of textChunks) {
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: chunk }
    });
  }

  // Close the stream
  events.push(
    {
      type: 'content_block_stop',
      index: 0
    },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        output_tokens: Math.ceil(textChunks.join('').length / 4),
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as MessageDeltaUsage
    },
    {
      type: 'message_stop'
    }
  );

  return createMockStreamingResponse(events);
}

/**
 * Creates an error stream (for testing error handling)
 *
 * Simulates an API error by throwing an error when the stream is consumed.
 * Useful for testing error recovery and user feedback.
 *
 * @param errorMessage - The error message to throw
 * @returns AsyncIterable that throws an error
 *
 * @example
 * ```typescript
 * const errorStream = createErrorStream('API rate limit exceeded');
 * vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(errorStream);
 * ```
 */
export async function* createErrorStream(errorMessage: string): AsyncIterable<MessageStreamEvent> {
  // Yield message_start to simulate partial response
  yield {
    type: 'message_start',
    message: {
      id: 'msg-error',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as Message['usage']
    }
  };

  // Then throw error (simulates API failure mid-stream)
  throw new Error(errorMessage);
}

/**
 * Creates a stream that simulates hitting max_tokens limit
 *
 * @param truncatedText - The text that was generated before hitting limit
 * @returns AsyncIterable<MessageStreamEvent>
 *
 * @example
 * ```typescript
 * const stream = createMaxTokensStream('This response was cut off because...');
 * ```
 */
export function createMaxTokensStream(truncatedText: string): AsyncIterable<MessageStreamEvent> {
  return createMockStreamingResponse([
    {
      type: 'message_start',
      message: {
        id: 'msg-max-tokens',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4',
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        } as Message['usage']
      }
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: [] } as ContentBlock
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: truncatedText }
    },
    {
      type: 'content_block_stop',
      index: 0
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens', stop_sequence: null },
      usage: {
        output_tokens: 4096, // Hit the token limit
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      } as MessageDeltaUsage
    },
    {
      type: 'message_stop'
    }
  ]);
}
