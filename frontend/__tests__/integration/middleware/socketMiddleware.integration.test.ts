/**
 * socketMiddleware Integration Tests
 *
 * Tests the full integration between socketMiddleware, SocketService, and the REAL Backend.
 * Verifies that events are correctly emitted, received, and processed by stores.
 *
 * @module __tests__/integration/middleware/socketMiddleware.integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSocket } from '@/lib/stores/socketMiddleware';
import { useChatStore } from '@/lib/stores/chatStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { getSocketService } from '@/lib/services/socket';
import { AgentEventFactory } from '../../fixtures/AgentEventFactory';

// Test Auth Token (must match backend/src/middleware/testAuth.ts)
const TEST_AUTH_TOKEN = 'test-auth-token-12345';

describe('socketMiddleware Integration (Real Backend)', () => {
  let sessionId: string;

  beforeEach(() => {
    // Reset stores
    act(() => {
      useChatStore.getState().reset();
      useAuthStore.getState().reset();
    });

    // Set test auth token
    localStorage.setItem('test_auth_token', TEST_AUTH_TOKEN);
    
    // Generate a new session ID for each test
    sessionId = `test-session-${Date.now()}`;
  });

  afterEach(() => {
    const socket = getSocketService();
    socket.disconnect();
    localStorage.removeItem('test_auth_token');
  });

  it('should connect to real backend and join session', async () => {
    const { result } = renderHook(() => useSocket({ 
      sessionId,
      autoConnect: true 
    }));

    // Wait for connection
    await waitFor(() => {
      expect(getSocketService().isConnected).toBe(true);
    }, { timeout: 5000 });

    // Verify session joined (backend should emit session:joined or we can check socket state)
    // Since we don't have direct access to backend state here, we rely on socket state
    expect(getSocketService().sessionId).toBe(sessionId);
  });

  it('should send message and receive confirmation from real backend', async () => {
    const { result } = renderHook(() => useSocket({ 
      sessionId,
      autoConnect: true 
    }));

    // Wait for connection
    await waitFor(() => {
      expect(getSocketService().isConnected).toBe(true);
    }, { timeout: 5000 });

    // Send message
    await act(async () => {
      result.current.sendMessage('Hello from integration test');
    });

    // Verify optimistic update
    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello from integration test');
    expect(messages[0].role).toBe('user');

    // Wait for backend response (thinking or message)
    // This confirms the backend received the message and is processing it
    await waitFor(() => {
      const state = useChatStore.getState();
      // Either we got a response message or we are streaming/thinking
      const hasResponse = state.messages.length > 1;
      const isStreaming = state.streaming;
      expect(hasResponse || isStreaming).toBe(true);
    }, { timeout: 15000 }); // Give backend time to process
  });

  it('should handle tool execution flow', async () => {
    // This test requires the agent to actually use a tool.
    // We can prompt it to use a tool.
    const { result } = renderHook(() => useSocket({ 
      sessionId,
      autoConnect: true 
    }));

    await waitFor(() => {
      expect(getSocketService().isConnected).toBe(true);
    }, { timeout: 5000 });

    await act(async () => {
      result.current.sendMessage('List my customers');
    });

    // Wait for tool use event
    await waitFor(() => {
      const toolExecutions = useChatStore.getState().toolExecutions;
      expect(toolExecutions.length).toBeGreaterThan(0);
      expect(toolExecutions[0].toolName).toContain('customer');
    }, { timeout: 20000 });
  });
});
