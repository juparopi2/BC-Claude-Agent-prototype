/**
 * @module ToolExecutionProcessor.test
 *
 * Unit tests for ToolExecutionProcessor.
 * Tests processing of tool executions from LangGraph streaming events.
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
  type IToolEventDeduplicator,
  type RawToolExecution,
  type ToolProcessorContext,
  type DeduplicationResult,
} from '@/domains/agent/tools';
import type { IPersistenceCoordinator, ToolExecution } from '@/domains/agent/persistence/types';

// === Mock Factories ===

function createMockDeduplicator(overrides: Partial<IToolEventDeduplicator> = {}): IToolEventDeduplicator {
  return {
    checkAndMark: vi.fn((toolUseId: string): DeduplicationResult => ({
      isDuplicate: false,
      toolUseId,
      firstSeenAt: new Date().toISOString(),
    })),
    hasSeen: vi.fn(() => false),
    getStats: vi.fn(() => ({ totalTracked: 0, duplicatesPrevented: 0 })),
    reset: vi.fn(),
    ...overrides,
  };
}

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

function createContext(overrides: Partial<ToolProcessorContext> = {}): ToolProcessorContext {
  return {
    sessionId: 'test-session-123',
    userId: 'test-user-456',
    onEvent: vi.fn(),
    ...overrides,
  };
}

describe('ToolExecutionProcessor', () => {
  let processor: ToolExecutionProcessor;
  let mockDeduplicator: IToolEventDeduplicator;
  let mockPersistence: IPersistenceCoordinator;

  beforeEach(() => {
    mockDeduplicator = createMockDeduplicator();
    mockPersistence = createMockPersistenceCoordinator();
    processor = new ToolExecutionProcessor(mockDeduplicator, mockPersistence);
  });

  // === Constructor & Dependency Injection ===
  describe('constructor', () => {
    it('should create with default dependencies', () => {
      const defaultProcessor = new ToolExecutionProcessor();
      expect(defaultProcessor).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should accept injected deduplicator', () => {
      const customDeduplicator = createMockDeduplicator();
      const processorWithCustomDedup = new ToolExecutionProcessor(customDeduplicator);
      expect(processorWithCustomDedup).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should accept injected persistenceCoordinator', () => {
      const customPersistence = createMockPersistenceCoordinator();
      const defaultDeduplicator = createMockDeduplicator();
      const processorWithCustomPersist = new ToolExecutionProcessor(
        defaultDeduplicator,
        customPersistence
      );
      expect(processorWithCustomPersist).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should accept both injected dependencies', () => {
      const customDeduplicator = createMockDeduplicator();
      const customPersistence = createMockPersistenceCoordinator();
      const processorWithBoth = new ToolExecutionProcessor(customDeduplicator, customPersistence);
      expect(processorWithBoth).toBeInstanceOf(ToolExecutionProcessor);
    });
  });

  // === processExecutions() - Basic ===
  describe('processExecutions() - basic', () => {
    it('should return empty array for empty executions', async () => {
      const context = createContext();
      const result = await processor.processExecutions([], context);

      expect(result).toEqual([]);
      expect(context.onEvent).not.toHaveBeenCalled();
    });

    it('should return empty array for undefined executions', async () => {
      const context = createContext();
      const result = await processor.processExecutions(
        undefined as unknown as RawToolExecution[],
        context
      );

      expect(result).toEqual([]);
    });

    it('should return empty array for null executions', async () => {
      const context = createContext();
      const result = await processor.processExecutions(
        null as unknown as RawToolExecution[],
        context
      );

      expect(result).toEqual([]);
    });

    it('should process single execution successfully', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ toolName: 'get_customers' });

      const result = await processor.processExecutions([execution], context);

      expect(result).toEqual(['get_customers']);
    });

    it('should return array of tool names for processed executions', async () => {
      const context = createContext();
      const executions = [
        createRawToolExecution({ toolName: 'tool_a' }),
        createRawToolExecution({ toolName: 'tool_b' }),
        createRawToolExecution({ toolName: 'tool_c' }),
      ];

      const result = await processor.processExecutions(executions, context);

      expect(result).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('should process multiple executions', async () => {
      const context = createContext();
      const executions = [
        createRawToolExecution(),
        createRawToolExecution(),
        createRawToolExecution(),
      ];

      await processor.processExecutions(executions, context);

      expect(mockDeduplicator.checkAndMark).toHaveBeenCalledTimes(3);
    });
  });

  // === processExecutions() - Deduplication ===
  describe('processExecutions() - deduplication', () => {
    it('should skip duplicate tool_use_ids', async () => {
      const duplicateDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn(() => ({
          isDuplicate: true,
          toolUseId: 'toolu_duplicate',
          firstSeenAt: '2025-01-01T00:00:00.000Z',
        })),
      });
      processor = new ToolExecutionProcessor(duplicateDeduplicator, mockPersistence);

      const context = createContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_duplicate' });

      const result = await processor.processExecutions([execution], context);

      expect(result).toEqual([]);
      expect(context.onEvent).not.toHaveBeenCalled();
    });

    it('should process unique tool_use_ids', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_unique' });

      const result = await processor.processExecutions([execution], context);

      expect(result.length).toBe(1);
      expect(context.onEvent).toHaveBeenCalled();
    });

    it('should track duplicates in stats', async () => {
      // First call: not duplicate
      // Second call: duplicate
      let callCount = 0;
      const mixedDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn((toolUseId: string) => {
          callCount++;
          return {
            isDuplicate: callCount === 2,
            toolUseId,
            firstSeenAt: new Date().toISOString(),
          };
        }),
      });
      processor = new ToolExecutionProcessor(mixedDeduplicator, mockPersistence);

      const context = createContext();
      const executions = [
        createRawToolExecution({ toolUseId: 'toolu_first' }),
        createRawToolExecution({ toolUseId: 'toolu_duplicate' }),
      ];

      await processor.processExecutions(executions, context);

      const stats = processor.getStats();
      expect(stats.duplicatesSkipped).toBe(1);
    });

    it('should handle mixed unique and duplicate executions', async () => {
      // Simulate: first is new, second is duplicate, third is new
      let callCount = 0;
      const mixedDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn((toolUseId: string) => {
          callCount++;
          return {
            isDuplicate: callCount === 2,
            toolUseId,
            firstSeenAt: new Date().toISOString(),
          };
        }),
      });
      processor = new ToolExecutionProcessor(mixedDeduplicator, mockPersistence);

      const context = createContext();
      const executions = [
        createRawToolExecution({ toolName: 'tool_a' }),
        createRawToolExecution({ toolName: 'tool_b_duplicate' }),
        createRawToolExecution({ toolName: 'tool_c' }),
      ];

      const result = await processor.processExecutions(executions, context);

      expect(result).toEqual(['tool_a', 'tool_c']);
    });

    it('should preserve firstSeenAt timestamp in logs for duplicates', async () => {
      const firstSeenAt = '2025-01-01T00:00:00.000Z';
      const duplicateDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn(() => ({
          isDuplicate: true,
          toolUseId: 'toolu_dup',
          firstSeenAt,
        })),
      });
      processor = new ToolExecutionProcessor(duplicateDeduplicator, mockPersistence);

      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      // Verify deduplicator was called with the execution's toolUseId
      expect(duplicateDeduplicator.checkAndMark).toHaveBeenCalled();
    });
  });

  // === processExecutions() - Event Emission ===
  describe('processExecutions() - event emission', () => {
    it('should emit tool_use event for each unique execution', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ toolName: 'my_tool' });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolUseEvents = calls.filter(
        ([event]: [AgentEvent]) => event.type === 'tool_use'
      );
      expect(toolUseEvents.length).toBe(1);
    });

    it('should emit tool_result event for each unique execution', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolResultEvents = calls.filter(
        ([event]: [AgentEvent]) => event.type === 'tool_result'
      );
      expect(toolResultEvents.length).toBe(1);
    });

    it('should emit events in order: tool_use then tool_result', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      expect(calls[0]?.[0]?.type).toBe('tool_use');
      expect(calls[1]?.[0]?.type).toBe('tool_result');
    });

    it('should include correct sessionId in events', async () => {
      const context = createContext({ sessionId: 'specific-session-id' });
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      expect(calls[0]?.[0]?.sessionId).toBe('specific-session-id');
      expect(calls[1]?.[0]?.sessionId).toBe('specific-session-id');
    });

    it('should include correct toolUseId in events', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_specific_id' });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      expect(calls[0]?.[0]?.toolUseId).toBe('toolu_specific_id');
      expect(calls[1]?.[0]?.toolUseId).toBe('toolu_specific_id');
    });

    it('should include correct args in tool_use event', async () => {
      const context = createContext();
      const execution = createRawToolExecution({
        args: { customParam: 'customValue', number: 42 },
      });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolUseEvent = calls[0]?.[0];
      expect(toolUseEvent?.args).toEqual({ customParam: 'customValue', number: 42 });
    });

    it('should include result in tool_result event', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ result: 'Custom result data' });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.result).toBe('Custom result data');
    });

    it('should include success flag in tool_result event', async () => {
      const context = createContext();
      const execution = createRawToolExecution({ success: true });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.success).toBe(true);
    });

    it('should include error in tool_result event when present', async () => {
      const context = createContext();
      const execution = createRawToolExecution({
        success: false,
        error: 'Something went wrong',
      });

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];
      expect(toolResultEvent?.success).toBe(false);
      expect(toolResultEvent?.error).toBe('Something went wrong');
    });

    it('should set persistenceState to pending', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      expect(calls[0]?.[0]?.persistenceState).toBe('pending');
      expect(calls[1]?.[0]?.persistenceState).toBe('pending');
    });

    it('should generate unique eventId for each event', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const eventId1 = calls[0]?.[0]?.eventId;
      const eventId2 = calls[1]?.[0]?.eventId;

      expect(eventId1).toBeDefined();
      expect(eventId2).toBeDefined();
      expect(eventId1).not.toBe(eventId2);
    });

    it('should use consistent timestamp for tool_use and tool_result pair', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const timestamp1 = calls[0]?.[0]?.timestamp;
      const timestamp2 = calls[1]?.[0]?.timestamp;

      expect(timestamp1).toBe(timestamp2);
    });
  });

  // === processExecutions() - Persistence ===
  describe('processExecutions() - persistence', () => {
    it('should call persistToolEventsAsync with correct sessionId', async () => {
      const context = createContext({ sessionId: 'persistence-test-session' });
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      expect(mockPersistence.persistToolEventsAsync).toHaveBeenCalledWith(
        'persistence-test-session',
        expect.any(Array)
      );
    });

    it('should pass all unique executions to persistence', async () => {
      const context = createContext();
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
      const context = createContext();
      const execution = createRawToolExecution({
        args: { param: 'value' },
      });

      await processor.processExecutions([execution], context);

      const persistCall = (mockPersistence.persistToolEventsAsync as Mock).mock.calls[0];
      const persistedExecution = persistCall?.[1]?.[0] as ToolExecution;

      expect(persistedExecution.toolInput).toEqual({ param: 'value' });
    });

    it('should not call persistence for empty executions', async () => {
      const context = createContext();

      await processor.processExecutions([], context);

      expect(mockPersistence.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should not call persistence when all are duplicates', async () => {
      const allDuplicatesDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn(() => ({
          isDuplicate: true,
          toolUseId: 'toolu_dup',
          firstSeenAt: new Date().toISOString(),
        })),
      });
      processor = new ToolExecutionProcessor(allDuplicatesDeduplicator, mockPersistence);

      const context = createContext();
      const executions = [createRawToolExecution(), createRawToolExecution()];

      await processor.processExecutions(executions, context);

      expect(mockPersistence.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should increment persistenceInitiated in stats', async () => {
      const context = createContext();
      const execution = createRawToolExecution();

      await processor.processExecutions([execution], context);

      const stats = processor.getStats();
      expect(stats.persistenceInitiated).toBe(1);
    });
  });

  // === processExecutions() - Error Handling ===
  describe('processExecutions() - error handling', () => {
    it('should catch and log callback errors', async () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('Callback failed');
      });
      const context = createContext({ onEvent: throwingCallback });
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
      const context = createContext({ onEvent: sometimesThrowingCallback });
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
      processor = new ToolExecutionProcessor(mockDeduplicator, failingPersistence);

      const context = createContext();
      const execution = createRawToolExecution();

      // Should not throw (fire-and-forget pattern)
      await expect(processor.processExecutions([execution], context)).resolves.not.toThrow();
    });
  });

  // === getStats() ===
  describe('getStats()', () => {
    it('should return zero stats initially', () => {
      const stats = processor.getStats();

      expect(stats.totalReceived).toBe(0);
      expect(stats.duplicatesSkipped).toBe(0);
      expect(stats.eventsEmitted).toBe(0);
      expect(stats.persistenceInitiated).toBe(0);
    });

    it('should count totalReceived correctly', async () => {
      const context = createContext();
      const executions = [
        createRawToolExecution(),
        createRawToolExecution(),
        createRawToolExecution(),
      ];

      await processor.processExecutions(executions, context);

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(3);
    });

    it('should count duplicatesSkipped correctly', async () => {
      // All duplicates
      const allDuplicatesDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn(() => ({
          isDuplicate: true,
          toolUseId: 'toolu_dup',
          firstSeenAt: new Date().toISOString(),
        })),
      });
      processor = new ToolExecutionProcessor(allDuplicatesDeduplicator, mockPersistence);

      const context = createContext();
      const executions = [
        createRawToolExecution(),
        createRawToolExecution(),
      ];

      await processor.processExecutions(executions, context);

      const stats = processor.getStats();
      expect(stats.duplicatesSkipped).toBe(2);
    });

    it('should count eventsEmitted correctly', async () => {
      const context = createContext();
      const executions = [createRawToolExecution(), createRawToolExecution()];

      await processor.processExecutions(executions, context);

      const stats = processor.getStats();
      // 2 executions × 2 events each (tool_use + tool_result) = 4
      expect(stats.eventsEmitted).toBe(4);
    });

    it('should accumulate stats across multiple calls', async () => {
      const context = createContext();

      await processor.processExecutions([createRawToolExecution()], context);
      await processor.processExecutions([createRawToolExecution()], context);
      await processor.processExecutions([createRawToolExecution()], context);

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(3);
      expect(stats.eventsEmitted).toBe(6); // 3 × 2
      expect(stats.persistenceInitiated).toBe(3);
    });
  });

  // === reset() ===
  describe('reset()', () => {
    it('should reset deduplicator', async () => {
      const context = createContext();
      await processor.processExecutions([createRawToolExecution()], context);

      processor.reset();

      expect(mockDeduplicator.reset).toHaveBeenCalled();
    });

    it('should reset all stats to zero', async () => {
      const context = createContext();
      await processor.processExecutions([createRawToolExecution()], context);

      processor.reset();

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(0);
      expect(stats.duplicatesSkipped).toBe(0);
      expect(stats.eventsEmitted).toBe(0);
      expect(stats.persistenceInitiated).toBe(0);
    });

    it('should allow processing same toolUseId after reset', async () => {
      const trackedIds = new Set<string>();
      const trackingDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn((toolUseId: string) => {
          const isDuplicate = trackedIds.has(toolUseId);
          trackedIds.add(toolUseId);
          return {
            isDuplicate,
            toolUseId,
            firstSeenAt: new Date().toISOString(),
          };
        }),
        reset: vi.fn(() => {
          trackedIds.clear();
        }),
      });
      processor = new ToolExecutionProcessor(trackingDeduplicator, mockPersistence);

      const context = createContext();
      const execution = createRawToolExecution({ toolUseId: 'toolu_same_id' });

      // First call: not duplicate
      const result1 = await processor.processExecutions([execution], context);
      expect(result1.length).toBe(1);

      // Second call without reset: duplicate
      const result2 = await processor.processExecutions([execution], context);
      expect(result2.length).toBe(0);

      // Reset and call again: not duplicate
      processor.reset();
      const result3 = await processor.processExecutions([execution], context);
      expect(result3.length).toBe(1);
    });

    it('should be idempotent', () => {
      processor.reset();
      processor.reset();
      processor.reset();

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(0);
    });
  });

  // === createToolExecutionProcessor() ===
  describe('createToolExecutionProcessor()', () => {
    it('should create new instance', () => {
      const proc = createToolExecutionProcessor();
      expect(proc).toBeInstanceOf(ToolExecutionProcessor);
    });

    it('should create independent instances', async () => {
      const proc1 = createToolExecutionProcessor();
      const proc2 = createToolExecutionProcessor();

      const context = createContext();
      await proc1.processExecutions([createRawToolExecution()], context);

      expect(proc1.getStats().totalReceived).toBe(1);
      expect(proc2.getStats().totalReceived).toBe(0);
    });

    it('should return ToolExecutionProcessor instance', () => {
      const proc = createToolExecutionProcessor();
      expect(proc).toBeInstanceOf(ToolExecutionProcessor);
    });
  });

  // === Realistic Scenarios ===
  describe('realistic scenarios', () => {
    it('should handle typical LangGraph tool execution batch', async () => {
      const context = createContext({ sessionId: 'chat-session-123' });
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
      expect(context.onEvent).toHaveBeenCalledTimes(4); // 2 × (tool_use + tool_result)

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(2);
      expect(stats.eventsEmitted).toBe(4);
      expect(stats.persistenceInitiated).toBe(1);
    });

    it('should handle tool failure with error', async () => {
      const context = createContext();
      const execution: RawToolExecution = {
        toolUseId: 'toolu_create_order_fail',
        toolName: 'create_order',
        args: { customerId: 999 },
        result: '',
        success: false,
        error: 'Customer not found',
      };

      await processor.processExecutions([execution], context);

      const calls = (context.onEvent as Mock).mock.calls;
      const toolResultEvent = calls[1]?.[0];

      expect(toolResultEvent?.success).toBe(false);
      expect(toolResultEvent?.error).toBe('Customer not found');
    });

    it('should handle multi-turn conversation with reset', async () => {
      const context = createContext();

      // Turn 1
      await processor.processExecutions(
        [createRawToolExecution({ toolName: 'turn1_tool' })],
        context
      );

      // Reset between turns
      processor.reset();

      // Turn 2
      await processor.processExecutions(
        [createRawToolExecution({ toolName: 'turn2_tool' })],
        context
      );

      const stats = processor.getStats();
      // Only turn 2 stats after reset
      expect(stats.totalReceived).toBe(1);
      expect(stats.eventsEmitted).toBe(2);
    });

    it('should handle rapid successive tool calls', async () => {
      const context = createContext();
      const executions = Array.from({ length: 10 }, (_, i) =>
        createRawToolExecution({
          toolUseId: `toolu_rapid_${i}`,
          toolName: `rapid_tool_${i}`,
        })
      );

      const result = await processor.processExecutions(executions, context);

      expect(result.length).toBe(10);
      expect(context.onEvent).toHaveBeenCalledTimes(20); // 10 × 2
    });

    it('should deduplicate across multiple processExecutions calls', async () => {
      // Use real deduplication tracking
      const trackedIds = new Set<string>();
      const trackingDeduplicator = createMockDeduplicator({
        checkAndMark: vi.fn((toolUseId: string) => {
          const isDuplicate = trackedIds.has(toolUseId);
          trackedIds.add(toolUseId);
          return {
            isDuplicate,
            toolUseId,
            firstSeenAt: new Date().toISOString(),
          };
        }),
      });
      processor = new ToolExecutionProcessor(trackingDeduplicator, mockPersistence);

      const context = createContext();
      const sameExecution = createRawToolExecution({ toolUseId: 'toolu_same_across_calls' });

      // First call: processed
      const result1 = await processor.processExecutions([sameExecution], context);
      expect(result1.length).toBe(1);

      // Second call with same ID: skipped
      const result2 = await processor.processExecutions([sameExecution], context);
      expect(result2.length).toBe(0);

      const stats = processor.getStats();
      expect(stats.totalReceived).toBe(2);
      expect(stats.duplicatesSkipped).toBe(1);
    });
  });
});
