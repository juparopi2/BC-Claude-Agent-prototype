/**
 * Unit tests for GraphStreamProcessor (Subfase 6A + 6B + 6C + 6D)
 *
 * Subfase 6A: Basic reasoning_delta and content_delta processing with accumulator integration.
 * Subfase 6B: Turn boundary detection (thinking_complete transition, final_response, array event handling).
 * Subfase 6C: Tool execution handling (tool_call processing, deduplication, mixed flows).
 * Subfase 6D: Usage events, stop reason handling, and final_response edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GraphStreamProcessor,
  createGraphStreamProcessor,
  type StreamProcessorContext,
} from '@domains/agent/streaming/GraphStreamProcessor';
import { ThinkingAccumulator } from '@domains/agent/streaming/ThinkingAccumulator';
import { ContentAccumulator } from '@domains/agent/streaming/ContentAccumulator';
import { ToolEventDeduplicator } from '@domains/agent/tools/ToolEventDeduplicator';
import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type { ProcessedStreamEvent } from '@domains/agent/streaming/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock INormalizedStreamEvent with default values.
 */
function createMockNormalizedEvent(
  overrides: Partial<INormalizedStreamEvent>
): INormalizedStreamEvent {
  return {
    type: 'content_delta',
    provider: 'anthropic',
    timestamp: new Date(),
    content: '',
    metadata: {
      blockIndex: 0,
      isStreaming: true,
      isFinal: false,
    },
    ...overrides,
  };
}

/**
 * Collects all events from an async generator into an array.
 */
async function collectEvents<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const event of generator) {
    results.push(event);
  }
  return results;
}

/**
 * Creates an async iterable from an array.
 */
async function* createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Helper function to create tool_call events.
 */
function createToolCallEvent(
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): INormalizedStreamEvent {
  return createMockNormalizedEvent({
    type: 'tool_call',
    toolCall: { id, name, input },
    metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
  });
}

/**
 * Mock context for stream processing.
 */
const mockContext: StreamProcessorContext = {
  sessionId: 'test-session',
  userId: 'test-user',
  enableThinking: true,
};

// ============================================================================
// Tests
// ============================================================================

describe('GraphStreamProcessor', () => {
  let thinkingAccumulator: ThinkingAccumulator;
  let contentAccumulator: ContentAccumulator;
  let processor: GraphStreamProcessor;

  beforeEach(() => {
    thinkingAccumulator = new ThinkingAccumulator();
    contentAccumulator = new ContentAccumulator();
    processor = new GraphStreamProcessor(thinkingAccumulator, contentAccumulator);
  });

  // ==========================================================================
  // 1. Construction and Factory (3 tests)
  // ==========================================================================

  describe('construction and factory', () => {
    it('should create instance with injected accumulators', () => {
      expect(processor).toBeInstanceOf(GraphStreamProcessor);
    });

    it('should have process method', () => {
      expect(processor.process).toBeDefined();
      expect(typeof processor.process).toBe('function');
    });

    it('should create instance via factory function', () => {
      const factoryProcessor = createGraphStreamProcessor(
        thinkingAccumulator,
        contentAccumulator
      );
      expect(factoryProcessor).toBeInstanceOf(GraphStreamProcessor);
    });
  });

  // ==========================================================================
  // 2. Basic Streaming (3 tests)
  // ==========================================================================

  describe('basic streaming', () => {
    it('should process empty event stream', async () => {
      const events: INormalizedStreamEvent[] = [];
      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(0);
    });

    it('should yield events for each input', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Hello',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: ' world',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(2);
    });

    it('should be async iterable', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'test',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const generator = processor.process(createAsyncIterable(events), mockContext);

      // Should be able to iterate with for-await-of
      const results: ProcessedStreamEvent[] = [];
      for await (const event of generator) {
        results.push(event);
      }

      expect(results).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 3. Reasoning Delta Processing (5 tests)
  // ==========================================================================

  describe('reasoning_delta processing', () => {
    it('should convert reasoning_delta to thinking_chunk', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Let me think...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'thinking_chunk',
        content: 'Let me think...',
        blockIndex: 0,
      });
    });

    it('should pass reasoning content to ThinkingAccumulator.append()', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking chunk',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Verify accumulator received the content
      expect(thinkingAccumulator.getContent()).toBe('Thinking chunk');
      expect(thinkingAccumulator.getChunkCount()).toBe(1);
    });

    it('should include blockIndex from metadata', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking',
          metadata: { blockIndex: 5, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results[0]?.blockIndex).toBe(5);
    });

    it('should handle empty reasoning content', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: '',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'thinking_chunk',
        content: '',
        blockIndex: 0,
      });

      // Empty chunks should not be added to accumulator
      expect(thinkingAccumulator.getChunkCount()).toBe(0);
    });

    it('should handle multiple reasoning chunks', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'First ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Second ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Third',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.content).toBe('First ');
      expect(results[1]?.content).toBe('Second ');
      expect(results[2]?.content).toBe('Third');

      // All chunks should be accumulated
      expect(thinkingAccumulator.getContent()).toBe('First Second Third');
      expect(thinkingAccumulator.getChunkCount()).toBe(3);
    });
  });

  // ==========================================================================
  // 4. Content Delta Processing (5 tests)
  // ==========================================================================

  describe('content_delta processing', () => {
    it('should convert content_delta to message_chunk', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Hello world',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'message_chunk',
        content: 'Hello world',
        blockIndex: 1,
      });
    });

    it('should pass content to ContentAccumulator.append()', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content chunk',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Verify accumulator received the content
      expect(contentAccumulator.getContent()).toBe('Content chunk');
      expect(contentAccumulator.getChunkCount()).toBe(1);
    });

    it('should include blockIndex from metadata', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content',
          metadata: { blockIndex: 7, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results[0]?.blockIndex).toBe(7);
    });

    it('should handle empty content', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: '',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        type: 'message_chunk',
        content: '',
        blockIndex: 0,
      });

      // Empty chunks should not be added to accumulator
      expect(contentAccumulator.getChunkCount()).toBe(0);
    });

    it('should handle multiple content chunks', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Hello ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'beautiful ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'world',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.content).toBe('Hello ');
      expect(results[1]?.content).toBe('beautiful ');
      expect(results[2]?.content).toBe('world');

      // All chunks should be accumulated
      expect(contentAccumulator.getContent()).toBe('Hello beautiful world');
      expect(contentAccumulator.getChunkCount()).toBe(3);
    });
  });

  // ==========================================================================
  // 5. Accumulator Integration (4 tests)
  // ==========================================================================

  describe('accumulator integration', () => {
    it('should reset accumulators at start of process()', async () => {
      // Pre-populate accumulators with data
      thinkingAccumulator.append('Old thinking');
      contentAccumulator.append('Old content');

      expect(thinkingAccumulator.getChunkCount()).toBe(1);
      expect(contentAccumulator.getChunkCount()).toBe(1);

      // Process empty stream
      const events: INormalizedStreamEvent[] = [];
      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Accumulators should be reset
      expect(thinkingAccumulator.getChunkCount()).toBe(0);
      expect(contentAccumulator.getChunkCount()).toBe(0);
      expect(thinkingAccumulator.getContent()).toBe('');
      expect(contentAccumulator.getContent()).toBe('');
    });

    it('should accumulate thinking across multiple events', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Step 1: ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Step 2: ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Step 3',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(thinkingAccumulator.getContent()).toBe('Step 1: Step 2: Step 3');
      expect(thinkingAccumulator.getChunkCount()).toBe(3);
      expect(thinkingAccumulator.hasContent()).toBe(true);
    });

    it('should accumulate content across multiple events', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'The ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'quick ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'brown ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'fox',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(contentAccumulator.getContent()).toBe('The quick brown fox');
      expect(contentAccumulator.getChunkCount()).toBe(4);
      expect(contentAccumulator.hasContent()).toBe(true);
    });

    it('should handle mixed thinking and content events', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Analyzing... ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Done.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Here is ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'my answer.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Should yield 5 events (Subfase 6B adds thinking_complete)
      expect(results).toHaveLength(5);
      expect(results[0]?.type).toBe('thinking_chunk');
      expect(results[1]?.type).toBe('thinking_chunk');
      expect(results[2]?.type).toBe('thinking_complete'); // NEW: Subfase 6B
      expect(results[3]?.type).toBe('message_chunk');
      expect(results[4]?.type).toBe('message_chunk');

      // Verify thinking_complete has full accumulated content
      expect(results[2]?.content).toBe('Analyzing... Done.');
      expect(results[2]?.blockIndex).toBe(0);

      // Both accumulators should have content
      expect(thinkingAccumulator.getContent()).toBe('Analyzing... Done.');
      expect(thinkingAccumulator.getChunkCount()).toBe(2);

      expect(contentAccumulator.getContent()).toBe('Here is my answer.');
      expect(contentAccumulator.getChunkCount()).toBe(2);

      // Verify thinking is marked complete
      expect(thinkingAccumulator.isComplete()).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Thinking Complete Transition (7 tests) - Subfase 6B
  // ==========================================================================

  describe('thinking_complete transition', () => {
    it('should emit thinking_complete when first content_delta arrives after thinking', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Let me think about this...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Here is the answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(3); // thinking_chunk, thinking_complete, message_chunk
      expect(results[0]?.type).toBe('thinking_chunk');
      expect(results[1]?.type).toBe('thinking_complete');
      expect(results[2]?.type).toBe('message_chunk');
    });

    it('should include full accumulated thinking content in thinking_complete', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'First thought. ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Second thought. ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Third thought.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const thinkingComplete = results.find(r => r.type === 'thinking_complete');
      expect(thinkingComplete).toBeDefined();
      expect(thinkingComplete?.content).toBe('First thought. Second thought. Third thought.');
    });

    it('should emit thinking_complete with blockIndex 0', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Response',
          metadata: { blockIndex: 5, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const thinkingComplete = results.find(r => r.type === 'thinking_complete');
      expect(thinkingComplete).toBeDefined();
      expect(thinkingComplete?.blockIndex).toBe(0); // Always block 0 for thinking
    });

    it('should emit message_chunk after thinking_complete', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Analyzing...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Result content',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const completeIdx = results.findIndex(r => r.type === 'thinking_complete');
      const chunkIdx = results.findIndex(r => r.type === 'message_chunk');

      expect(completeIdx).toBeGreaterThan(-1);
      expect(chunkIdx).toBeGreaterThan(completeIdx); // message_chunk comes after
      expect(results[chunkIdx]?.content).toBe('Result content');
    });

    it('should NOT emit thinking_complete if no thinking was accumulated', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Direct answer',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: ' continued',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const thinkingComplete = results.find(r => r.type === 'thinking_complete');
      expect(thinkingComplete).toBeUndefined();
      expect(results).toHaveLength(2); // Only message_chunk events
    });

    it('should NOT emit thinking_complete twice', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Think',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'First',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Second',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Third',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const thinkingCompleteCount = results.filter(
        r => r.type === 'thinking_complete'
      ).length;
      expect(thinkingCompleteCount).toBe(1); // Only once
    });

    it('should mark thinking accumulator as complete after transition', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking process',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // After processing, thinking should be marked complete
      expect(thinkingAccumulator.isComplete()).toBe(true);
      expect(thinkingAccumulator.hasContent()).toBe(true);
    });
  });

  // ==========================================================================
  // 7. Final Response Detection (5 tests) - Subfase 6B
  // ==========================================================================

  describe('final response detection', () => {
    it('should emit final_response when stream_end arrives with accumulated content', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Hello',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: ' world',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect(finalResponse?.type).toBe('final_response');
      expect((finalResponse as any).content).toBe('Hello world');
    });

    it('should include full accumulated content in final_response', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'The ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'quick ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'brown ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'fox',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results[results.length - 1]; // Should be last event
      expect(finalResponse?.type).toBe('final_response');
      expect((finalResponse as any).content).toBe('The quick brown fox');
    });

    it('should include stopReason "end_turn" in final_response', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('end_turn');
    });

    it('should NOT emit final_response if no content was accumulated', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(0); // No events emitted
    });

    it('should emit final_response after mixed thinking and content stream', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Analyzing the question... ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Found the solution.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'The answer is ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: '42.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Last event should be final_response
      const lastEvent = results[results.length - 1];
      expect(lastEvent?.type).toBe('final_response');
      expect((lastEvent as any).content).toBe('The answer is 42.');

      // Should have: 2 thinking_chunk, 1 thinking_complete, 2 message_chunk, 1 final_response = 6 total
      expect(results).toHaveLength(6);
    });
  });

  // ==========================================================================
  // 8. Array Event Handling (3 tests) - Subfase 6B
  // ==========================================================================

  describe('array event handling', () => {
    it('should yield multiple events when processEvent returns array', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Second event triggers array return [thinking_complete, message_chunk]
      expect(results).toHaveLength(3);
      expect(results[0]?.type).toBe('thinking_chunk'); // From first event
      expect(results[1]?.type).toBe('thinking_complete'); // From array
      expect(results[2]?.type).toBe('message_chunk'); // From array
    });

    it('should maintain event order (thinking_complete before message_chunk)', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Process',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Result',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const completeIdx = results.findIndex(r => r.type === 'thinking_complete');
      const chunkIdx = results.findIndex(r => r.type === 'message_chunk');

      expect(completeIdx).toBeLessThan(chunkIdx);
      expect(completeIdx).toBe(1); // After thinking_chunk
      expect(chunkIdx).toBe(2); // After thinking_complete
    });

    it('should handle alternating single and array returns', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Think1',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }), // Returns single event
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content1',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }), // Returns array [thinking_complete, message_chunk]
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content2',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }), // Returns single event
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }), // Returns single event
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // thinking_chunk, thinking_complete, message_chunk, message_chunk, final_response = 5
      expect(results).toHaveLength(5);
      expect(results[0]?.type).toBe('thinking_chunk');
      expect(results[1]?.type).toBe('thinking_complete');
      expect(results[2]?.type).toBe('message_chunk');
      expect(results[3]?.type).toBe('message_chunk');
      expect(results[4]?.type).toBe('final_response');
    });
  });

  // ==========================================================================
  // 9. Tool Call Processing (6 tests) - Subfase 6C
  // ==========================================================================

  describe('tool_call processing', () => {
    it('should convert tool_call to tool_execution event', async () => {
      const events = [createToolCallEvent('toolu_123', 'get_weather', { city: 'Seattle' })];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.type).toBe('tool_execution');
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolUseId).toBe('toolu_123');
      expect(toolExec.execution.toolName).toBe('get_weather');
      expect(toolExec.execution.input).toEqual({ city: 'Seattle' });
    });

    it('should extract toolUseId from toolCall.id', async () => {
      const events = [createToolCallEvent('toolu_456', 'list_customers')];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolUseId).toBe('toolu_456');
    });

    it('should extract toolName from toolCall.name', async () => {
      const events = [createToolCallEvent('toolu_789', 'create_sales_order')];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolName).toBe('create_sales_order');
    });

    it('should extract input from toolCall.input', async () => {
      const complexInput = {
        customerId: 'CUST-001',
        items: [
          { productId: 'PROD-A', quantity: 5 },
          { productId: 'PROD-B', quantity: 10 },
        ],
        priority: 'high',
      };
      const events = [createToolCallEvent('toolu_complex', 'create_order', complexInput)];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.input).toEqual(complexInput);
    });

    it('should return null if toolCall is missing from event', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'tool_call',
          // toolCall is undefined
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(0); // No events emitted
    });

    it('should handle tool_call with complex input object', async () => {
      const nestedInput = {
        filters: {
          status: 'active',
          dateRange: { start: '2024-01-01', end: '2024-12-31' },
        },
        sort: { field: 'name', order: 'asc' },
        pagination: { page: 1, limit: 50 },
      };
      const events = [createToolCallEvent('toolu_nested', 'query_database', nestedInput)];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.input).toEqual(nestedInput);
      expect(toolExec.execution.toolName).toBe('query_database');
    });
  });

  // ==========================================================================
  // 10. Tool Event Deduplication (5 tests) - Subfase 6C
  // ==========================================================================

  describe('tool event deduplication', () => {
    let deduplicator: ToolEventDeduplicator;
    let processorWithDedup: GraphStreamProcessor;

    beforeEach(() => {
      deduplicator = new ToolEventDeduplicator();
      processorWithDedup = new GraphStreamProcessor(
        new ThinkingAccumulator(),
        new ContentAccumulator(),
        deduplicator
      );
    });

    it('should skip duplicate tool_call with same id', async () => {
      const events = [
        createToolCallEvent('toolu_123', 'get_weather'),
        createToolCallEvent('toolu_123', 'get_weather'), // Duplicate
      ];

      const results = await collectEvents(
        processorWithDedup.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1); // Only first one emitted
      expect(results[0]?.type).toBe('tool_execution');
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolUseId).toBe('toolu_123');
    });

    it('should emit tool_execution for first occurrence', async () => {
      const events = [
        createToolCallEvent('toolu_first', 'list_items'),
        createToolCallEvent('toolu_first', 'list_items'), // Duplicate
        createToolCallEvent('toolu_first', 'list_items'), // Duplicate
      ];

      const results = await collectEvents(
        processorWithDedup.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1); // Only first occurrence
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolUseId).toBe('toolu_first');
    });

    it('should emit tool_execution for different tool ids', async () => {
      const events = [
        createToolCallEvent('toolu_001', 'tool_a'),
        createToolCallEvent('toolu_002', 'tool_b'),
        createToolCallEvent('toolu_003', 'tool_c'),
      ];

      const results = await collectEvents(
        processorWithDedup.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(3); // All different IDs
      expect(results[0]?.type).toBe('tool_execution');
      expect(results[1]?.type).toBe('tool_execution');
      expect(results[2]?.type).toBe('tool_execution');

      const ids = results.map(
        r => (r as { type: 'tool_execution'; execution: any }).execution.toolUseId
      );
      expect(ids).toEqual(['toolu_001', 'toolu_002', 'toolu_003']);
    });

    it('should work without deduplicator (no deduplication)', async () => {
      // Use processor without deduplicator (from main beforeEach)
      const events = [
        createToolCallEvent('toolu_123', 'get_weather'),
        createToolCallEvent('toolu_123', 'get_weather'), // Same id, no dedup
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(2); // Both emitted (no deduplication)
      expect(results[0]?.type).toBe('tool_execution');
      expect(results[1]?.type).toBe('tool_execution');
    });

    it('should reset deduplicator at start of process()', async () => {
      // First stream with a tool call
      const stream1 = [createToolCallEvent('toolu_xyz', 'first_call')];
      await collectEvents(
        processorWithDedup.process(createAsyncIterable(stream1), mockContext)
      );

      // Second stream with the SAME tool id (should NOT be deduplicated because reset)
      const stream2 = [createToolCallEvent('toolu_xyz', 'first_call')];
      const results = await collectEvents(
        processorWithDedup.process(createAsyncIterable(stream2), mockContext)
      );

      expect(results).toHaveLength(1); // Should emit (deduplicator was reset)
      const toolExec = results[0] as { type: 'tool_execution'; execution: any };
      expect(toolExec.execution.toolUseId).toBe('toolu_xyz');
    });
  });

  // ==========================================================================
  // 11. Mixed Tool and Content Events (4 tests) - Subfase 6C
  // ==========================================================================

  describe('mixed tool and content events', () => {
    it('should handle tool_call between content_delta events', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Let me check that. ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createToolCallEvent('toolu_mid', 'check_status'),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Found it!',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.type).toBe('message_chunk');
      expect(results[0]?.content).toBe('Let me check that. ');
      expect(results[1]?.type).toBe('tool_execution');
      expect(results[2]?.type).toBe('message_chunk');
      expect(results[2]?.content).toBe('Found it!');
    });

    it('should handle multiple tool_calls in sequence', async () => {
      const events = [
        createToolCallEvent('toolu_1', 'list_customers'),
        createToolCallEvent('toolu_2', 'get_customer_details'),
        createToolCallEvent('toolu_3', 'calculate_total'),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'All done!',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(4);
      expect(results[0]?.type).toBe('tool_execution');
      expect(results[1]?.type).toBe('tool_execution');
      expect(results[2]?.type).toBe('tool_execution');
      expect(results[3]?.type).toBe('message_chunk');
    });

    it('should handle thinking → tool → content flow', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'I need to fetch data first. ',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Then process it.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createToolCallEvent('toolu_abc', 'fetch_data'),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Here is the result.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // thinking_chunk (2), tool_execution, thinking_complete, message_chunk = 5
      expect(results).toHaveLength(5);
      expect(results[0]?.type).toBe('thinking_chunk');
      expect(results[1]?.type).toBe('thinking_chunk');
      expect(results[2]?.type).toBe('tool_execution');
      expect(results[3]?.type).toBe('thinking_complete'); // Emitted before first content
      expect(results[4]?.type).toBe('message_chunk');
    });

    it('should maintain correct event order with tools', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Starting... ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createToolCallEvent('toolu_step1', 'step_one'),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Step 1 complete. ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createToolCallEvent('toolu_step2', 'step_two'),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'All steps done.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // content, tool, content, tool, content, final_response = 6
      expect(results).toHaveLength(6);
      expect(results[0]?.type).toBe('message_chunk');
      expect(results[0]?.content).toBe('Starting... ');
      expect(results[1]?.type).toBe('tool_execution');
      expect(results[2]?.type).toBe('message_chunk');
      expect(results[2]?.content).toBe('Step 1 complete. ');
      expect(results[3]?.type).toBe('tool_execution');
      expect(results[4]?.type).toBe('message_chunk');
      expect(results[4]?.content).toBe('All steps done.');
      expect(results[5]?.type).toBe('final_response');
    });
  });

  // ==========================================================================
  // 12. Usage Event Processing (5 tests) - Subfase 6D
  // ==========================================================================

  describe('usage event processing', () => {
    it('should convert usage event to usage ProcessedStreamEvent', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 50 },
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.type).toBe('usage');
      expect((results[0] as any).inputTokens).toBe(100);
      expect((results[0] as any).outputTokens).toBe(50);
    });

    it('should extract inputTokens from usage', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'usage',
          usage: { inputTokens: 250, outputTokens: 150 },
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect((results[0] as any).inputTokens).toBe(250);
    });

    it('should extract outputTokens from usage', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'usage',
          usage: { inputTokens: 500, outputTokens: 300 },
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(1);
      expect((results[0] as any).outputTokens).toBe(300);
    });

    it('should return null if usage data is missing', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'usage',
          // usage is undefined
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results).toHaveLength(0); // No events emitted
    });

    it('should handle usage event at end of stream', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Response',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
        createMockNormalizedEvent({
          type: 'usage',
          usage: { inputTokens: 120, outputTokens: 80 },
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // message_chunk, final_response, usage = 3
      expect(results).toHaveLength(3);
      expect(results[0]?.type).toBe('message_chunk');
      expect(results[1]?.type).toBe('final_response');
      expect(results[2]?.type).toBe('usage');
      expect((results[2] as any).inputTokens).toBe(120);
      expect((results[2] as any).outputTokens).toBe(80);
    });
  });

  // ==========================================================================
  // 13. Stop Reason Handling (5 tests) - Subfase 6D
  // ==========================================================================

  describe('stop reason handling', () => {
    it('should use "end_turn" as default stop reason', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Content',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('end_turn');
    });

    it('should extract stop_reason from event.raw', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Hello',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          raw: { stop_reason: 'max_tokens' },
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('max_tokens');
    });

    it('should handle "tool_use" stop reason', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Using tool',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          raw: { stop_reason: 'tool_use' },
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('tool_use');
    });

    it('should handle "max_tokens" stop reason', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Running out of tokens...',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          raw: { stop_reason: 'max_tokens' },
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('max_tokens');
    });

    it('should handle "refusal" stop reason', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'I cannot do that',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          raw: { stop_reason: 'refusal' },
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).stopReason).toBe('refusal');
    });
  });

  // ==========================================================================
  // 14. Final Response Edge Cases (5 tests) - Subfase 6D
  // ==========================================================================

  describe('final response edge cases', () => {
    it('should emit thinking_complete at stream_end if thinking not completed', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking only',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Should have: thinking_chunk, thinking_complete
      expect(results.some(r => r.type === 'thinking_complete')).toBe(true);
      expect(results.some(r => r.type === 'thinking_chunk')).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should emit both thinking_complete and final_response at stream_end', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Analyzing...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Should have: thinking_chunk, thinking_complete, message_chunk, final_response = 4
      expect(results).toHaveLength(4);
      expect(results.some(r => r.type === 'thinking_complete')).toBe(true);
      expect(results.some(r => r.type === 'final_response')).toBe(true);
    });

    it('should NOT emit final_response if no content accumulated', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      expect(results.some(r => r.type === 'final_response')).toBe(false);
      expect(results).toHaveLength(0);
    });

    it('should handle stream_end with only thinking (no content)', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'reasoning_delta',
          reasoning: 'Just thinking, no answer',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      // Should have: thinking_chunk, thinking_complete (no final_response since no content)
      expect(results).toHaveLength(2);
      expect(results[0]?.type).toBe('thinking_chunk');
      expect(results[1]?.type).toBe('thinking_complete');
      expect(results.some(r => r.type === 'final_response')).toBe(false);
    });

    it('should include stop reason in final_response', async () => {
      const events = [
        createMockNormalizedEvent({
          type: 'content_delta',
          content: 'Final content',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createMockNormalizedEvent({
          type: 'stream_end',
          raw: { stop_reason: 'tool_use' },
          metadata: { blockIndex: 1, isStreaming: false, isFinal: true },
        }),
      ];

      const results = await collectEvents(
        processor.process(createAsyncIterable(events), mockContext)
      );

      const finalResponse = results.find(r => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).content).toBe('Final content');
      expect((finalResponse as any).stopReason).toBe('tool_use');
    });
  });
});
