/**
 * AnthropicClient Unit Tests
 *
 * Tests for the real Anthropic SDK wrapper implementation.
 * These tests verify that AnthropicClient correctly:
 * 1. Initializes the SDK with provided configuration
 * 2. Delegates calls to the SDK
 * 3. Handles errors and re-throws with context
 * 4. Logs thinking configuration when enabled
 * 5. Properly yields streaming events
 * 6. Handles multi-tenant concurrent usage safely
 *
 * @module AnthropicClient.test
 *
 * QA Master Review Fixes (2025-11-25):
 * - C1: Test thinking: undefined vs omitted
 * - C2: Verify logging consistency between sync/streaming
 * - C3: API key sanitization in error messages
 * - H1: Concurrent streams isolation
 * - H2: max_tokens: 0 boundary
 * - H3: budget_tokens: 0 boundary
 * - H4: Multi-turn conversation with tool results
 * - H5: Stream timeout/stall handling
 * - M1-M5: Cache tokens, tool_choice, helper improvements
 * - L1-L3: Constants, consistent naming
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageStreamEvent, Message } from '@anthropic-ai/sdk/resources/messages';
import type { ChatCompletionRequest, ChatCompletionResponse } from '@/services/agent/IAnthropicClient';

// ===================
// TEST CONSTANTS (L2)
// ===================
const TEST_MODEL = 'claude-sonnet-4-20250514';
const TEST_API_KEY = 'test-api-key-12345';

// Use vi.hoisted to create mocks that are available during mock factory evaluation
const { mockCreate, mockStream, mockAnthropicConstructor, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
  mockAnthropicConstructor: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

// Mock the Anthropic SDK before importing the client
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      };

      constructor(config: { apiKey: string }) {
        mockAnthropicConstructor(config);
      }
    },
  };
});

// Mock the logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    error: mockLoggerError,
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
import { AnthropicClient } from '@/services/agent/AnthropicClient';

// ===================
// TEST HELPERS (M3 - improved with all fields)
// ===================

/**
 * Helper to create a mock async iterable from events
 */
function createMockAsyncIterable(events: MessageStreamEvent[]): AsyncIterable<MessageStreamEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Helper to create a complete message_start event (M3 - includes cache tokens)
 */
function createMessageStartEvent(id: string = 'msg_test'): MessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model: TEST_MODEL,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        // M1: Include cache tokens for completeness
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Message,
  } as MessageStreamEvent;
}

/**
 * Helper to collect all events from an async iterable
 */
async function collectEvents(stream: AsyncIterable<MessageStreamEvent>): Promise<MessageStreamEvent[]> {
  const events: MessageStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/**
 * Create base mock response (M1 - with cache tokens)
 */
function createMockResponse(overrides: Partial<ChatCompletionResponse> = {}): ChatCompletionResponse {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello there!', citations: [] }],
    model: TEST_MODEL,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 15,
      // M1: Include cache tokens
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as ChatCompletionResponse['usage'],
    ...overrides,
  };
}

/**
 * Create base request
 */
function createBaseRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    model: TEST_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('AnthropicClient', () => {
  let client: AnthropicClient;

  beforeEach(() => {
    // Reset all mock call history
    mockCreate.mockReset();
    mockStream.mockReset();
    mockAnthropicConstructor.mockClear();
    mockLoggerInfo.mockReset();
    mockLoggerError.mockReset();

    client = new AnthropicClient({ apiKey: TEST_API_KEY });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ====================
  // CONSTRUCTOR TESTS
  // ====================
  describe('constructor', () => {
    it('should initialize Anthropic SDK with provided API key', () => {
      expect(mockAnthropicConstructor).toHaveBeenCalledWith({
        apiKey: TEST_API_KEY,
      });
    });

    it('should create a new SDK instance for each client', () => {
      const initialCalls = mockAnthropicConstructor.mock.calls.length;
      const _client2 = new AnthropicClient({ apiKey: 'another-key' });
      expect(mockAnthropicConstructor).toHaveBeenCalledTimes(initialCalls + 1);
    });

    it('should work with minimal config (only apiKey)', () => {
      const _minimalClient = new AnthropicClient({ apiKey: 'minimal-key' });
      expect(mockAnthropicConstructor).toHaveBeenLastCalledWith({
        apiKey: 'minimal-key',
      });
    });
  });

  // ====================
  // createChatCompletion TESTS
  // ====================
  describe('createChatCompletion', () => {
    describe('success cases', () => {
      it('should call SDK messages.create with correct parameters', async () => {
        const mockResponse = createMockResponse();
        mockCreate.mockResolvedValueOnce(mockResponse);
        const baseRequest = createBaseRequest();

        await client.createChatCompletion(baseRequest);

        expect(mockCreate).toHaveBeenCalledWith({
          model: baseRequest.model,
          max_tokens: baseRequest.max_tokens,
          messages: baseRequest.messages,
          tools: undefined,
          system: undefined,
          thinking: undefined,
        });
      });

      it('should return the SDK response', async () => {
        const mockResponse = createMockResponse();
        mockCreate.mockResolvedValueOnce(mockResponse);

        const result = await client.createChatCompletion(createBaseRequest());

        expect(result).toEqual(mockResponse);
      });

      it('should pass tools when provided', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithTools = createBaseRequest({
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              input_schema: { type: 'object', properties: {} },
            },
          ],
        });

        await client.createChatCompletion(requestWithTools);

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: requestWithTools.tools,
          })
        );
      });

      it('should pass system prompt when provided', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithSystem = createBaseRequest({
          system: 'You are a helpful assistant.',
        });

        await client.createChatCompletion(requestWithSystem);

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            system: 'You are a helpful assistant.',
          })
        );
      });

      it('should pass system prompt blocks with cache control', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithSystemBlocks = createBaseRequest({
          system: [
            {
              type: 'text',
              text: 'You are helpful.',
              cache_control: { type: 'ephemeral' },
            },
          ],
        });

        await client.createChatCompletion(requestWithSystemBlocks);

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            system: requestWithSystemBlocks.system,
          })
        );
      });

      // M1: Test response with cache tokens
      it('should handle response with cache tokens', async () => {
        const responseWithCache = createMockResponse({
          usage: {
            input_tokens: 10,
            output_tokens: 15,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
          } as ChatCompletionResponse['usage'],
        });
        mockCreate.mockResolvedValueOnce(responseWithCache);

        const result = await client.createChatCompletion(createBaseRequest());

        expect(result.usage).toEqual(expect.objectContaining({
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        }));
      });
    });

    describe('extended thinking', () => {
      it('should log when thinking is enabled', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithThinking = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 10000 },
        });

        await client.createChatCompletion(requestWithThinking);

        expect(mockLoggerInfo).toHaveBeenCalledWith(
          '🧠 Extended thinking ENABLED',
          { budget_tokens: 10000 }
        );
      });

      it('should not log when thinking is disabled', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithThinkingDisabled = createBaseRequest({
          thinking: { type: 'disabled' },
        });

        await client.createChatCompletion(requestWithThinkingDisabled);

        expect(mockLoggerInfo).not.toHaveBeenCalledWith(
          expect.stringContaining('Extended thinking'),
          expect.anything()
        );
      });

      // C1: Test thinking: undefined explicitly
      it('should not log when thinking is explicitly undefined', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithUndefinedThinking = createBaseRequest({
          thinking: undefined,
        });

        await client.createChatCompletion(requestWithUndefinedThinking);

        expect(mockLoggerInfo).not.toHaveBeenCalledWith(
          expect.stringContaining('Extended thinking'),
          expect.anything()
        );
      });

      it('should pass thinking config to SDK', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithThinking = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 50000 },
        });

        await client.createChatCompletion(requestWithThinking);

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: 'enabled', budget_tokens: 50000 },
          })
        );
      });

      // H3: Test budget_tokens: 0
      it('should handle thinking enabled with budget_tokens of 0', async () => {
        mockCreate.mockResolvedValueOnce(createMockResponse());
        const requestWithZeroBudget = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 0 },
        });

        await client.createChatCompletion(requestWithZeroBudget);

        expect(mockLoggerInfo).toHaveBeenCalledWith(
          '🧠 Extended thinking ENABLED',
          { budget_tokens: 0 }
        );
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: 'enabled', budget_tokens: 0 },
          })
        );
      });
    });

    describe('error handling', () => {
      it('should re-throw Error with context message', async () => {
        const originalError = new Error('API key invalid');
        mockCreate.mockRejectedValueOnce(originalError);

        await expect(client.createChatCompletion(createBaseRequest())).rejects.toThrow(
          'Anthropic API call failed: API key invalid'
        );
      });

      it('should re-throw non-Error objects as-is', async () => {
        const strangeError = { code: 'STRANGE_ERROR' };
        mockCreate.mockRejectedValueOnce(strangeError);

        await expect(client.createChatCompletion(createBaseRequest())).rejects.toEqual(strangeError);
      });

      it('should handle rate limit errors', async () => {
        const rateLimitError = new Error('rate_limit_error: Too many requests');
        mockCreate.mockRejectedValueOnce(rateLimitError);

        await expect(client.createChatCompletion(createBaseRequest())).rejects.toThrow(
          'Anthropic API call failed: rate_limit_error: Too many requests'
        );
      });

      it('should handle authentication errors', async () => {
        const authError = new Error('authentication_error: Invalid API key');
        mockCreate.mockRejectedValueOnce(authError);

        await expect(client.createChatCompletion(createBaseRequest())).rejects.toThrow(
          'Anthropic API call failed: authentication_error: Invalid API key'
        );
      });

      // C2: Verify logging is consistent with streaming
      it('should log error details for sync calls (consistency with streaming)', async () => {
        const econnresetError = Object.assign(new Error('Connection reset'), {
          code: 'ECONNRESET',
          syscall: 'read',
        });
        mockCreate.mockRejectedValueOnce(econnresetError);

        try {
          await client.createChatCompletion(createBaseRequest());
        } catch {
          // Expected
        }

        expect(mockLoggerError).toHaveBeenCalledWith(
          '❌ Anthropic API call failed',
          expect.objectContaining({
            error: 'Connection reset',
            errorCode: 'ECONNRESET',
            errorSyscall: 'read',
            isECONNRESET: true,
          })
        );
      });

      // C3: API key should not be leaked in error messages
      it('should not leak API key patterns in error messages', async () => {
        // Note: The SDK error message might contain key info, but our wrapper
        // should not add additional exposure. We verify the error format.
        const errorWithKeyHint = new Error('Invalid x]api key provided');
        mockCreate.mockRejectedValueOnce(errorWithKeyHint);

        try {
          await client.createChatCompletion(createBaseRequest());
        } catch (error) {
          // Verify we don't add the actual key to the message
          const errorMessage = (error as Error).message;
          expect(errorMessage).not.toContain(TEST_API_KEY);
          expect(errorMessage).not.toContain('sk-ant-');
        }
      });
    });
  });

  // ====================
  // createChatCompletionStream TESTS
  // ====================
  describe('createChatCompletionStream', () => {
    describe('success cases', () => {
      it('should call SDK messages.stream with correct parameters', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));
        const baseRequest = createBaseRequest();

        const events = await collectEvents(client.createChatCompletionStream(baseRequest));

        expect(mockStream).toHaveBeenCalledWith({
          model: baseRequest.model,
          max_tokens: baseRequest.max_tokens,
          messages: baseRequest.messages,
          tools: undefined,
          system: undefined,
          thinking: undefined,
        });
        expect(events).toHaveLength(2);
      });

      it('should yield all events from the SDK stream', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello!' },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_stop',
            index: 0,
          } as unknown as MessageStreamEvent,
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const receivedEvents = await collectEvents(client.createChatCompletionStream(createBaseRequest()));

        expect(receivedEvents).toHaveLength(5);
        expect(receivedEvents[0]?.type).toBe('message_start');
        expect(receivedEvents[1]?.type).toBe('content_block_start');
        expect(receivedEvents[2]?.type).toBe('content_block_delta');
        expect(receivedEvents[3]?.type).toBe('content_block_stop');
        expect(receivedEvents[4]?.type).toBe('message_stop');
      });

      it('should pass tools when provided', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithTools = createBaseRequest({
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              input_schema: { type: 'object', properties: {} },
            },
          ],
        });

        await collectEvents(client.createChatCompletionStream(requestWithTools));

        expect(mockStream).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: requestWithTools.tools,
          })
        );
      });

      it('should handle tool_use content blocks', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_123',
              name: 'list_all_entities',
              input: {},
            },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{}' },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_stop',
            index: 0,
          } as unknown as MessageStreamEvent,
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 20 },
          } as unknown as MessageStreamEvent,
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const receivedEvents = await collectEvents(client.createChatCompletionStream(createBaseRequest()));

        expect(receivedEvents).toHaveLength(6);
        const toolStartEvent = receivedEvents[1] as { type: string; content_block?: { type: string; name?: string } };
        expect(toolStartEvent?.content_block?.type).toBe('tool_use');
        expect(toolStartEvent?.content_block?.name).toBe('list_all_entities');
      });

      it('should handle message_delta with stop_reason', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 50 },
          } as unknown as MessageStreamEvent,
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const receivedEvents = await collectEvents(client.createChatCompletionStream(createBaseRequest()));

        expect(receivedEvents).toHaveLength(3);
        const deltaEvent = receivedEvents[1] as { type: string; delta?: { stop_reason?: string } };
        expect(deltaEvent?.delta?.stop_reason).toBe('end_turn');
      });
    });

    describe('extended thinking (streaming)', () => {
      it('should log when thinking is enabled for streaming', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithThinking = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 20000 },
        });

        await collectEvents(client.createChatCompletionStream(requestWithThinking));

        expect(mockLoggerInfo).toHaveBeenCalledWith(
          '🧠 Extended thinking ENABLED (streaming)',
          { budget_tokens: 20000 }
        );
      });

      it('should not log when thinking is disabled for streaming', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithThinkingDisabled = createBaseRequest({
          thinking: { type: 'disabled' },
        });

        await collectEvents(client.createChatCompletionStream(requestWithThinkingDisabled));

        expect(mockLoggerInfo).not.toHaveBeenCalledWith(
          expect.stringContaining('Extended thinking'),
          expect.anything()
        );
      });

      // C1: Test thinking: undefined for streaming
      it('should not log when thinking is explicitly undefined for streaming', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithUndefinedThinking = createBaseRequest({
          thinking: undefined,
        });

        await collectEvents(client.createChatCompletionStream(requestWithUndefinedThinking));

        expect(mockLoggerInfo).not.toHaveBeenCalledWith(
          expect.stringContaining('Extended thinking'),
          expect.anything()
        );
      });

      it('should pass thinking config to SDK stream', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithThinking = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 100000 },
        });

        await collectEvents(client.createChatCompletionStream(requestWithThinking));

        expect(mockStream).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: 'enabled', budget_tokens: 100000 },
          })
        );
      });

      it('should handle thinking content blocks in stream', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Let me analyze this...' },
          } as unknown as MessageStreamEvent,
          {
            type: 'content_block_stop',
            index: 0,
          } as unknown as MessageStreamEvent,
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const receivedEvents = await collectEvents(client.createChatCompletionStream(createBaseRequest()));

        expect(receivedEvents).toHaveLength(5);
        const thinkingStartEvent = receivedEvents[1] as { type: string; content_block?: { type: string } };
        expect(thinkingStartEvent?.content_block?.type).toBe('thinking');
      });

      // H3: Test budget_tokens: 0 for streaming
      it('should handle thinking enabled with budget_tokens of 0 for streaming', async () => {
        const mockEvents: MessageStreamEvent[] = [
          createMessageStartEvent(),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        mockStream.mockReturnValueOnce(createMockAsyncIterable(mockEvents));

        const requestWithZeroBudget = createBaseRequest({
          thinking: { type: 'enabled', budget_tokens: 0 },
        });

        await collectEvents(client.createChatCompletionStream(requestWithZeroBudget));

        expect(mockLoggerInfo).toHaveBeenCalledWith(
          '🧠 Extended thinking ENABLED (streaming)',
          { budget_tokens: 0 }
        );
      });
    });

    describe('error handling', () => {
      it('should re-throw Error with context message', async () => {
        const originalError = new Error('Network error');
        mockStream.mockImplementationOnce(() => {
          throw originalError;
        });

        const stream = client.createChatCompletionStream(createBaseRequest());

        await expect(async () => {
          for await (const _ of stream) {
            // This should throw
          }
        }).rejects.toThrow('Anthropic streaming API call failed: Network error');
      });

      it('should re-throw non-Error objects as-is', async () => {
        const strangeError = { code: 'STRANGE_STREAM_ERROR' };
        mockStream.mockImplementationOnce(() => {
          throw strangeError;
        });

        const stream = client.createChatCompletionStream(createBaseRequest());

        await expect(async () => {
          for await (const _ of stream) {
            // This should throw
          }
        }).rejects.toEqual(strangeError);
      });

      it('should log error details including ECONNRESET', async () => {
        const econnresetError = Object.assign(new Error('Connection reset'), {
          code: 'ECONNRESET',
          syscall: 'read',
        });
        mockStream.mockImplementationOnce(() => {
          throw econnresetError;
        });

        const stream = client.createChatCompletionStream(createBaseRequest());

        try {
          for await (const _ of stream) {
            // This should throw
          }
        } catch {
          // Expected
        }

        expect(mockLoggerError).toHaveBeenCalledWith(
          '❌ Anthropic API streaming failed',
          expect.objectContaining({
            error: 'Connection reset',
            errorCode: 'ECONNRESET',
            errorSyscall: 'read',
            isECONNRESET: true,
          })
        );
      });

      it('should log error details for generic errors', async () => {
        const genericError = new Error('Something went wrong');
        mockStream.mockImplementationOnce(() => {
          throw genericError;
        });

        const stream = client.createChatCompletionStream(createBaseRequest());

        try {
          for await (const _ of stream) {
            // This should throw
          }
        } catch {
          // Expected
        }

        expect(mockLoggerError).toHaveBeenCalledWith(
          '❌ Anthropic API streaming failed',
          expect.objectContaining({
            error: 'Something went wrong',
            isECONNRESET: false,
          })
        );
      });

      it('should handle mid-stream errors', async () => {
        // Create an async iterable that yields some events then throws
        function createErrorInMiddle(): AsyncIterable<MessageStreamEvent> {
          return {
            [Symbol.asyncIterator]: async function* () {
              yield createMessageStartEvent();
              yield {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              } as unknown as MessageStreamEvent;
              throw new Error('Connection lost mid-stream');
            },
          };
        }
        mockStream.mockReturnValueOnce(createErrorInMiddle());

        const stream = client.createChatCompletionStream(createBaseRequest());
        const receivedEvents: MessageStreamEvent[] = [];

        await expect(async () => {
          for await (const event of stream) {
            receivedEvents.push(event);
          }
        }).rejects.toThrow('Anthropic streaming API call failed: Connection lost mid-stream');

        // Should have received the first two events before error
        expect(receivedEvents).toHaveLength(2);
      });
    });

    // H1: Concurrent streams isolation
    describe('concurrent streams (multi-tenant)', () => {
      it('should handle multiple concurrent streams without interference', async () => {
        const events1: MessageStreamEvent[] = [
          createMessageStartEvent('stream1_msg'),
          { type: 'message_stop' } as MessageStreamEvent,
        ];
        const events2: MessageStreamEvent[] = [
          createMessageStartEvent('stream2_msg'),
          { type: 'message_stop' } as MessageStreamEvent,
        ];

        mockStream
          .mockReturnValueOnce(createMockAsyncIterable(events1))
          .mockReturnValueOnce(createMockAsyncIterable(events2));

        // Start both streams
        const stream1Promise = collectEvents(client.createChatCompletionStream(createBaseRequest()));
        const stream2Promise = collectEvents(client.createChatCompletionStream(createBaseRequest()));

        // Await both concurrently
        const [result1, result2] = await Promise.all([stream1Promise, stream2Promise]);

        // Verify isolation
        const msg1 = result1[0] as { type: string; message?: { id: string } };
        const msg2 = result2[0] as { type: string; message?: { id: string } };

        expect(msg1?.message?.id).toBe('stream1_msg');
        expect(msg2?.message?.id).toBe('stream2_msg');
        expect(result1).toHaveLength(2);
        expect(result2).toHaveLength(2);
      });

      it('should isolate errors between concurrent streams', async () => {
        const successEvents: MessageStreamEvent[] = [
          createMessageStartEvent('success_msg'),
          { type: 'message_stop' } as MessageStreamEvent,
        ];

        // First stream succeeds, second fails
        mockStream
          .mockReturnValueOnce(createMockAsyncIterable(successEvents))
          .mockImplementationOnce(() => {
            throw new Error('Stream 2 failed');
          });

        const stream1Promise = collectEvents(client.createChatCompletionStream(createBaseRequest()));
        const stream2 = client.createChatCompletionStream(createBaseRequest());

        // First should succeed
        const result1 = await stream1Promise;
        expect(result1).toHaveLength(2);

        // Second should fail independently
        await expect(collectEvents(stream2)).rejects.toThrow('Anthropic streaming API call failed: Stream 2 failed');
      });
    });

    // H5: Stream timeout/stall handling
    describe('stream timeout behavior', () => {
      it('should allow external timeout handling for stalled streams', async () => {
        // Create a stream that never emits events (stalled)
        let streamStarted = false;
        const stalledStream = {
          [Symbol.asyncIterator]: async function* () {
            streamStarted = true;
            // Wait indefinitely (simulates network stall)
            await new Promise<never>(() => {});
          },
        };
        mockStream.mockReturnValueOnce(stalledStream);

        const stream = client.createChatCompletionStream(createBaseRequest());

        // External timeout mechanism
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), 50);
        });

        const consumePromise = (async () => {
          const events: MessageStreamEvent[] = [];
          for await (const event of stream) {
            events.push(event);
          }
          return events;
        })();

        // Race between stream consumption and timeout
        const result = await Promise.race([consumePromise, timeoutPromise]);

        expect(result).toBe('timeout');
        expect(streamStarted).toBe(true);
      });
    });
  });

  // ====================
  // getUnderlyingClient TESTS
  // ====================
  describe('getUnderlyingClient', () => {
    it('should return the underlying Anthropic SDK client', () => {
      const underlying = client.getUnderlyingClient();

      // The underlying client should have the messages property
      expect(underlying).toBeDefined();
      expect(underlying.messages).toBeDefined();
    });

    it('should return the same client instance on multiple calls', () => {
      const client1 = client.getUnderlyingClient();
      const client2 = client.getUnderlyingClient();

      expect(client1).toBe(client2);
    });

    // M5: Test getUnderlyingClient after error
    it('should return client even after previous errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API failed'));

      try {
        await client.createChatCompletion(createBaseRequest());
      } catch {
        // Expected
      }

      const underlying = client.getUnderlyingClient();
      expect(underlying).toBeDefined();
      expect(underlying.messages).toBeDefined();
    });
  });

  // ====================
  // EDGE CASES
  // ====================
  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const mockResponse = createMockResponse({
        id: 'msg_empty',
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const request = createBaseRequest({ messages: [] });

      const result = await client.createChatCompletion(request);

      expect(result.content).toEqual([]);
    });

    // H2: Test max_tokens: 0
    it('should pass max_tokens of 0 to SDK (SDK validation)', async () => {
      // Note: SDK may reject this, but we pass it through
      mockCreate.mockRejectedValueOnce(new Error('max_tokens must be at least 1'));

      const request = createBaseRequest({ max_tokens: 0 });

      await expect(client.createChatCompletion(request)).rejects.toThrow();

      // Verify we attempted the call with max_tokens: 0
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 0 })
      );
    });

    // H2: Test max_tokens: 1 (boundary)
    it('should handle max_tokens of 1 (minimum valid)', async () => {
      const mockResponse = createMockResponse({
        usage: { input_tokens: 10, output_tokens: 1 },
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const request = createBaseRequest({ max_tokens: 1 });

      const result = await client.createChatCompletion(request);

      expect(result.usage.output_tokens).toBe(1);
    });

    it('should handle max_tokens stop reason', async () => {
      const mockResponse = createMockResponse({
        id: 'msg_max',
        content: [{ type: 'text', text: 'Truncated response...', citations: [] }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 100, output_tokens: 4096 },
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const request = createBaseRequest({
        messages: [{ role: 'user', content: 'Write a very long essay' }],
      });

      const result = await client.createChatCompletion(request);

      expect(result.stop_reason).toBe('max_tokens');
    });

    it('should handle stop_sequence stop reason', async () => {
      const mockResponse = createMockResponse({
        id: 'msg_stop_seq',
        content: [{ type: 'text', text: 'Response until stop', citations: [] }],
        stop_reason: 'stop_sequence',
        stop_sequence: '###END###',
        usage: { input_tokens: 50, output_tokens: 20 },
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const result = await client.createChatCompletion(createBaseRequest());

      expect(result.stop_reason).toBe('stop_sequence');
      expect(result.stop_sequence).toBe('###END###');
    });

    it('should handle multiple tool_use blocks in response', async () => {
      const mockResponse = createMockResponse({
        id: 'msg_multi_tool',
        content: [
          { type: 'text', text: 'I will use two tools:', citations: [] },
          { type: 'tool_use', id: 'tool_1', name: 'tool_a', input: { x: 1 } },
          { type: 'tool_use', id: 'tool_2', name: 'tool_b', input: { y: 2 } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 80 },
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const request = createBaseRequest({
        messages: [{ role: 'user', content: 'Do multiple things' }],
        tools: [
          { name: 'tool_a', description: 'Tool A', input_schema: { type: 'object', properties: {} } },
          { name: 'tool_b', description: 'Tool B', input_schema: { type: 'object', properties: {} } },
        ],
      });

      const result = await client.createChatCompletion(request);

      expect(result.content).toHaveLength(3);
      expect(result.stop_reason).toBe('tool_use');
    });

    // H4: Multi-turn conversation with tool results
    it('should handle multi-turn conversation with tool results', async () => {
      mockCreate.mockResolvedValueOnce(createMockResponse());

      const multiTurnRequest = createBaseRequest({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: [{ type: 'text', text: 'Hi! Let me help.' }] },
          { role: 'user', content: 'Use a tool' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool_1', name: 'test_tool', input: { query: 'test' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'Tool result here' }],
          },
        ],
        tools: [{ name: 'test_tool', description: 'Test', input_schema: { type: 'object', properties: {} } }],
      });

      await client.createChatCompletion(multiTurnRequest);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: multiTurnRequest.messages,
        })
      );
    });

    // Test null stop_reason (in progress)
    it('should handle null stop_reason', async () => {
      const mockResponse = createMockResponse({
        stop_reason: null,
      });
      mockCreate.mockResolvedValueOnce(mockResponse);

      const result = await client.createChatCompletion(createBaseRequest());

      expect(result.stop_reason).toBeNull();
    });
  });

  // ====================
  // SECURITY TESTS (C3)
  // ====================
  describe('security', () => {
    it('should not expose API key in error stack traces', async () => {
      const errorWithStack = new Error('Connection failed');
      mockCreate.mockRejectedValueOnce(errorWithStack);

      try {
        await client.createChatCompletion(createBaseRequest());
      } catch (error) {
        const stack = (error as Error).stack ?? '';
        expect(stack).not.toContain(TEST_API_KEY);
        expect(stack).not.toContain('sk-ant-');
      }
    });

    it('should not log API key in error details', async () => {
      const errorWithKey = new Error('Auth failed for key');
      mockCreate.mockRejectedValueOnce(errorWithKey);

      try {
        await client.createChatCompletion(createBaseRequest());
      } catch {
        // Expected
      }

      // Check all mockLoggerError calls
      const errorCalls = mockLoggerError.mock.calls;
      for (const call of errorCalls) {
        const loggedData = JSON.stringify(call);
        expect(loggedData).not.toContain(TEST_API_KEY);
      }
    });
  });
});
