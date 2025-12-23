/**
 * @module __tests__/integration/domains/agent/streaming/GraphStreamProcessor.integration.test
 *
 * Integration tests for GraphStreamProcessor with REAL dependencies.
 * Tests complete flow scenarios with actual ThinkingAccumulator, ContentAccumulator, and ToolEventDeduplicator.
 *
 * Coverage:
 * - Complete stream with thinking + content (2 tests)
 * - Complete stream with tools (2 tests)
 * - Multi-turn conversation simulation (2 tests)
 * - Usage and stop reasons (2 tests)
 * - Edge cases (2 tests)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStreamProcessor } from '@domains/agent/streaming/GraphStreamProcessor';
import { ThinkingAccumulator } from '@domains/agent/streaming/ThinkingAccumulator';
import { ContentAccumulator } from '@domains/agent/streaming/ContentAccumulator';
import { ToolEventDeduplicator } from '@domains/agent/tools/ToolEventDeduplicator';
import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type { ProcessedStreamEvent } from '@domains/agent/streaming/types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a normalized stream event with defaults.
 */
function createEvent(
  overrides: Partial<INormalizedStreamEvent>
): INormalizedStreamEvent {
  return {
    type: 'content_delta',
    provider: 'anthropic',
    timestamp: new Date(),
    metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
    ...overrides,
  };
}

/**
 * Convert array to async iterable for testing.
 */
async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Collect all items from an async generator.
 */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('GraphStreamProcessor Integration', () => {
  let thinkingAccumulator: ThinkingAccumulator;
  let contentAccumulator: ContentAccumulator;
  let toolDeduplicator: ToolEventDeduplicator;
  let processor: GraphStreamProcessor;

  const context = { sessionId: 'test-session', userId: 'test-user' };

  beforeEach(() => {
    // Use REAL dependencies - NO MOCKS
    thinkingAccumulator = new ThinkingAccumulator();
    contentAccumulator = new ContentAccumulator();
    toolDeduplicator = new ToolEventDeduplicator();
    processor = new GraphStreamProcessor(
      thinkingAccumulator,
      contentAccumulator,
      toolDeduplicator
    );
  });

  // ==========================================================================
  // Category 1: Complete Stream with Thinking + Content (2 tests)
  // ==========================================================================

  describe('complete stream with thinking + content', () => {
    it('should process full stream with correct event sequence', async () => {
      // Arrange: Create realistic stream with thinking -> content -> end
      const events = [
        createEvent({
          type: 'reasoning_delta',
          reasoning: 'Let me think...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'reasoning_delta',
          reasoning: ' about this problem.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'Here is ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'the answer.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act: Process the stream
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Verify event sequence
      expect(results.length).toBeGreaterThanOrEqual(5);

      // Thinking chunks
      expect(results[0].type).toBe('thinking_chunk');
      expect((results[0] as any).content).toBe('Let me think...');
      expect(results[1].type).toBe('thinking_chunk');
      expect((results[1] as any).content).toBe(' about this problem.');

      // Thinking complete (emitted before first message_chunk)
      expect(results[2].type).toBe('thinking_complete');
      expect((results[2] as any).content).toBe(
        'Let me think... about this problem.'
      );

      // Message chunks
      expect(results[3].type).toBe('message_chunk');
      expect((results[3] as any).content).toBe('Here is ');
      expect(results[4].type).toBe('message_chunk');
      expect((results[4] as any).content).toBe('the answer.');

      // Final response
      const finalResponse = results.find((r) => r.type === 'final_response');
      expect(finalResponse).toBeDefined();
      expect((finalResponse as any).content).toBe('Here is the answer.');
      expect((finalResponse as any).stopReason).toBe('end_turn');
    });

    it('should accumulate content correctly across chunks', async () => {
      // Arrange: Simple content stream
      const events = [
        createEvent({
          type: 'content_delta',
          content: 'Hello',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: ' ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'World',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Verify chunks emitted correctly
      const messageChunks = results.filter((r) => r.type === 'message_chunk');
      expect(messageChunks).toHaveLength(3);
      expect((messageChunks[0] as any).content).toBe('Hello');
      expect((messageChunks[1] as any).content).toBe(' ');
      expect((messageChunks[2] as any).content).toBe('World');

      // Assert: Verify final response has complete content
      const finalResponse = results.find(
        (r) => r.type === 'final_response'
      ) as any;
      expect(finalResponse).toBeDefined();
      expect(finalResponse.content).toBe('Hello World');
    });
  });

  // ==========================================================================
  // Category 2: Complete Stream with Tools (2 tests)
  // ==========================================================================

  describe('complete stream with tools', () => {
    it('should emit tool_execution for tool_call events', async () => {
      // Arrange: Stream with tool call
      const events = [
        createEvent({
          type: 'tool_call',
          toolCall: {
            id: 'toolu_123',
            name: 'get_weather',
            input: { city: 'Seattle' },
          },
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'The weather is sunny.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Tool execution event emitted
      const toolExec = results.find((r) => r.type === 'tool_execution') as any;
      expect(toolExec).toBeDefined();
      expect(toolExec.execution.toolName).toBe('get_weather');
      expect(toolExec.execution.toolUseId).toBe('toolu_123');
      expect(toolExec.execution.input).toEqual({ city: 'Seattle' });

      // Assert: Content also processed
      const messageChunk = results.find((r) => r.type === 'message_chunk');
      expect(messageChunk).toBeDefined();
      expect((messageChunk as any).content).toBe('The weather is sunny.');
    });

    it('should deduplicate tool events with same id', async () => {
      // Arrange: Stream with duplicate tool calls (LangGraph can emit duplicates)
      const events = [
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_123', name: 'test_tool', input: {} },
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_123', name: 'test_tool', input: {} }, // DUPLICATE
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_456', name: 'another_tool', input: {} }, // DIFFERENT
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Only 2 tool executions (duplicate filtered out)
      const toolExecs = results.filter((r) => r.type === 'tool_execution');
      expect(toolExecs).toHaveLength(2);

      // Assert: Correct tools emitted
      const toolIds = toolExecs.map((t: any) => t.execution.toolUseId);
      expect(toolIds).toContain('toolu_123');
      expect(toolIds).toContain('toolu_456');

      // Assert: Deduplicator stats
      const stats = toolDeduplicator.getStats();
      expect(stats.totalTracked).toBe(2);
      expect(stats.duplicatesPrevented).toBe(1);
    });
  });

  // ==========================================================================
  // Category 3: Multi-turn Conversation Simulation (2 tests)
  // ==========================================================================

  describe('multi-turn conversation simulation', () => {
    it('should reset accumulators between streams', async () => {
      // Arrange: First stream
      const stream1 = [
        createEvent({
          type: 'reasoning_delta',
          reasoning: 'First thought',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'First response',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act: Process first stream
      const results1 = await collect(
        processor.process(toAsyncIterable(stream1), context)
      );

      // Assert: First stream processed correctly
      const thinking1 = results1.find((r) => r.type === 'thinking_complete');
      const final1 = results1.find((r) => r.type === 'final_response');
      expect((thinking1 as any).content).toBe('First thought');
      expect((final1 as any).content).toBe('First response');

      // Arrange: Second stream (new turn)
      const stream2 = [
        createEvent({
          type: 'reasoning_delta',
          reasoning: 'Second thought',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'Second response',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act: Process second stream
      const results2 = await collect(
        processor.process(toAsyncIterable(stream2), context)
      );

      // Assert: Second stream has fresh data (not accumulated from first)
      const thinking2 = results2.find((r) => r.type === 'thinking_complete');
      const final2 = results2.find((r) => r.type === 'final_response');
      expect((thinking2 as any).content).toBe('Second thought'); // NOT "First thoughtSecond thought"
      expect((final2 as any).content).toBe('Second response'); // NOT "First responseSecond response"
    });

    it('should reset tool deduplicator between streams', async () => {
      // Arrange: First stream with tool
      const stream1 = [
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_123', name: 'tool_a', input: {} },
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act: Process first stream
      const results1 = await collect(
        processor.process(toAsyncIterable(stream1), context)
      );
      expect(results1.filter((r) => r.type === 'tool_execution')).toHaveLength(
        1
      );

      // Arrange: Second stream with SAME tool id (should not be deduplicated across streams)
      const stream2 = [
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_123', name: 'tool_a', input: {} }, // Same ID as stream1
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act: Process second stream
      const results2 = await collect(
        processor.process(toAsyncIterable(stream2), context)
      );

      // Assert: Tool should be emitted again (deduplicator was reset)
      expect(results2.filter((r) => r.type === 'tool_execution')).toHaveLength(
        1
      );

      // Assert: Deduplicator stats only reflect second stream
      const stats = toolDeduplicator.getStats();
      expect(stats.totalTracked).toBe(1); // Only second stream
      expect(stats.duplicatesPrevented).toBe(0); // No duplicates in second stream
    });
  });

  // ==========================================================================
  // Category 4: Usage and Stop Reasons (2 tests)
  // ==========================================================================

  describe('usage and stop reasons', () => {
    it('should emit usage events with token counts', async () => {
      // Arrange: Stream with usage event
      const events = [
        createEvent({
          type: 'content_delta',
          content: 'Response',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'usage',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            reasoningTokens: 25,
          },
          metadata: { blockIndex: 0, isStreaming: false, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Usage event emitted
      const usageEvent = results.find((r) => r.type === 'usage') as any;
      expect(usageEvent).toBeDefined();
      expect(usageEvent.inputTokens).toBe(100);
      expect(usageEvent.outputTokens).toBe(50);
    });

    it('should extract stop reason from raw event data', async () => {
      // Arrange: Stream with explicit stop_reason in raw data
      const events = [
        createEvent({
          type: 'content_delta',
          content: 'Answer',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          raw: { stop_reason: 'max_tokens' }, // Explicit stop reason
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Final response has correct stop reason
      const finalResponse = results.find(
        (r) => r.type === 'final_response'
      ) as any;
      expect(finalResponse).toBeDefined();
      expect(finalResponse.stopReason).toBe('max_tokens');
    });
  });

  // ==========================================================================
  // Category 5: Edge Cases (2 tests)
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle stream with only thinking (no content)', async () => {
      // Arrange: Stream with thinking but no content
      const events = [
        createEvent({
          type: 'reasoning_delta',
          reasoning: 'Thinking deeply...',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'reasoning_delta',
          reasoning: ' about the universe.',
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: Thinking chunks emitted
      const thinkingChunks = results.filter(
        (r) => r.type === 'thinking_chunk'
      );
      expect(thinkingChunks).toHaveLength(2);

      // Assert: Thinking complete emitted at stream_end
      const thinkingComplete = results.find(
        (r) => r.type === 'thinking_complete'
      ) as any;
      expect(thinkingComplete).toBeDefined();
      expect(thinkingComplete.content).toBe(
        'Thinking deeply... about the universe.'
      );

      // Assert: No final_response (because no content was generated)
      const finalResponse = results.find((r) => r.type === 'final_response');
      expect(finalResponse).toBeUndefined();
    });

    it('should handle stream with tool and content mixed', async () => {
      // Arrange: Complex stream with tool in middle of content
      const events = [
        createEvent({
          type: 'content_delta',
          content: 'Let me check ',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'tool_call',
          toolCall: { id: 'toolu_789', name: 'search', input: { query: 'AI' } },
          metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'content_delta',
          content: 'that for you.',
          metadata: { blockIndex: 1, isStreaming: true, isFinal: false },
        }),
        createEvent({
          type: 'stream_end',
          metadata: { blockIndex: 0, isStreaming: false, isFinal: true },
        }),
      ];

      // Act
      const results = await collect(
        processor.process(toAsyncIterable(events), context)
      );

      // Assert: All events processed in order
      expect(results[0].type).toBe('message_chunk');
      expect((results[0] as any).content).toBe('Let me check ');

      expect(results[1].type).toBe('tool_execution');
      expect((results[1] as any).execution.toolName).toBe('search');

      expect(results[2].type).toBe('message_chunk');
      expect((results[2] as any).content).toBe('that for you.');

      // Assert: Final response has complete content
      const finalResponse = results.find(
        (r) => r.type === 'final_response'
      ) as any;
      expect(finalResponse).toBeDefined();
      expect(finalResponse.content).toBe('Let me check that for you.');
    });
  });
});
