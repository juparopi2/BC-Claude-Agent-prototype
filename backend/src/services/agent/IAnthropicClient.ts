/**
 * IAnthropicClient - Abstraction over Anthropic SDK
 *
 * This interface follows the "Don't Mock What You Don't Own" principle.
 * Instead of mocking the Anthropic SDK directly in tests, we:
 * 1. Define an interface for what we need from the SDK
 * 2. Create a wrapper (AnthropicClient) that implements this interface
 * 3. Create a fake (FakeAnthropicClient) for testing
 *
 * Benefits:
 * - Tests survive SDK version upgrades (we control the interface)
 * - Tests are simpler (fake has predictable behavior)
 * - No brittle mocks coupled to SDK implementation details
 * - Clear separation between our code and external dependencies
 */

import type {
  MessageParam,
  TextBlock,
  ToolUseBlock,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

/**
 * Configuration for creating an Anthropic client
 */
export interface AnthropicClientConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Tool definition for Claude API
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Request parameters for chat completion
 */
export interface ChatCompletionRequest {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  tools?: ClaudeTool[];
  system?: string;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<TextBlock | ToolUseBlock>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: TokenUsage;
}

/**
 * Anthropic Client Interface
 *
 * Defines the contract for interacting with Claude API.
 * Implementations:
 * - AnthropicClient: Real implementation using @anthropic-ai/sdk
 * - FakeAnthropicClient: Test double for unit tests
 */
export interface IAnthropicClient {
  /**
   * Creates a chat completion with Claude (non-streaming)
   *
   * @param request - The chat completion request parameters
   * @returns Promise resolving to the completion response
   * @throws Error if the API call fails
   */
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Creates a chat completion with Claude using native streaming
   *
   * Streams events incrementally as Claude generates the response:
   * - content_block_start: New content block begins (text or tool_use)
   * - content_block_delta: Incremental text chunks or tool input
   * - content_block_stop: Content block completed
   * - message_delta: Token usage and stop_reason updates
   * - message_stop: Full message completed
   *
   * @param request - The chat completion request parameters
   * @returns AsyncIterable of MessageStreamEvent from Anthropic SDK
   * @throws Error if the API call fails
   *
   * @example
   * ```typescript
   * const stream = client.createChatCompletionStream({...});
   * for await (const event of stream) {
   *   if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
   *     console.log(event.delta.text); // Incremental text chunk
   *   }
   * }
   * ```
   */
  createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncIterable<MessageStreamEvent>;
}
