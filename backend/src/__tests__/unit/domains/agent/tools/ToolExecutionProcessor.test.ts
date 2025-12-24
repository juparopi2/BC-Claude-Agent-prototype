/**
 * @module ToolExecutionProcessor.test
 *
 * Unit tests for ToolExecutionProcessor.
 * Tests processing of tool executions from LangGraph streaming events.
 *
 * NOTE: ToolExecutionProcessor is now STATELESS. Deduplication uses ctx.seenToolIds.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';

// Mock getPersistenceCoordinator to prevent Redis connection in default constructor
vi.mock('@/domains/agent/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/agent/persistence')>();
  return {
    ...actual,
    getPersistenceCoordinator: vi.fn(() => ({
      persistUserMessage: vi.fn(),
      persistAgentMessage: vi.fn(),
      persistThinking: vi.fn(),
      persistToolUse: vi.fn(),
      persistToolResult: vi.fn(),
      persistError: vi.fn(),
      persistToolEventsAsync: vi.fn(),
    })),
  };
});

import {
  ToolExecutionProcessor,
  createToolExecutionProcessor,
  type RawToolExecution,
} from '@/domains/agent/tools';
import type { IPersistenceCoordinator, ToolExecution } from '@/domains/agent/persistence/types';
import {
  createExecutionContext,
  type ExecutionContext,
} from '@/domains/agent/orchestration/ExecutionContext';

// === Mock Factories ===

function createMockPersistenceCoordinator(
  overrides: Partial<IPersistenceCoordinator> = {}
): IPersistenceCoordinator {
  return {
    persistUserMessage: vi.fn(),
    persistAgentMessage: vi.fn(),
    persistThinking: vi.fn(),
    persistToolUse: vi.fn(),
    persistToolResult: vi.fn(),
    persistError: vi.fn(),
    persistToolEventsAsync: vi.fn(),
    ...overrides,
  } as IPersistenceCoordinator;
}

function createRawToolExecution(overrides: Partial<RawToolExecution> = {}): RawToolExecution {
  return {
    toolUseId: `toolu_${Math.random().toString(36).slice(2, 10)}`,
    toolName: 'test_tool',
    args: { param1: 'value1' },
    result: 'Success',
    success: true,
    ...overrides,
  };
}

/**
 * Creates a fresh ExecutionContext for testing.
 * Deduplication state lives in ctx.seenToolIds.
 */
function createTestContext(options?: {
  sessionId?: string;
  userId?: string;
  callback?: (event: AgentEvent) => void;
}): ExecutionContext {
  return createExecutionContext(
    options?.sessionId ?? 'test-session-123',
    options?.userId ?? 'test-user-456',
    options?.callback ?? vi.fn(),
    { enableThinking: false }
  );
}

describe('ToolExecutionProcessor', () => {
  let processor: ToolExecutionProcessor;
  let mockPersistence: IPersistenceCoordinator;
  let ctx: ExecutionContext;

  beforeEach(() => {
    mockPersistence = createMockPersistenceCoordinator();
    processor = new ToolExecutionProcessor(mockPersistence);
    ctx = createTestContext();
  });

  // === Constructor & Dependency Injection ===
  describe('constructor', () => {
    it('should create with default dependencies', () => {
      const defaultProcessor = new ToolExecutionProcessor();
      expect(defaultProcessor).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should accept injected persistenceCoordinator', () => {
      const customPersistence = createMockPersistenceCoordinator();
      const processorWithCustomPersist = new ToolExecutionProcessor(customPersistence);
      expect(processorWithCustomPersist).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should create via factory function', () => {
      const factoryProcessor = createToolExecutionProcessor();
      expect(factoryProcessor).toBeInstanceOf(ToolExecutionProcessor);
    });
  });

  // === processExecutions() - Basic ===
  describe('processExecutions() - basic', () => {
    it('should return empty array for empty executions', async () => {
      const context = createTestContext();
      const result = await processor.processExecutions([], context);

      expect(result).toEqual([]);
      expect(context.callback).not.toHaveBeenCalled();
    });

    it('should return empty array for undefined executions', async () => {
      const context = createTestContext();
      const result = await processor.processExecutions(
        undefined as unknown as RawToolExecution[],
        context
      );

      expect(result).toEqual([]);
    });

    it('should return empty array for null executions', async () => {
      const context = createTestContext();
      const result = await processor.processExecutions(
        null as unknown as RawToolExecution[],
        context
      );

      expect(result).toEqual([]);
    });

    it('should process single execution successfully', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ toolName: 'get_customers' });

      const result = await processor.processExecutions([execution], context);

      expect(result).toEqual(['get_customers']);
    });

    it('should return array of tool names for processed executions', async () => {
      const context = createTestContext();
      const executions = [
        createRawToolExecution({ toolName: 'tool_a' }),
        createRawToolExecution({ toolName: 'tool_b' }),
        createRawToolExecution({ toolName: 'tool_c' }),
      ];

      const result = await processor.processExecutions(executions, context);

      expect(result).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('should process multiple executions', async () => {
      const context = createTestContext();
      const executions = [
        createRawToolExecution(),
        createRawToolExecution(),
        createRawToolExecution(),
      ];

      await processor.processExecutions(executions, context);

      // All 3 tools should be tracked in ctx.seenToolIds
      expect(context.seenToolIds.size).toBe(3);
    });
  });

  // === processExecutions() - Deduplication ===
  describe('processExecutions() - deduplication', () => {
    it('should skip duplicate tool_use_ids', async () => {
      // Pre-populate seenToolIds to simulate duplicate
      const context = createTestContext();
      context.seenToolIds.set('toolu_duplicate', new Date().toISOString());

      const execution = createRawToolExecution({ toolUseId: 'toolu_duplicate' });

      const result = await processor.processExecutions([execution], context);

      expect(result).toEqual([]);
      expect(context.callback).not.toHaveBeenCalled();
    });

    it('should process unique tool_use_ids', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_unique' });

      const result = await processor.processExecutions([execution], context);

      expect(result.length).toBe(1);
      expect(context.callback).toHaveBeenCalled();
    });

    it('should track tools in seenToolIds', async () => {
      const context = createTestContext();
      const executions = [
        createRawToolExecution({ toolUseId: 'toolu_first' }),
        createRawToolExecution({ toolUseId: 'toolu_second' }),
      ];

      await processor.processExecutions(executions, context);

      // Both tools should be tracked in ctx.seenToolIds
      expect(context.seenToolIds.has('toolu_first')).toBe(true);
      expect(context.seenToolIds.has('toolu_second')).toBe(true);
      expect(context.seenToolIds.size).toBe(2);
    });

    it('should handle mixed unique and duplicate executions', async () => {
      const context = createTestContext();
      // Pre-populate one as duplicate
      context.seenToolIds.set('toolu_duplicate', new Date().toISOString());

      const executions = [
        createRawToolExecution({ toolName: 'tool_a', toolUseId: 'toolu_a' }),
        createRawToolExecution({ toolName: 'tool_b_duplicate', toolUseId: 'toolu_duplicate' }),
        createRawToolExecution({ toolName: 'tool_c', toolUseId: 'toolu_c' }),
      ];

      const result = await processor.processExecutions(executions, context);

      expect(result).toEqual(['tool_a', 'tool_c']);
    });

    it('should preserve firstSeenAt timestamp in logs for duplicates', async () => {
      const firstSeenAt = '2025-01-01T00:00:00.000Z';
      const context = createTestContext();

      // Pre-populate to simulate duplicate with known timestamp
      const toolUseId = 'toolu_dup';
      context.seenToolIds.set(toolUseId, firstSeenAt);

      const execution = createRawToolExecution({ toolUseId });

      const result = await processor.processExecutions([execution], context);

      // Should skip the duplicate
      expect(result).toEqual([]);
      // Timestamp should still be the original
      expect(context.seenToolIds.get(toolUseId)).toBe(firstSeenAt);
    });
  });

  // === processExecutions() - Event Emission ===
  describe('processExecutions() - event emission', () => {
    it('should emit tool_use event for each unique execution', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ toolName: 'my_tool' });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolUseEvents = calls.filter(
        ([event]: [AgentEvent]) => event.type === 'tool_use'
      );
      expect(toolUseEvents.length).toBe(1);
    });

    it('should emit tool_result event for each unique execution', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolResultEvents = calls.filter(
        ([event]: [AgentEvent]) => event.type === 'tool_result'
      );
      expect(toolResultEvents.length).toBe(1);
    });

    it('should emit events in order: tool_use then tool_result', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      expect(calls[0]?.[0]?.type).toBe('tool_use');
      expect(calls[1]?.[0]?.type).toBe('tool_result');
    });

    it('should include correct sessionId in events', async () => {
      const context = createTestContext({ sessionId: 'specific-session-id' });
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      expect(calls[0]?.[0]?.sessionId).toBe('specific-session-id');
      expect(calls[1]?.[0]?.sessionId).toBe('specific-session-id');
    });

    it('should include correct toolUseId in events', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_specific_id' });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      expect(calls[0]?.[0]?.toolUseId).toBe('toolu_specific_id');
      expect(calls[1]?.[0]?.toolUseId).toBe('toolu_specific_id');
    });

    it('should include correct args in tool_use event', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({
        args: { customParam: 'customValue', number: 42 },
      });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolUseEvent = calls[0]?.[0];
      expect(toolUseEvent?.args).toEqual({ customParam: 'customValue', number: 42 });
    });

    it('should include result in tool_result event', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ result: 'Custom result data' });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.result).toBe('Custom result data');
    });

    it('should include success flag in tool_result event', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({ success: true });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.success).toBe(true);
    });

    it('should include error in tool_result event when present', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({
        success: false,
        error: 'Something went wrong',
      });

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.success).toBe(false);
      expect(toolResultEvent?.error).toBe('Something went wrong');
    });

    it('should set persistenceState to pending', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      expect(calls[0]?.[0]?.persistenceState).toBe('pending');
      expect(calls[1]?.[0]?.persistenceState).toBe('pending');
    });

    it('should generate unique eventId for each event', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const eventId1 = calls[0]?.[0]?.eventId;
      const eventId2 = calls[1]?.[0]?.eventId;

      expect(eventId1).toBeDefined();
      expect(eventId2).toBeDefined();
      expect(eventId1).not.toBe(eventId2);
    });

    it('should use consistent timestamp for tool_use and tool_result pair', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const timestamp1 = calls[0]?.[0]?.timestamp;
      const timestamp2 = calls[1]?.[0]?.timestamp;

      expect(timestamp1).toBe(timestamp2);
    });
  });

  // === processExecutions() - Persistence ===
  describe('processExecutions() - persistence', () => {
    it('should call persistToolEventsAsync with correct sessionId', async () => {
      const context = createTestContext({ sessionId: 'persistence-test-session' });
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      expect(mockPersistence.persistToolEventsAsync).toHaveBeenCalledWith(
        'persistence-test-session',
        expect.any(Array)
      );
    });

    it('should pass all unique executions to persistence', async () => {
      const context = createTestContext();
      const executions = [
        createRawToolExecution({ toolName: 'tool_1' }),
        createRawToolExecution({ toolName: 'tool_2' }),
      ];

      await processor.processExecutions(executions, context);

      const persistCall = (mockPersistence.persistToolEventsAsync as Mock).mock.calls[0];
      const persistedExecutions = persistCall?.[1] as ToolExecution[];

      expect(persistedExecutions.length).toBe(2);
      expect(persistedExecutions[0]?.toolName).toBe('tool_1');
      expect(persistedExecutions[1]?.toolName).toBe('tool_2');
    });

    it('should transform args to toolInput for persistence', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution({
        args: { param: 'value' },
      });

      await processor.processExecutions([execution], context);

      const persistCall = (mockPersistence.persistToolEventsAsync as Mock).mock.calls[0];
      const persistedExecution = persistCall?.[1]?.[0] as ToolExecution;

      expect(persistedExecution.toolInput).toEqual({ param: 'value' });
    });

    it('should not call persistence for empty executions', async () => {
      const context = createTestContext();

      await processor.processExecutions([], context);

      expect(mockPersistence.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should not call persistence when all are duplicates', async () => {
      // Pre-populate context with duplicate IDs
      const context = createTestContext();
      const toolId1 = 'toolu_dup1';
      const toolId2 = 'toolu_dup2';
      context.seenToolIds.set(toolId1, new Date().toISOString());
      context.seenToolIds.set(toolId2, new Date().toISOString());

      const executions = [
        createRawToolExecution({ toolUseId: toolId1 }),
        createRawToolExecution({ toolUseId: toolId2 }),
      ];

      await processor.processExecutions(executions, context);

      expect(mockPersistence.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should call persistence for unique executions', async () => {
      const context = createTestContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      // Persistence should have been called for the unique execution
      expect(mockPersistence.persistToolEventsAsync).toHaveBeenCalled();
    });
  });

  // === processExecutions() - Error Handling ===
  describe('processExecutions() - error handling', () => {
    it('should catch and log callback errors', async () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback failed');
      });
      const context = createTestContext({ callback: throwingCallback });
      const execution = createRawToolExecution();

      // Should not throw
      await expect(processor.processExecutions([execution], context)).resolves.not.toThrow();
    });

    it('should continue processing after callback error', async () => {
      let callCount = 0;
      const sometimesThrowingCallback = vi.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('First call fails');
      });
      const context = createTestContext({ callback: sometimesThrowingCallback });
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      // Should have attempted both tool_use and tool_result
      expect(sometimesThrowingCallback).toHaveBeenCalledTimes(2);
    });

    it('should handle persistence coordinator failure gracefully', async () => {
      const failingPersistence = createMockPersistenceCoordinator({
        persistToolEventsAsync: vi.fn(() => {
          throw new Error('Persistence failed');
        }),
      });
      processor = new ToolExecutionProcessor(failingPersistence);

      const context = createTestContext();
      const execution = createRawToolExecution();

      // Should not throw (fire-and-forget pattern)
      await expect(processor.processExecutions([execution], context)).resolves.not.toThrow();
    });
  });

  // === Context-based deduplication (replaces getStats/reset) ===
  describe('context-based deduplication', () => {
    it('should isolate deduplication between different contexts', async () => {
      const ctx1 = createTestContext();
      const ctx2 = createTestContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_same_id' });

      // First context processes the execution
      const result1 = await processor.processExecutions([execution], ctx1);
      expect(result1.length).toBe(1);

      // Second context also processes (isolated)
      const result2 = await processor.processExecutions([execution], ctx2);
      expect(result2.length).toBe(1);

      // Both contexts track the same tool independently
      expect(ctx1.seenToolIds.has('toolu_same_id')).toBe(true);
      expect(ctx2.seenToolIds.has('toolu_same_id')).toBe(true);
    });

    it('should deduplicate within same context', async () => {
      const ctx = createTestContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_same_id' });

      // First call: not duplicate
      const result1 = await processor.processExecutions([execution], ctx);
      expect(result1.length).toBe(1);

      // Second call with same context: duplicate
      const result2 = await processor.processExecutions([execution], ctx);
      expect(result2.length).toBe(0);
    });

    it('should allow processing same toolUseId with fresh context', async () => {
      const ctx1 = createTestContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_same_id' });

      // First call with ctx1
      const result1 = await processor.processExecutions([execution], ctx1);
      expect(result1.length).toBe(1);

      // Fresh context - not duplicate
      const ctx2 = createTestContext();
      const result2 = await processor.processExecutions([execution], ctx2);
      expect(result2.length).toBe(1);
    });
  });

  // === createToolExecutionProcessor() ===
  describe('createToolExecutionProcessor()', () => {
    it('should create new instance', () => {
      const proc = createToolExecutionProcessor();
      expect(proc).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should be stateless (deduplication via context)', async () => {
      const proc1 = createToolExecutionProcessor();
      const proc2 = createToolExecutionProcessor();

      const ctx1 = createTestContext();
      const ctx2 = createTestContext();

      await proc1.processExecutions([createRawToolExecution()], ctx1);

      // Processor is stateless - deduplication state is in context
      expect(ctx1.seenToolIds.size).toBe(1);
      expect(ctx2.seenToolIds.size).toBe(0);
    });

    it('should return ToolExecutionProcessor instance', () => {
      const proc = createToolExecutionProcessor();
      expect(proc).toBeInstanceOf(ToolExecutionProcessor);
    });
  });

  // === Realistic Scenarios ===
  describe('realistic scenarios', () => {
    it('should handle typical LangGraph tool execution batch', async () => {
      const context = createTestContext({ sessionId: 'chat-session-123' });
      const executions: RawToolExecution[] = [
        {
          toolUseId: 'toolu_get_customers_001',
          toolName: 'get_customers',
          args: { limit: 10, filter: 'active' },
          result: JSON.stringify([{ id: 1, name: 'Customer A' }]),
          success: true,
        },
        {
          toolUseId: 'toolu_get_orders_002',
          toolName: 'get_orders',
          args: { customerId: 1 },
          result: JSON.stringify([{ id: 101, total: 500 }]),
          success: true,
        },
      ];

      const result = await processor.processExecutions(executions, context);

      expect(result).toEqual(['get_customers', 'get_orders']);
      expect(context.callback).toHaveBeenCalledTimes(4); // 2 × (tool_use + tool_result)
      expect(context.seenToolIds.size).toBe(2);
    });

    it('should handle tool failure with error', async () => {
      const context = createTestContext();
      const execution: RawToolExecution = {
        toolUseId: 'toolu_create_order_fail',
        toolName: 'create_order',
        args: { customerId: 999 },
        result: '',
        success: false,
        error: 'Customer not found',
      };

      await processor.processExecutions([execution], context);

      const calls = (context.callback as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];

      expect(toolResultEvent?.success).toBe(false);
      expect(toolResultEvent?.error).toBe('Customer not found');
    });

    it('should handle multi-turn conversation with fresh contexts', async () => {
      // Turn 1 with context 1
      const ctx1 = createTestContext();
      await processor.processExecutions(
        [createRawToolExecution({ toolName: 'turn1_tool', toolUseId: 'toolu_turn1' })],
        ctx1
      );
      expect(ctx1.seenToolIds.size).toBe(1);

      // Turn 2 with fresh context (simulates new execution)
      const ctx2 = createTestContext();
      await processor.processExecutions(
        [createRawToolExecution({ toolName: 'turn2_tool', toolUseId: 'toolu_turn2' })],
        ctx2
      );
      expect(ctx2.seenToolIds.size).toBe(1);
    });

    it('should handle rapid successive tool calls', async () => {
      const context = createTestContext();
      const executions = Array.from({ length: 10 }, (_, i) =>
        createRawToolExecution({
          toolUseId: `toolu_rapid_${i}`,
          toolName: `rapid_tool_${i}`,
        })
      );

      const result = await processor.processExecutions(executions, context);

      expect(result.length).toBe(10);
      expect(context.callback).toHaveBeenCalledTimes(20); // 10 × 2
      expect(context.seenToolIds.size).toBe(10);
    });

    it('should deduplicate across multiple processExecutions calls with same context', async () => {
      const context = createTestContext();
      const sameExecution = createRawToolExecution({ toolUseId: 'toolu_same_across_calls' });

      // First call: processed
      const result1 = await processor.processExecutions([sameExecution], context);
      expect(result1.length).toBe(1);

      // Second call with same context + same ID: skipped
      const result2 = await processor.processExecutions([sameExecution], context);
      expect(result2.length).toBe(0);

      // Only tracked once
      expect(context.seenToolIds.size).toBe(1);
      expect(context.seenToolIds.has('toolu_same_across_calls')).toBe(true);
    });
  });
});
