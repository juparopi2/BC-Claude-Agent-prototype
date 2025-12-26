/**
 * usePagination Hook Tests
 *
 * Unit tests for the pagination hook that loads older messages.
 *
 * @module __tests__/domains/chat/hooks/usePagination
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePagination } from '@/src/domains/chat/hooks/usePagination';
import { resetMessageStore, getMessageStore } from '@/src/domains/chat/stores/messageStore';
import type { Message } from '@bc-agent/shared';

// Mock the API module - getApiClient returns a singleton with getMessages
const mockGetMessages = vi.fn();

vi.mock('@/lib/services/api', () => ({
  getApiClient: () => ({
    getMessages: mockGetMessages,
  }),
}));

// Helper to create test messages
function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    type: 'standard',
    id: `msg-${Math.random().toString(36).substr(2, 9)}`,
    session_id: 'test-session',
    role: 'assistant',
    content: 'Test message',
    sequence_number: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Message;
}

describe('usePagination', () => {
  beforeEach(() => {
    resetMessageStore();
    mockGetMessages.mockReset();
    mockGetMessages.mockResolvedValue({
      success: true,
      data: [],
    });
  });

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('should return initial state', () => {
      const { result } = renderHook(() => usePagination('session-123'));

      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.loadOlderMessages).toBe('function');
    });

    it('should handle null sessionId', () => {
      const { result } = renderHook(() => usePagination(null));

      expect(result.current.hasMore).toBe(true);
      expect(result.current.isLoadingMore).toBe(false);
    });

    it('should handle undefined sessionId', () => {
      const { result } = renderHook(() => usePagination(undefined));

      expect(result.current.hasMore).toBe(true);
    });
  });

  // ============================================================================
  // loadOlderMessages
  // ============================================================================

  describe('loadOlderMessages', () => {
    it('should set error when no sessionId', async () => {
      const { result } = renderHook(() => usePagination(null));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.error).toBe('No session ID provided');
    });

    it('should fetch messages from API', async () => {
      const olderMessages = [
        createMessage({ id: 'old-1', sequence_number: 5 }),
        createMessage({ id: 'old-2', sequence_number: 6 }),
      ];

      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: olderMessages,
      });

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(mockGetMessages).toHaveBeenCalledWith('session-123', {
        limit: 50,
        before: undefined, // No existing messages
      });
    });

    it('should use oldest sequence number as cursor', async () => {
      // Add some messages to the store first
      const store = getMessageStore().getState();
      store.addMessage(createMessage({ id: 'msg-1', sequence_number: 10 }));
      store.addMessage(createMessage({ id: 'msg-2', sequence_number: 15 }));
      store.addMessage(createMessage({ id: 'msg-3', sequence_number: 12 }));

      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(mockGetMessages).toHaveBeenCalledWith('session-123', {
        limit: 50,
        before: 10, // Oldest sequence number
      });
    });

    it('should set isLoadingMore during fetch', async () => {
      let resolvePromise: () => void;
      const loadingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      mockGetMessages.mockImplementationOnce(async () => {
        await loadingPromise;
        return { success: true, data: [] };
      });

      const { result } = renderHook(() => usePagination('session-123'));

      // Start loading
      act(() => {
        result.current.loadOlderMessages();
      });

      // Check loading state (synchronous)
      expect(result.current.isLoadingMore).toBe(true);

      // Complete loading
      await act(async () => {
        resolvePromise!();
      });

      expect(result.current.isLoadingMore).toBe(false);
    });

    it('should add fetched messages to store', async () => {
      const olderMessages = [
        createMessage({ id: 'old-1', sequence_number: 1 }),
        createMessage({ id: 'old-2', sequence_number: 2 }),
      ];

      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: olderMessages,
      });

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      const storeMessages = getMessageStore().getState().messages;
      expect(storeMessages.some((m) => m.id === 'old-1')).toBe(true);
      expect(storeMessages.some((m) => m.id === 'old-2')).toBe(true);
    });

    it('should set hasMore to false when fewer messages returned', async () => {
      // Return fewer than pageSize
      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: [createMessage({ sequence_number: 1 })], // Only 1 message
      });

      const { result } = renderHook(() => usePagination('session-123', 50));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.hasMore).toBe(false);
    });

    it('should respect custom pageSize', async () => {
      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const { result } = renderHook(() => usePagination('session-123', 25));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(mockGetMessages).toHaveBeenCalledWith('session-123', {
        limit: 25,
        before: undefined,
      });
    });

    it('should not load when already loading', async () => {
      let resolvePromise: () => void;
      const loadingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      mockGetMessages.mockImplementationOnce(async () => {
        await loadingPromise;
        return { success: true, data: [] };
      });

      const { result } = renderHook(() => usePagination('session-123'));

      // Start first load
      act(() => {
        result.current.loadOlderMessages();
      });

      // Try second load while first is in progress
      await act(async () => {
        await result.current.loadOlderMessages();
      });

      // API should only be called once
      expect(mockGetMessages).toHaveBeenCalledTimes(1);

      // Complete first load
      await act(async () => {
        resolvePromise!();
      });
    });

    it('should not load when hasMore is false', async () => {
      // First load returns empty (sets hasMore = false)
      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const { result } = renderHook(() => usePagination('session-123', 50));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.hasMore).toBe(false);

      // Try to load again
      await act(async () => {
        await result.current.loadOlderMessages();
      });

      // API should only be called once
      expect(mockGetMessages).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('error handling', () => {
    it('should set error on API failure', async () => {
      mockGetMessages.mockResolvedValueOnce({
        success: false,
        error: { message: 'Network error' },
        data: undefined,
      });

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.error).toBe('Network error');
    });

    it('should set error on exception', async () => {
      mockGetMessages.mockRejectedValueOnce(new Error('Connection failed'));

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.error).toBe('Connection failed');
    });

    it('should clear error on successful load', async () => {
      // First call fails
      mockGetMessages.mockResolvedValueOnce({
        success: false,
        error: { message: 'Network error' },
        data: undefined,
      });

      const { result } = renderHook(() => usePagination('session-123'));

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.error).toBe('Network error');

      // Second call succeeds
      mockGetMessages.mockResolvedValueOnce({
        success: true,
        data: [createMessage({ sequence_number: 1 })],
      });

      await act(async () => {
        await result.current.loadOlderMessages();
      });

      expect(result.current.error).toBeNull();
    });
  });

  // ============================================================================
  // oldestSequenceNumber
  // ============================================================================

  describe('oldestSequenceNumber', () => {
    it('should return null when no messages', () => {
      const { result } = renderHook(() => usePagination('session-123'));
      expect(result.current.oldestSequenceNumber).toBeNull();
    });

    it('should return null when messages have no sequence numbers', () => {
      const store = getMessageStore().getState();
      store.addMessage(createMessage({ id: 'msg-1', sequence_number: 0 }));
      store.addMessage(createMessage({ id: 'msg-2', sequence_number: null as unknown as number }));

      const { result } = renderHook(() => usePagination('session-123'));
      expect(result.current.oldestSequenceNumber).toBeNull();
    });
  });
});
