/**
 * Socket.IO Mock Factory
 *
 * Provides a mock Socket.IO client for testing SocketService.
 * Uses factory pattern for test isolation - each test gets a fresh instance.
 *
 * @module __tests__/mocks/socketMock
 */

import { vi, type Mock } from 'vitest';

type EventCallback = (...args: unknown[]) => void;

/**
 * Mock Socket interface matching Socket.IO client
 */
export interface MockSocket {
  /** Connection state */
  connected: boolean;
  /** Socket ID */
  id: string;

  // Event emitter methods
  on: Mock<(event: string, callback: EventCallback) => MockSocket>;
  off: Mock<(event: string, callback?: EventCallback) => MockSocket>;
  emit: Mock<(event: string, ...args: unknown[]) => MockSocket>;
  once: Mock<(event: string, callback: EventCallback) => MockSocket>;

  // Connection methods
  connect: Mock<() => MockSocket>;
  disconnect: Mock<() => MockSocket>;

  // Test utilities (not part of real Socket.IO)
  /** Trigger an event as if server sent it */
  _trigger: (event: string, ...args: unknown[]) => void;
  /** Map of registered event listeners */
  _listeners: Map<string, Set<EventCallback>>;
  /** Clear all listeners and reset state */
  _reset: () => void;
}

/**
 * Create a mock Socket.IO socket instance
 *
 * @param options Configuration options
 * @param options.connected Initial connection state (default: false)
 * @param options.id Socket ID (default: auto-generated)
 *
 * @example
 * ```typescript
 * const mockSocket = createMockSocket({ connected: true });
 *
 * // Simulate server event
 * mockSocket._trigger('agent:event', { type: 'message', content: 'Hello' });
 *
 * // Verify client emission
 * expect(mockSocket.emit).toHaveBeenCalledWith('chat:message', { message: 'Hi' });
 * ```
 */
export function createMockSocket(
  options: { connected?: boolean; id?: string } = {}
): MockSocket {
  const listeners = new Map<string, Set<EventCallback>>();

  const socket: MockSocket = {
    connected: options.connected ?? false,
    id: options.id ?? `mock-socket-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,

    on: vi.fn((event: string, callback: EventCallback) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
      return socket;
    }),

    off: vi.fn((event: string, callback?: EventCallback) => {
      if (callback && listeners.has(event)) {
        listeners.get(event)!.delete(callback);
      } else if (!callback) {
        listeners.delete(event);
      }
      return socket;
    }),

    emit: vi.fn((_event: string, ..._args: unknown[]) => {
      return socket;
    }),

    once: vi.fn((event: string, callback: EventCallback) => {
      const onceCallback: EventCallback = (...args: unknown[]) => {
        listeners.get(event)?.delete(onceCallback);
        callback(...args);
      };
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(onceCallback);
      return socket;
    }),

    connect: vi.fn(() => {
      socket.connected = true;
      // Simulate async connect event
      queueMicrotask(() => {
        socket._trigger('connect');
      });
      return socket;
    }),

    disconnect: vi.fn(() => {
      socket.connected = false;
      // Simulate async disconnect event
      queueMicrotask(() => {
        socket._trigger('disconnect', 'io client disconnect');
      });
      return socket;
    }),

    _trigger: (event: string, ...args: unknown[]) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach((callback) => {
          try {
            callback(...args);
          } catch (error) {
            console.error(`Error in mock socket event handler for "${event}":`, error);
          }
        });
      }
    },

    _listeners: listeners,

    _reset: () => {
      listeners.clear();
      socket.connected = false;
      vi.mocked(socket.on).mockClear();
      vi.mocked(socket.off).mockClear();
      vi.mocked(socket.emit).mockClear();
      vi.mocked(socket.once).mockClear();
      vi.mocked(socket.connect).mockClear();
      vi.mocked(socket.disconnect).mockClear();
    },
  };

  return socket;
}

/**
 * Mock io() function from socket.io-client
 * Returns a MockSocket that can be configured for testing
 */
export const mockIo = vi.fn((_url?: string, _options?: unknown) => {
  return createMockSocket();
});

/**
 * Get mock socket instance from last io() call
 * Useful for accessing the mock after SocketService creates it internally
 */
export function getLastMockSocket(): MockSocket | undefined {
  const calls = mockIo.mock.results;
  if (calls.length > 0) {
    return calls[calls.length - 1]?.value as MockSocket;
  }
  return undefined;
}

/**
 * Reset mockIo and clear all call history
 */
export function resetMockIo(): void {
  mockIo.mockClear();
}

/**
 * Configure mockIo to return a specific mock socket
 * Useful when you need to preconfigure the socket before SocketService.connect()
 *
 * @example
 * ```typescript
 * const mockSocket = createMockSocket({ connected: true });
 * setMockSocket(mockSocket);
 *
 * const service = new SocketService();
 * service.connect();
 *
 * // mockSocket will be used by the service
 * mockSocket._trigger('agent:event', { type: 'complete', reason: 'success' });
 * ```
 */
export function setMockSocket(socket: MockSocket): void {
  mockIo.mockReturnValue(socket);
}

/**
 * Simulate server event on the last created mock socket
 * Convenience function for tests that don't need direct socket access
 */
export function simulateServerEvent(event: string, ...args: unknown[]): void {
  const socket = getLastMockSocket();
  if (socket) {
    socket._trigger(event, ...args);
  } else {
    throw new Error('No mock socket available. Call io() first.');
  }
}

/**
 * Assert that the mock socket emitted a specific event
 */
export function assertEmitted(
  socket: MockSocket,
  event: string,
  ...expectedArgs: unknown[]
): void {
  const emitCalls = socket.emit.mock.calls;
  const matchingCall = emitCalls.find(
    (call) => call[0] === event
  );

  if (!matchingCall) {
    const emittedEvents = emitCalls.map((call) => call[0]).join(', ');
    throw new Error(
      `Expected socket to emit "${event}" but it emitted: [${emittedEvents}]`
    );
  }

  if (expectedArgs.length > 0) {
    const actualArgs = matchingCall.slice(1);
    expect(actualArgs).toEqual(expectedArgs);
  }
}

/**
 * Assert that the mock socket registered a listener for a specific event
 */
export function assertListenerRegistered(
  socket: MockSocket,
  event: string
): void {
  const listeners = socket._listeners.get(event);
  if (!listeners || listeners.size === 0) {
    throw new Error(`Expected socket to have listener for "${event}" but none was registered`);
  }
}

/**
 * Get all events that the socket has emitted
 */
export function getEmittedEvents(socket: MockSocket): string[] {
  return socket.emit.mock.calls.map((call) => call[0] as string);
}

/**
 * Get all registered event listener names
 */
export function getRegisteredListeners(socket: MockSocket): string[] {
  return Array.from(socket._listeners.keys());
}
