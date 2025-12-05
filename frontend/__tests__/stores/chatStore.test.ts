/**
 * Chat Store Tests
 *
 * Unit tests for the chat store and its selectors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useChatStore,
  selectAllMessages,
  selectPendingApprovals,
  // selectToolExecutions removed - tool executions now tracked in messages array
} from '../../lib/stores/chatStore';
import type { Message } from '../../lib/services/api';
import type { AgentEvent } from '@bc-agent/shared';

describe('ChatStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useChatStore.setState({
        messages: [],
        optimisticMessages: new Map(),
        streaming: {
          content: '',
          thinking: '',
          isStreaming: false,
          capturedThinking: null,
        },
        pendingApprovals: new Map(),
        // toolExecutions removed - now tracked in messages array
        isLoading: false,
        isAgentBusy: false,
        error: null,
        currentSessionId: null,
      });
    });
  });

  describe('Message Management', () => {
    it('should add messages and sort by sequence number', () => {
      const msg1: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 2,
        created_at: '2024-01-01T00:00:00Z',
      };
      const msg2: Message = {
        type: 'standard',
        id: 'msg-2',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Hi there!',
        sequence_number: 1,
        created_at: '2024-01-01T00:00:01Z',
      };

      act(() => {
        useChatStore.getState().addMessage(msg1);
        useChatStore.getState().addMessage(msg2);
      });

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      // Should be sorted by sequence_number
      expect(state.messages[0]?.sequence_number).toBe(1);
      expect(state.messages[1]?.sequence_number).toBe(2);
    });

    it('should handle optimistic messages', () => {
      const tempId = 'temp-123';
      const optimisticMsg: Message = {
        type: 'standard',
        id: tempId,
        session_id: 'session-1',
        role: 'user',
        content: 'Optimistic message',
        sequence_number: 999,
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        useChatStore.getState().addOptimisticMessage(tempId, optimisticMsg);
      });

      let state = useChatStore.getState();
      expect(state.optimisticMessages.has(tempId)).toBe(true);

      // Confirm the optimistic message
      const confirmedMsg: Message = {
        ...optimisticMsg,
        id: 'real-msg-id',
        sequence_number: 5,
      };

      act(() => {
        useChatStore.getState().confirmOptimisticMessage(tempId, confirmedMsg);
      });

      state = useChatStore.getState();
      expect(state.optimisticMessages.has(tempId)).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.id).toBe('real-msg-id');
    });
  });

  describe('Streaming', () => {
    it('should handle streaming state', () => {
      act(() => {
        useChatStore.getState().startStreaming('msg-123');
      });

      let state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.messageId).toBe('msg-123');
      expect(state.isAgentBusy).toBe(true);

      act(() => {
        useChatStore.getState().appendStreamContent('Hello');
        useChatStore.getState().appendStreamContent(' World');
      });

      state = useChatStore.getState();
      expect(state.streaming.content).toBe('Hello World');

      act(() => {
        useChatStore.getState().appendThinkingContent('Thinking...');
      });

      state = useChatStore.getState();
      expect(state.streaming.thinking).toBe('Thinking...');

      act(() => {
        useChatStore.getState().endStreaming();
      });

      state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(false);
      expect(state.isAgentBusy).toBe(false);
    });

    it('should clear streaming state', () => {
      act(() => {
        useChatStore.getState().startStreaming();
        useChatStore.getState().appendStreamContent('Some content');
        useChatStore.getState().clearStreaming();
      });

      const state = useChatStore.getState();
      expect(state.streaming.content).toBe('');
      expect(state.streaming.isStreaming).toBe(false);
    });
  });

  describe('Approvals', () => {
    it('should add and remove pending approvals', () => {
      const approval = {
        id: 'approval-1',
        toolName: 'update_customer',
        args: { customerId: '123' },
        changeSummary: 'Update customer 123',
        priority: 'high' as const,
        createdAt: new Date(),
      };

      act(() => {
        useChatStore.getState().addPendingApproval(approval);
      });

      let state = useChatStore.getState();
      expect(state.pendingApprovals.has('approval-1')).toBe(true);

      act(() => {
        useChatStore.getState().removePendingApproval('approval-1');
      });

      state = useChatStore.getState();
      expect(state.pendingApprovals.has('approval-1')).toBe(false);
    });
  });

  describe('Tool Executions', () => {
    it('should track tool executions via messages', () => {
      // Tool executions are now tracked as messages with type 'tool_use'
      const toolUseEvent: AgentEvent = {
        type: 'tool_use',
        toolName: 'list_customers',
        toolUseId: 'tool-1',
        args: {},
        eventId: 'evt-tool-1',
        timestamp: new Date(),
        persistenceState: 'persisted',
        sequenceNumber: 1,
        sessionId: 'session-1',
      };

      act(() => {
        useChatStore.getState().handleAgentEvent(toolUseEvent);
      });

      let state = useChatStore.getState();
      const toolMessages = state.messages.filter(m => m.type === 'tool_use');
      expect(toolMessages).toHaveLength(1);

      // Type guard to safely access tool_use message properties
      const toolMsg = toolMessages[0];
      if (toolMsg && toolMsg.type === 'tool_use') {
        expect(toolMsg.tool_name).toBe('list_customers');
        expect(toolMsg.status).toBe('pending');
      }

      // Update tool with result
      const toolResultEvent: AgentEvent = {
        type: 'tool_result',
        toolName: 'list_customers',
        success: true,
        result: { customers: [] },
        durationMs: 100,
        eventId: 'evt-result-1',
        timestamp: new Date(),
        persistenceState: 'persisted',
        sequenceNumber: 2,
        sessionId: 'session-1',
        toolUseId: 'tool-1',
      };

      act(() => {
        useChatStore.getState().handleAgentEvent(toolResultEvent);
      });

      state = useChatStore.getState();
      const updatedToolMessage = state.messages.find(
        m => m.type === 'tool_use' && m.tool_use_id === 'tool-1'
      );

      // Type guard to safely access properties
      if (updatedToolMessage && updatedToolMessage.type === 'tool_use') {
        expect(updatedToolMessage.status).toBe('success');
        expect(updatedToolMessage.result).toEqual({ customers: [] });
      }
    });
  });

  describe('Agent Event Handling', () => {
    it('should handle message_chunk events', () => {
      const event: AgentEvent = {
        type: 'message_chunk',
        content: 'Hello',
        eventId: 'evt-1',
        timestamp: new Date(),
        persistenceState: 'transient',
      };

      act(() => {
        useChatStore.getState().handleAgentEvent(event);
      });

      const state = useChatStore.getState();
      expect(state.streaming.isStreaming).toBe(true);
      expect(state.streaming.content).toBe('Hello');
    });

    it('should handle thinking_chunk events', () => {
      const event: AgentEvent = {
        type: 'thinking_chunk',
        content: 'Let me think...',
        eventId: 'evt-1',
        timestamp: new Date(),
        persistenceState: 'transient',
      };

      act(() => {
        useChatStore.getState().handleAgentEvent(event);
      });

      const state = useChatStore.getState();
      expect(state.streaming.thinking).toBe('Let me think...');
    });

    it('should handle approval_requested events', () => {
      const event: AgentEvent = {
        type: 'approval_requested',
        approvalId: 'approval-1',
        toolName: 'update_customer',
        args: { id: '123' },
        changeSummary: 'Update customer',
        priority: 'high',
        eventId: 'evt-1',
        timestamp: new Date(),
        persistenceState: 'persisted',
      };

      act(() => {
        useChatStore.getState().handleAgentEvent(event);
      });

      const state = useChatStore.getState();
      expect(state.pendingApprovals.has('approval-1')).toBe(true);
    });

    it('should handle error events', () => {
      const event: AgentEvent = {
        type: 'error',
        error: 'Something went wrong',
        eventId: 'evt-1',
        timestamp: new Date(),
        persistenceState: 'transient',
      };

      act(() => {
        useChatStore.getState().startStreaming();
        useChatStore.getState().handleAgentEvent(event);
      });

      const state = useChatStore.getState();
      expect(state.error).toBe('Something went wrong');
      expect(state.streaming.isStreaming).toBe(false);
    });
  });

  describe('Selectors', () => {
    it('selectAllMessages should combine persisted and optimistic messages', () => {
      const msg1: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Hello',
        sequence_number: 1,
        created_at: '2024-01-01T00:00:00Z',
      };
      const optimisticMsg: Message = {
        type: 'standard',
        id: 'temp-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Hi',
        sequence_number: 2,
        created_at: '2024-01-01T00:00:01Z',
      };

      act(() => {
        useChatStore.getState().addMessage(msg1);
        useChatStore.getState().addOptimisticMessage('temp-1', optimisticMsg);
      });

      const allMessages = selectAllMessages(useChatStore.getState());
      expect(allMessages).toHaveLength(2);
      expect(allMessages[0]?.id).toBe('msg-1');
      expect(allMessages[1]?.id).toBe('temp-1');
    });

    it('selectPendingApprovals should return array of approvals', () => {
      act(() => {
        useChatStore.getState().addPendingApproval({
          id: 'a1',
          toolName: 'tool1',
          args: {},
          changeSummary: 'Change 1',
          priority: 'low',
          createdAt: new Date(),
        });
        useChatStore.getState().addPendingApproval({
          id: 'a2',
          toolName: 'tool2',
          args: {},
          changeSummary: 'Change 2',
          priority: 'high',
          createdAt: new Date(),
        });
      });

      const approvals = selectPendingApprovals(useChatStore.getState());
      expect(approvals).toHaveLength(2);
    });

    // selectToolExecutions removed - tool executions are now tracked as messages with type 'tool_use'
    // See 'Tool Executions' test suite above for message-based tool execution tests
  });
});
