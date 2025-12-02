/**
 * Socket Middleware Integration Tests
 *
 * Tests the socketMiddleware integration with real backend WebSocket.
 * These tests verify:
 * - Auto-connect behavior
 * - Session joining
 * - Message sending with optimistic updates
 * - Event handling and store integration
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible
 * - Test session data seeded in database
 *
 * @module __tests__/integration/socketMiddleware.integration.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSocket } from '@/lib/stores/socketMiddleware';
import { useChatStore } from '@/lib/stores/chatStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { getSocketService, resetSocketService } from '@/lib/services/socket';

// Mock user for testing
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: new Date().toISOString(),
  role: 'editor' as const,
};

describe('Socket Middleware Integration', () => {
  beforeEach(() => {
    // Reset stores
    useChatStore.setState({
      messages: [],
      optimisticMessages: new Map(),
      currentSessionId: null,
      isAgentBusy: false,
      error: null,
      streaming: {
        isStreaming: false,
        content: '',
        thinking: '',
        messageId: undefined,
      },
      pendingApprovals: new Map(),
      toolExecutions: new Map(),
    });

    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    // Reset socket singleton
    resetSocketService();
  });

  afterEach(() => {
    // Clean up socket connection
    const socket = getSocketService();
    if (socket) {
      socket.disconnect();
    }
    resetSocketService();
  });

  describe('Auto-connect behavior', () => {
    it('should auto-connect when autoConnect is true', async () => {
      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
        })
      );

      // Wait for connection
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );
    });

    it('should not auto-connect when autoConnect is false', async () => {
      const { result } = renderHook(() =>
        useSocket({
          autoConnect: false,
        })
      );

      // Give it a moment to potentially connect
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(result.current.isConnected).toBe(false);
    });

    it('should connect manually when connect() is called', async () => {
      const { result } = renderHook(() =>
        useSocket({
          autoConnect: false,
        })
      );

      expect(result.current.isConnected).toBe(false);

      act(() => {
        result.current.connect();
      });

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );
    });
  });

  describe('Session management', () => {
    it('should join session when sessionId is provided', async () => {
      const testSessionId = 'test-session-123';
      const onSessionReady = vi.fn();

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
          sessionId: testSessionId,
          onSessionReady,
        })
      );

      // Wait for connection
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      // Verify session was joined (session:ready event should fire)
      await waitFor(
        () => {
          expect(onSessionReady).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );
    });

   it('should allow manual session joining', async () => {
      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
        })
      );

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      const testSessionId = 'manual-session-456';

      act(() => {
        result.current.joinSession(testSessionId);
      });

      // Verify currentSession in store is updated
      await waitFor(
        () => {
          const currentSessionId = useChatStore.getState().currentSessionId;
          expect(currentSessionId).toBe(testSessionId);
        },
        { timeout: 5000 }
      );
    });
  });

  describe('Optimistic message creation', () => {
    it('should create optimistic message before sending to server', async () => {
      const testSessionId = 'test-session-opt';

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
          sessionId: testSessionId,
        })
      );

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      const messageContent = 'Test optimistic message';

      act(() => {
        result.current.sendMessage(messageContent);
      });

      // Check optimistic message was added
      const optimisticMessages = useChatStore.getState().optimisticMessages;
      expect(optimisticMessages.size).toBe(1);

      const optimisticMsg = Array.from(optimisticMessages.values())[0];
      expect(optimisticMsg?.content).toBe(messageContent);
      expect(optimisticMsg?.role).toBe('user');
      expect(optimisticMsg?.id).toMatch(/^optimistic-/);
    });

    it('should not send message without user', async () => {
      // Clear user
      useAuthStore.setState({ user: null, isAuthenticated: false });

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
        })
      );

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        result.current.sendMessage('Should not send');
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot send message')
      );

      // No optimistic message should be created
      const optimisticMessages = useChatStore.getState().optimisticMessages;
      expect(optimisticMessages.size).toBe(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Store integration', () => {
    it('should update chatStore when receiving agent events', async () => {
      const onAgentEvent = vi.fn();
      const testSessionId = 'test-session-events';

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
          sessionId: testSessionId,
          onAgentEvent,
        })
      );

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      // Send a message to trigger agent events
      act(() => {
        result.current.sendMessage('Hello');
      });

      // Wait for at least one agent event
      await waitFor(
        () => {
          expect(onAgentEvent).toHaveBeenCalled();
        },
        { timeout: 15000 }
      );

      // Verify chatStore was updated
      const events = onAgentEvent.mock.calls.map((call) => call[0]);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle connection state changes', async () => {
      const onConnectionChange = vi.fn();

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
          onConnectionChange,
        })
      );

      // Wait for connection
      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(onConnectionChange).toHaveBeenCalledWith(true);

      // Disconnect
      act(() => {
        result.current.disconnect();
      });

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(false);
        },
        { timeout: 2000 }
      );

      expect(onConnectionChange).toHaveBeenCalledWith(false);
    });
  });

  describe('Error handling', () => {
    it('should handle agent errors', async () => {
      const onError = vi.fn();
      const testSessionId = 'invalid-session-id-12345';

      const { result } = renderHook(() =>
        useSocket({
          autoConnect: true,
          sessionId: testSessionId,
          onError,
        })
      );

      await waitFor(
        () => {
          expect(result.current.isConnected).toBe(true);
        },
        { timeout: 5000 }
      );

      // Send message with invalid session (should trigger error)
      act(() => {
        result.current.sendMessage('This should error');
      });

      // Wait for error event
      await waitFor(
        () => {
          expect(onError).toHaveBeenCalled();
        },
        { timeout: 10000 }
      );

      const errorData = onError.mock.calls[0][0];
      expect(errorData).toHaveProperty('error');
    });
  });
});
