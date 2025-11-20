/**
 * AnthropicClient - Real implementation of IAnthropicClient
 *
 * This is a thin wrapper over the @anthropic-ai/sdk that implements our interface.
 * It delegates all actual work to the real Anthropic SDK.
 *
 * Why this approach:
 * 1. Dependency Inversion Principle: DirectAgentService depends on the interface, not the SDK
 * 2. Testability: We can inject FakeAnthropicClient in tests instead of mocking the SDK
 * 3. Maintainability: SDK upgrades only require changes here, not in tests
 * 4. Clarity: Makes it explicit what SDK features we use
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import type {
  IAnthropicClient,
  AnthropicClientConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from './IAnthropicClient';
import { logger } from '@/utils/logger';

/**
 * Real Anthropic Client
 *
 * Wraps @anthropic-ai/sdk to implement our IAnthropicClient interface.
 */
export class AnthropicClient implements IAnthropicClient {
  private client: Anthropic;

  /**
   * Creates a new Anthropic client
   *
   * @param config - Configuration including API key and defaults
   */
  constructor(config: AnthropicClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  /**
   * Creates a chat completion with Claude (non-streaming)
   *
   * Delegates to the real Anthropic SDK's messages.create() method.
   *
   * @param request - The chat completion request parameters
   * @returns Promise resolving to the completion response
   * @throws Error if the API call fails
   */
  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.max_tokens,
        messages: request.messages,
        tools: request.tools,
        system: request.system,
      });

      // The SDK response already matches our interface structure
      // We just need to return it with the correct type
      return response as ChatCompletionResponse;
    } catch (error) {
      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(`Anthropic API call failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Creates a chat completion with Claude using native streaming
   *
   * Delegates to the real Anthropic SDK's messages.stream() method.
   * Yields MessageStreamEvent objects incrementally as Claude generates the response.
   *
   * Event types yielded:
   * - message_start: Message begins (contains id, model, role)
   * - content_block_start: New content block (text or tool_use)
   * - content_block_delta: Incremental chunks (text_delta or input_json_delta)
   * - content_block_stop: Content block completed
   * - message_delta: Token usage and stop_reason updates
   * - message_stop: Full message completed
   *
   * @param request - The chat completion request parameters
   * @returns AsyncIterable yielding MessageStreamEvent objects
   * @throws Error if the streaming API call fails
   *
   * @example
   * ```typescript
   * const stream = client.createChatCompletionStream({...});
   * for await (const event of stream) {
   *   if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
   *     process.stdout.write(event.delta.text); // Render incrementally
   *   }
   * }
   * ```
   */
  async *createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncIterable<MessageStreamEvent> {
    try {
      // Use SDK's native streaming method
      const stream = this.client.messages.stream({
        model: request.model,
        max_tokens: request.max_tokens,
        messages: request.messages,
        tools: request.tools,
        system: request.system,
      });

      // The SDK returns a MessageStream which is AsyncIterable
      // We yield each event as it arrives from the API
      for await (const event of stream) {
        yield event;
      }
    } catch (error) {
      // Enhanced error logging for diagnostics
      // Type for Node.js system errors (ECONNRESET, etc.)
      type NodeSystemError = Error & { code?: string; syscall?: string };
      const systemError = error as NodeSystemError;

      logger.error('❌ Anthropic API streaming failed', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: systemError?.code,
        errorSyscall: systemError?.syscall,
        isECONNRESET: systemError?.code === 'ECONNRESET',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(`Anthropic streaming API call failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets the underlying Anthropic SDK client
   *
   * WARNING: Only use this if you need SDK features not exposed by IAnthropicClient.
   * Prefer extending the interface instead.
   *
   * @returns The underlying Anthropic client
   */
  getUnderlyingClient(): Anthropic {
    return this.client;
  }
}
