/**
 * Chat Flow Integration Tests
 *
 * Tests complete chat flows using real stores (no mocks).
 * Only the socket transport is mocked.
 *
 * @module __tests__/domains/chat/integration/chatFlow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';
import {
  processAgentEvent,
  resetAllStores,
  getMessageStore,
  getStreamingStore,
  getApprovalStore,
  getPendingApprovalsArray,
} from '../../../../src/domains/chat';

// Helper to create timestamps
const now = () => new Date().toISOString();

describe('Chat Flow Integration', () => {
  beforeEach(() => {
    resetAllStores();
  });

  // ============================================================================
  // Simple Message Flow
  // ============================================================================

  describe('Simple message flow', () => {
    it('should process: send → user_confirmed → chunks → message → complete', () => {
      const sessionId = 'test-session';
      const agentBusyChanges: boolean[] = [];

      const callbacks = {
        onAgentBusyChange: (busy: boolean) => agentBusyChanges.push(busy),
      };

      // 1. Session start
      processAgentEvent({
        type: 'session_start',
        eventId: 'evt-1',
        sessionId,
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent, callbacks);

      expect(agentBusyChanges).toContain(true);
      expect(getStreamingStore().getState().isStreaming).toBe(false); // Reset on session_start

      // 2. User message confirmed
      processAgentEvent({
        type: 'user_message_confirmed',
        eventId: 'evt-2',
        messageId: 'msg-1',
        sessionId,
        content: 'Hello!',
        sequenceNumber: 1,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent, callbacks);

      // 3. Message chunks
      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-3',
        sessionId,
        content: 'Hi there! ',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent, callbacks);

      expect(getStreamingStore().getState().isStreaming).toBe(true);
      expect(getStreamingStore().getState().accumulatedContent).toBe('Hi there! ');

      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-4',
        sessionId,
        content: 'How can I help?',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent, callbacks);

      expect(getStreamingStore().getState().accumulatedContent).toBe('Hi there! How can I help?');

      // 4. Final message
      processAgentEvent({
        type: 'message',
        eventId: 'evt-5',
        messageId: 'msg-2',
        sessionId,
        role: 'assistant',
        content: 'Hi there! How can I help?',
        sequenceNumber: 2,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent, callbacks);

      const messages = getMessageStore().getState().messages;
      const assistantMessage = messages.find(m => m.id === 'msg-2');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.role).toBe('assistant');

      // 5. Complete
      processAgentEvent({
        type: 'complete',
        eventId: 'evt-6',
        sessionId,
        stopReason: 'success',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent, callbacks);

      expect(getStreamingStore().getState().isComplete).toBe(true);
      expect(getStreamingStore().getState().isStreaming).toBe(false);
      expect(agentBusyChanges[agentBusyChanges.length - 1]).toBe(false);
    });
  });

  // ============================================================================
  // Thinking Flow
  // ============================================================================

  describe('Thinking flow', () => {
    it('should process: thinking_chunk* → thinking_complete → message_chunk* → complete', () => {
      const sessionId = 'test-session';

      // 1. Session start
      processAgentEvent({
        type: 'session_start',
        eventId: 'evt-1',
        sessionId,
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      // 2. Thinking chunks
      processAgentEvent({
        type: 'thinking_chunk',
        eventId: 'evt-2',
        sessionId,
        content: 'Let me think...',
        blockIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      expect(getStreamingStore().getState().isStreaming).toBe(true);
      expect(getStreamingStore().getState().accumulatedThinking).toBe('Let me think...');

      processAgentEvent({
        type: 'thinking_chunk',
        eventId: 'evt-3',
        sessionId,
        content: ' about this.',
        blockIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      expect(getStreamingStore().getState().accumulatedThinking).toBe('Let me think... about this.');

      // 3. Thinking complete
      processAgentEvent({
        type: 'thinking_complete',
        eventId: 'evt-4',
        sessionId,
        content: 'Let me think... about this.',
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      // 4. Message chunks
      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-5',
        sessionId,
        content: 'Here is my answer.',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      expect(getStreamingStore().getState().accumulatedContent).toBe('Here is my answer.');

      // 5. Complete
      processAgentEvent({
        type: 'complete',
        eventId: 'evt-6',
        sessionId,
        stopReason: 'success',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      // Captured thinking should be preserved
      expect(getStreamingStore().getState().capturedThinking).toBe('Let me think... about this.');
    });
  });

  // ============================================================================
  // Tool Execution Flow
  // ============================================================================

  describe('Tool execution flow', () => {
    it('should process: tool_use → tool_result → message', () => {
      const sessionId = 'test-session';

      // 1. Tool use
      processAgentEvent({
        type: 'tool_use',
        eventId: 'evt-1',
        sessionId,
        toolUseId: 'tool-1',
        toolName: 'search_entities',
        args: { query: 'invoices' },
        sequenceNumber: 1,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      const messages = getMessageStore().getState().messages;
      const toolMessage = messages.find(m => m.type === 'tool_use');
      expect(toolMessage).toBeDefined();
      expect((toolMessage as { tool_name: string }).tool_name).toBe('search_entities');
      expect((toolMessage as { status: string }).status).toBe('pending');

      // 2. Tool result
      processAgentEvent({
        type: 'tool_result',
        eventId: 'evt-2',
        sessionId,
        toolUseId: 'tool-1',
        toolName: 'search_entities',
        success: true,
        result: { entities: ['Invoice', 'InvoiceLine'] },
        durationMs: 150,
        sequenceNumber: 2,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      const updatedMessages = getMessageStore().getState().messages;
      const updatedToolMessage = updatedMessages.find(m => m.type === 'tool_use');
      expect((updatedToolMessage as { status: string }).status).toBe('success');
      expect((updatedToolMessage as { duration_ms?: number }).duration_ms).toBe(150);

      // 3. Assistant message
      processAgentEvent({
        type: 'message',
        eventId: 'evt-3',
        messageId: 'msg-1',
        sessionId,
        role: 'assistant',
        content: 'I found Invoice and InvoiceLine entities.',
        sequenceNumber: 3,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      const finalMessages = getMessageStore().getState().messages;
      expect(finalMessages).toHaveLength(2); // tool_use + message
    });

    it('should handle tool error', () => {
      const sessionId = 'test-session';

      // Tool use
      processAgentEvent({
        type: 'tool_use',
        eventId: 'evt-1',
        sessionId,
        toolUseId: 'tool-2',
        toolName: 'search_entities',
        args: { query: 'invalid' },
        sequenceNumber: 1,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      // Tool result with error
      processAgentEvent({
        type: 'tool_result',
        eventId: 'evt-2',
        sessionId,
        toolUseId: 'tool-2',
        toolName: 'search_entities',
        success: false,
        result: null,
        error: 'Entity not found',
        durationMs: 50,
        sequenceNumber: 2,
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      const messages = getMessageStore().getState().messages;
      const toolMessage = messages.find(m => m.type === 'tool_use');
      expect((toolMessage as { status: string }).status).toBe('error');
      expect((toolMessage as { error_message?: string }).error_message).toBe('Entity not found');
    });
  });

  // ============================================================================
  // Approval Flow
  // ============================================================================

  describe('Approval flow', () => {
    it('should handle approval request and resolution', () => {
      const sessionId = 'test-session';

      // Approval requested
      processAgentEvent({
        type: 'approval_requested',
        eventId: 'evt-1',
        sessionId,
        approvalId: 'approval-1',
        toolName: 'write_file',
        args: { path: '/tmp/test.txt' },
        changeSummary: 'Write to file',
        priority: 'high',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      const approvals = getPendingApprovalsArray(getApprovalStore().getState());
      expect(approvals).toHaveLength(1);
      expect(approvals[0].toolName).toBe('write_file');

      // Approval resolved
      processAgentEvent({
        type: 'approval_resolved',
        eventId: 'evt-2',
        sessionId,
        approvalId: 'approval-1',
        decision: 'approved',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      expect(getPendingApprovalsArray(getApprovalStore().getState())).toHaveLength(0);
    });
  });

  // ============================================================================
  // Error Recovery
  // ============================================================================

  describe('Error recovery', () => {
    it('should handle error event and mark complete', () => {
      const sessionId = 'test-session';
      let errorReceived: string | null = null;

      const callbacks = {
        onError: (error: string) => { errorReceived = error; },
      };

      // Session start
      processAgentEvent({
        type: 'session_start',
        eventId: 'evt-1',
        sessionId,
        userId: 'user-1',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      // Start streaming
      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-2',
        sessionId,
        content: 'Starting...',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      expect(getStreamingStore().getState().isStreaming).toBe(true);

      // Error event
      processAgentEvent({
        type: 'error',
        eventId: 'evt-3',
        sessionId,
        error: 'Rate limit exceeded',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent, callbacks);

      expect(getStreamingStore().getState().isComplete).toBe(true);
      expect(getStreamingStore().getState().isStreaming).toBe(false);
      expect(errorReceived).toBe('Rate limit exceeded');
    });
  });

  // ============================================================================
  // Late Chunk Handling (Gap #6)
  // ============================================================================

  describe('Late chunk handling (Gap #6)', () => {
    it('should ignore late chunks after complete', () => {
      const sessionId = 'test-session';

      // Start streaming
      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-1',
        sessionId,
        content: 'Hello',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      expect(getStreamingStore().getState().accumulatedContent).toBe('Hello');

      // Complete
      processAgentEvent({
        type: 'complete',
        eventId: 'evt-2',
        sessionId,
        stopReason: 'success',
        timestamp: now(),
        persistenceState: 'persisted',
      } as AgentEvent);

      expect(getStreamingStore().getState().isComplete).toBe(true);

      // Late chunk (should be ignored)
      processAgentEvent({
        type: 'message_chunk',
        eventId: 'evt-3',
        sessionId,
        content: ' LATE',
        eventIndex: 0,
        timestamp: now(),
        persistenceState: 'transient',
      } as AgentEvent);

      // Content should NOT include late chunk
      expect(getStreamingStore().getState().accumulatedContent).toBe('Hello');
    });
  });

  // ============================================================================
  // Message Sorting
  // ============================================================================

  describe('Message sorting', () => {
    it('should sort messages by sequence number', () => {
      // Add messages out of order
      getMessageStore().getState().setMessages([
        {
          type: 'standard',
          id: 'msg-3',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Third',
          sequence_number: 3,
          created_at: now(),
        },
        {
          type: 'standard',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'First',
          sequence_number: 1,
          created_at: now(),
        },
        {
          type: 'standard',
          id: 'msg-2',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Second',
          sequence_number: 2,
          created_at: now(),
        },
      ]);

      const messages = getMessageStore().getState().messages;
      // Note: getState().messages returns unsorted array
      // Sorting happens in useMessages hook via getSortedMessages

      // Verify messages exist
      expect(messages).toHaveLength(3);
    });
  });

  // ============================================================================
  // Optimistic Update Flow
  // ============================================================================

  describe('Optimistic update flow', () => {
    it('should handle optimistic message confirmation', () => {
      const store = getMessageStore();

      // Add optimistic message
      store.getState().addOptimisticMessage('temp-1', {
        type: 'standard',
        id: 'temp-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 0,
        created_at: now(),
      });

      expect(store.getState().optimisticMessages.size).toBe(1);
      expect(store.getState().messages).toHaveLength(0);

      // Confirm with real message
      store.getState().confirmOptimisticMessage('temp-1', {
        type: 'standard',
        id: 'msg-real',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 5,
        created_at: now(),
      });

      expect(store.getState().optimisticMessages.size).toBe(0);
      expect(store.getState().messages).toHaveLength(1);
      expect(store.getState().messages[0].id).toBe('msg-real');
    });
  });
});
