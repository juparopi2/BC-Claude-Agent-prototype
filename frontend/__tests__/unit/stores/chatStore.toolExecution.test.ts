/**
 * Chat Store - Tool Execution Tests (Message-Based)
 *
 * Unit tests for tool execution lifecycle in the chat store.
 * Tests the complete flow from tool_use -> tool_result via messages array.
 *
 * Tool executions are now tracked as messages with type 'tool_use' in the messages array.
 * This replaces the obsolete toolExecutions Map approach.
 *
 * @module __tests__/unit/stores/chatStore.toolExecution.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useChatStore } from '@/lib/stores/chatStore';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';
import type { Message, ToolUseMessage } from '@bc-agent/shared';

/**
 * Type guard to check if a message is a ToolUseMessage
 */
function isToolUseMessage(msg: Message): msg is ToolUseMessage {
  return msg.type === 'tool_use';
}

describe('ChatStore - Tool Execution Lifecycle (Messages-Based)', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useChatStore.getState().reset();
    });
    // Reset sequence counter for consistent event IDs
    AgentEventFactory.resetSequence();
  });

  describe('TE-1: Add tool_use message on tool_use event', () => {
    it('should add tool_use message to messages array with status "pending"', () => {
      // Create tool_use event
      const toolUse = AgentEventFactory.toolUse({
        toolName: 'list_customers',
        toolUseId: 'toolu_test001',
        args: { filter: 'active', limit: 10 },
      });

      // Handle the event
      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Verify tool_use message is added
      const state = useChatStore.getState();
      const toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === 'toolu_test001'
      );

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.tool_name).toBe('list_customers');
      expect(toolMessage?.status).toBe('pending');
      expect(toolMessage?.tool_args).toEqual({ filter: 'active', limit: 10 });
      expect(toolMessage?.tool_use_id).toBe('toolu_test001');
      expect(toolMessage?.role).toBe('assistant');
      expect(toolMessage?.result).toBeUndefined();
      expect(toolMessage?.error_message).toBeUndefined();
    });

    it('should store tool_use message with correct sequence_number', () => {
      const toolUse = AgentEventFactory.toolUse({
        toolName: 'get_customer',
        toolUseId: 'toolu_seq001',
        args: { id: '12345' },
        sequenceNumber: 42,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      const state = useChatStore.getState();
      const toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === 'toolu_seq001'
      );

      expect(toolMessage?.sequence_number).toBe(42);
    });
  });

  describe('TE-2: Update tool_use message on tool_result (success)', () => {
    it('should update existing tool_use message with status "success" and result', () => {
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

      // Verify initial state
      let state = useChatStore.getState();
      let toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage?.status).toBe('pending');
      expect(toolMessage?.result).toBeUndefined();

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

      // Verify tool_use message is updated
      state = useChatStore.getState();
      toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.status).toBe('success');
      expect(toolMessage?.result).toEqual({
        id: '12345',
        name: 'Acme Corp',
        email: 'contact@acme.com',
      });
      expect(toolMessage?.error_message).toBeUndefined();
      expect(toolMessage?.duration_ms).toBe(245);
    });
  });

  describe('TE-3: Update tool_use message on tool_result (failure)', () => {
    it('should update existing tool_use message with status "error" and error_message', () => {
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

      // Verify initial state
      let state = useChatStore.getState();
      let toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage?.status).toBe('pending');

      // Create failed tool_result
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        toolName: 'delete_customer',
        success: false,
        result: undefined,
        error: 'Customer not found: 99999',
        durationMs: 120,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify tool_use message is updated with error
      state = useChatStore.getState();
      toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.status).toBe('error');
      expect(toolMessage?.error_message).toBe('Customer not found: 99999');
      expect(toolMessage?.result).toBeUndefined();
      expect(toolMessage?.duration_ms).toBe(120);
    });
  });

  describe('TE-4: Track multiple concurrent tools', () => {
    it('should track all 3 tools as separate messages with status "pending"', () => {
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

      // Verify all 3 are tracked as separate messages
      const state = useChatStore.getState();
      const toolMessages = state.messages.filter(isToolUseMessage);

      expect(toolMessages).toHaveLength(3);

      // Verify each tool individually
      const toolAMessage = toolMessages.find(m => m.tool_use_id === 'toolu_a001');
      expect(toolAMessage?.tool_name).toBe('list_customers');
      expect(toolAMessage?.status).toBe('pending');

      const toolBMessage = toolMessages.find(m => m.tool_use_id === 'toolu_b002');
      expect(toolBMessage?.tool_name).toBe('get_sales_order');
      expect(toolBMessage?.status).toBe('pending');

      const toolCMessage = toolMessages.find(m => m.tool_use_id === 'toolu_c003');
      expect(toolCMessage?.tool_name).toBe('list_items');
      expect(toolCMessage?.status).toBe('pending');
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
      const toolMessages = state.messages.filter(isToolUseMessage);

      const toolAMessage = toolMessages.find(m => m.tool_use_id === 'toolu_a001');
      expect(toolAMessage?.status).toBe('success');
      expect(toolAMessage?.result).toEqual({ data: 'result_a' });

      const toolBMessage = toolMessages.find(m => m.tool_use_id === 'toolu_b002');
      expect(toolBMessage?.status).toBe('success');
      expect(toolBMessage?.result).toEqual({ data: 'result_b' });

      const toolCMessage = toolMessages.find(m => m.tool_use_id === 'toolu_c003');
      expect(toolCMessage?.status).toBe('success');
      expect(toolCMessage?.result).toEqual({ data: 'result_c' });
    });
  });

  describe('TE-6: Track execution duration', () => {
    it('should store duration_ms correctly from tool_result', () => {
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

      // Verify duration is stored in the message
      const state = useChatStore.getState();
      const toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage).toBeDefined();
      expect(toolMessage?.duration_ms).toBe(1250);
      expect(toolMessage?.status).toBe('success');
    });
  });

  describe('TE-7: Correlate tool_use and tool_result via tool_use_id', () => {
    it('should correctly match tool_use and tool_result by tool_use_id', () => {
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
      let toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage?.tool_use_id).toBe(toolUseId);
      expect(toolMessage?.tool_name).toBe('create_customer');
      expect(toolMessage?.tool_args).toEqual({
        name: 'New Corp',
        email: 'info@newcorp.com',
        phone: '555-1234',
      });
      expect(toolMessage?.status).toBe('pending');
      expect(toolMessage?.result).toBeUndefined();

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
      toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      // Verify correlation: same tool_use_id, same toolName, original args preserved, result added
      expect(toolMessage?.tool_use_id).toBe(toolUseId);
      expect(toolMessage?.tool_name).toBe('create_customer');
      expect(toolMessage?.tool_args).toEqual({
        name: 'New Corp',
        email: 'info@newcorp.com',
        phone: '555-1234',
      });
      expect(toolMessage?.status).toBe('success');
      expect(toolMessage?.result).toEqual({
        customerId: 'CUST-99887',
        name: 'New Corp',
        created: true,
      });
      expect(toolMessage?.duration_ms).toBe(340);
    });
  });

  describe('TE-8: Handle tool_result for non-existent tool_use', () => {
    it('should gracefully handle tool_result with no matching tool_use message', () => {
      // Create tool_result for a tool_use that was never created
      const toolResult = AgentEventFactory.toolResult({
        toolUseId: 'toolu_nonexistent',
        toolName: 'phantom_tool',
        success: true,
        result: { data: 'result' },
        durationMs: 100,
      });

      // Should not throw error
      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify no tool_use message exists
      const state = useChatStore.getState();
      const toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === 'toolu_nonexistent'
      );

      expect(toolMessage).toBeUndefined();
    });
  });

  describe('TE-9: Preserve tool_args when updating with tool_result', () => {
    it('should not modify original tool_args when updating status', () => {
      const toolUseId = 'toolu_preserve_args';
      const originalArgs = {
        name: 'Test Corp',
        email: 'test@example.com',
        priority: 'high',
        tags: ['important', 'new']
      };

      // Create tool_use
      const toolUse = AgentEventFactory.toolUse({
        toolUseId,
        toolName: 'create_customer',
        args: originalArgs,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUse);
      });

      // Create tool_result
      const toolResult = AgentEventFactory.toolResult({
        toolUseId,
        toolName: 'create_customer',
        success: true,
        result: { customerId: 'CUST-001' },
        durationMs: 200,
      });

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResult);
      });

      // Verify args are preserved
      const state = useChatStore.getState();
      const toolMessage = state.messages.find(
        (m): m is ToolUseMessage =>
          m.type === 'tool_use' && m.tool_use_id === toolUseId
      );

      expect(toolMessage?.tool_args).toEqual(originalArgs);
      expect(toolMessage?.status).toBe('success');
    });
  });

  describe('TE-10: Mixed success and failure results', () => {
    it('should handle some tools succeeding and others failing', () => {
      // Create 3 tool_use events
      const tools = [
        { id: 'toolu_success', name: 'tool_success' },
        { id: 'toolu_fail', name: 'tool_fail' },
        { id: 'toolu_another', name: 'tool_another' },
      ];

      act(() => {
        tools.forEach(({ id, name }) => {
          useChatStore.getState().handleAgentEvent(
            AgentEventFactory.toolUse({
              toolUseId: id,
              toolName: name,
              args: {},
            })
          );
        });
      });

      // Create mixed results
      act(() => {
        // Success
        useChatStore.getState().handleAgentEvent(
          AgentEventFactory.toolResult({
            toolUseId: 'toolu_success',
            success: true,
            result: { data: 'success_data' },
            durationMs: 100,
          })
        );

        // Failure
        useChatStore.getState().handleAgentEvent(
          AgentEventFactory.toolResult({
            toolUseId: 'toolu_fail',
            success: false,
            error: 'Operation failed',
            durationMs: 50,
          })
        );

        // Success
        useChatStore.getState().handleAgentEvent(
          AgentEventFactory.toolResult({
            toolUseId: 'toolu_another',
            success: true,
            result: { data: 'another_data' },
            durationMs: 150,
          })
        );
      });

      // Verify states
      const state = useChatStore.getState();
      const toolMessages = state.messages.filter(isToolUseMessage);

      const successMsg = toolMessages.find(m => m.tool_use_id === 'toolu_success');
      expect(successMsg?.status).toBe('success');
      expect(successMsg?.result).toEqual({ data: 'success_data' });

      const failMsg = toolMessages.find(m => m.tool_use_id === 'toolu_fail');
      expect(failMsg?.status).toBe('error');
      expect(failMsg?.error_message).toBe('Operation failed');

      const anotherMsg = toolMessages.find(m => m.tool_use_id === 'toolu_another');
      expect(anotherMsg?.status).toBe('success');
      expect(anotherMsg?.result).toEqual({ data: 'another_data' });
    });
  });
});
