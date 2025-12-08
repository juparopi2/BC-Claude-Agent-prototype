/**
 * MockAnthropicClient - Intelligent mocking for E2E tests
 *
 * Pattern-matching mock that returns predefined responses based on
 * user message content, eliminating Claude API costs in E2E tests.
 *
 * **Purpose:**
 * - Reduce E2E test costs by 90%+ (no real Claude API calls)
 * - Provide realistic responses based on message patterns
 * - Support common test scenarios (greetings, BC queries, tool use)
 * - Maintain streaming behavior for realistic testing
 *
 * **Differences from FakeAnthropicClient:**
 * - FakeAnthropicClient: Manual response configuration (unit tests)
 * - MockAnthropicClient: Automatic pattern matching (E2E tests)
 *
 * **Usage:**
 * ```typescript
 * // In E2E test setup (e.g., Playwright)
 * import { MockAnthropicClient } from '@services/agent/MockAnthropicClient';
 * import { Environment } from '@config/EnvironmentFacade';
 *
 * if (Environment.features.testing.skipClaudeTests) {
 *   const mockClient = new MockAnthropicClient();
 *   // Inject into DirectAgentService
 *   const service = new DirectAgentService(undefined, undefined, mockClient);
 * }
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
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'MockAnthropicClient' });

/**
 * Response configuration for a pattern
 */
interface MockResponse {
  thinkingBlocks?: string[];
  textBlocks: string[];
  toolUseBlocks?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason: 'end_turn' | 'tool_use';
  usage?: Partial<TokenUsage>;
}

/**
 * MockAnthropicClient for E2E tests
 *
 * Provides intelligent pattern matching to return realistic responses
 * without calling the real Claude API, reducing costs by 90%+
 */
export class MockAnthropicClient implements IAnthropicClient {
  /**
   * Pattern definitions with keywords and response generators
   */
  private readonly patterns = {
    greeting: {
      keywords: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon'],
      weight: 1.5, // Higher weight for exact matches
    },
    businessCentral: {
      keywords: ['business central', 'bc', 'dynamics', 'erp', 'customers', 'invoices', 'sales'],
      weight: 1.2,
    },
    createCustomer: {
      keywords: ['create customer', 'add customer', 'new customer'],
      weight: 2.0, // Highest weight for specific actions
    },
    createInvoice: {
      keywords: ['create invoice', 'add invoice', 'new invoice'],
      weight: 2.0,
    },
    searchQuery: {
      keywords: ['find', 'search', 'show', 'list', 'get', 'display'],
      weight: 1.0,
    },
    complexQuestion: {
      keywords: ['why', 'how', 'explain', 'what is', 'tell me about'],
      weight: 1.3,
    },
  };

  /**
   * Creates a chat completion (non-streaming)
   *
   * Note: E2E tests typically use streaming, so this is a simplified implementation.
   */
  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    logger.debug({ model: request.model }, 'MockAnthropicClient: Non-streaming request');

    const userMessage = this.extractUserMessage(request);
    const pattern = this.matchPattern(userMessage);
    const mockResponse = this.getMockResponse(pattern, userMessage);

    // Build content array
    const content: Array<TextBlock | ToolUseBlock> = [];

    if (mockResponse.thinkingBlocks) {
      for (const thinking of mockResponse.thinkingBlocks) {
        content.push({
          type: 'thinking',
          thinking,
        } as unknown as TextBlock);
      }
    }

    for (const text of mockResponse.textBlocks) {
      content.push({
        type: 'text',
        text,
        citations: [],
      });
    }

    if (mockResponse.toolUseBlocks) {
      for (const tool of mockResponse.toolUseBlocks) {
        content.push({
          type: 'tool_use',
          id: tool.id,
          name: tool.name,
          input: tool.input,
        });
      }
    }

    const messageId = this.generateMessageId();

    return {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content,
      model: request.model,
      stop_reason: mockResponse.stopReason as ChatCompletionResponse['stop_reason'],
      stop_sequence: null,
      usage: {
        input_tokens: mockResponse.usage?.input_tokens || 100,
        output_tokens: mockResponse.usage?.output_tokens || 50,
      },
    };
  }

  /**
   * Creates a chat completion with streaming (primary method for E2E tests)
   *
   * Simulates streaming by yielding MessageStreamEvent objects incrementally
   * with realistic delays (50-200ms per chunk).
   */
  async *createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncIterable<MessageStreamEvent> {
    const userMessage = this.extractUserMessage(request);
    const pattern = this.matchPattern(userMessage);
    const mockResponse = this.getMockResponse(pattern, userMessage);

    logger.info(
      { pattern, userMessagePreview: userMessage.slice(0, 100) },
      'MockAnthropicClient: Streaming mock response'
    );

    // Generate Anthropic-format message ID (msg_01...)
    const messageId = this.generateMessageId();

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
        usage: { input_tokens: mockResponse.usage?.input_tokens || 100, output_tokens: 0 },
      },
    } as unknown as MessageStreamEvent;

    await this.delay(50);

    let contentBlockIndex = 0;

    // ========== Stream thinking blocks (Extended Thinking) ==========
    if (mockResponse.thinkingBlocks) {
      for (const thinking of mockResponse.thinkingBlocks) {
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

          await this.delay(80); // Simulate thinking speed
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
    for (const text of mockResponse.textBlocks) {
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

    // ========== Stream tool use blocks ==========
    if (mockResponse.toolUseBlocks) {
      for (const tool of mockResponse.toolUseBlocks) {
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
    yield {
      type: 'message_delta',
      delta: {
        stop_reason: mockResponse.stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: mockResponse.usage?.output_tokens || 50,
      },
    } as unknown as MessageStreamEvent;

    await this.delay(30);

    // ========== message_stop ==========
    yield {
      type: 'message_stop',
    } as unknown as MessageStreamEvent;
  }

  /**
   * Extracts the user message from the request
   */
  private extractUserMessage(request: ChatCompletionRequest): string {
    // Find the last user message
    for (let i = request.messages.length - 1; i >= 0; i--) {
      const message = request.messages[i];
      if (message && message.role === 'user') {
        // Handle both string and array content
        if (typeof message.content === 'string') {
          return message.content;
        } else if (Array.isArray(message.content)) {
          // Extract text from content blocks
          return message.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map((block) => block.text)
            .join(' ');
        }
      }
    }
    return '';
  }

  /**
   * Matches a message against known patterns
   *
   * Returns the best matching pattern based on keyword scoring.
   */
  private matchPattern(message: string): string {
    const normalized = message.toLowerCase().trim();
    const scores: Record<string, number> = {};

    // Score each pattern
    for (const [patternName, patternDef] of Object.entries(this.patterns)) {
      let score = 0;
      for (const keyword of patternDef.keywords) {
        if (normalized.includes(keyword)) {
          score += patternDef.weight;
        }
      }
      scores[patternName] = score;
    }

    // Find highest scoring pattern
    const entries = Object.entries(scores);
    const bestMatch = entries.reduce(
      (max, [pattern, score]) => (score > max.score ? { pattern, score } : max),
      { pattern: 'default', score: 0 }
    );

    return bestMatch.pattern;
  }

  /**
   * Gets the appropriate mock response for a pattern
   */
  private getMockResponse(pattern: string, userMessage: string): MockResponse {
    switch (pattern) {
      case 'greeting':
        return this.getGreetingResponse();

      case 'businessCentral':
        return this.getBusinessCentralResponse(userMessage);

      case 'createCustomer':
        return this.getCreateCustomerResponse();

      case 'createInvoice':
        return this.getCreateInvoiceResponse();

      case 'searchQuery':
        return this.getSearchQueryResponse(userMessage);

      case 'complexQuestion':
        return this.getComplexQuestionResponse(userMessage);

      default:
        return this.getDefaultResponse(userMessage);
    }
  }

  /**
   * Greeting response
   */
  private getGreetingResponse(): MockResponse {
    return {
      textBlocks: [
        'Hello! I\'m your Business Central assistant. I can help you with tasks like viewing customers, creating invoices, searching records, and more. What would you like to do?',
      ],
      stopReason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 40 },
    };
  }

  /**
   * Business Central general query response
   */
  private getBusinessCentralResponse(_message: string): MockResponse {
    return {
      thinkingBlocks: [
        'The user is asking about Business Central. I should provide a helpful overview of what I can do with the BC system.',
      ],
      textBlocks: [
        'I can help you interact with Microsoft Dynamics 365 Business Central. Here are some things I can do:\n\n' +
          '- View and search customers, vendors, and items\n' +
          '- Create and update sales orders and invoices\n' +
          '- Check inventory levels and locations\n' +
          '- Manage purchase orders\n' +
          '- Generate reports and summaries\n\n' +
          'What specific task would you like help with?',
      ],
      stopReason: 'end_turn',
      usage: { input_tokens: 80, output_tokens: 100 },
    };
  }

  /**
   * Create customer response (requires approval)
   */
  private getCreateCustomerResponse(): MockResponse {
    return {
      thinkingBlocks: [
        'The user wants to create a new customer. This is a write operation that requires approval. I should use the create_customer tool.',
      ],
      textBlocks: ['I\'ll help you create a new customer in Business Central.'],
      toolUseBlocks: [
        {
          id: `toolu_${this.generateRandomString(24)}`,
          name: 'create_customer',
          input: {
            displayName: 'Test Customer',
            email: 'test@example.com',
            phoneNumber: '555-0100',
          },
        },
      ],
      stopReason: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 60 },
    };
  }

  /**
   * Create invoice response (requires approval)
   */
  private getCreateInvoiceResponse(): MockResponse {
    return {
      thinkingBlocks: [
        'The user wants to create a new invoice. This requires approval. I should use the create_invoice tool with appropriate parameters.',
      ],
      textBlocks: ['I\'ll create a new sales invoice for you.'],
      toolUseBlocks: [
        {
          id: `toolu_${this.generateRandomString(24)}`,
          name: 'create_salesInvoice',
          input: {
            customerNumber: '10000',
            invoiceDate: new Date().toISOString().split('T')[0],
          },
        },
      ],
      stopReason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  /**
   * Search query response
   */
  private getSearchQueryResponse(message: string): MockResponse {
    const searchTerm = this.extractSearchTerm(message);
    return {
      thinkingBlocks: [
        `The user wants to search for something. Let me identify what they're looking for: "${searchTerm}".`,
      ],
      textBlocks: [
        `Here are the search results for "${searchTerm}":\n\n` +
          '**Customers:**\n' +
          '- Contoso Ltd. (Customer #10000)\n' +
          '- Fabrikam Inc. (Customer #10001)\n' +
          '- Adventure Works (Customer #10002)\n\n' +
          'Would you like more details on any of these?',
      ],
      stopReason: 'end_turn',
      usage: { input_tokens: 90, output_tokens: 80 },
    };
  }

  /**
   * Complex question response (with extended thinking)
   */
  private getComplexQuestionResponse(_message: string): MockResponse {
    return {
      thinkingBlocks: [
        'This is a complex question requiring multi-step reasoning. Let me break it down:\n\n' +
          '1. The user is asking about Business Central functionality\n' +
          '2. I need to explain the underlying concepts\n' +
          '3. I should provide practical examples\n' +
          '4. I should offer next steps',
      ],
      textBlocks: [
        'Let me explain how this works in Business Central:\n\n' +
          'Business Central uses a multi-tier architecture where the application server handles business logic, ' +
          'while the database tier manages data persistence. When you interact with entities like customers or invoices, ' +
          'the system enforces business rules, validates data, and maintains referential integrity.\n\n' +
          'For example, when creating a sales invoice, the system automatically:\n' +
          '- Validates the customer exists\n' +
          '- Checks credit limits\n' +
          '- Applies pricing and discounts\n' +
          '- Updates inventory reservations\n\n' +
          'Is there a specific aspect you\'d like to explore further?',
      ],
      stopReason: 'end_turn',
      usage: { input_tokens: 150, output_tokens: 140 },
    };
  }

  /**
   * Default response for unrecognized patterns
   */
  private getDefaultResponse(message: string): MockResponse {
    return {
      textBlocks: [
        'I understand you\'re asking about: "' +
          message.slice(0, 100) +
          (message.length > 100 ? '..."' : '"') +
          '\n\n' +
          'I\'m a Business Central assistant and I can help with tasks like viewing data, creating records, and answering questions about your ERP system. ' +
          'Could you provide more details about what you\'d like to do?',
      ],
      stopReason: 'end_turn',
      usage: { input_tokens: 70, output_tokens: 60 },
    };
  }

  /**
   * Extracts a search term from a message
   */
  private extractSearchTerm(message: string): string {
    // Remove common search words
    const cleanedMessage = message
      .toLowerCase()
      .replace(/\b(find|search|show|list|get|display|me|the|for|all)\b/g, '')
      .trim();

    return cleanedMessage || 'records';
  }

  /**
   * Generates an Anthropic-format message ID (msg_01...)
   */
  private generateMessageId(): string {
    return `msg_01${this.generateRandomString(22)}`;
  }

  /**
   * Generates a random base62 string
   */
  private generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  /**
   * Delay helper for simulating network/typing latency
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
