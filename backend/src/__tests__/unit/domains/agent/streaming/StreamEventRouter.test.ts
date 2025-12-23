/**
 * Unit tests for StreamEventRouter
 *
 * Tests the routing logic that separates:
 * - Normalized events (from StreamAdapter) → GraphStreamProcessor
 * - Tool executions (from on_chain_end) → ToolExecutionProcessor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StreamEventRouter,
  createStreamEventRouter,
} from '@domains/agent/streaming/StreamEventRouter';
import type { IStreamAdapter } from '@shared/providers/interfaces/IStreamAdapter';
import type { INormalizedStreamEvent } from '@shared/providers/interfaces/INormalizedEvent';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { RoutedEvent } from '@domains/agent/streaming/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock StreamEvent with default values.
 */
function createMockStreamEvent(overrides: Partial<StreamEvent>): StreamEvent {
  return {
    event: 'on_chat_model_stream',
    name: 'test-node',
    data: {},
    run_id: 'test-run-id',
    tags: [],
    metadata: {},
    ...overrides,
  } as StreamEvent;
}

/**
 * Creates a mock on_chain_end event with toolExecutions.
 */
function createChainEndWithTools(
  agentName: string,
  toolExecutions: Array<{
    toolUseId: string;
    toolName: string;
    args?: Record<string, unknown>;
    result?: string;
    success?: boolean;
    error?: string;
  }>
): StreamEvent {
  return createMockStreamEvent({
    event: 'on_chain_end',
    name: agentName,
    data: {
      output: {
        toolExecutions,
      },
    },
  });
}

/**
 * Creates a mock IStreamAdapter.
 */
function createMockAdapter(
  processChunkFn?: (event: StreamEvent) => INormalizedStreamEvent | null
): IStreamAdapter {
  return {
    provider: 'anthropic',
    processChunk: processChunkFn ?? vi.fn().mockReturnValue(null),
    reset: vi.fn(),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
  };
}

/**
 * Creates a mock normalized event.
 */
function createMockNormalizedEvent(
  overrides: Partial<INormalizedStreamEvent> = {}
): INormalizedStreamEvent {
  return {
    type: 'content_delta',
    provider: 'anthropic',
    timestamp: new Date(),
    content: 'test content',
    metadata: { blockIndex: 0, isStreaming: true, isFinal: false },
    ...overrides,
  };
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
 * Collects all events from an async generator into an array.
 */
async function collectEvents<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const event of generator) {
    results.push(event);
  }
  return results;
}

// ============================================================================
// Tests
// ============================================================================

describe('StreamEventRouter', () => {
  let router: StreamEventRouter;

  beforeEach(() => {
    router = createStreamEventRouter();
  });

  // ==========================================================================
  // Factory Function Tests (2 tests)
  // ==========================================================================

  describe('createStreamEventRouter', () => {
    it('should create a new instance', () => {
      const instance = createStreamEventRouter();
      expect(instance).toBeInstanceOf(StreamEventRouter);
    });

    it('should create independent instances', () => {
      const instance1 = createStreamEventRouter();
      const instance2 = createStreamEventRouter();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ==========================================================================
  // Normalized Event Routing Tests (3 tests)
  // ==========================================================================

  describe('normalized event routing', () => {
    it('should route events normalized by adapter', async () => {
      const normalizedEvent = createMockNormalizedEvent({ content: 'Hello' });
      const adapter = createMockAdapter(() => normalizedEvent);
      const streamEvent = createMockStreamEvent({ event: 'on_chat_model_stream' });
      const eventStream = createAsyncIterable([streamEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ type: 'normalized', event: normalizedEvent });
    });

    it('should route multiple normalized events', async () => {
      const event1 = createMockNormalizedEvent({ content: 'chunk1' });
      const event2 = createMockNormalizedEvent({ content: 'chunk2' });
      let callCount = 0;
      const adapter = createMockAdapter(() => {
        callCount++;
        return callCount === 1 ? event1 : event2;
      });

      const eventStream = createAsyncIterable([
        createMockStreamEvent({}),
        createMockStreamEvent({}),
      ]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ type: 'normalized', event: event1 });
      expect(results[1]).toEqual({ type: 'normalized', event: event2 });
    });

    it('should skip events not normalized by adapter', async () => {
      const adapter = createMockAdapter(() => null);
      const streamEvent = createMockStreamEvent({ event: 'on_parser_start' });
      const eventStream = createAsyncIterable([streamEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Tool Execution Routing Tests (5 tests)
  // ==========================================================================

  describe('tool execution routing', () => {
    it('should route on_chain_end with toolExecutions', async () => {
      const adapter = createMockAdapter(() => null);
      const chainEndEvent = createChainEndWithTools('business-central', [
        {
          toolUseId: 'tool-1',
          toolName: 'getCustomers',
          args: { limit: 10 },
          result: '[]',
          success: true,
        },
      ]);
      const eventStream = createAsyncIterable([chainEndEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool_executions');
      if (results[0].type === 'tool_executions') {
        expect(results[0].agentName).toBe('business-central');
        expect(results[0].executions).toHaveLength(1);
        expect(results[0].executions[0].toolUseId).toBe('tool-1');
        expect(results[0].executions[0].toolName).toBe('getCustomers');
      }
    });

    it('should route multiple tool executions', async () => {
      const adapter = createMockAdapter(() => null);
      const chainEndEvent = createChainEndWithTools('rag-knowledge', [
        { toolUseId: 'tool-1', toolName: 'search', result: 'results1' },
        { toolUseId: 'tool-2', toolName: 'retrieve', result: 'results2' },
      ]);
      const eventStream = createAsyncIterable([chainEndEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(1);
      if (results[0].type === 'tool_executions') {
        expect(results[0].executions).toHaveLength(2);
        expect(results[0].executions[0].toolName).toBe('search');
        expect(results[0].executions[1].toolName).toBe('retrieve');
      }
    });

    it('should map tool execution fields correctly', async () => {
      const adapter = createMockAdapter(() => null);
      const chainEndEvent = createChainEndWithTools('business-central', [
        {
          toolUseId: 'tu-123',
          toolName: 'createInvoice',
          args: { customerId: 'C001' },
          result: '{"id": "INV001"}',
          success: true,
        },
      ]);
      const eventStream = createAsyncIterable([chainEndEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      if (results[0].type === 'tool_executions') {
        const exec = results[0].executions[0];
        expect(exec.toolUseId).toBe('tu-123');
        expect(exec.toolName).toBe('createInvoice');
        expect(exec.args).toEqual({ customerId: 'C001' });
        expect(exec.result).toBe('{"id": "INV001"}');
        expect(exec.success).toBe(true);
        expect(exec.error).toBeUndefined();
      }
    });

    it('should include error field when present', async () => {
      const adapter = createMockAdapter(() => null);
      const chainEndEvent = createChainEndWithTools('business-central', [
        {
          toolUseId: 'tu-fail',
          toolName: 'deleteCustomer',
          args: {},
          result: '',
          success: false,
          error: 'Permission denied',
        },
      ]);
      const eventStream = createAsyncIterable([chainEndEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      if (results[0].type === 'tool_executions') {
        expect(results[0].executions[0].success).toBe(false);
        expect(results[0].executions[0].error).toBe('Permission denied');
      }
    });

    it('should default success to true when not specified', async () => {
      const adapter = createMockAdapter(() => null);
      const chainEndEvent = createChainEndWithTools('test-agent', [
        {
          toolUseId: 'tu-default',
          toolName: 'testTool',
          args: {},
          result: 'ok',
          // success field omitted
        },
      ]);
      const eventStream = createAsyncIterable([chainEndEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      if (results[0].type === 'tool_executions') {
        expect(results[0].executions[0].success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Filtering Tests (4 tests)
  // ==========================================================================

  describe('event filtering', () => {
    it('should NOT route on_chain_end from LangGraph', async () => {
      const adapter = createMockAdapter(() => null);
      const langGraphEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'LangGraph',
        data: {
          output: { toolExecutions: [{ toolUseId: 't1', toolName: 'test' }] },
        },
      });
      const eventStream = createAsyncIterable([langGraphEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });

    it('should NOT route on_chain_end with name __end__', async () => {
      const adapter = createMockAdapter(() => null);
      const endEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: '__end__',
        data: {
          output: { toolExecutions: [{ toolUseId: 't1', toolName: 'test' }] },
        },
      });
      const eventStream = createAsyncIterable([endEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });

    it('should NOT route on_chain_end without toolExecutions', async () => {
      const adapter = createMockAdapter(() => null);
      const noToolsEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'business-central',
        data: { output: { someOtherField: 'value' } },
      });
      const eventStream = createAsyncIterable([noToolsEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });

    it('should NOT route on_chain_end with empty toolExecutions', async () => {
      const adapter = createMockAdapter(() => null);
      const emptyToolsEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'business-central',
        data: { output: { toolExecutions: [] } },
      });
      const eventStream = createAsyncIterable([emptyToolsEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Mixed Flow Tests (2 tests)
  // ==========================================================================

  describe('mixed event flows', () => {
    it('should route both normalized and tool events in sequence', async () => {
      const normalizedEvent = createMockNormalizedEvent({ content: 'text' });
      const adapter = createMockAdapter((event) => {
        if (event.event === 'on_chat_model_stream') {
          return normalizedEvent;
        }
        return null;
      });

      const eventStream = createAsyncIterable([
        createMockStreamEvent({ event: 'on_chat_model_stream' }),
        createChainEndWithTools('business-central', [
          { toolUseId: 't1', toolName: 'test', result: 'ok' },
        ]),
      ]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('normalized');
      expect(results[1].type).toBe('tool_executions');
    });

    it('should handle empty event stream', async () => {
      const adapter = createMockAdapter(() => null);
      const eventStream = createAsyncIterable<StreamEvent>([]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Edge Cases (3 tests)
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle missing fields in tool executions gracefully', async () => {
      const adapter = createMockAdapter(() => null);
      const incompleteEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'test-agent',
        data: {
          output: {
            toolExecutions: [
              { toolUseId: 't1' }, // Missing most fields
            ],
          },
        },
      });
      const eventStream = createAsyncIterable([incompleteEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(1);
      if (results[0].type === 'tool_executions') {
        const exec = results[0].executions[0];
        expect(exec.toolUseId).toBe('t1');
        expect(exec.toolName).toBe('');
        expect(exec.args).toEqual({});
        expect(exec.result).toBe('');
        expect(exec.success).toBe(true); // default
      }
    });

    it('should handle null data.output gracefully', async () => {
      const adapter = createMockAdapter(() => null);
      const nullOutputEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'test-agent',
        data: { output: null },
      });
      const eventStream = createAsyncIterable([nullOutputEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });

    it('should handle undefined data.output gracefully', async () => {
      const adapter = createMockAdapter(() => null);
      const undefinedOutputEvent = createMockStreamEvent({
        event: 'on_chain_end',
        name: 'test-agent',
        data: {},
      });
      const eventStream = createAsyncIterable([undefinedOutputEvent]);

      const results = await collectEvents(router.route(eventStream, adapter));

      expect(results).toHaveLength(0);
    });
  });
});
