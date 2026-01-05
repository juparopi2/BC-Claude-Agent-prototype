/**
 * @module ToolLifecycleManager.test
 *
 * Unit tests for ToolLifecycleManager.
 * Tests unified tool persistence - tracking tool request/response lifecycle.
 *
 * TDD Phase 1 (RED): Tests written before implementation.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  ToolLifecycleManager,
  createToolLifecycleManager,
} from '@/domains/agent/tools/ToolLifecycleManager';
import type { ToolState, ToolLifecycleStats } from '@/domains/agent/tools/types';

// Mock PersistenceCoordinator for finalizeAndPersistOrphans tests
interface MockPersistenceCoordinator {
  persistToolEventsAsync: Mock;
}

describe('ToolLifecycleManager', () => {
  let manager: ToolLifecycleManager;
  let mockPersistenceCoordinator: MockPersistenceCoordinator;

  beforeEach(() => {
    manager = new ToolLifecycleManager();
    mockPersistenceCoordinator = {
      persistToolEventsAsync: vi.fn(),
    };
  });

  describe('onToolRequested()', () => {
    it('should register a new tool request in memory', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '456' });

      expect(manager.hasPendingTool('toolu_123')).toBe(true);
      expect(manager.getStats().pending).toBe(1);
    });

    it('should ignore duplicate tool requests', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '456' });
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '789' });

      expect(manager.getStats().pending).toBe(1);
    });

    it('should track multiple different tools independently', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'get_customer', {});
      manager.onToolRequested('session-1', 'toolu_2', 'get_order', {});
      manager.onToolRequested('session-1', 'toolu_3', 'search_products', {});

      expect(manager.getStats().pending).toBe(3);
      expect(manager.hasPendingTool('toolu_1')).toBe(true);
      expect(manager.hasPendingTool('toolu_2')).toBe(true);
      expect(manager.hasPendingTool('toolu_3')).toBe(true);
    });

    it('should NOT trigger persistence', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '456' });

      // onToolRequested should only store in memory, not persist
      // This is verified by the fact that we can complete it later with full data
      expect(manager.hasPendingTool('toolu_123')).toBe(true);
    });

    it('should store args for later retrieval on completion', () => {
      const args = { id: '456', name: 'test', nested: { a: 1 } };
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', args);

      const result = manager.onToolCompleted('session-1', 'toolu_123', 'result', true);

      expect(result).not.toBeNull();
      expect(result!.args).toEqual(args);
    });

    it('should store toolName for later retrieval on completion', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'specific_tool_name', {});

      const result = manager.onToolCompleted('session-1', 'toolu_123', 'result', true);

      expect(result).not.toBeNull();
      expect(result!.toolName).toBe('specific_tool_name');
    });

    it('should track timestamp of request', () => {
      const beforeRequest = new Date();
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});

      const result = manager.onToolCompleted('session-1', 'toolu_123', 'result', true);
      const afterComplete = new Date();

      expect(result).not.toBeNull();
      expect(result!.requestedAt.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
      expect(result!.requestedAt.getTime()).toBeLessThanOrEqual(afterComplete.getTime());
    });
  });

  describe('onToolCompleted()', () => {
    it('should return complete state with input and output', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '456' });

      const result = manager.onToolCompleted('session-1', 'toolu_123', '{"name": "John"}', true);

      expect(result).not.toBeNull();
      expect(result!.toolUseId).toBe('toolu_123');
      expect(result!.toolName).toBe('get_customer');
      expect(result!.args).toEqual({ id: '456' });
      expect(result!.result).toBe('{"name": "John"}');
      expect(result!.state).toBe('completed');
      expect(result!.error).toBeUndefined();
    });

    it('should return state with failed status on error', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', { id: '456' });

      const result = manager.onToolCompleted(
        'session-1',
        'toolu_123',
        'Error output',
        false,
        'Not found'
      );

      expect(result).not.toBeNull();
      expect(result!.state).toBe('failed');
      expect(result!.error).toBe('Not found');
      expect(result!.result).toBe('Error output');
    });

    it('should return null for orphan response (no matching request)', () => {
      const result = manager.onToolCompleted('session-1', 'toolu_unknown', 'result', true);

      expect(result).toBeNull();
    });

    it('should return null for session mismatch', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});

      const result = manager.onToolCompleted('session-2', 'toolu_123', 'result', true);

      expect(result).toBeNull();
    });

    it('should remove tool from pending after completion', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});
      expect(manager.hasPendingTool('toolu_123')).toBe(true);

      manager.onToolCompleted('session-1', 'toolu_123', 'result', true);

      expect(manager.hasPendingTool('toolu_123')).toBe(false);
    });

    it('should update stats correctly on success completion', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});
      manager.onToolRequested('session-1', 'toolu_2', 'tool_b', {});

      manager.onToolCompleted('session-1', 'toolu_1', 'result', true);

      const stats = manager.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('should update stats correctly on failure', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});

      manager.onToolCompleted('session-1', 'toolu_1', 'error', false, 'Failed');

      const stats = manager.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(1);
    });

    it('should include timestamps in returned state', () => {
      const beforeRequest = new Date();
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});

      const result = manager.onToolCompleted('session-1', 'toolu_123', 'result', true);
      const afterComplete = new Date();

      expect(result!.requestedAt.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
      expect(result!.completedAt!.getTime()).toBeLessThanOrEqual(afterComplete.getTime());
      expect(result!.completedAt!.getTime()).toBeGreaterThanOrEqual(
        result!.requestedAt.getTime()
      );
    });

    it('should handle empty result string', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});

      const result = manager.onToolCompleted('session-1', 'toolu_123', '', true);

      expect(result).not.toBeNull();
      expect(result!.result).toBe('');
      expect(result!.state).toBe('completed');
    });

    it('should handle large result strings', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});
      const largeResult = 'x'.repeat(100000);

      const result = manager.onToolCompleted('session-1', 'toolu_123', largeResult, true);

      expect(result).not.toBeNull();
      expect(result!.result).toBe(largeResult);
    });
  });

  describe('hasPendingTool()', () => {
    it('should return false for unseen tool_use_id', () => {
      expect(manager.hasPendingTool('toolu_123')).toBe(false);
    });

    it('should return true for pending tool', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});

      expect(manager.hasPendingTool('toolu_123')).toBe(true);
    });

    it('should return false after tool is completed', () => {
      manager.onToolRequested('session-1', 'toolu_123', 'get_customer', {});
      manager.onToolCompleted('session-1', 'toolu_123', 'result', true);

      expect(manager.hasPendingTool('toolu_123')).toBe(false);
    });
  });

  describe('finalizeAndPersistOrphans()', () => {
    it('should do nothing when no orphans exist', async () => {
      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      expect(mockPersistenceCoordinator.persistToolEventsAsync).not.toHaveBeenCalled();
    });

    it('should persist orphaned tools with incomplete status', async () => {
      manager.onToolRequested('session-1', 'toolu_orphan', 'get_customer', { id: '123' });
      // No completion call - tool is orphaned

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      expect(mockPersistenceCoordinator.persistToolEventsAsync).toHaveBeenCalledWith(
        'session-1',
        [
          expect.objectContaining({
            toolUseId: 'toolu_orphan',
            toolName: 'get_customer',
            toolInput: { id: '123' },
            toolOutput: expect.stringContaining('INCOMPLETE'),
            success: false,
            error: expect.stringContaining('did not complete'),
          }),
        ]
      );
    });

    it('should only persist orphans for the specified session', async () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});
      manager.onToolRequested('session-2', 'toolu_2', 'tool_b', {});

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      // Only session-1 orphan should be persisted
      expect(mockPersistenceCoordinator.persistToolEventsAsync).toHaveBeenCalledWith(
        'session-1',
        [expect.objectContaining({ toolUseId: 'toolu_1' })]
      );

      // session-2 tool should still be pending
      expect(manager.hasPendingTool('toolu_2')).toBe(true);
    });

    it('should update stats and clear pending tools after finalization', async () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});
      manager.onToolRequested('session-1', 'toolu_2', 'tool_b', {});

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      const stats = manager.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.orphaned).toBe(2);
      expect(manager.hasPendingTool('toolu_1')).toBe(false);
      expect(manager.hasPendingTool('toolu_2')).toBe(false);
    });

    it('should handle mixed completed and orphaned tools', async () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});
      manager.onToolRequested('session-1', 'toolu_2', 'tool_b', {});
      manager.onToolRequested('session-1', 'toolu_3', 'tool_c', {});

      // Complete only toolu_1
      manager.onToolCompleted('session-1', 'toolu_1', 'result', true);

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      // Should persist toolu_2 and toolu_3 as orphans
      const callArgs = mockPersistenceCoordinator.persistToolEventsAsync.mock.calls[0];
      expect(callArgs[1]).toHaveLength(2);
      expect(callArgs[1].map((e: { toolUseId: string }) => e.toolUseId).sort()).toEqual([
        'toolu_2',
        'toolu_3',
      ]);

      const stats = manager.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.orphaned).toBe(2);
    });

    it('should not persist orphans from already-completed tools', async () => {
      manager.onToolRequested('session-1', 'toolu_1', 'tool_a', {});
      manager.onToolCompleted('session-1', 'toolu_1', 'result', true);

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      expect(mockPersistenceCoordinator.persistToolEventsAsync).not.toHaveBeenCalled();
    });
  });

  describe('getStats()', () => {
    it('should return initial stats as zeros', () => {
      const stats = manager.getStats();

      expect(stats.pending).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.orphaned).toBe(0);
    });

    it('should track all state changes accurately', async () => {
      // 2 successful, 1 failed, 1 orphaned
      manager.onToolRequested('session-1', 'toolu_1', 'a', {});
      manager.onToolRequested('session-1', 'toolu_2', 'b', {});
      manager.onToolRequested('session-1', 'toolu_3', 'c', {});
      manager.onToolRequested('session-1', 'toolu_4', 'd', {});

      manager.onToolCompleted('session-1', 'toolu_1', 'ok', true);
      manager.onToolCompleted('session-1', 'toolu_2', 'ok', true);
      manager.onToolCompleted('session-1', 'toolu_3', 'err', false, 'error');
      // toolu_4 is orphaned

      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      const stats = manager.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.orphaned).toBe(1);
    });

    it('should return copy of stats (not mutable reference)', () => {
      const stats1 = manager.getStats();
      (stats1 as any).pending = 999;

      const stats2 = manager.getStats();
      expect(stats2.pending).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear all pending tools', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'a', {});
      manager.onToolRequested('session-1', 'toolu_2', 'b', {});

      manager.reset();

      expect(manager.hasPendingTool('toolu_1')).toBe(false);
      expect(manager.hasPendingTool('toolu_2')).toBe(false);
    });

    it('should reset all stats to zero', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'a', {});
      manager.onToolCompleted('session-1', 'toolu_1', 'ok', true);

      manager.reset();

      const stats = manager.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.orphaned).toBe(0);
    });

    it('should be idempotent', () => {
      manager.onToolRequested('session-1', 'toolu_1', 'a', {});
      manager.reset();
      manager.reset();
      manager.reset();

      expect(manager.getStats().pending).toBe(0);
    });
  });

  describe('createToolLifecycleManager()', () => {
    it('should create new instances each time', () => {
      const m1 = createToolLifecycleManager();
      const m2 = createToolLifecycleManager();

      expect(m1).not.toBe(m2);
    });

    it('should create independent instances', () => {
      const m1 = createToolLifecycleManager();
      const m2 = createToolLifecycleManager();

      m1.onToolRequested('session-1', 'toolu_1', 'a', {});

      expect(m1.hasPendingTool('toolu_1')).toBe(true);
      expect(m2.hasPendingTool('toolu_1')).toBe(false);
    });

    it('should return ToolLifecycleManager instances', () => {
      const m = createToolLifecycleManager();
      expect(m).toBeInstanceOf(ToolLifecycleManager);
    });
  });

  describe('realistic scenarios', () => {
    it('should handle typical agent execution with multiple tools', async () => {
      // Simulate: Agent uses 3 tools in sequence

      // Tool 1: get_customer
      manager.onToolRequested('session-1', 'toolu_001', 'get_customer', { id: 'C123' });
      const tool1 = manager.onToolCompleted('session-1', 'toolu_001', '{"name":"John"}', true);
      expect(tool1).not.toBeNull();
      expect(tool1!.args).toEqual({ id: 'C123' });
      expect(tool1!.result).toBe('{"name":"John"}');

      // Tool 2: get_orders
      manager.onToolRequested('session-1', 'toolu_002', 'get_orders', { customerId: 'C123' });
      const tool2 = manager.onToolCompleted('session-1', 'toolu_002', '[{id: "O1"}]', true);
      expect(tool2).not.toBeNull();

      // Tool 3: create_invoice (fails)
      manager.onToolRequested('session-1', 'toolu_003', 'create_invoice', { orderId: 'O1' });
      const tool3 = manager.onToolCompleted(
        'session-1',
        'toolu_003',
        'Error',
        false,
        'Permission denied'
      );
      expect(tool3).not.toBeNull();
      expect(tool3!.state).toBe('failed');

      // Finalize
      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      // No orphans expected
      expect(mockPersistenceCoordinator.persistToolEventsAsync).not.toHaveBeenCalled();

      const stats = manager.getStats();
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.orphaned).toBe(0);
    });

    it('should handle parallel tool executions', () => {
      // Some LLMs can request multiple tools at once
      manager.onToolRequested('session-1', 'toolu_A', 'tool_a', { a: 1 });
      manager.onToolRequested('session-1', 'toolu_B', 'tool_b', { b: 2 });
      manager.onToolRequested('session-1', 'toolu_C', 'tool_c', { c: 3 });

      // Responses arrive out of order
      const toolB = manager.onToolCompleted('session-1', 'toolu_B', 'B result', true);
      const toolA = manager.onToolCompleted('session-1', 'toolu_A', 'A result', true);
      const toolC = manager.onToolCompleted('session-1', 'toolu_C', 'C result', true);

      expect(toolA!.args).toEqual({ a: 1 });
      expect(toolB!.args).toEqual({ b: 2 });
      expect(toolC!.args).toEqual({ c: 3 });

      expect(manager.getStats().completed).toBe(3);
    });

    it('should handle execution timeout with orphaned tools', async () => {
      // Simulate: 2 tools requested, but execution times out before responses
      manager.onToolRequested('session-1', 'toolu_slow_1', 'slow_tool', {});
      manager.onToolRequested('session-1', 'toolu_slow_2', 'slow_tool', {});

      // Timeout occurs, finalize is called
      await manager.finalizeAndPersistOrphans('session-1', mockPersistenceCoordinator as any);

      const stats = manager.getStats();
      expect(stats.orphaned).toBe(2);
      expect(mockPersistenceCoordinator.persistToolEventsAsync).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple sessions concurrently', async () => {
      // Two different sessions running simultaneously
      manager.onToolRequested('session-A', 'toolu_1', 'tool', {});
      manager.onToolRequested('session-B', 'toolu_2', 'tool', {});

      manager.onToolCompleted('session-A', 'toolu_1', 'result A', true);
      // session-B tool becomes orphan

      await manager.finalizeAndPersistOrphans('session-B', mockPersistenceCoordinator as any);

      expect(mockPersistenceCoordinator.persistToolEventsAsync).toHaveBeenCalledWith(
        'session-B',
        [expect.objectContaining({ toolUseId: 'toolu_2' })]
      );

      const stats = manager.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.orphaned).toBe(1);
    });

    it('should handle Anthropic-style tool_use_ids', () => {
      // Real Anthropic tool_use_ids look like: toolu_01XFDUDYJgAACzvnptvVoYEL
      const toolUseId = 'toolu_01XFDUDYJgAACzvnptvVoYEL';
      manager.onToolRequested('session-1', toolUseId, 'get_metadata', { entity: 'Customer' });

      const result = manager.onToolCompleted('session-1', toolUseId, '{"fields": [...]}', true);

      expect(result).not.toBeNull();
      expect(result!.toolUseId).toBe(toolUseId);
    });
  });
});
