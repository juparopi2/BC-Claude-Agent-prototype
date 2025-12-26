/**
 * MessageStore Tests
 *
 * Unit tests for the message store that handles persisted and optimistic messages.
 * Tests include Gap #4 fix for ID mismatch in user_message_confirmed.
 *
 * @module __tests__/domains/chat/stores/messageStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import type { Message } from '@bc-agent/shared';

// Will be implemented in messageStore.ts
import {
  getMessageStore,
  resetMessageStore,
  useMessageStore,
  getSortedMessages,
} from '../../../../src/domains/chat/stores/messageStore';

describe('MessageStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    resetMessageStore();
  });

  // ============================================================================
  // Basic Message Operations
  // ============================================================================

  describe('setMessages', () => {
    it('should load and sort messages by sequence_number', () => {
      const messages: Message[] = [
        {
          type: 'standard',
          id: 'msg-2',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Response',
          sequence_number: 2,
          created_at: '2024-01-01T00:00:01Z',
        },
        {
          type: 'standard',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Hello',
          sequence_number: 1,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      act(() => {
        getMessageStore().getState().setMessages(messages);
      });

      const sorted = getSortedMessages(getMessageStore().getState());
      expect(sorted).toHaveLength(2);
      expect(sorted[0]?.sequence_number).toBe(1);
      expect(sorted[1]?.sequence_number).toBe(2);
    });

    it('should merge tool_result data into corresponding tool_use messages', () => {
      const toolUseId = 'toolu_abc123';
      const messages: Message[] = [
        {
          type: 'tool_use',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'assistant',
          tool_name: 'search',
          tool_args: { query: 'test' },
          tool_use_id: toolUseId,
          status: 'pending',
          sequence_number: 1,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          type: 'tool_result',
          id: 'msg-2',
          session_id: 'session-1',
          tool_use_id: toolUseId,
          success: true,
          result: { data: 'found' },
          sequence_number: 2,
          created_at: '2024-01-01T00:00:01Z',
        },
      ];

      act(() => {
        getMessageStore().getState().setMessages(messages);
      });

      const state = getMessageStore().getState();
      // tool_result should be filtered out (merged into tool_use)
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.type).toBe('tool_use');
      expect((state.messages[0] as { status: string }).status).toBe('success');
      expect((state.messages[0] as { result: unknown }).result).toEqual({ data: 'found' });
    });
  });

  describe('addMessage', () => {
    it('should add a message and maintain sort order', () => {
      const msg1: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'user',
        content: 'First',
        sequence_number: 1,
        created_at: '2024-01-01T00:00:00Z',
      };

      const msg2: Message = {
        type: 'standard',
        id: 'msg-2',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Second',
        sequence_number: 2,
        created_at: '2024-01-01T00:00:01Z',
      };

      act(() => {
        // Add out of order
        getMessageStore().getState().addMessage(msg2);
        getMessageStore().getState().addMessage(msg1);
      });

      const sorted = getSortedMessages(getMessageStore().getState());
      expect(sorted).toHaveLength(2);
      expect(sorted[0]?.id).toBe('msg-1');
      expect(sorted[1]?.id).toBe('msg-2');
    });
  });

  describe('updateMessage', () => {
    it('should update an existing message', () => {
      const msg: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Original',
        sequence_number: 1,
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        getMessageStore().getState().addMessage(msg);
        getMessageStore().getState().updateMessage('msg-1', { content: 'Updated' });
      });

      const state = getMessageStore().getState();
      expect((state.messages[0] as { content: string }).content).toBe('Updated');
    });

    it('should not fail when updating non-existent message', () => {
      act(() => {
        getMessageStore().getState().updateMessage('non-existent', { content: 'Test' });
      });

      const state = getMessageStore().getState();
      expect(state.messages).toHaveLength(0);
    });
  });

  // ============================================================================
  // Optimistic Messages
  // ============================================================================

  describe('Optimistic Message Flow', () => {
    it('should add optimistic message to Map', () => {
      const tempId = 'optimistic-temp-123';
      const optimisticMsg: Message = {
        type: 'standard',
        id: tempId,
        session_id: 'session-1',
        role: 'user',
        content: 'Pending message',
        sequence_number: 0, // No sequence yet
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage(tempId, optimisticMsg);
      });

      const state = getMessageStore().getState();
      expect(state.optimisticMessages.has(tempId)).toBe(true);
      expect(state.optimisticMessages.get(tempId)?.content).toBe('Pending message');
    });

    it('should include optimistic messages in sorted output', () => {
      const confirmedMsg: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Confirmed',
        sequence_number: 1,
        created_at: '2024-01-01T00:00:00Z',
      };

      const optimisticMsg: Message = {
        type: 'standard',
        id: 'optimistic-temp',
        session_id: 'session-1',
        role: 'user',
        content: 'Optimistic',
        sequence_number: 0,
        created_at: '2024-01-01T00:00:01Z',
      };

      act(() => {
        getMessageStore().getState().addMessage(confirmedMsg);
        getMessageStore().getState().addOptimisticMessage('optimistic-temp', optimisticMsg);
      });

      const sorted = getSortedMessages(getMessageStore().getState());
      expect(sorted).toHaveLength(2);
      // Confirmed (seq=1) before optimistic (seq=0)
      expect(sorted[0]?.id).toBe('msg-1');
      expect(sorted[1]?.id).toBe('optimistic-temp');
    });

    it('should remove optimistic message on removeOptimisticMessage', () => {
      const tempId = 'optimistic-temp';
      const msg: Message = {
        type: 'standard',
        id: tempId,
        session_id: 'session-1',
        role: 'user',
        content: 'Test',
        sequence_number: 0,
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage(tempId, msg);
      });

      expect(getMessageStore().getState().optimisticMessages.has(tempId)).toBe(true);

      act(() => {
        getMessageStore().getState().removeOptimisticMessage(tempId);
      });

      expect(getMessageStore().getState().optimisticMessages.has(tempId)).toBe(false);
    });
  });

  // ============================================================================
  // Gap #4 Fix: confirmOptimisticMessage with robust matching
  // ============================================================================

  describe('confirmOptimisticMessage (Gap #4 Fix)', () => {
    it('should confirm by exact tempId match (happy path)', () => {
      const tempId = 'optimistic-exact-123';
      const optimisticMsg: Message = {
        type: 'standard',
        id: tempId,
        session_id: 'session-1',
        role: 'user',
        content: 'Hello world',
        sequence_number: 0,
        created_at: '2024-01-01T00:00:00Z',
      };

      const confirmedMsg: Message = {
        type: 'standard',
        id: 'msg-real-456',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello world',
        sequence_number: 5,
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage(tempId, optimisticMsg);
      });

      expect(getMessageStore().getState().optimisticMessages.has(tempId)).toBe(true);

      act(() => {
        getMessageStore().getState().confirmOptimisticMessage(tempId, confirmedMsg);
      });

      const state = getMessageStore().getState();
      // Optimistic removed
      expect(state.optimisticMessages.has(tempId)).toBe(false);
      // Confirmed added to messages
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.id).toBe('msg-real-456');
      expect(state.messages[0]?.sequence_number).toBe(5);
    });

    it('should fallback to content+timestamp matching when tempId does not match', () => {
      const frontendTempId = 'optimistic-frontend-abc';
      const backendTempId = 'optimistic-backend-xyz'; // Different ID!
      const timestamp = '2024-01-01T00:00:00Z';
      const content = 'Test message content';

      const optimisticMsg: Message = {
        type: 'standard',
        id: frontendTempId,
        session_id: 'session-1',
        role: 'user',
        content,
        sequence_number: 0,
        created_at: timestamp,
      };

      const confirmedMsg: Message = {
        type: 'standard',
        id: 'msg-real',
        session_id: 'session-1',
        role: 'user',
        content,
        sequence_number: 10,
        created_at: timestamp, // Same timestamp
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage(frontendTempId, optimisticMsg);
      });

      // Confirm with WRONG tempId (simulates backend sending different eventId)
      act(() => {
        getMessageStore().getState().confirmOptimisticMessage(backendTempId, confirmedMsg);
      });

      const state = getMessageStore().getState();
      // Should still remove the optimistic message via fallback matching
      expect(state.optimisticMessages.has(frontendTempId)).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.id).toBe('msg-real');
    });

    it('should NOT match if timestamp differs by more than 5 seconds', () => {
      const frontendTempId = 'optimistic-frontend';
      const backendTempId = 'optimistic-backend'; // Different
      const content = 'Test message';

      const optimisticMsg: Message = {
        type: 'standard',
        id: frontendTempId,
        session_id: 'session-1',
        role: 'user',
        content,
        sequence_number: 0,
        created_at: '2024-01-01T00:00:00Z', // T+0
      };

      const confirmedMsg: Message = {
        type: 'standard',
        id: 'msg-real',
        session_id: 'session-1',
        role: 'user',
        content, // Same content
        sequence_number: 10,
        created_at: '2024-01-01T00:00:10Z', // T+10 seconds (> 5s window)
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage(frontendTempId, optimisticMsg);
      });

      act(() => {
        getMessageStore().getState().confirmOptimisticMessage(backendTempId, confirmedMsg);
      });

      const state = getMessageStore().getState();
      // Optimistic NOT removed because timestamp window exceeded
      expect(state.optimisticMessages.has(frontendTempId)).toBe(true);
      // Confirmed still added
      expect(state.messages).toHaveLength(1);
    });

    it('should correctly match when multiple optimistic messages exist', () => {
      const msg1Content = 'First message';
      const msg2Content = 'Second message';

      const optimistic1: Message = {
        type: 'standard',
        id: 'opt-1',
        session_id: 'session-1',
        role: 'user',
        content: msg1Content,
        sequence_number: 0,
        created_at: '2024-01-01T00:00:00Z',
      };

      const optimistic2: Message = {
        type: 'standard',
        id: 'opt-2',
        session_id: 'session-1',
        role: 'user',
        content: msg2Content,
        sequence_number: 0,
        created_at: '2024-01-01T00:00:01Z',
      };

      const confirmed1: Message = {
        type: 'standard',
        id: 'msg-real-1',
        session_id: 'session-1',
        role: 'user',
        content: msg1Content,
        sequence_number: 1,
        created_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        getMessageStore().getState().addOptimisticMessage('opt-1', optimistic1);
        getMessageStore().getState().addOptimisticMessage('opt-2', optimistic2);
      });

      expect(getMessageStore().getState().optimisticMessages.size).toBe(2);

      // Confirm first with exact match
      act(() => {
        getMessageStore().getState().confirmOptimisticMessage('opt-1', confirmed1);
      });

      const state = getMessageStore().getState();
      expect(state.optimisticMessages.has('opt-1')).toBe(false);
      expect(state.optimisticMessages.has('opt-2')).toBe(true); // Still pending
      expect(state.messages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Sorting Edge Cases
  // ============================================================================

  describe('Message Sorting Edge Cases', () => {
    it('should sort transient messages (no sequence_number) by timestamp', () => {
      const msg1: Message = {
        type: 'standard',
        id: 'msg-1',
        session_id: 'session-1',
        role: 'user',
        content: 'First',
        sequence_number: 0, // Transient
        created_at: '2024-01-01T00:00:01Z', // Later timestamp
      };

      const msg2: Message = {
        type: 'standard',
        id: 'msg-2',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Second',
        sequence_number: 0, // Transient
        created_at: '2024-01-01T00:00:00Z', // Earlier timestamp
      };

      act(() => {
        getMessageStore().getState().addMessage(msg1);
        getMessageStore().getState().addMessage(msg2);
      });

      const sorted = getSortedMessages(getMessageStore().getState());
      // Should be sorted by timestamp when sequence_number is 0
      expect(sorted[0]?.id).toBe('msg-2'); // Earlier
      expect(sorted[1]?.id).toBe('msg-1'); // Later
    });

    it('should put persisted messages before transient ones', () => {
      const persisted: Message = {
        type: 'standard',
        id: 'msg-persisted',
        session_id: 'session-1',
        role: 'user',
        content: 'Persisted',
        sequence_number: 5,
        created_at: '2024-01-01T00:00:01Z',
      };

      const transient: Message = {
        type: 'standard',
        id: 'msg-transient',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Transient',
        sequence_number: 0,
        created_at: '2024-01-01T00:00:00Z', // Earlier timestamp but no sequence
      };

      act(() => {
        getMessageStore().getState().addMessage(transient);
        getMessageStore().getState().addMessage(persisted);
      });

      const sorted = getSortedMessages(getMessageStore().getState());
      expect(sorted[0]?.id).toBe('msg-persisted'); // Persisted first
      expect(sorted[1]?.id).toBe('msg-transient'); // Transient last
    });
  });

  // ============================================================================
  // Reset and Clear
  // ============================================================================

  describe('reset', () => {
    it('should reset store to initial state', () => {
      act(() => {
        getMessageStore().getState().addMessage({
          type: 'standard',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Test',
          sequence_number: 1,
          created_at: '2024-01-01T00:00:00Z',
        });
        getMessageStore().getState().addOptimisticMessage('opt-1', {
          type: 'standard',
          id: 'opt-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Optimistic',
          sequence_number: 0,
          created_at: '2024-01-01T00:00:00Z',
        });
      });

      expect(getMessageStore().getState().messages).toHaveLength(1);
      expect(getMessageStore().getState().optimisticMessages.size).toBe(1);

      act(() => {
        getMessageStore().getState().reset();
      });

      const state = getMessageStore().getState();
      expect(state.messages).toHaveLength(0);
      expect(state.optimisticMessages.size).toBe(0);
    });
  });
});
