/**
 * useSocket Hook Unit Tests
 *
 * Tests for the socket middleware hook that connects WebSocket events to Zustand stores.
 * Mocks SocketService to isolate hook logic.
 *
 * @module __tests__/unit/hooks/useSocket.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSocket } from '@/lib/stores/socketMiddleware';

// 1. Define mock functions globally for the test file
const mockHandleAgentEvent = vi.fn();
const mockSetAgentBusy = vi.fn();
const mockSetError = vi.fn();
const mockSetCurrentSession = vi.fn();
const mockAddOptimisticMessage = vi.fn();

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockJoinSession = vi.fn();
const mockLeaveSession = vi.fn();
const mockSendMessage = vi.fn();
const mockStopAgent = vi.fn();
const mockRespondToApproval = vi.fn();

const mockSocketService = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  joinSession: mockJoinSession,
  leaveSession: mockLeaveSession,
  sendMessage: mockSendMessage,
  stopAgent: mockStopAgent,
  respondToApproval: mockRespondToApproval,
  isConnected: false,
};

// 2. Mock modules using the global mock functions
// Note: This relies on Vitest hoisting these variables or using them from closure if not hoisted.
// If this fails, we will use the "return mock object" pattern inside vi.mock

vi.mock('@/lib/stores/chatStore', () => ({
  useChatStore: vi.fn((selector) => {
    const state = {
      handleAgentEvent: mockHandleAgentEvent,
      setAgentBusy: mockSetAgentBusy,
      setError: mockSetError,
      setCurrentSession: mockSetCurrentSession,
      addOptimisticMessage: mockAddOptimisticMessage,
      streaming: false,
    };
    return selector(state);
  }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: 'test-user-id' },
    };
    return selector(state);
  }),
}));

vi.mock('@/lib/services/socket', () => ({
  getSocketService: vi.fn(() => mockSocketService),
}));

describe('useSocket Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketService.isConnected = false;
  });

  it('should connect on mount if autoConnect is true (default)', () => {
    renderHook(() => useSocket());
    expect(mockConnect).toHaveBeenCalled();
  });

  it('should not connect on mount if autoConnect is false', () => {
    renderHook(() => useSocket({ autoConnect: false }));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('should expose connect/disconnect methods', () => {
    const { result } = renderHook(() => useSocket({ autoConnect: false }));
    
    act(() => {
      result.current.connect();
    });
    expect(mockConnect).toHaveBeenCalled();
    
    act(() => {
      result.current.disconnect();
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('should send message with optimistic update', () => {
    const { result } = renderHook(() => useSocket({ sessionId: 'session-123' }));
    
    act(() => {
      result.current.joinSession('session-123');
    });
    
    act(() => {
      result.current.sendMessage('Hello');
    });
    
    expect(mockAddOptimisticMessage).toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Hello',
      sessionId: 'session-123',
      userId: 'test-user-id',
    }));
  });

  it('should respond to approval', () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      result.current.respondToApproval('approval-1', true, 'reason');
    });
    
    expect(mockRespondToApproval).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      userId: 'test-user-id',
      reason: 'reason',
    });
  });
});
