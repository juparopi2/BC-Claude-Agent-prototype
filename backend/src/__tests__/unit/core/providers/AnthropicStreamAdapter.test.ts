import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicStreamAdapter } from '@/core/providers/adapters/AnthropicStreamAdapter';
import { StreamEvent } from '@langchain/core/tracers/log_stream';

/**
 * Type-safe mock factory for StreamEvent objects.
 * This follows the PRINCIPLES.md guideline to avoid `any` types in tests.
 */
interface MockStreamEventData {
  event: string;
  data: {
    chunk?: {
      content?: string | Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
        citations?: Array<{
          cited_text: string;
          document_title?: string;
          document_index?: number;
          start_char_index?: number;
          end_char_index?: number;
        }>;
      }>;
      id?: string;
    };
    output?: {
      llmOutput?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    };
  };
  run_id: string;
}

function createMockEvent(data: MockStreamEventData): StreamEvent {
  return data as StreamEvent;
}

describe('AnthropicStreamAdapter', () => {
  let adapter: AnthropicStreamAdapter;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    adapter = new AnthropicStreamAdapter(sessionId);
  });

  it('should initialize with correct provider', () => {
    expect(adapter.provider).toBe('anthropic');
  });

  describe('processChunk', () => {
    it('should ignore irrelevant events', () => {
      const event = createMockEvent({
        event: 'on_tool_start',
        data: {},
        run_id: 'run-123'
      });
      const result = adapter.processChunk(event);
      expect(result).toBeNull();
    });

    it('should process text content chunks', () => {
      const event = createMockEvent({
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            content: [
              { type: 'text', text: 'Hello world' }
            ]
          }
        },
        run_id: 'msg-123'
      });

      const result = adapter.processChunk(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('content_delta');
      expect(result?.content).toBe('Hello world');
      expect(result?.metadata.isStreaming).toBe(true);
      expect(result?.metadata.messageId).toBe('msg-123');
    });

    it('should process thinking (reasoning) chunks', () => {
      const event = createMockEvent({
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            content: [
              { type: 'thinking', thinking: 'I need to think about this...' }
            ]
          }
        },
        run_id: 'msg-123'
      });

      const result = adapter.processChunk(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('reasoning_delta');
      expect(result?.reasoning).toBe('I need to think about this...');
      expect(result?.metadata.isStreaming).toBe(true);
    });

    it('should validly process simple string content', () => {
      const event = createMockEvent({
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            content: 'Simple text'
          }
        },
        run_id: 'msg-123'
      });

      const result = adapter.processChunk(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('content_delta');
      expect(result?.content).toBe('Simple text');
    });

    it('should process tool use chunks correctly using Anthropic IDs', () => {
      const event = createMockEvent({
        event: 'on_chat_model_stream',
        data: {
          chunk: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_01234',
                name: 'get_weather',
                input: { city: 'Madrid' }
              }
            ]
          }
        },
        run_id: 'msg-tool-1'
      });

      const result = adapter.processChunk(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('tool_call');
      expect(result?.toolCall).toBeDefined();
      expect(result?.toolCall?.id).toBe('toolu_01234'); // Verify using Anthropic ID
      expect(result?.toolCall?.name).toBe('get_weather');
      expect(result?.toolCall?.input).toEqual({ city: 'Madrid' });
    });

    it('should process usage events', () => {
      const event = createMockEvent({
        event: 'on_chat_model_end',
        data: {
          output: {
            llmOutput: {
              usage: {
                input_tokens: 10,
                output_tokens: 20
              }
            }
          }
        },
        run_id: 'run-end'
      });

      const result = adapter.processChunk(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('usage');
      expect(result?.usage).toBeDefined();
      expect(result?.usage?.inputTokens).toBe(10);
      expect(result?.usage?.outputTokens).toBe(20);
      expect(result?.metadata.isFinal).toBe(true);
    });

    describe('edge cases', () => {
      it('should return null for empty content array', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: []
            }
          },
          run_id: 'msg-empty'
        });

        const result = adapter.processChunk(event);
        expect(result).toBeNull();
      });

      it('should return null for missing chunk', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {},
          run_id: 'msg-no-chunk'
        });

        const result = adapter.processChunk(event);
        expect(result).toBeNull();
      });

      it('should skip signature blocks (return null)', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: [
                { type: 'signature', text: 'cryptographic_signature_data' }
              ]
            }
          },
          run_id: 'msg-signature'
        });

        const result = adapter.processChunk(event);
        expect(result).toBeNull();
      });

      it('should skip input_json_delta blocks (return null)', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: [
                { type: 'input_json_delta', text: '{"partial": "json"}' }
              ]
            }
          },
          run_id: 'msg-json-delta'
        });

        const result = adapter.processChunk(event);
        expect(result).toBeNull();
      });

      it('should extract citations from text blocks', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: [
                {
                  type: 'text',
                  text: 'According to the financial report...',
                  citations: [
                    {
                      cited_text: 'Revenue increased by 15%',
                      document_title: 'Q4 Financial Report',
                      document_index: 0,
                      start_char_index: 0,
                      end_char_index: 25
                    }
                  ]
                }
              ]
            }
          },
          run_id: 'msg-citations'
        });

        const result = adapter.processChunk(event);

        expect(result).not.toBeNull();
        expect(result?.type).toBe('content_delta');
        expect(result?.content).toBe('According to the financial report...');
        expect(result?.citation).toBeDefined();
        expect(result?.citation?.text).toBe('Revenue increased by 15%');
        expect(result?.citation?.source).toBe('Q4 Financial Report');
        expect(result?.citation?.documentIndex).toBe(0);
        expect(result?.citation?.location).toEqual({ start: 0, end: 25 });
      });

      it('should handle text blocks without citations', () => {
        const event = createMockEvent({
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: [
                {
                  type: 'text',
                  text: 'No citations here'
                }
              ]
            }
          },
          run_id: 'msg-no-citations'
        });

        const result = adapter.processChunk(event);

        expect(result).not.toBeNull();
        expect(result?.type).toBe('content_delta');
        expect(result?.citation).toBeUndefined();
      });
    });
  });

  describe('blockIndex tracking', () => {
    it('should increment blockIndex for each processed chunk', () => {
      const event1 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'First' }] } },
        run_id: 'msg-1'
      });
      const event2 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'Second' }] } },
        run_id: 'msg-1'
      });
      const event3 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'thinking', thinking: 'Third' }] } },
        run_id: 'msg-1'
      });

      const result1 = adapter.processChunk(event1);
      const result2 = adapter.processChunk(event2);
      const result3 = adapter.processChunk(event3);

      expect(result1?.metadata.blockIndex).toBe(0);
      expect(result2?.metadata.blockIndex).toBe(1);
      expect(result3?.metadata.blockIndex).toBe(2);
    });

    it('should not increment blockIndex for skipped events', () => {
      // First valid event
      const validEvent = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'Valid' }] } },
        run_id: 'msg-1'
      });

      // Skipped event (signature)
      const skippedEvent = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'signature', text: 'sig' }] } },
        run_id: 'msg-1'
      });

      // Second valid event
      const validEvent2 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'Valid2' }] } },
        run_id: 'msg-1'
      });

      const result1 = adapter.processChunk(validEvent);
      const skipped = adapter.processChunk(skippedEvent);
      const result2 = adapter.processChunk(validEvent2);

      expect(result1?.metadata.blockIndex).toBe(0);
      expect(skipped).toBeNull();
      // blockIndex should be 1, not 2, because skipped events don't increment
      expect(result2?.metadata.blockIndex).toBe(1);
    });
  });

  describe('reset()', () => {
    it('should reset blockIndex counter to zero', () => {
      // Process some events to increment counter
      const event1 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'First' }] } },
        run_id: 'msg-1'
      });
      const event2 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'Second' }] } },
        run_id: 'msg-1'
      });

      adapter.processChunk(event1);
      adapter.processChunk(event2);
      expect(adapter.getCurrentBlockIndex()).toBe(2);

      // Reset
      adapter.reset();
      expect(adapter.getCurrentBlockIndex()).toBe(0);

      // Verify next event starts at 0
      const event3 = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'After reset' }] } },
        run_id: 'msg-2'
      });
      const result = adapter.processChunk(event3);
      expect(result?.metadata.blockIndex).toBe(0);
    });
  });

  describe('getCurrentBlockIndex()', () => {
    it('should return 0 for new adapter', () => {
      expect(adapter.getCurrentBlockIndex()).toBe(0);
    });

    it('should return current counter value', () => {
      const event = createMockEvent({
        event: 'on_chat_model_stream',
        data: { chunk: { content: [{ type: 'text', text: 'Test' }] } },
        run_id: 'msg-1'
      });

      expect(adapter.getCurrentBlockIndex()).toBe(0);
      adapter.processChunk(event);
      expect(adapter.getCurrentBlockIndex()).toBe(1);
      adapter.processChunk(event);
      expect(adapter.getCurrentBlockIndex()).toBe(2);
    });
  });
});
