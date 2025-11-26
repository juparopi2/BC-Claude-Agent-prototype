/**
 * TestSocketClient - Socket.IO Client Wrapper for Integration Tests
 *
 * Provides a type-safe wrapper around socket.io-client for testing
 * WebSocket flows without requiring a real frontend.
 *
 * Features:
 * - Async/await API for event handling
 * - Type-safe event collection
 * - Automatic connection management
 * - Timeout-based event waiting
 *
 * @module __tests__/integration/helpers/TestSocketClient
 */

import { io, Socket } from 'socket.io-client';
import type { AgentEvent } from '@/types/websocket.types';

/**
 * Options for creating a test socket client
 */
export interface TestSocketClientOptions {
  /** Server port to connect to */
  port: number;
  /** Session cookie for authentication (format: 'connect.sid=s%3A...') */
  sessionCookie?: string;
  /** Default timeout for waiting operations (ms) */
  defaultTimeout?: number;
  /** Optional auth token */
  authToken?: string;
}

/**
 * Received event with type and full data
 */
export interface ReceivedEvent {
  type: string;
  data: AgentEvent;
  timestamp: Date;
}

/**
 * Test Socket Client
 *
 * Wraps socket.io-client for integration testing.
 * Collects all events and provides async waiting utilities.
 */
export class TestSocketClient {
  private socket: Socket | null = null;
  private receivedEvents: ReceivedEvent[] = [];
  private eventPromises: Map<string, Array<{
    resolve: (event: AgentEvent) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>> = new Map();
  private defaultTimeout: number;
  private connected = false;
  private connectionError: Error | null = null;

  constructor(private options: TestSocketClientOptions) {
    this.defaultTimeout = options.defaultTimeout || 10000;
  }

  /**
   * Connect to the Socket.IO server
   *
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${this.options.port}`;

      // Build connection options
      const socketOptions: Parameters<typeof io>[1] = {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: false, // Disable for tests - we want explicit failures
        timeout: this.defaultTimeout,
      };

      // Add auth if provided
      if (this.options.sessionCookie) {
        socketOptions.extraHeaders = {
          Cookie: this.options.sessionCookie,
        };
      }

      if (this.options.authToken) {
        socketOptions.auth = {
          token: this.options.authToken,
        };
      }

      this.socket = io(url, socketOptions);

      // Connection success
      this.socket.on('connect', () => {
        this.connected = true;
        this.connectionError = null;
        resolve();
      });

      // Connection error
      this.socket.on('connect_error', (error: Error) => {
        this.connected = false;
        this.connectionError = error;
        reject(new Error(`Socket connection failed: ${error.message}`));
      });

      // Disconnect
      this.socket.on('disconnect', (reason: string) => {
        this.connected = false;
        // Don't reject on intentional disconnect
        if (reason !== 'io client disconnect') {
          this.connectionError = new Error(`Unexpected disconnect: ${reason}`);
        }
      });

      // Listen for agent:event (main event type)
      this.socket.on('agent:event', (data: AgentEvent) => {
        this.handleEvent('agent:event', data);
      });

      // Listen for agent:error (error events)
      this.socket.on('agent:error', (data: { error: string; sessionId: string }) => {
        this.handleEvent('agent:error', data as unknown as AgentEvent);
      });

      // Listen for session events
      this.socket.on('session:joined', (data: unknown) => {
        this.handleEvent('session:joined', data as AgentEvent);
      });

      this.socket.on('session:error', (data: unknown) => {
        this.handleEvent('session:error', data as AgentEvent);
      });

      this.socket.on('session:left', (data: unknown) => {
        this.handleEvent('session:left', data as AgentEvent);
      });

      // Listen for pong (ping response)
      this.socket.on('pong', (data: unknown) => {
        this.handleEvent('pong', data as AgentEvent);
      });

      // Listen for connected event
      this.socket.on('connected', (data: unknown) => {
        this.handleEvent('connected', data as AgentEvent);
      });

      // Set connection timeout
      setTimeout(() => {
        if (!this.connected) {
          this.socket?.disconnect();
          reject(new Error(`Connection timeout after ${this.defaultTimeout}ms`));
        }
      }, this.defaultTimeout);
    });
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.socket !== null;
  }

  /**
   * Get socket ID
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Join a session room
   *
   * @param sessionId - Session ID to join
   * @returns Promise resolving when joined
   */
  async joinSession(sessionId: string): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Join session timeout after ${this.defaultTimeout}ms`));
      }, this.defaultTimeout);

      // Listen for success
      const onJoined = (data: { sessionId: string }) => {
        if (data.sessionId === sessionId) {
          clearTimeout(timeout);
          this.socket?.off('session:joined', onJoined);
          this.socket?.off('session:error', onError);
          resolve();
        }
      };

      // Listen for error
      const onError = (data: { error: string; sessionId: string }) => {
        if (data.sessionId === sessionId) {
          clearTimeout(timeout);
          this.socket?.off('session:joined', onJoined);
          this.socket?.off('session:error', onError);
          reject(new Error(data.error));
        }
      };

      this.socket.on('session:joined', onJoined);
      this.socket.on('session:error', onError);
      this.socket.emit('session:join', { sessionId });
    });
  }

  /**
   * Leave a session room
   *
   * @param sessionId - Session ID to leave
   */
  async leaveSession(sessionId: string): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    this.socket.emit('session:leave', { sessionId });
  }

  /**
   * Send a chat message
   *
   * @param sessionId - Session ID
   * @param message - Message content
   * @param options - Optional thinking config
   */
  async sendMessage(
    sessionId: string,
    message: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
    }
  ): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const payload = {
      sessionId,
      message,
      thinking: options ? {
        enableThinking: options.enableThinking,
        thinkingBudget: options.thinkingBudget,
      } : undefined,
    };

    this.socket.emit('chat:message', payload);
  }

  /**
   * Send approval response
   *
   * @param approvalId - Approval ID
   * @param decision - 'approved' or 'rejected'
   */
  async respondToApproval(
    approvalId: string,
    decision: 'approved' | 'rejected'
  ): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    this.socket.emit('approval:response', { approvalId, decision });
  }

  /**
   * Wait for a specific event type
   *
   * @param eventType - Event type to wait for (e.g., 'message', 'complete')
   * @param timeout - Optional timeout (uses default if not provided)
   * @returns Promise resolving to the event data
   */
  async waitForEvent(
    eventType: string,
    timeout?: number
  ): Promise<AgentEvent> {
    const timeoutMs = timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      // Check if we already have the event
      const existing = this.receivedEvents.find(e => {
        if (eventType === 'agent:event') return true;
        if (e.type === 'agent:event') {
          return (e.data as AgentEvent).type === eventType;
        }
        return e.type === eventType;
      });

      if (existing) {
        resolve(existing.data);
        return;
      }

      // Set up promise to wait
      const timeoutHandle = setTimeout(() => {
        const promises = this.eventPromises.get(eventType);
        if (promises) {
          const index = promises.findIndex(p => p.timeout === timeoutHandle);
          if (index !== -1) {
            promises.splice(index, 1);
          }
        }
        reject(new Error(`Timeout waiting for event type: ${eventType} (${timeoutMs}ms)`));
      }, timeoutMs);

      const existingPromises = this.eventPromises.get(eventType) || [];
      existingPromises.push({ resolve, reject, timeout: timeoutHandle });
      this.eventPromises.set(eventType, existingPromises);
    });
  }

  /**
   * Wait for an agent event with specific type
   *
   * @param agentEventType - The AgentEvent.type to wait for
   * @param timeout - Optional timeout
   */
  async waitForAgentEvent(
    agentEventType: AgentEvent['type'],
    timeout?: number
  ): Promise<AgentEvent> {
    const timeoutMs = timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      // Check existing events
      const existing = this.receivedEvents.find(e => {
        if (e.type === 'agent:event' && e.data.type === agentEventType) {
          return true;
        }
        return false;
      });

      if (existing) {
        resolve(existing.data);
        return;
      }

      // Set up wait
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Timeout waiting for agent event: ${agentEventType} (${timeoutMs}ms)`));
      }, timeoutMs);

      // Register for this specific type
      const key = `agent:${agentEventType}`;
      const existingPromises = this.eventPromises.get(key) || [];
      existingPromises.push({ resolve, reject, timeout: timeoutHandle });
      this.eventPromises.set(key, existingPromises);
    });
  }

  /**
   * Collect multiple events of a type
   *
   * @param eventType - Event type to collect
   * @param count - Number of events to collect
   * @param timeout - Optional timeout
   */
  async collectEvents(
    eventType: string,
    count: number,
    timeout?: number
  ): Promise<AgentEvent[]> {
    const timeoutMs = timeout || this.defaultTimeout;
    const collected: AgentEvent[] = [];

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Timeout collecting ${count} events of type ${eventType} (got ${collected.length})`));
      }, timeoutMs);

      const checkComplete = () => {
        if (collected.length >= count) {
          clearTimeout(timeoutHandle);
          resolve(collected);
        }
      };

      // Check existing events
      for (const event of this.receivedEvents) {
        const matches = eventType === 'agent:event' ||
          (event.type === 'agent:event' && event.data.type === eventType) ||
          event.type === eventType;

        if (matches) {
          collected.push(event.data);
          if (collected.length >= count) {
            clearTimeout(timeoutHandle);
            resolve(collected);
            return;
          }
        }
      }

      // Register for more
      const key = `collect:${eventType}:${Date.now()}`;
      const handler = {
        resolve: (event: AgentEvent) => {
          collected.push(event);
          checkComplete();
        },
        reject,
        timeout: timeoutHandle,
      };
      this.eventPromises.set(key, [handler]);
    });
  }

  /**
   * Get all received events
   */
  getReceivedEvents(): ReceivedEvent[] {
    return [...this.receivedEvents];
  }

  /**
   * Get received events of a specific type
   */
  getEventsByType(eventType: string): AgentEvent[] {
    return this.receivedEvents
      .filter(e => {
        if (e.type === 'agent:event') {
          return e.data.type === eventType;
        }
        return e.type === eventType;
      })
      .map(e => e.data);
  }

  /**
   * Clear collected events
   */
  clearEvents(): void {
    this.receivedEvents = [];
  }

  /**
   * Get the last connection error
   */
  getConnectionError(): Error | null {
    return this.connectionError;
  }

  /**
   * Emit a raw event (for testing edge cases)
   */
  emitRaw(event: string, data: unknown): void {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    this.socket.emit(event, data);
  }

  /**
   * Handle incoming event
   */
  private handleEvent(socketEventType: string, data: AgentEvent): void {
    const event: ReceivedEvent = {
      type: socketEventType,
      data,
      timestamp: new Date(),
    };

    this.receivedEvents.push(event);

    // Resolve pending promises for this event type
    const keysToCheck = [
      socketEventType,
      `agent:${data.type}`,
      ...Array.from(this.eventPromises.keys()).filter(k => k.startsWith('collect:')),
    ];

    for (const key of keysToCheck) {
      const promises = this.eventPromises.get(key);
      if (promises && promises.length > 0) {
        const promise = promises[0];
        if (promise) {
          clearTimeout(promise.timeout);
          promise.resolve(data);

          // Remove resolved promise
          if (!key.startsWith('collect:')) {
            promises.shift();
            if (promises.length === 0) {
              this.eventPromises.delete(key);
            }
          }
        }
      }
    }
  }
}

/**
 * Create a test socket client
 *
 * Factory function for creating TestSocketClient instances.
 *
 * @param options - Client options
 * @returns New TestSocketClient instance
 */
export function createTestSocketClient(options: TestSocketClientOptions): TestSocketClient {
  return new TestSocketClient(options);
}
