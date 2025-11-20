/**
 * WebSocket Context Tests
 *
 * Tests for WebSocketProvider focusing on API surface and integration.
 * Note: Full integration testing of joinSessionAndWait retry logic requires
 * a running backend. These tests verify the API contract and basic behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { WebSocketProvider, useWebSocket } from '@/contexts/websocket';
import type { ReactNode } from 'react';

// Mock socket.io-client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSocket: any;

vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(() => mockSocket),
  };
});

describe('WebSocketProvider', () => {
  beforeEach(() => {
    // Create fresh mock socket for each test
    mockSocket = {
      id: 'mock-socket-id',
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    // Mock console methods to keep tests clean
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WebSocketProvider>{children}</WebSocketProvider>
  );

  /**
   * Test 1: Provider exposes correct API
   */
  it('should expose all WebSocket context methods', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    // Verify all methods are available
    expect(result.current.socket).toBeDefined();
    expect(result.current.isConnected).toBeDefined();
    expect(typeof result.current.joinSession).toBe('function');
    expect(typeof result.current.leaveSession).toBe('function');
    expect(typeof result.current.joinSessionAndWait).toBe('function');
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.respondToApproval).toBe('function');
    expect(typeof result.current.onAgentEvent).toBe('function');
    expect(typeof result.current.onApprovalRequested).toBe('function');
    expect(typeof result.current.onApprovalResolved).toBe('function');
  });

  /**
   * Test 2: Provider throws error outside context
   */
  it('should throw error when used outside provider', () => {
    expect(() => {
      renderHook(() => useWebSocket());
    }).toThrow('useWebSocket must be used within WebSocketProvider');
  });

  /**
   * Test 3: joinSession emits correct event
   */
  it('should emit session:join event when joinSession is called', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    result.current.joinSession('test-session-123');

    expect(mockSocket.emit).toHaveBeenCalledWith('session:join', {
      sessionId: 'test-session-123',
    });
  });

  /**
   * Test 4: leaveSession emits correct event
   */
  it('should emit session:leave event when leaveSession is called', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    result.current.leaveSession('test-session-456');

    expect(mockSocket.emit).toHaveBeenCalledWith('session:leave', {
      sessionId: 'test-session-456',
    });
  });

  /**
   * Test 5: sendMessage emits correct event
   */
  it('should emit chat:message event when sendMessage is called', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    result.current.sendMessage('session-789', 'Hello world', 'user-123');

    expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', {
      message: 'Hello world',
      sessionId: 'session-789',
      userId: 'user-123',
    });
  });

  /**
   * Test 6: respondToApproval emits correct event
   */
  it('should emit approval:respond event when respondToApproval is called', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    result.current.respondToApproval('approval-001', true, 'user-456');

    expect(mockSocket.emit).toHaveBeenCalledWith('approval:respond', {
      approvalId: 'approval-001',
      approved: true,
      userId: 'user-456',
    });
  });

  /**
   * Test 7: onAgentEvent registers listener
   */
  it('should register listener for agent:event', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    const mockHandler = vi.fn();
    const cleanup = result.current.onAgentEvent(mockHandler);

    expect(mockSocket.on).toHaveBeenCalledWith('agent:event', mockHandler);
    expect(typeof cleanup).toBe('function');

    // Call cleanup
    cleanup();
    expect(mockSocket.off).toHaveBeenCalledWith('agent:event', mockHandler);
  });

  /**
   * Test 8: onApprovalRequested registers listener
   */
  it('should register listener for approval:requested', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    const mockHandler = vi.fn();
    const cleanup = result.current.onApprovalRequested(mockHandler);

    expect(mockSocket.on).toHaveBeenCalledWith('approval:requested', mockHandler);
    expect(typeof cleanup).toBe('function');

    cleanup();
    expect(mockSocket.off).toHaveBeenCalledWith('approval:requested', mockHandler);
  });

  /**
   * Test 9: onApprovalResolved registers listener
   */
  it('should register listener for approval:resolved', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    const mockHandler = vi.fn();
    const cleanup = result.current.onApprovalResolved(mockHandler);

    expect(mockSocket.on).toHaveBeenCalledWith('approval:resolved', mockHandler);
    expect(typeof cleanup).toBe('function');

    cleanup();
    expect(mockSocket.off).toHaveBeenCalledWith('approval:resolved', mockHandler);
  });

  /**
   * Test 10: joinSessionAndWait is a Promise
   */
  it('should return a Promise from joinSessionAndWait', () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    const promise = result.current.joinSessionAndWait('test-session');

    expect(promise).toBeInstanceOf(Promise);
  });
});

/**
 * joinSessionAndWait Retry Logic Tests
 *
 * These tests verify the retry behavior of joinSessionAndWait.
 * For full E2E testing, run against a live backend.
 */
describe('WebSocketProvider - joinSessionAndWait behavior', () => {
  beforeEach(() => {
    mockSocket = {
      id: 'mock-socket-id',
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn((event: string, handler: (data: { sessionId: string }) => void) => {
        // Simulate immediate success for basic tests
        if (event === 'session:joined') {
          setTimeout(() => handler({ sessionId: 'test-session' }), 10);
        }
      }),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WebSocketProvider>{children}</WebSocketProvider>
  );

  /**
   * Test 11: joinSessionAndWait resolves on success
   */
  it('should resolve when backend confirms session:joined', async () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    // Should resolve without error
    await expect(
      result.current.joinSessionAndWait('test-session')
    ).resolves.toBeUndefined();

    // Verify emit was called
    expect(mockSocket.emit).toHaveBeenCalledWith('session:join', {
      sessionId: 'test-session',
    });
  });

  /**
   * Test 12: joinSessionAndWait with custom timeout
   */
  it('should accept custom timeout parameter', async () => {
    const { result } = renderHook(() => useWebSocket(), { wrapper });

    // Should work with custom timeout
    await expect(
      result.current.joinSessionAndWait('test-session', 5000)
    ).resolves.toBeUndefined();
  });
});
