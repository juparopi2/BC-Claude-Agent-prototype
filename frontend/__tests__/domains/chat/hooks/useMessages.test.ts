/**
 * useMessages Hook Tests
 *
 * Unit tests for the useMessages hook that provides access to chat messages.
 *
 * @module __tests__/domains/chat/hooks/useMessages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Message } from '@bc-agent/shared';

import { useMessages } from '../../../../src/domains/chat/hooks/useMessages';
import {
  getMessageStore,
  resetMessageStore,
} from '../../../../src/domains/chat/stores/messageStore';

describe('useMessages', () => {
  beforeEach(() => {
    resetMessageStore();
  });

  // ============================================================================
  // Basic Functionality
  // ============================================================================

  describe('messages', () => {
    it('should return empty array initially', () => {
      const { result } = renderHook(() => useMessages());
      expect(result.current.messages).toEqual([]);
    });

    it('should return sorted messages from store', () => {
      // Pre-populate store with unsorted messages
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

      const { result } = renderHook(() => useMessages());

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]?.id).toBe('msg-1');
      expect(result.current.messages[1]?.id).toBe('msg-2');
    });

    it('should include optimistic messages in sorted output', () => {
      // Add persisted message
      act(() => {
        getMessageStore().getState().setMessages([
          {
            type: 'standard',
            id: 'msg-1',
            session_id: 'session-1',
            role: 'assistant',
            content: 'Response',
            sequence_number: 2,
            created_at: '2024-01-01T00:00:01Z',
          },
        ]);
      });

      const { result } = renderHook(() => useMessages());

      // Add optimistic message
      act(() => {
        result.current.addOptimistic('temp-1', {
          type: 'standard',
          id: 'temp-1',
          session_id: 'session-1',
          role: 'user',
          content: 'New message',
          sequence_number: 0, // Optimistic messages have no sequence
          created_at: new Date().toISOString(),
        });
      });

      // Should have both messages
      expect(result.current.messages).toHaveLength(2);
    });

    it('should update when store changes', () => {
      const { result } = renderHook(() => useMessages());

      expect(result.current.messages).toHaveLength(0);

      act(() => {
        getMessageStore().getState().addMessage({
          type: 'standard',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Hello',
          sequence_number: 1,
          created_at: new Date().toISOString(),
        });
      });

      expect(result.current.messages).toHaveLength(1);
    });
  });

  // ============================================================================
  // isEmpty
  // ============================================================================

  describe('isEmpty', () => {
    it('should return true when no messages', () => {
      const { result } = renderHook(() => useMessages());
      expect(result.current.isEmpty).toBe(true);
    });

    it('should return false when has messages', () => {
      act(() => {
        getMessageStore().getState().addMessage({
          type: 'standard',
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Hello',
          sequence_number: 1,
          created_at: new Date().toISOString(),
        });
      });

      const { result } = renderHook(() => useMessages());
      expect(result.current.isEmpty).toBe(false);
    });

    it('should return false when has optimistic messages only', () => {
      const { result } = renderHook(() => useMessages());

      act(() => {
        result.current.addOptimistic('temp-1', {
          type: 'standard',
          id: 'temp-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Pending message',
          sequence_number: 0,
          created_at: new Date().toISOString(),
        });
      });

      expect(result.current.isEmpty).toBe(false);
    });
  });

  // ============================================================================
  // Optimistic Actions
  // ============================================================================

  describe('addOptimistic', () => {
    it('should add optimistic message to store', () => {
      const { result } = renderHook(() => useMessages());

      const optimisticMessage: Message = {
        type: 'standard',
        id: 'temp-123',
        session_id: 'session-1',
        role: 'user',
        content: 'Sending...',
        sequence_number: 0,
        created_at: new Date().toISOString(),
      };

      act(() => {
        result.current.addOptimistic('temp-123', optimisticMessage);
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.content).toBe('Sending...');

      // Verify it's in optimistic map
      const state = getMessageStore().getState();
      expect(state.optimisticMessages.has('temp-123')).toBe(true);
    });
  });

  describe('confirmOptimistic', () => {
    it('should confirm and replace optimistic message', () => {
      const { result } = renderHook(() => useMessages());

      // Add optimistic message
      const optimisticMessage: Message = {
        type: 'standard',
        id: 'temp-456',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 0,
        created_at: new Date().toISOString(),
      };

      act(() => {
        result.current.addOptimistic('temp-456', optimisticMessage);
      });

      // Confirm with real message
      const confirmedMessage: Message = {
        type: 'standard',
        id: 'real-msg-id',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        sequence_number: 5,
        created_at: new Date().toISOString(),
      };

      act(() => {
        result.current.confirmOptimistic('temp-456', confirmedMessage);
      });

      // Should have the confirmed message
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.id).toBe('real-msg-id');
      expect(result.current.messages[0]?.sequence_number).toBe(5);

      // Optimistic should be removed
      const state = getMessageStore().getState();
      expect(state.optimisticMessages.size).toBe(0);
    });
  });

  describe('removeOptimistic', () => {
    it('should remove optimistic message from store', () => {
      const { result } = renderHook(() => useMessages());

      // Add optimistic message
      act(() => {
        result.current.addOptimistic('temp-789', {
          type: 'standard',
          id: 'temp-789',
          session_id: 'session-1',
          role: 'user',
          content: 'Will fail',
          sequence_number: 0,
          created_at: new Date().toISOString(),
        });
      });

      expect(result.current.messages).toHaveLength(1);

      // Remove it (e.g., on send error)
      act(() => {
        result.current.removeOptimistic('temp-789');
      });

      expect(result.current.messages).toHaveLength(0);
      expect(result.current.isEmpty).toBe(true);
    });
  });

  // ============================================================================
  // Memoization
  // ============================================================================

  describe('memoization', () => {
    it('should return same actions object on re-render', () => {
      const { result, rerender } = renderHook(() => useMessages());

      const firstAddOptimistic = result.current.addOptimistic;
      const firstConfirmOptimistic = result.current.confirmOptimistic;
      const firstRemoveOptimistic = result.current.removeOptimistic;

      // Trigger re-render
      rerender();

      // Actions should be the same reference
      expect(result.current.addOptimistic).toBe(firstAddOptimistic);
      expect(result.current.confirmOptimistic).toBe(firstConfirmOptimistic);
      expect(result.current.removeOptimistic).toBe(firstRemoveOptimistic);
    });

    it('should update messages reference when store changes', () => {
      const { result } = renderHook(() => useMessages());

      const firstMessages = result.current.messages;

      act(() => {
        getMessageStore().getState().addMessage({
          type: 'standard',
          id: 'msg-new',
          session_id: 'session-1',
          role: 'user',
          content: 'New',
          sequence_number: 1,
          created_at: new Date().toISOString(),
        });
      });

      // Messages reference should change
      expect(result.current.messages).not.toBe(firstMessages);
      expect(result.current.messages.length).toBe(firstMessages.length + 1);
    });
  });
});
