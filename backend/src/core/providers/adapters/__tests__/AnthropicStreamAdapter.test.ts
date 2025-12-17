import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicStreamAdapter } from '../AnthropicStreamAdapter';
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
  });
});
