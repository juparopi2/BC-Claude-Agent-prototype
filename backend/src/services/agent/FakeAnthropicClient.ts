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
import type {
  TextBlock,
  ToolUseBlock,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

/**
 * Configuration for a fake response
 */
interface FakeResponse {
  /** Text content blocks */
  textBlocks?: string[];
  /** Thinking content blocks (Extended Thinking feature) */
  thinkingBlocks?: string[];
  /** Tool use blocks */
  toolUseBlocks?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /** Stop reason */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal';
  /** Custom token usage */
  usage?: Partial<TokenUsage>;
  /** Estimated thinking tokens (for token tracking) */
  thinkingTokens?: number;
  /**
   * If true, skip automatic thinking generation even when request.thinking is enabled.
   * Useful when you want to test the "no thinking" case explicitly.
   */
  suppressAutoThinking?: boolean;
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
    // Note: We use 'as unknown as TextBlock' for thinking blocks because TypeScript SDK
    // doesn't have explicit typing for thinking blocks yet
    const content: Array<TextBlock | ToolUseBlock> = [];

    // Add thinking blocks (Extended Thinking feature)
    // Support dynamic thinking: if request.thinking is enabled and no explicit
    // thinkingBlocks were configured, generate auto-thinking content
    let effectiveThinkingBlocks = fakeResponse.thinkingBlocks;
    if (
      !effectiveThinkingBlocks &&
      !fakeResponse.suppressAutoThinking &&
      this.isThinkingEnabled(request)
    ) {
      const budget = this.getThinkingBudget(request);
      effectiveThinkingBlocks = [this.generateAutoThinking(budget)];
    }

    if (effectiveThinkingBlocks) {
      for (const thinking of effectiveThinkingBlocks) {
        content.push({
          type: 'thinking',
          thinking,
        } as unknown as TextBlock);
      }
    }

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
    // Note: Cast stop_reason to support extended stop reasons (pause_turn, refusal)
    // that may not be in the strict SDK type yet
    const response: ChatCompletionResponse = {
      id: `fake_msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      type: 'message',
      role: 'assistant',
      content,
      model: request.model,
      stop_reason: stopReason as ChatCompletionResponse['stop_reason'],
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
   * Creates a chat completion with Claude using streaming (fake implementation)
   *
   * Simulates streaming by yielding MessageStreamEvent objects incrementally
   * with realistic delays (50-200ms per chunk).
   *
   * @param request - The chat completion request parameters
   * @returns AsyncIterable yielding fake MessageStreamEvent objects
   * @throws Error if configured to throw
   */
  async *createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncIterable<MessageStreamEvent> {
    // Check if we should throw
    if (this.shouldThrow) {
      const error = this.shouldThrow;
      this.shouldThrow = null;
      throw error;
    }

    // Get the next configured response
    const fakeResponse = this.responses[this.responseIndex] || this.getDefaultResponse();
    if (this.responseIndex < this.responses.length) {
      this.responseIndex++;
    }

    // ⭐ PHASE 1B: Generate Anthropic-format message ID (msg_01...)
    // Format: msg_01 + 22 random base62 characters (matching Anthropic's format)
    const randomChars = Array.from({ length: 22 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
        Math.floor(Math.random() * 62)
      ]
    ).join('');
    const messageId = `msg_01${randomChars}`;

    // ========== message_start ==========
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: request.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: fakeResponse.usage?.input_tokens || 100, output_tokens: 0 },
      },
    } as unknown as MessageStreamEvent;

    await this.delay(50); // Simulate initial latency

    let contentBlockIndex = 0;

    // ========== Stream thinking blocks (Extended Thinking) ==========
    // Support dynamic thinking: if request.thinking is enabled and no explicit
    // thinkingBlocks were configured, generate auto-thinking content
    let effectiveThinkingBlocks = fakeResponse.thinkingBlocks;
    if (
      !effectiveThinkingBlocks &&
      !fakeResponse.suppressAutoThinking &&
      this.isThinkingEnabled(request)
    ) {
      const budget = this.getThinkingBudget(request);
      effectiveThinkingBlocks = [this.generateAutoThinking(budget)];
    }

    if (effectiveThinkingBlocks) {
      for (const thinking of effectiveThinkingBlocks) {
        // content_block_start for thinking
        yield {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: {
            type: 'thinking',
            thinking: '',
          },
        } as unknown as MessageStreamEvent;

        await this.delay(30);

        // Stream thinking in chunks (simulate thinking process)
        const chunkSize = 10; // Words per thinking chunk
        const words = thinking.split(' ');
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join(' ');
          const addSpace = i + chunkSize < words.length ? ' ' : '';

          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: {
              type: 'thinking_delta',
              thinking: chunk + addSpace,
            },
          } as unknown as MessageStreamEvent;

          await this.delay(80); // Simulate thinking speed (faster than typing)
        }

        // content_block_stop for thinking
        yield {
          type: 'content_block_stop',
          index: contentBlockIndex,
        } as unknown as MessageStreamEvent;

        await this.delay(30);
        contentBlockIndex++;
      }
    }

    // ========== Stream text blocks ==========
    if (fakeResponse.textBlocks) {
      for (const text of fakeResponse.textBlocks) {
        // content_block_start
        yield {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: {
            type: 'text',
            text: '',
          },
        } as unknown as MessageStreamEvent;

        await this.delay(30);

        // Stream text in chunks (simulate typing)
        const chunkSize = 5; // Words per chunk
        const words = text.split(' ');
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join(' ');
          const addSpace = i + chunkSize < words.length ? ' ' : '';

          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: {
              type: 'text_delta',
              text: chunk + addSpace,
            },
          } as unknown as MessageStreamEvent;

          await this.delay(100); // Simulate typing speed
        }

        // content_block_stop
        yield {
          type: 'content_block_stop',
          index: contentBlockIndex,
        } as unknown as MessageStreamEvent;

        await this.delay(30);
        contentBlockIndex++;
      }
    }

    // ========== Stream tool use blocks ==========
    if (fakeResponse.toolUseBlocks) {
      for (const tool of fakeResponse.toolUseBlocks) {
        // content_block_start
        yield {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: {},
          },
        } as unknown as MessageStreamEvent;

        await this.delay(50);

        // Tool input delta (JSON chunks)
        const inputStr = JSON.stringify(tool.input);
        yield {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: inputStr,
          },
        } as unknown as MessageStreamEvent;

        await this.delay(100);

        // content_block_stop
        yield {
          type: 'content_block_stop',
          index: contentBlockIndex,
        } as unknown as MessageStreamEvent;

        await this.delay(30);
        contentBlockIndex++;
      }
    }

    // ========== message_delta (final token usage + stop_reason) ==========
    const stopReason = fakeResponse.stopReason || (fakeResponse.toolUseBlocks ? 'tool_use' : 'end_turn');
    yield {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: fakeResponse.usage?.output_tokens || 50,
      },
    } as unknown as MessageStreamEvent;

    await this.delay(30);

    // ========== message_stop ==========
    yield {
      type: 'message_stop',
    } as unknown as MessageStreamEvent;

    // ========== Record the call (construct full response for call history) ==========
    const content: Array<TextBlock | ToolUseBlock> = [];
    // Add thinking blocks to call record (use effectiveThinkingBlocks for dynamic thinking)
    if (effectiveThinkingBlocks) {
      for (const thinking of effectiveThinkingBlocks) {
        content.push({ type: 'thinking', thinking } as unknown as TextBlock);
      }
    }
    if (fakeResponse.textBlocks) {
      for (const text of fakeResponse.textBlocks) {
        content.push({ type: 'text', text, citations: [] });
      }
    }
    if (fakeResponse.toolUseBlocks) {
      for (const tool of fakeResponse.toolUseBlocks) {
        content.push({ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input });
      }
    }

    const response: ChatCompletionResponse = {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content,
      model: request.model,
      stop_reason: stopReason as ChatCompletionResponse['stop_reason'],
      stop_sequence: null,
      usage: {
        input_tokens: fakeResponse.usage?.input_tokens || 100,
        output_tokens: fakeResponse.usage?.output_tokens || 50,
      },
    };

    this.calls.push({
      request,
      response,
      timestamp: new Date(),
    });
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

  /**
   * Checks if thinking is enabled in the request
   *
   * @param request - The chat completion request
   * @returns true if thinking is enabled
   */
  private isThinkingEnabled(request: ChatCompletionRequest): boolean {
    // ThinkingConfigParam can be { type: 'enabled', budget_tokens: N } or { type: 'disabled' }
    const thinking = request.thinking as { type?: string; budget_tokens?: number } | undefined;
    return thinking?.type === 'enabled';
  }

  /**
   * Gets the thinking budget from request, or returns a default
   *
   * @param request - The chat completion request
   * @returns Budget tokens or default of 1024
   */
  private getThinkingBudget(request: ChatCompletionRequest): number {
    const thinking = request.thinking as { type?: string; budget_tokens?: number } | undefined;
    return thinking?.budget_tokens || 1024;
  }

  /**
   * Generates automatic thinking content when thinking is enabled.
   * The content is proportional to the budget (roughly 1 word per 10 tokens).
   *
   * @param budget - The thinking budget in tokens
   * @returns Generated thinking content
   */
  private generateAutoThinking(budget: number): string {
    // Generate roughly proportional thinking content
    // Assume ~10 tokens per word (conservative estimate)
    const wordCount = Math.max(10, Math.min(200, Math.floor(budget / 10)));

    const thinkingPhrases = [
      'Let me analyze this request.',
      'I need to consider the context here.',
      'Breaking down the problem into steps.',
      'First, I should identify the key requirements.',
      'Looking at the available tools and data.',
      'Considering the best approach for this task.',
      'I need to ensure accuracy in my response.',
      'Evaluating the possible solutions.',
      'The user is asking for specific information.',
      'I should structure my response clearly.',
    ];

    // Build thinking content up to word limit
    const words: string[] = [];
    let phraseIndex = 0;

    while (words.length < wordCount && phraseIndex < 100) {
      const phrase = thinkingPhrases[phraseIndex % thinkingPhrases.length];
      if (phrase) {
        words.push(...phrase.split(' '));
      }
      phraseIndex++;
    }

    return words.slice(0, wordCount).join(' ');
  }

  /**
   * Delay helper for simulating network/typing latency
   *
   * @param ms - Milliseconds to delay
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
