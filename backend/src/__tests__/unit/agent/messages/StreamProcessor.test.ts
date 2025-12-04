/**
 * StreamProcessor Unit Tests
 *
 * Tests the stream processing logic extracted from DirectAgentService.
 * Uses mock Anthropic stream events to verify:
 * - Event handling for all event types
 * - Correct StreamEvent yielding
 * - TurnResult generation with proper ordering
 * - Token tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamProcessor, blocksToAnthropicFormat } from '@services/agent/messages/StreamProcessor';
import type { StreamEvent } from '@services/agent/messages/StreamProcessor';
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

// Mock logger to avoid noise in tests
vi.mock('@/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Helper to create mock Anthropic stream events
 */
function createMockStream(events: MessageStreamEvent[]): AsyncIterable<MessageStreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Create a message_start event
 */
function messageStart(options: {
  messageId?: string;
  model?: string;
  inputTokens?: number;
  cacheCreation?: number;
  cacheRead?: number;
} = {}): MessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: options.messageId || 'msg_01XYZ',
      type: 'message',
      role: 'assistant',
      content: [],
      model: options.model || 'claude-sonnet-4-5-20250929',
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: options.inputTokens || 100,
        output_tokens: 0,
        cache_creation_input_tokens: options.cacheCreation,
        cache_read_input_tokens: options.cacheRead,
      } as any,
    },
  } as MessageStreamEvent;
}

/**
 * Create a content_block_start event for text
 */
function textBlockStart(index: number): MessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  } as MessageStreamEvent;
}

/**
 * Create a content_block_start event for thinking
 */
function thinkingBlockStart(index: number): MessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'thinking', thinking: '' },
  } as MessageStreamEvent;
}

/**
 * Create a content_block_start event for tool_use
 */
function toolUseBlockStart(index: number, toolId: string, toolName: string): MessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} },
  } as MessageStreamEvent;
}

/**
 * Create a text_delta event
 */
function textDelta(index: number, text: string): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  } as MessageStreamEvent;
}

/**
 * Create a thinking_delta event
 */
function thinkingDelta(index: number, thinking: string): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking },
  } as MessageStreamEvent;
}

/**
 * Create an input_json_delta event
 */
function inputJsonDelta(index: number, partialJson: string): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  } as MessageStreamEvent;
}

/**
 * Create a signature_delta event
 */
function signatureDelta(index: number, signature: string): MessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'signature_delta', signature },
  } as MessageStreamEvent;
}

/**
 * Create a content_block_stop event
 */
function blockStop(index: number): MessageStreamEvent {
  return {
    type: 'content_block_stop',
    index,
  } as MessageStreamEvent;
}

/**
 * Create a message_delta event
 */
function messageDelta(stopReason: string, outputTokens: number): MessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  } as MessageStreamEvent;
}

/**
 * Create a message_stop event
 */
function messageStop(): MessageStreamEvent {
  return { type: 'message_stop' } as MessageStreamEvent;
}

describe('StreamProcessor', () => {
  let processor: StreamProcessor;

  beforeEach(() => {
    processor = new StreamProcessor({ sessionId: 'test-session', turnCount: 1 });
  });

  describe('processStream - basic flow', () => {
    it('should process a simple text message', async () => {
      const stream = createMockStream([
        messageStart({ messageId: 'msg_123', inputTokens: 50 }),
        textBlockStart(0),
        textDelta(0, 'Hello '),
        textDelta(0, 'World'),
        blockStop(0),
        messageDelta('end_turn', 10),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);

      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      // Check yielded events
      expect(events).toContainEqual({
        type: 'message_start',
        messageId: 'msg_123',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 50,
        cacheTokens: undefined,
      });
      expect(events).toContainEqual({ type: 'text_chunk', index: 0, chunk: 'Hello ' });
      expect(events).toContainEqual({ type: 'text_chunk', index: 0, chunk: 'World' });
      expect(events.find(e => e.type === 'block_complete')).toBeDefined();
      expect(events).toContainEqual({ type: 'message_delta', stopReason: 'end_turn', outputTokens: 10 });
      expect(events).toContainEqual({ type: 'message_stop' });

      // Check turn result
      const turnResult = result.value;
      expect(turnResult.messageId).toBe('msg_123');
      expect(turnResult.stopReason).toBe('end_turn');
      expect(turnResult.blocks).toHaveLength(1);
      expect(turnResult.blocks[0].content).toEqual({
        type: 'text',
        text: 'Hello World',
        citations: [],
      });
      expect(turnResult.usage.inputTokens).toBe(50);
      expect(turnResult.usage.outputTokens).toBe(10);
    });

    it('should process a thinking + text message', async () => {
      const stream = createMockStream([
        messageStart(),
        thinkingBlockStart(0),
        thinkingDelta(0, 'Let me think...'),
        signatureDelta(0, 'sig_abc'),
        blockStop(0),
        textBlockStart(1),
        textDelta(1, 'The answer is 42'),
        blockStop(1),
        messageDelta('end_turn', 20),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);

      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      // Check thinking chunk events
      expect(events).toContainEqual({ type: 'thinking_chunk', index: 0, chunk: 'Let me think...' });

      // Check turn result ordering
      const turnResult = result.value;
      expect(turnResult.blocks).toHaveLength(2);
      expect(turnResult.blocks[0].type).toBe('thinking');
      expect(turnResult.blocks[0].anthropicIndex).toBe(0);
      expect(turnResult.blocks[1].type).toBe('text');
      expect(turnResult.blocks[1].anthropicIndex).toBe(1);
    });

    it('should process a tool use message', async () => {
      const stream = createMockStream([
        messageStart(),
        textBlockStart(0),
        textDelta(0, 'Let me search...'),
        blockStop(0),
        toolUseBlockStart(1, 'toolu_01ABC', 'search_entity'),
        inputJsonDelta(1, '{"entity":'),
        inputJsonDelta(1, '"customers"}'),
        blockStop(1),
        messageDelta('tool_use', 30),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);

      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      // Check tool start event
      expect(events).toContainEqual({
        type: 'tool_start',
        index: 1,
        toolId: 'toolu_01ABC',
        toolName: 'search_entity',
      });

      // Check tool input chunk events
      expect(events).toContainEqual({ type: 'tool_input_chunk', index: 1, partialJson: '{"entity":' });
      expect(events).toContainEqual({ type: 'tool_input_chunk', index: 1, partialJson: '"customers"}' });

      // Check turn result
      const turnResult = result.value;
      expect(turnResult.stopReason).toBe('tool_use');
      expect(turnResult.blocks).toHaveLength(2);
      expect(turnResult.blocks[1].content).toEqual({
        type: 'tool_use',
        id: 'toolu_01ABC',
        name: 'search_entity',
        input: { entity: 'customers' },
      });
    });

    it('should handle multiple tool uses in order', async () => {
      const stream = createMockStream([
        messageStart(),
        toolUseBlockStart(0, 'toolu_01', 'first_tool'),
        inputJsonDelta(0, '{}'),
        blockStop(0),
        toolUseBlockStart(1, 'toolu_02', 'second_tool'),
        inputJsonDelta(1, '{}'),
        blockStop(1),
        messageDelta('tool_use', 20),
        messageStop(),
      ]);

      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }

      const turnResult = result.value;
      expect(turnResult.blocks).toHaveLength(2);
      expect(turnResult.blocks[0].anthropicIndex).toBe(0);
      expect(turnResult.blocks[0].content.type).toBe('tool_use');
      expect((turnResult.blocks[0].content as any).name).toBe('first_tool');
      expect(turnResult.blocks[1].anthropicIndex).toBe(1);
      expect((turnResult.blocks[1].content as any).name).toBe('second_tool');
    });
  });

  describe('cache token handling', () => {
    it('should capture cache tokens when present', async () => {
      const stream = createMockStream([
        messageStart({ inputTokens: 100, cacheCreation: 50, cacheRead: 30 }),
        textBlockStart(0),
        textDelta(0, 'Cached response'),
        blockStop(0),
        messageDelta('end_turn', 10),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);

      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      // Check message_start event has cache tokens
      const startEvent = events.find(e => e.type === 'message_start') as any;
      expect(startEvent.cacheTokens).toEqual({ creation: 50, read: 30 });

      // Check turn result has cache tokens
      const turnResult = result.value;
      expect(turnResult.usage.cacheCreationInputTokens).toBe(50);
      expect(turnResult.usage.cacheReadInputTokens).toBe(30);
    });

    it('should not include cache tokens when not present', async () => {
      const stream = createMockStream([
        messageStart({ inputTokens: 100 }),
        textBlockStart(0),
        textDelta(0, 'No cache'),
        blockStop(0),
        messageDelta('end_turn', 10),
        messageStop(),
      ]);

      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }

      const turnResult = result.value;
      expect(turnResult.usage.cacheCreationInputTokens).toBeUndefined();
      expect(turnResult.usage.cacheReadInputTokens).toBeUndefined();
    });
  });

  describe('state management', () => {
    it('should reset state between streams', async () => {
      // First stream
      const stream1 = createMockStream([
        messageStart({ messageId: 'msg_first' }),
        textBlockStart(0),
        textDelta(0, 'First'),
        blockStop(0),
        messageDelta('end_turn', 10),
        messageStop(),
      ]);

      const gen1 = processor.processStream(stream1);
      let result1 = await gen1.next();
      while (!result1.done) result1 = await gen1.next();

      expect(result1.value.messageId).toBe('msg_first');

      // Second stream (should have clean state)
      const stream2 = createMockStream([
        messageStart({ messageId: 'msg_second' }),
        textBlockStart(0),
        textDelta(0, 'Second'),
        blockStop(0),
        messageDelta('end_turn', 5),
        messageStop(),
      ]);

      const gen2 = processor.processStream(stream2);
      let result2 = await gen2.next();
      while (!result2.done) result2 = await gen2.next();

      expect(result2.value.messageId).toBe('msg_second');
      expect(result2.value.blocks).toHaveLength(1);
      expect(result2.value.blocks[0].content).toEqual({
        type: 'text',
        text: 'Second',
        citations: [],
      });
    });

    it('should provide accurate state summary', async () => {
      const stream = createMockStream([
        messageStart({ messageId: 'msg_test', model: 'claude-test' }),
        textBlockStart(0),
        textDelta(0, 'Test'),
        blockStop(0),
        messageDelta('end_turn', 15),
        messageStop(),
      ]);

      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }

      const summary = processor.getStateSummary();
      expect(summary.messageId).toBe('msg_test');
      expect(summary.model).toBe('claude-test');
      expect(summary.stopReason).toBe('end_turn');
      expect(summary.outputTokens).toBe(15);
    });
  });

  describe('getters', () => {
    it('should return accumulated text', async () => {
      const stream = createMockStream([
        messageStart(),
        thinkingBlockStart(0),
        thinkingDelta(0, 'Thinking...'),
        blockStop(0),
        textBlockStart(1),
        textDelta(1, 'Answer: '),
        textDelta(1, '42'),
        blockStop(1),
        messageDelta('end_turn', 10),
        messageStop(),
      ]);

      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }

      expect(processor.getAccumulatedText()).toBe('Answer: 42');
    });

    it('should return correct getters after processing', async () => {
      const stream = createMockStream([
        messageStart({ messageId: 'msg_xyz', model: 'claude-test-model' }),
        textBlockStart(0),
        textDelta(0, 'Test'),
        blockStop(0),
        messageDelta('max_tokens', 100),
        messageStop(),
      ]);

      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }

      expect(processor.getMessageId()).toBe('msg_xyz');
      expect(processor.getModel()).toBe('claude-test-model');
      expect(processor.getStopReason()).toBe('max_tokens');
    });
  });

  describe('edge cases', () => {
    it('should handle empty text deltas', async () => {
      const stream = createMockStream([
        messageStart(),
        textBlockStart(0),
        textDelta(0, ''),  // Empty delta
        textDelta(0, 'Content'),
        blockStop(0),
        messageDelta('end_turn', 5),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      // Empty chunks should not be yielded
      const textChunks = events.filter(e => e.type === 'text_chunk');
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0]).toEqual({ type: 'text_chunk', index: 0, chunk: 'Content' });
    });

    it('should handle tool_use with fallback ID', async () => {
      const stream = createMockStream([
        messageStart(),
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: '', name: 'test_tool', input: {} },
        } as MessageStreamEvent,
        inputJsonDelta(0, '{}'),
        blockStop(0),
        messageDelta('tool_use', 10),
        messageStop(),
      ]);

      const events: StreamEvent[] = [];
      const generator = processor.processStream(stream);
      let result = await generator.next();
      while (!result.done) {
        events.push(result.value);
        result = await generator.next();
      }

      const toolStart = events.find(e => e.type === 'tool_start') as any;
      expect(toolStart.toolId).toMatch(/^toolu_fallback_/);
    });
  });
});

describe('blocksToAnthropicFormat', () => {
  it('should convert completed blocks to Anthropic format', () => {
    const blocks = [
      {
        type: 'thinking' as const,
        anthropicIndex: 0,
        content: {
          type: 'thinking' as const,
          thinking: 'My thoughts',
          signature: 'sig_123',
        },
      },
      {
        type: 'text' as const,
        anthropicIndex: 1,
        content: {
          type: 'text' as const,
          text: 'Hello World',
          citations: [],
        },
      },
      {
        type: 'tool_use' as const,
        anthropicIndex: 2,
        content: {
          type: 'tool_use' as const,
          id: 'toolu_01',
          name: 'search',
          input: { query: 'test' },
        },
      },
    ];

    const result = blocksToAnthropicFormat(blocks);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      type: 'thinking',
      thinking: 'My thoughts',
      signature: 'sig_123',
    });
    expect(result[1]).toEqual({
      type: 'text',
      text: 'Hello World',
      citations: [],
    });
    expect(result[2]).toEqual({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'search',
      input: { query: 'test' },
    });
  });
});
