/**
 * StreamProcessor Tests
 *
 * Unit tests for the stream processor that routes agent events to stores.
 * Tests cover all 16 event types defined in the backend contract.
 *
 * @module __tests__/domains/chat/services/streamProcessor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AgentEvent,
  ThinkingChunkEvent,
  ThinkingCompleteEvent,
  MessageChunkEvent,
  MessageEvent,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  CompleteEvent,
  Message,
  StandardMessage,
} from '@bc-agent/shared';

// Import the function to test
import {
  processAgentEvent,
  resetAllStores,
} from '../../../../src/domains/chat/services/streamProcessor';

// Import store getters for mocking
import { getMessageStore, resetMessageStore } from '../../../../src/domains/chat/stores/messageStore';
import { getStreamingStore, resetStreamingStore } from '../../../../src/domains/chat/stores/streamingStore';
import { getApprovalStore, resetApprovalStore } from '../../../../src/domains/chat/stores/approvalStore';

// Helper to create timestamps for events
const now = () => new Date().toISOString();

describe('StreamProcessor', () => {
  // Track callback invocations
  let callbacks: {
    onAgentBusyChange: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onCitationsReceived: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all stores before each test
    resetMessageStore();
    resetStreamingStore();
    resetApprovalStore();

    // Create fresh mock callbacks
    callbacks = {
      onAgentBusyChange: vi.fn(),
      onError: vi.fn(),
      onCitationsReceived: vi.fn(),
    };
  });

  // ============================================================================
  // session_start Event
  // ============================================================================

  describe('session_start', () => {
    it('should reset streaming store', () => {
      // First, put streaming store in non-initial state
      const streamingStore = getStreamingStore();
      streamingStore.getState().startStreaming();
      streamingStore.getState().appendMessageChunk(0, 'partial');

      expect(streamingStore.getState().isStreaming).toBe(true);

      // Process session_start
      const event: AgentEvent = {
        type: 'session_start',
        eventId: 'evt-1',
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      };

      processAgentEvent(event, callbacks);

      // Streaming store should be reset
      expect(streamingStore.getState().isStreaming).toBe(false);
      expect(streamingStore.getState().accumulatedContent).toBe('');
    });

    it('should call onAgentBusyChange(true)', () => {
      const event: AgentEvent = {
        type: 'session_start',
        eventId: 'evt-1',
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      };

      processAgentEvent(event, callbacks);

      expect(callbacks.onAgentBusyChange).toHaveBeenCalledTimes(1);
      expect(callbacks.onAgentBusyChange).toHaveBeenCalledWith(true);
    });
  });

  // ============================================================================
  // Thinking Events
  // ============================================================================

  describe('thinking events', () => {
    describe('thinking (legacy)', () => {
      it('should create thinking message placeholder', () => {
        const event: AgentEvent = {
          type: 'thinking',
          eventId: 'evt-thinking-1',
          sessionId: 'session-1',
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const messages = getMessageStore().getState().messages;
        expect(messages).toHaveLength(1);
        expect(messages[0]?.type).toBe('thinking');
        expect(messages[0]?.id).toBe('evt-thinking-1');
        const thinkingMsg = messages[0] as StandardMessage;
        expect(thinkingMsg.content).toBe('');
      });

      it('should start streaming if not already streaming', () => {
        const event: AgentEvent = {
          type: 'thinking',
          eventId: 'evt-thinking-1',
          sessionId: 'session-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        expect(getStreamingStore().getState().isStreaming).toBe(false);

        processAgentEvent(event, callbacks);

        expect(getStreamingStore().getState().isStreaming).toBe(true);
      });
    });

    describe('thinking_chunk', () => {
      it('should append thinking chunk with blockIndex', () => {
        const event: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Thinking about',
          blockIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };

        processAgentEvent(event, callbacks);

        const state = getStreamingStore().getState();
        expect(state.isStreaming).toBe(true);
        expect(state.accumulatedThinking).toBe('Thinking about');
        expect(state.thinkingBlocks.get(0)).toBe('Thinking about');
      });

      it('should accumulate multiple chunks in same block', () => {
        const event1: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'First ',
          blockIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        const event2: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-2',
          sessionId: 'session-1',
          content: 'second',
          blockIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };

        processAgentEvent(event1, callbacks);
        processAgentEvent(event2, callbacks);

        const state = getStreamingStore().getState();
        expect(state.thinkingBlocks.get(0)).toBe('First second');
      });

      it('should support multiple blocks (multi-block thinking)', () => {
        const event1: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Block 0',
          blockIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        const event2: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-2',
          sessionId: 'session-1',
          content: 'Block 1',
          blockIndex: 1,
          timestamp: now(),
          persistenceState: 'transient',
        };

        processAgentEvent(event1, callbacks);
        processAgentEvent(event2, callbacks);

        const state = getStreamingStore().getState();
        expect(state.thinkingBlocks.get(0)).toBe('Block 0');
        expect(state.thinkingBlocks.get(1)).toBe('Block 1');
      });

      it('should update thinking message in messageStore if exists', () => {
        // First create a thinking message
        const thinkingEvent: AgentEvent = {
          type: 'thinking',
          eventId: 'think-msg-1',
          sessionId: 'session-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(thinkingEvent, callbacks);

        // Then send chunk
        const chunkEvent: ThinkingChunkEvent = {
          type: 'thinking_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Reasoning...',
          blockIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        const messages = getMessageStore().getState().messages;
        const thinkingMsg = messages.find(m => m.type === 'thinking') as StandardMessage | undefined;
        expect(thinkingMsg?.content).toBe('Reasoning...');
      });
    });

    describe('thinking_complete', () => {
      it('should finalize thinking message with final content', () => {
        // Setup: Create thinking message first
        const thinkingEvent: AgentEvent = {
          type: 'thinking',
          eventId: 'think-msg-1',
          sessionId: 'session-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(thinkingEvent, callbacks);

        // Complete event
        const completeEvent: ThinkingCompleteEvent = {
          type: 'thinking_complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          content: 'Final thinking content after analysis.',
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(completeEvent, callbacks);

        const messages = getMessageStore().getState().messages;
        const thinkingMsg = messages.find(m => m.type === 'thinking') as StandardMessage | undefined;
        expect(thinkingMsg?.content).toBe('Final thinking content after analysis.');
      });
    });
  });

  // ============================================================================
  // Message Events
  // ============================================================================

  describe('message events', () => {
    describe('message_chunk', () => {
      it('should append message chunk with eventIndex', () => {
        const event: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Hello',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };

        processAgentEvent(event, callbacks);

        const state = getStreamingStore().getState();
        expect(state.isStreaming).toBe(true);
        expect(state.accumulatedContent).toBe('Hello');
        expect(state.messageChunks.get(0)).toBe('Hello');
      });

      it('should accumulate multiple chunks in order', () => {
        const event1: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Hello ',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        const event2: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-2',
          sessionId: 'session-1',
          content: 'World',
          eventIndex: 1,
          timestamp: now(),
          persistenceState: 'transient',
        };

        processAgentEvent(event1, callbacks);
        processAgentEvent(event2, callbacks);

        const state = getStreamingStore().getState();
        expect(state.accumulatedContent).toBe('Hello World');
      });

      it('should ignore late chunks after complete (Gap #6)', () => {
        // Start streaming
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Original',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        // Mark complete
        const completeEvent: CompleteEvent = {
          type: 'complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          reason: 'success',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(completeEvent, callbacks);

        // Try to send late chunk
        const lateChunk: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-late',
          sessionId: 'session-1',
          content: 'Late chunk',
          eventIndex: 1,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(lateChunk, callbacks);

        // Late chunk should be ignored
        const state = getStreamingStore().getState();
        expect(state.messageChunks.size).toBe(1);
        expect(state.accumulatedContent).toBe('Original');
      });
    });

    describe('message', () => {
      it('should create final message in messageStore', () => {
        const event: MessageEvent = {
          type: 'message',
          eventId: 'evt-msg',
          sessionId: 'session-1',
          messageId: 'msg-123',
          role: 'assistant',
          content: 'Hello, I am Claude.',
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const messages = getMessageStore().getState().messages;
        expect(messages).toHaveLength(1);
        expect(messages[0]?.id).toBe('msg-123');
        const msg = messages[0] as StandardMessage;
        expect(msg.content).toBe('Hello, I am Claude.');
        expect(msg.role).toBe('assistant');
        expect(msg.sequence_number).toBe(1);
      });

      it('should include token usage in final message', () => {
        const event: MessageEvent = {
          type: 'message',
          eventId: 'evt-msg',
          sessionId: 'session-1',
          messageId: 'msg-123',
          role: 'assistant',
          content: 'Response',
          sequenceNumber: 1,
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
          },
          model: 'claude-3-5-sonnet-20241022',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const messages = getMessageStore().getState().messages;
        const msg = messages[0] as StandardMessage & { token_usage?: { input_tokens: number; output_tokens: number }; model?: string };
        expect(msg.token_usage).toEqual({
          input_tokens: 100,
          output_tokens: 50,
        });
        expect(msg.model).toBe('claude-3-5-sonnet-20241022');
      });

      it('should mark streaming complete', () => {
        // Start streaming first
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Partial',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);
        expect(getStreamingStore().getState().isStreaming).toBe(true);

        // Final message
        const event: MessageEvent = {
          type: 'message',
          eventId: 'evt-msg',
          sessionId: 'session-1',
          messageId: 'msg-123',
          role: 'assistant',
          content: 'Final',
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(event, callbacks);

        expect(getStreamingStore().getState().isComplete).toBe(true);
      });
    });
  });

  // ============================================================================
  // user_message_confirmed Event
  // ============================================================================

  describe('user_message_confirmed', () => {
    it('should confirm optimistic message by exact tempId match', () => {
      // Add optimistic message
      getMessageStore().getState().addOptimisticMessage('optimistic-evt-user-1', {
        type: 'standard',
        id: 'temp-id',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello agent',
        sequence_number: 0,
        created_at: new Date().toISOString(),
      });

      // Confirm it
      const event = {
        type: 'user_message_confirmed' as const,
        eventId: 'evt-user-1',
        sessionId: 'session-1',
        messageId: 'real-msg-id',
        content: 'Hello agent',
        sequenceNumber: 5,
      };

      processAgentEvent(event as AgentEvent, callbacks);

      const state = getMessageStore().getState();
      expect(state.optimisticMessages.size).toBe(0);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.id).toBe('real-msg-id');
      expect(state.messages[0]?.sequence_number).toBe(5);
    });

    it('should confirm by content+timestamp fallback when tempId mismatch (Gap #4)', () => {
      // Add optimistic message with different ID format
      const content = 'Hello agent';
      getMessageStore().getState().addOptimisticMessage('different-temp-id', {
        type: 'standard',
        id: 'different-temp-id',
        session_id: 'session-1',
        role: 'user',
        content,
        sequence_number: 0,
        created_at: new Date().toISOString(),
      });

      // Confirm with non-matching ID
      const event = {
        type: 'user_message_confirmed' as const,
        eventId: 'evt-user-1',
        sessionId: 'session-1',
        messageId: 'real-msg-id',
        content,
        sequenceNumber: 5,
      };

      processAgentEvent(event as AgentEvent, callbacks);

      // Should find by content matching (within 5s window)
      const state = getMessageStore().getState();
      expect(state.optimisticMessages.size).toBe(0);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.id).toBe('real-msg-id');
    });
  });

  // ============================================================================
  // Tool Events
  // ============================================================================

  describe('tool events', () => {
    describe('tool_use', () => {
      it('should create tool_use message with pending status', () => {
        const event: ToolUseEvent = {
          type: 'tool_use',
          eventId: 'evt-tool-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_abc123',
          toolName: 'search_knowledge',
          args: { query: 'test query' },
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const messages = getMessageStore().getState().messages;
        expect(messages).toHaveLength(1);

        const toolMsg = messages[0] as Message & {
          tool_name: string;
          tool_args: Record<string, unknown>;
          tool_use_id: string;
          status: string;
        };
        expect(toolMsg.type).toBe('tool_use');
        expect(toolMsg.tool_name).toBe('search_knowledge');
        expect(toolMsg.tool_args).toEqual({ query: 'test query' });
        expect(toolMsg.tool_use_id).toBe('toolu_abc123');
        expect(toolMsg.status).toBe('pending');
      });
    });

    describe('tool_result', () => {
      it('should update tool_use on success', () => {
        // First, create tool_use
        const toolUseEvent: ToolUseEvent = {
          type: 'tool_use',
          eventId: 'evt-tool-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_abc123',
          toolName: 'search',
          args: {},
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(toolUseEvent, callbacks);

        // Then, send result
        const resultEvent: ToolResultEvent = {
          type: 'tool_result',
          eventId: 'evt-result-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_abc123',
          toolName: 'search',
          success: true,
          result: { data: 'found results' },
          durationMs: 150,
          sequenceNumber: 2,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(resultEvent, callbacks);

        const messages = getMessageStore().getState().messages;
        const toolMsg = messages[0] as Message & {
          status: string;
          result: unknown;
          duration_ms: number;
        };
        expect(toolMsg.status).toBe('success');
        expect(toolMsg.result).toEqual({ data: 'found results' });
        expect(toolMsg.duration_ms).toBe(150);
      });

      it('should update tool_use on error', () => {
        // First, create tool_use
        const toolUseEvent: ToolUseEvent = {
          type: 'tool_use',
          eventId: 'evt-tool-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_error',
          toolName: 'search',
          args: {},
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(toolUseEvent, callbacks);

        // Then, send error result
        const resultEvent: ToolResultEvent = {
          type: 'tool_result',
          eventId: 'evt-result-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_error',
          toolName: 'search',
          success: false,
          result: null,
          error: 'Connection timeout',
          durationMs: 5000,
          sequenceNumber: 2,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(resultEvent, callbacks);

        const messages = getMessageStore().getState().messages;
        const toolMsg = messages[0] as Message & {
          status: string;
          error_message: string;
        };
        expect(toolMsg.status).toBe('error');
        expect(toolMsg.error_message).toBe('Connection timeout');
      });

      it('should handle missing tool_use gracefully', () => {
        // Send result without corresponding tool_use
        const resultEvent: ToolResultEvent = {
          type: 'tool_result',
          eventId: 'evt-result-1',
          sessionId: 'session-1',
          toolUseId: 'nonexistent',
          toolName: 'unknown',
          success: true,
          result: {},
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };

        // Should not throw
        expect(() => processAgentEvent(resultEvent, callbacks)).not.toThrow();

        // No messages should be modified
        expect(getMessageStore().getState().messages).toHaveLength(0);
      });

      it('should use correlationId as fallback for toolUseId', () => {
        // Create tool_use
        const toolUseEvent: ToolUseEvent = {
          type: 'tool_use',
          eventId: 'evt-tool-1',
          sessionId: 'session-1',
          toolUseId: 'toolu_correlation',
          toolName: 'search',
          args: {},
          sequenceNumber: 1,
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(toolUseEvent, callbacks);

        // Send result with correlationId instead of toolUseId
        const resultEvent = {
          type: 'tool_result' as const,
          eventId: 'evt-result-1',
          sessionId: 'session-1',
          correlationId: 'toolu_correlation', // Using correlationId
          toolName: 'search',
          success: true,
          result: { data: 'found' },
          sequenceNumber: 2,
          timestamp: now(),
          persistenceState: 'persisted' as const,
        };
        processAgentEvent(resultEvent as unknown as AgentEvent, callbacks);

        const messages = getMessageStore().getState().messages;
        const toolMsg = messages[0] as Message & { status: string };
        expect(toolMsg.status).toBe('success');
      });
    });
  });

  // ============================================================================
  // Approval Events
  // ============================================================================

  describe('approval events', () => {
    describe('approval_requested', () => {
      it('should add approval to approvalStore', () => {
        const event: ApprovalRequestedEvent = {
          type: 'approval_requested',
          eventId: 'evt-approval-1',
          sessionId: 'session-1',
          approvalId: 'approval-123',
          toolName: 'delete_file',
          args: { path: '/important.txt' },
          changeSummary: 'Delete important.txt',
          priority: 'high',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const state = getApprovalStore().getState();
        expect(state.pendingApprovals.size).toBe(1);
        expect(state.pendingApprovals.has('approval-123')).toBe(true);

        const approval = state.pendingApprovals.get('approval-123');
        expect(approval?.toolName).toBe('delete_file');
        expect(approval?.priority).toBe('high');
        expect(approval?.changeSummary).toBe('Delete important.txt');
      });

      it('should include expiresAt if provided', () => {
        const expiresAt = new Date(Date.now() + 60000).toISOString();
        const event: ApprovalRequestedEvent = {
          type: 'approval_requested',
          eventId: 'evt-1',
          sessionId: 'session-1',
          approvalId: 'approval-456',
          toolName: 'modify_data',
          args: {},
          changeSummary: 'Modify data',
          priority: 'medium',
          expiresAt,
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(event, callbacks);

        const approval = getApprovalStore().getState().pendingApprovals.get('approval-456');
        expect(approval?.expiresAt).toBe(expiresAt);
      });
    });

    describe('approval_resolved', () => {
      it('should remove approval from approvalStore', () => {
        // First, add an approval
        const requestEvent: ApprovalRequestedEvent = {
          type: 'approval_requested',
          eventId: 'evt-1',
          sessionId: 'session-1',
          approvalId: 'approval-to-resolve',
          toolName: 'test',
          args: {},
          changeSummary: 'Test',
          priority: 'low',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(requestEvent, callbacks);
        expect(getApprovalStore().getState().pendingApprovals.size).toBe(1);

        // Then resolve it
        const resolveEvent = {
          type: 'approval_resolved' as const,
          eventId: 'evt-2',
          sessionId: 'session-1',
          approvalId: 'approval-to-resolve',
          timestamp: now(),
          persistenceState: 'persisted' as const,
        };
        processAgentEvent(resolveEvent as AgentEvent, callbacks);

        expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
      });
    });
  });

  // ============================================================================
  // Error and Complete Events
  // ============================================================================

  describe('error/complete events', () => {
    describe('error', () => {
      it('should mark streaming complete', () => {
        // Start streaming
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Partial',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);
        expect(getStreamingStore().getState().isStreaming).toBe(true);

        // Error event
        const errorEvent = {
          type: 'error' as const,
          eventId: 'evt-error',
          sessionId: 'session-1',
          error: 'Something went wrong',
          timestamp: now(),
          persistenceState: 'persisted' as const,
        };
        processAgentEvent(errorEvent as AgentEvent, callbacks);

        expect(getStreamingStore().getState().isComplete).toBe(true);
      });

      it('should call onError callback', () => {
        const errorEvent = {
          type: 'error' as const,
          eventId: 'evt-error',
          sessionId: 'session-1',
          error: 'API rate limit exceeded',
          timestamp: now(),
          persistenceState: 'persisted' as const,
        };

        processAgentEvent(errorEvent as AgentEvent, callbacks);

        expect(callbacks.onError).toHaveBeenCalledTimes(1);
        expect(callbacks.onError).toHaveBeenCalledWith('API rate limit exceeded');
      });
    });

    describe('complete', () => {
      it('should mark streaming complete', () => {
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Response',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        const completeEvent: CompleteEvent = {
          type: 'complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          reason: 'success',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(completeEvent, callbacks);

        expect(getStreamingStore().getState().isComplete).toBe(true);
      });

      it('should call onAgentBusyChange(false)', () => {
        const completeEvent: CompleteEvent = {
          type: 'complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          reason: 'success',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(completeEvent, callbacks);

        expect(callbacks.onAgentBusyChange).toHaveBeenCalledWith(false);
      });

      it('should pass citations to callback', () => {
        const completeEvent: CompleteEvent = {
          type: 'complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          reason: 'success',
          citedFiles: [
            { fileName: 'doc.pdf', fileId: 'file-123' },
            { fileName: 'report.xlsx', fileId: 'file-456' },
          ],
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(completeEvent, callbacks);

        expect(callbacks.onCitationsReceived).toHaveBeenCalledTimes(1);
        const citationMap = callbacks.onCitationsReceived.mock.calls[0]?.[0];
        expect(citationMap?.get('doc.pdf')).toBe('file-123');
        expect(citationMap?.get('report.xlsx')).toBe('file-456');
      });

      it('should pass empty map when citedFiles is empty array', () => {
        const completeEvent: CompleteEvent = {
          type: 'complete',
          eventId: 'evt-complete',
          sessionId: 'session-1',
          reason: 'success',
          citedFiles: [],
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(completeEvent, callbacks);

        expect(callbacks.onCitationsReceived).toHaveBeenCalledTimes(1);
        const citationMap = callbacks.onCitationsReceived.mock.calls[0]?.[0];
        expect(citationMap?.size).toBe(0);
      });
    });
  });

  // ============================================================================
  // Session Lifecycle Events
  // ============================================================================

  describe('session lifecycle', () => {
    describe('session_end', () => {
      it('should mark streaming complete', () => {
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Partial',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        const endEvent: AgentEvent = {
          type: 'session_end',
          eventId: 'evt-end',
          sessionId: 'session-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(endEvent, callbacks);

        expect(getStreamingStore().getState().isComplete).toBe(true);
      });

      it('should call onAgentBusyChange(false)', () => {
        const endEvent: AgentEvent = {
          type: 'session_end',
          eventId: 'evt-end',
          sessionId: 'session-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(endEvent, callbacks);

        expect(callbacks.onAgentBusyChange).toHaveBeenCalledWith(false);
      });
    });

    describe('turn_paused (Gap #7 Fix)', () => {
      it('should set paused state without marking complete', () => {
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Partial',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        const pausedEvent: AgentEvent = {
          type: 'turn_paused',
          eventId: 'evt-paused',
          sessionId: 'session-1',
          messageId: 'msg-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(pausedEvent, callbacks);

        const state = getStreamingStore().getState();
        // Gap #7: turn_paused sets isPaused, NOT isComplete
        expect(state.isPaused).toBe(true);
        expect(state.isComplete).toBe(false);
        expect(state.isStreaming).toBe(false);
        // Note: turn_paused does NOT call onAgentBusyChange
        expect(callbacks.onAgentBusyChange).not.toHaveBeenCalled();
      });

      it('should capture pause reason from event', () => {
        const pausedEvent = {
          type: 'turn_paused' as const,
          eventId: 'evt-paused',
          sessionId: 'session-1',
          messageId: 'msg-1',
          reason: 'waiting_for_approval',
          timestamp: now(),
          persistenceState: 'persisted' as const,
        };
        processAgentEvent(pausedEvent as AgentEvent, callbacks);

        const state = getStreamingStore().getState();
        expect(state.isPaused).toBe(true);
        expect(state.pauseReason).toBe('waiting_for_approval');
      });
    });

    describe('content_refused', () => {
      it('should call onError with policy message', () => {
        const refusedEvent: AgentEvent = {
          type: 'content_refused',
          eventId: 'evt-refused',
          sessionId: 'session-1',
          messageId: 'msg-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };

        processAgentEvent(refusedEvent, callbacks);

        expect(callbacks.onError).toHaveBeenCalledWith('Content was refused due to policy violation');
      });

      it('should mark streaming complete', () => {
        const chunkEvent: MessageChunkEvent = {
          type: 'message_chunk',
          eventId: 'evt-1',
          sessionId: 'session-1',
          content: 'Partial',
          eventIndex: 0,
          timestamp: now(),
          persistenceState: 'transient',
        };
        processAgentEvent(chunkEvent, callbacks);

        const refusedEvent: AgentEvent = {
          type: 'content_refused',
          eventId: 'evt-refused',
          sessionId: 'session-1',
          messageId: 'msg-1',
          timestamp: now(),
          persistenceState: 'persisted',
        };
        processAgentEvent(refusedEvent, callbacks);

        expect(getStreamingStore().getState().isComplete).toBe(true);
      });
    });
  });

  // ============================================================================
  // resetAllStores
  // ============================================================================

  describe('resetAllStores', () => {
    it('should reset all three stores to initial state', () => {
      // Populate all stores
      getMessageStore().getState().addMessage({
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 1,
        created_at: new Date().toISOString(),
      });

      getStreamingStore().getState().startStreaming();
      getStreamingStore().getState().appendMessageChunk(0, 'Streaming');

      getApprovalStore().getState().addPendingApproval({
        id: 'approval-1',
        toolName: 'test',
        args: {},
        changeSummary: 'Test',
        priority: 'low',
        createdAt: new Date(),
      });

      // Verify not empty
      expect(getMessageStore().getState().messages).toHaveLength(1);
      expect(getStreamingStore().getState().isStreaming).toBe(true);
      expect(getApprovalStore().getState().pendingApprovals.size).toBe(1);

      // Reset all
      resetAllStores();

      // Verify all reset
      expect(getMessageStore().getState().messages).toHaveLength(0);
      expect(getStreamingStore().getState().isStreaming).toBe(false);
      expect(getStreamingStore().getState().accumulatedContent).toBe('');
      expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should work without callbacks', () => {
      const event: AgentEvent = {
        type: 'session_start',
        eventId: 'evt-1',
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      };

      // Should not throw when callbacks is undefined
      expect(() => processAgentEvent(event)).not.toThrow();
    });

    it('should handle unknown event types gracefully', () => {
      const unknownEvent = {
        type: 'unknown_event_type',
        eventId: 'evt-unknown',
        sessionId: 'session-1',
        timestamp: now(),
        persistenceState: 'persisted' as const,
      } as unknown as AgentEvent;

      // Should not throw
      expect(() => processAgentEvent(unknownEvent, callbacks)).not.toThrow();
    });

    it('should handle events with missing optional fields', () => {
      // Using type assertion to test runtime behavior with minimal fields
      const minimalEvent = {
        type: 'message_chunk',
        eventId: 'evt-1',
        content: 'Content',
        timestamp: now(),
        persistenceState: 'transient',
        // No sessionId, no eventIndex
      } as MessageChunkEvent;

      expect(() => processAgentEvent(minimalEvent, callbacks)).not.toThrow();
      expect(getStreamingStore().getState().accumulatedContent).toBe('Content');
    });
  });
});
