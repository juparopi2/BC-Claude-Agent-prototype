/**
 * useSendMessage Hook Tests
 *
 * Unit tests for the useSendMessage hook that provides message sending.
 *
 * @module __tests__/domains/chat/hooks/useSendMessage
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSendMessage } from '../../../../src/domains/chat/hooks/useSendMessage';
import {
  getMessageStore,
  resetMessageStore,
} from '../../../../src/domains/chat/stores/messageStore';

// Mock useSocketConnection
const mockSendMessage = vi.fn();
const mockStopAgent = vi.fn();
let mockIsConnected = true;
let mockIsSessionReady = true;
let mockIsReconnecting = false;

vi.mock('../../../../src/domains/chat/hooks/useSocketConnection', () => ({
  useSocketConnection: vi.fn(() => ({
    sendMessage: mockSendMessage,
    stopAgent: mockStopAgent,
    isConnected: mockIsConnected,
    isSessionReady: mockIsSessionReady,
    isReconnecting: mockIsReconnecting,
  })),
}));

// Import mocked useSocketConnection for verification
import { useSocketConnection } from '../../../../src/domains/chat/hooks/useSocketConnection';

describe('useSendMessage', () => {
  beforeEach(() => {
    resetMessageStore();
    vi.clearAllMocks();

    // Reset connection state
    mockIsConnected = true;
    mockIsSessionReady = true;
    mockIsReconnecting = false;

    // Update mock return value
    (useSocketConnection as Mock).mockReturnValue({
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
      isConnected: mockIsConnected,
      isSessionReady: mockIsSessionReady,
      isReconnecting: mockIsReconnecting,
    });
  });

  // ============================================================================
  // Initialization
  // ============================================================================

  describe('initialization', () => {
    it('should call useSocketConnection with sessionId', () => {
      renderHook(() => useSendMessage('session-123'));

      expect(useSocketConnection).toHaveBeenCalledWith({
        sessionId: 'session-123',
        autoConnect: true,
      });
    });

    it('should return connection state from useSocketConnection', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isSessionReady).toBe(true);
      expect(result.current.isReconnecting).toBe(false);
    });
  });

  // ============================================================================
  // sendMessage
  // ============================================================================

  describe('sendMessage', () => {
    it('should call socket.sendMessage with content', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      act(() => {
        result.current.sendMessage('Hello world');
      });

      expect(mockSendMessage).toHaveBeenCalledWith('Hello world', {
        enableThinking: undefined,
        thinkingBudget: undefined,
        attachments: undefined,
        enableAutoSemanticSearch: undefined,
      });
    });

    it('should pass options to socket.sendMessage', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      act(() => {
        result.current.sendMessage('Hello', {
          enableThinking: true,
          thinkingBudget: 5000,
          attachments: ['file-1', 'file-2'],
          enableAutoSemanticSearch: true,
        });
      });

      expect(mockSendMessage).toHaveBeenCalledWith('Hello', {
        enableThinking: true,
        thinkingBudget: 5000,
        attachments: ['file-1', 'file-2'],
        enableAutoSemanticSearch: true,
      });
    });

    it('should not send empty message', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      act(() => {
        result.current.sendMessage('');
      });

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should not send whitespace-only message', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      act(() => {
        result.current.sendMessage('   ');
      });

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // stopAgent
  // ============================================================================

  describe('stopAgent', () => {
    it('should call socket.stopAgent', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      act(() => {
        result.current.stopAgent();
      });

      expect(mockStopAgent).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // isSending
  // ============================================================================

  describe('isSending', () => {
    it('should return false when no optimistic messages', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));
      expect(result.current.isSending).toBe(false);
    });

    it('should return true when has optimistic messages', () => {
      // Add optimistic message directly to store
      act(() => {
        getMessageStore().getState().addOptimisticMessage('temp-1', {
          type: 'standard',
          id: 'temp-1',
          session_id: 'session-123',
          role: 'user',
          content: 'Pending...',
          sequence_number: 0,
          created_at: new Date().toISOString(),
        });
      });

      const { result } = renderHook(() => useSendMessage('session-123'));
      expect(result.current.isSending).toBe(true);
    });

    it('should return false after optimistic message confirmed', () => {
      // Add optimistic message
      act(() => {
        getMessageStore().getState().addOptimisticMessage('temp-1', {
          type: 'standard',
          id: 'temp-1',
          session_id: 'session-123',
          role: 'user',
          content: 'Pending...',
          sequence_number: 0,
          created_at: new Date().toISOString(),
        });
      });

      const { result } = renderHook(() => useSendMessage('session-123'));
      expect(result.current.isSending).toBe(true);

      // Confirm the message
      act(() => {
        getMessageStore().getState().confirmOptimisticMessage('temp-1', {
          type: 'standard',
          id: 'real-msg-id',
          session_id: 'session-123',
          role: 'user',
          content: 'Pending...',
          sequence_number: 5,
          created_at: new Date().toISOString(),
        });
      });

      expect(result.current.isSending).toBe(false);
    });

    it('should update reactively when store changes', () => {
      const { result } = renderHook(() => useSendMessage('session-123'));

      expect(result.current.isSending).toBe(false);

      act(() => {
        getMessageStore().getState().addOptimisticMessage('temp-2', {
          type: 'standard',
          id: 'temp-2',
          session_id: 'session-123',
          role: 'user',
          content: 'New message',
          sequence_number: 0,
          created_at: new Date().toISOString(),
        });
      });

      expect(result.current.isSending).toBe(true);
    });
  });

  // ============================================================================
  // Connection State
  // ============================================================================

  describe('connection state', () => {
    it('should reflect disconnected state', () => {
      mockIsConnected = false;
      mockIsSessionReady = false;

      (useSocketConnection as Mock).mockReturnValue({
        sendMessage: mockSendMessage,
        stopAgent: mockStopAgent,
        isConnected: false,
        isSessionReady: false,
        isReconnecting: false,
      });

      const { result } = renderHook(() => useSendMessage('session-123'));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.isSessionReady).toBe(false);
    });

    it('should reflect reconnecting state', () => {
      mockIsReconnecting = true;

      (useSocketConnection as Mock).mockReturnValue({
        sendMessage: mockSendMessage,
        stopAgent: mockStopAgent,
        isConnected: true,
        isSessionReady: true,
        isReconnecting: true,
      });

      const { result } = renderHook(() => useSendMessage('session-123'));

      expect(result.current.isReconnecting).toBe(true);
    });
  });

  // ============================================================================
  // Memoization
  // ============================================================================

  describe('memoization', () => {
    it('should return stable sendMessage reference', () => {
      const { result, rerender } = renderHook(() => useSendMessage('session-123'));

      const firstSendMessage = result.current.sendMessage;

      rerender();

      expect(result.current.sendMessage).toBe(firstSendMessage);
    });

    it('should return stable stopAgent reference', () => {
      const { result, rerender } = renderHook(() => useSendMessage('session-123'));

      const firstStopAgent = result.current.stopAgent;

      rerender();

      expect(result.current.stopAgent).toBe(firstStopAgent);
    });
  });
});
