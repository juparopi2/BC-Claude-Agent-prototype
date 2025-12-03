/**
 * Chat Store - Tool Execution Tests
 *
 * Unit tests for tool execution lifecycle in the chat store.
 * Tests the complete flow from tool_use -> tool_result with various scenarios.
 *
 * @module __tests__/unit/stores/chatStore.toolExecution.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '@/lib/stores/chatStore';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';

describe('ChatStore - Tool Execution', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useChatStore.getState().reset();
    });
    // Reset sequence counter for consistent event IDs
    AgentEventFactory.resetSequence();
  });

  describe('TE-1: Add tool execution on tool_use event', () => {
    it('should add tool to toolExecutions Map with status "running"', () => {
      // Create tool_use event
      const toolUse = AgentEventFactory.toolUse({
        toolName: 'list_customers',
        args: { filter: 'active', limit: 10 },
      });

      // Handle the event
      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Verify tool is added with running status
      const state = useChatStore.getState();
      const toolId = toolUse.toolUseId || toolUse.eventId;

      expect(state.toolExecutions.has(toolId)).toBe(true);

      const tool = state.toolExecutions.get(toolId);
      expect(tool).toBeDefined();
      expect(tool?.id).toBe(toolId);
      expect(tool?.toolName).toBe('list_customers');
      expect(tool?.args).toEqual({ filter: 'active', limit: 10 });
      expect(tool?.status).toBe('running');
      expect(tool?.startedAt).toBeInstanceOf(Date);
      expect(tool?.result).toBeUndefined();
      expect(tool?.error).toBeUndefined();
    });
  });

  describe('TE-2: Update tool on successful result', () => {
    it('should change status to "completed" and store result', () => {
      // Create and handle tool_use event
      const toolUseId = 'toolu_abc123';
      const toolUse = AgentEventFactory.toolUse({
        toolUseId,
        toolName: 'get_customer',
        args: { customerId: '12345' },
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Create successful tool_result
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        toolName: 'get_customer',
        success: true,
        result: {
          id: '12345',
          name: 'Acme Corp',
          email: 'contact@acme.com',
        },
        durationMs: 245,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify tool is updated
      const state = useChatStore.getState();
      const tool = state.toolExecutions.get(toolUseId);

      expect(tool).toBeDefined();
      expect(tool?.status).toBe('completed');
      expect(tool?.result).toEqual({
        id: '12345',
        name: 'Acme Corp',
        email: 'contact@acme.com',
      });
      expect(tool?.error).toBeUndefined();
      expect(tool?.completedAt).toBeInstanceOf(Date);
      expect(tool?.durationMs).toBe(245);
    });
  });

  describe('TE-3: Mark tool as failed on error', () => {
    it('should change status to "failed" and store error message', () => {
      // Create and handle tool_use event
      const toolUseId = 'toolu_xyz789';
      const toolUse = AgentEventFactory.toolUse({
        toolUseId,
        toolName: 'delete_customer',
        args: { customerId: '99999' },
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Create failed tool_result
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        toolName: 'delete_customer',
        success: false,
        result: undefined, // Explicitly undefined for failed tools
        error: 'Customer not found: 99999',
        durationMs: 120,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify tool is marked as failed
      const state = useChatStore.getState();
      const tool = state.toolExecutions.get(toolUseId);

      expect(tool).toBeDefined();
      expect(tool?.status).toBe('failed');
      expect(tool?.error).toBe('Customer not found: 99999');
      expect(tool?.result).toBeUndefined();
      expect(tool?.completedAt).toBeInstanceOf(Date);
      expect(tool?.durationMs).toBe(120);
    });
  });

  describe('TE-4: Track multiple concurrent tools', () => {
    it('should track all 3 tools in toolExecutions Map with status "running"', () => {
      // Create 3 tool_use events with different IDs
      const toolA = AgentEventFactory.toolUse({
        toolUseId: 'toolu_a001',
        toolName: 'list_customers',
        args: { limit: 50 },
      });

      const toolB = AgentEventFactory.toolUse({
        toolUseId: 'toolu_b002',
        toolName: 'get_sales_order',
        args: { orderId: '12345' },
      });

      const toolC = AgentEventFactory.toolUse({
        toolUseId: 'toolu_c003',
        toolName: 'list_items',
        args: { category: 'electronics' },
      });

      // Handle all three events
      act(() => {
        useChatStore.getState().handleAgentEvent(toolA);
        useChatStore.getState().handleAgentEvent(toolB);
        useChatStore.getState().handleAgentEvent(toolC);
      });

      // Verify all 3 are tracked
      const state = useChatStore.getState();
      expect(state.toolExecutions.size).toBe(3);

      // Verify each tool individually
      const toolAExec = state.toolExecutions.get('toolu_a001');
      expect(toolAExec?.toolName).toBe('list_customers');
      expect(toolAExec?.status).toBe('running');

      const toolBExec = state.toolExecutions.get('toolu_b002');
      expect(toolBExec?.toolName).toBe('get_sales_order');
      expect(toolBExec?.status).toBe('running');

      const toolCExec = state.toolExecutions.get('toolu_c003');
      expect(toolCExec?.toolName).toBe('list_items');
      expect(toolCExec?.status).toBe('running');
    });
  });

  describe('TE-5: Handle results arriving out-of-order', () => {
    it('should complete all tools successfully with correct results', () => {
      // Create 3 tool_use events
      const toolA = AgentEventFactory.toolUse({
        toolUseId: 'toolu_a001',
        toolName: 'tool_a',
        args: { param: 'a' },
      });

      const toolB = AgentEventFactory.toolUse({
        toolUseId: 'toolu_b002',
        toolName: 'tool_b',
        args: { param: 'b' },
      });

      const toolC = AgentEventFactory.toolUse({
        toolUseId: 'toolu_c003',
        toolName: 'tool_c',
        args: { param: 'c' },
      });

      // Handle all tool_use events
      act(() => {
        useChatStore.getState().handleAgentEvent(toolA);
        useChatStore.getState().handleAgentEvent(toolB);
        useChatStore.getState().handleAgentEvent(toolC);
      });

      // Create tool_result events (out of order: C, A, B)
      const resultC = AgentEventFactory.toolResult({
        toolUseId: 'toolu_c003',
        success: true,
        result: { data: 'result_c' },
      });

      const resultA = AgentEventFactory.toolResult({
        toolUseId: 'toolu_a001',
        success: true,
        result: { data: 'result_a' },
      });

      const resultB = AgentEventFactory.toolResult({
        toolUseId: 'toolu_b002',
        success: true,
        result: { data: 'result_b' },
      });

      // Handle results in order: C, A, B
      act(() => {
        useChatStore.getState().handleAgentEvent(resultC);
        useChatStore.getState().handleAgentEvent(resultA);
        useChatStore.getState().handleAgentEvent(resultB);
      });

      // Verify all completed with correct results
      const state = useChatStore.getState();

      const toolAExec = state.toolExecutions.get('toolu_a001');
      expect(toolAExec?.status).toBe('completed');
      expect(toolAExec?.result).toEqual({ data: 'result_a' });

      const toolBExec = state.toolExecutions.get('toolu_b002');
      expect(toolBExec?.status).toBe('completed');
      expect(toolBExec?.result).toEqual({ data: 'result_b' });

      const toolCExec = state.toolExecutions.get('toolu_c003');
      expect(toolCExec?.status).toBe('completed');
      expect(toolCExec?.result).toEqual({ data: 'result_c' });
    });
  });

  describe('TE-6: Track execution duration', () => {
    it('should store durationMs correctly from tool_result', () => {
      // Create and handle tool_use
      const toolUseId = 'toolu_timing123';
      const toolUse = AgentEventFactory.toolUse({
        toolUseId,
        toolName: 'slow_operation',
        args: {},
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Create tool_result with specific duration
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        success: true,
        result: { success: true },
        durationMs: 1250, // 1.25 seconds
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify duration is stored
      const state = useChatStore.getState();
      const tool = state.toolExecutions.get(toolUseId);

      expect(tool).toBeDefined();
      expect(tool?.durationMs).toBe(1250);
      expect(tool?.status).toBe('completed');
    });
  });

  describe('TE-7: Correlate tool_use and tool_result via toolUseId', () => {
    it('should correctly match tool_use and tool_result by toolUseId', () => {
      // Create tool_use with specific data
      const toolUseId = 'toolu_correlation789';
      const toolUse = AgentEventFactory.toolUse({
        toolUseId,
        toolName: 'create_customer',
        args: {
          name: 'New Corp',
          email: 'info@newcorp.com',
          phone: '555-1234',
        },
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Verify initial state
      let state = useChatStore.getState();
      let tool = state.toolExecutions.get(toolUseId);

      expect(tool?.id).toBe(toolUseId);
      expect(tool?.toolName).toBe('create_customer');
      expect(tool?.args).toEqual({
        name: 'New Corp',
        email: 'info@newcorp.com',
        phone: '555-1234',
      });
      expect(tool?.status).toBe('running');
      expect(tool?.result).toBeUndefined();

      // Create tool_result with same toolUseId
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        toolName: 'create_customer',
        success: true,
        result: {
          customerId: 'CUST-99887',
          name: 'New Corp',
          created: true,
        },
        durationMs: 340,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify correlation and final state
      state = useChatStore.getState();
      tool = state.toolExecutions.get(toolUseId);

      // Verify correlation: same ID, same toolName, original args preserved, result added
      expect(tool?.id).toBe(toolUseId);
      expect(tool?.toolName).toBe('create_customer');
      expect(tool?.args).toEqual({
        name: 'New Corp',
        email: 'info@newcorp.com',
        phone: '555-1234',
      });
      expect(tool?.status).toBe('completed');
      expect(tool?.result).toEqual({
        customerId: 'CUST-99887',
        name: 'New Corp',
        created: true,
      });
      expect(tool?.durationMs).toBe(340);
      expect(tool?.completedAt).toBeInstanceOf(Date);
    });
  });
});
