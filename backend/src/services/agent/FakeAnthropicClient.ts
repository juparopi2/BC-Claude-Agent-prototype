/**
 * FakeAnthropicClient - Test Double for IAnthropicClient
 *
 * This is a "fake" implementation (not a mock) that provides predictable behavior for testing.
 * Unlike mocks which verify interactions, fakes have real implementations that are simpler
 * and more suitable for testing.
 *
 * Benefits over mocking the SDK directly:
 * - Survives SDK version upgrades (implements our interface, not SDK internals)
 * - Simpler test setup (no complex mock configuration)
 * - More realistic (actually implements the interface contract)
 * - Easier to debug (real code, not mock magic)
 * - Configurable behavior for different test scenarios
 *
 * Usage:
 * ```typescript
 * const fake = new FakeAnthropicClient();
 * fake.addResponse({ content: [{ type: 'text', text: 'Hello!' }] });
 * const service = new DirectAgentService(undefined, undefined, fake);
 * ```
 */

import type {
  IAnthropicClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  TokenUsage,
} from './IAnthropicClient';
import type { TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

/**
 * Configuration for a fake response
 */
interface FakeResponse {
  /** Text content blocks */
  textBlocks?: string[];
  /** Tool use blocks */
  toolUseBlocks?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /** Stop reason */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  /** Custom token usage */
  usage?: Partial<TokenUsage>;
}

/**
 * Record of a call made to the fake client
 */
interface CallRecord {
  request: ChatCompletionRequest;
  response: ChatCompletionResponse;
  timestamp: Date;
}

/**
 * Fake Anthropic Client
 *
 * Test double that implements IAnthropicClient with configurable behavior.
 */
export class FakeAnthropicClient implements IAnthropicClient {
  private responses: FakeResponse[] = [];
  private responseIndex = 0;
  private calls: CallRecord[] = [];
  private shouldThrow: Error | null = null;

  /**
   * Adds a response that will be returned by the next createChatCompletion call
   *
   * @param response - The fake response configuration
   */
  addResponse(response: FakeResponse): void {
    this.responses.push(response);
  }

  /**
   * Adds multiple responses in order
   *
   * @param responses - Array of fake response configurations
   */
  addResponses(responses: FakeResponse[]): void {
    this.responses.push(...responses);
  }

  /**
   * Configures the fake to throw an error on the next call
   *
   * @param error - The error to throw
   */
  throwOnNextCall(error: Error): void {
    this.shouldThrow = error;
  }

  /**
   * Gets all calls made to this fake
   *
   * @returns Array of call records
   */
  getCalls(): CallRecord[] {
    return this.calls;
  }

  /**
   * Gets the last call made to this fake
   *
   * @returns The last call record, or undefined if no calls
   */
  getLastCall(): CallRecord | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Resets the fake to initial state
   */
  reset(): void {
    this.responses = [];
    this.responseIndex = 0;
    this.calls = [];
    this.shouldThrow = null;
  }

  /**
   * Creates a chat completion with Claude (fake implementation)
   *
   * Returns the next configured response, or a default response if none configured.
   *
   * @param request - The chat completion request parameters
   * @returns Promise resolving to the fake completion response
   * @throws Error if configured to throw
   */
  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Check if we should throw
    if (this.shouldThrow) {
      const error = this.shouldThrow;
      this.shouldThrow = null;
      throw error;
    }

    // Get the next configured response, or use default
    const fakeResponse = this.responses[this.responseIndex] || this.getDefaultResponse();
    if (this.responseIndex < this.responses.length) {
      this.responseIndex++;
    }

    // Build content array
    const content: Array<TextBlock | ToolUseBlock> = [];

    // Add text blocks
    if (fakeResponse.textBlocks) {
      for (const text of fakeResponse.textBlocks) {
        content.push({
          type: 'text',
          text,
          citations: [],
        });
      }
    }

    // Add tool use blocks
    if (fakeResponse.toolUseBlocks) {
      for (const tool of fakeResponse.toolUseBlocks) {
        content.push({
          type: 'tool_use',
          id: tool.id,
          name: tool.name,
          input: tool.input,
        });
      }
    }

    // Determine stop reason
    const stopReason = fakeResponse.stopReason || (fakeResponse.toolUseBlocks ? 'tool_use' : 'end_turn');

    // Build response
    const response: ChatCompletionResponse = {
      id: `fake_msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      type: 'message',
      role: 'assistant',
      content,
      model: request.model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: fakeResponse.usage?.input_tokens || 100,
        output_tokens: fakeResponse.usage?.output_tokens || 50,
      },
    };

    // Record the call
    this.calls.push({
      request,
      response,
      timestamp: new Date(),
    });

    return response;
  }

  /**
   * Gets a default response when none configured
   */
  private getDefaultResponse(): FakeResponse {
    return {
      textBlocks: ['This is a fake response from FakeAnthropicClient.'],
      stopReason: 'end_turn',
    };
  }
}
