/**
 * Critical Tests for useChat Event Handling
 *
 * Tests the unified agent:event listener with discriminated union pattern.
 * Verifies that the migration from legacy events to unified events works correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentEvent } from '@/types/events';
import { useChat } from '@/hooks/useChat';
import type { Socket } from 'socket.io-client';

// Mock WebSocket context
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  once: vi.fn(),
} as unknown as Socket;

const mockIsConnected = true;

vi.mock('@/contexts/websocket', () => ({
  useWebSocket: () => ({
    socket: mockSocket,
    isConnected: mockIsConnected,
  }),
}));

// Mock API client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    sessions: {
      list: vi.fn().mockResolvedValue({ sessions: [] }),
      get: vi.fn().mockResolvedValue({ session: { id: 'test-session', title: 'Test' } }),
      create: vi.fn().mockResolvedValue({ session: { id: 'new-session', title: 'New' } }),
      delete: vi.fn().mockResolvedValue({}),
    },
    messages: {
      list: vi.fn().mockResolvedValue({ messages: [] }),
    },
  },
}));

describe('useChat - Unified Event Handling', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should register unified agent:event listener on mount', () => {
    renderHook(() => useChat('test-session'), { wrapper });

    // Should register 'agent:event' listener (not legacy individual listeners)
    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCalls = calls.filter((call) => call[0] === 'agent:event');

    expect(agentEventCalls.length).toBeGreaterThan(0);
    expect(agentEventCalls[0][0]).toBe('agent:event');
  });

  it('should NOT register legacy event listeners', () => {
    renderHook(() => useChat('test-session'), { wrapper });

    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const legacyEvents = [
      'agent:message_complete',
      'agent:thinking',
      'agent:tool_use',
      'agent:tool_result',
      'agent:message_chunk',
      'agent:complete',
    ];

    legacyEvents.forEach((eventName) => {
      const legacyCalls = calls.filter((call) => call[0] === eventName);
      expect(legacyCalls.length).toBe(0);
    });
  });

  it('should handle message_chunk event correctly', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    // Get the registered event handler
    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    // Simulate message_chunk event
    const chunkEvent: AgentEvent = {
      type: 'message_chunk',
      content: 'Hello',
      eventId: 'event-1',
      sequenceNumber: 1,
      persistenceState: 'queued',
      timestamp: new Date(),
    };

    eventHandler(chunkEvent);

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.streamingMessage).toBe('Hello');
    });
  });

  it('should handle message event with sequence_number correctly', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    // Get the registered event handler
    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    // Simulate message event
    const messageEvent: AgentEvent = {
      type: 'message',
      content: 'Complete response',
      stopReason: 'end_turn',
      tokenCount: 100,
      eventId: 'event-2',
      sequenceNumber: 2,
      persistenceState: 'persisted',
      timestamp: new Date(),
    };

    eventHandler(messageEvent);

    await waitFor(() => {
      const messages = result.current.messages;
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = messages[messages.length - 1];

      // Verify message has sequence_number
      expect('sequence_number' in lastMessage).toBe(true);
      if ('sequence_number' in lastMessage) {
        expect(lastMessage.sequence_number).toBe(2);
      }

      // Verify stop_reason from SDK
      if ('stop_reason' in lastMessage) {
        expect(lastMessage.stop_reason).toBe('end_turn');
      }
    });
  });

  it('should handle tool_use event correctly', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    // Simulate tool_use event
    const toolUseEvent: AgentEvent = {
      type: 'tool_use',
      toolName: 'test_tool',
      toolArgs: { param: 'value' },
      requiresApproval: false,
      eventId: 'event-3',
      sequenceNumber: 3,
      persistenceState: 'queued',
      timestamp: new Date(),
    };

    eventHandler(toolUseEvent);

    await waitFor(() => {
      const messages = result.current.messages;
      const toolMessage = messages.find((m) => 'type' in m && m.type === 'tool_use');

      expect(toolMessage).toBeDefined();
      if (toolMessage && 'tool_name' in toolMessage) {
        expect(toolMessage.tool_name).toBe('test_tool');
        expect(toolMessage.status).toBe('pending');
      }
    });
  });

  it('should handle thinking event correctly', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    // Simulate thinking event
    const thinkingEvent: AgentEvent = {
      type: 'thinking',
      content: 'Analyzing data...',
      eventId: 'event-4',
      sequenceNumber: 4,
      persistenceState: 'queued',
      timestamp: new Date(),
    };

    eventHandler(thinkingEvent);

    await waitFor(() => {
      expect(result.current.isThinking).toBe(true);

      const messages = result.current.messages;
      const thinkingMessage = messages.find((m) => 'type' in m && m.type === 'thinking');

      expect(thinkingMessage).toBeDefined();
      if (thinkingMessage && 'content' in thinkingMessage) {
        expect(thinkingMessage.content).toBe('Analyzing data...');
      }
    });
  });

  it('should handle complete event and clear streaming state', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    // First, set streaming state
    const chunkEvent: AgentEvent = {
      type: 'message_chunk',
      content: 'Test',
      eventId: 'event-5',
      sequenceNumber: 5,
      persistenceState: 'queued',
      timestamp: new Date(),
    };
    eventHandler(chunkEvent);

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    // Then send complete event
    const completeEvent: AgentEvent = {
      type: 'complete',
      reason: 'finished',
      eventId: 'event-6',
      sequenceNumber: 6,
      persistenceState: 'persisted',
      timestamp: new Date(),
    };
    eventHandler(completeEvent);

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingMessage).toBe('');
      expect(result.current.isThinking).toBe(false);
    });
  });

  it('should handle error event correctly', async () => {
    const { result } = renderHook(() => useChat('test-session'), { wrapper });

    const calls = (mockSocket.on as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventCall = calls.find((call) => call[0] === 'agent:event');
    const eventHandler = agentEventCall?.[1] as (event: AgentEvent) => void;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Simulate error event
    const errorEvent: AgentEvent = {
      type: 'error',
      error: 'Test error',
      code: 'TEST_ERROR',
      recoverable: false,
      eventId: 'event-7',
      sequenceNumber: 7,
      persistenceState: 'failed',
      timestamp: new Date(),
    };

    eventHandler(errorEvent);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('[useChat] Agent error:', 'Test error', 'TEST_ERROR');
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isThinking).toBe(false);
    });

    consoleSpy.mockRestore();
  });

  it('should cleanup event listeners on unmount', () => {
    const { unmount } = renderHook(() => useChat('test-session'), { wrapper });

    unmount();

    // Should unregister 'agent:event' listener
    const offCalls = (mockSocket.off as ReturnType<typeof vi.fn>).mock.calls;
    const agentEventOffCalls = offCalls.filter((call) => call[0] === 'agent:event');

    expect(agentEventOffCalls.length).toBeGreaterThan(0);
  });
});
