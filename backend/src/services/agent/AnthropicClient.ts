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
import type {
  IAnthropicClient,
  AnthropicClientConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from './IAnthropicClient';

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
   * Creates a chat completion with Claude
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
