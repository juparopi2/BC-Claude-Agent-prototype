/**
 * E2ETestClient - Unified HTTP + WebSocket Client for E2E Tests
 *
 * Simulates a complete frontend client with:
 * - HTTP client for REST API calls
 * - WebSocket client for real-time events
 * - Session management (authentication)
 * - Event collection and waiting utilities
 *
 * @module __tests__/e2e/helpers/E2ETestClient
 */

import { io, Socket } from 'socket.io-client';
import type { AgentEvent } from '@/types/websocket.types';
import { E2E_CONFIG } from '../setup.e2e';

/**
 * Options for creating an E2E test client
 */
export interface E2ETestClientOptions {
  /** Base URL for HTTP requests (default: from E2E_CONFIG) */
  baseUrl?: string;
  /** Session cookie for authentication */
  sessionCookie?: string;
  /** Default timeout for operations (ms) */
  timeout?: number;
}

/**
 * HTTP response wrapper
 */
export interface E2EHttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Headers;
  body: T;
  ok: boolean;
}

/**
 * Received event with metadata
 */
export interface E2EReceivedEvent {
  type: string;
  socketEventType: string;
  data: AgentEvent;
  timestamp: Date;
}

/**
 * E2E Test Client
 *
 * Provides a unified interface for testing both REST API and WebSocket
 * interactions, simulating a real frontend client.
 */
export class E2ETestClient {
  private baseUrl: string;
  private socket: Socket | null = null;
  private sessionCookie: string | null = null;
  private receivedEvents: E2EReceivedEvent[] = [];
  private eventWaiters: Map<string, Array<{
    resolve: (event: AgentEvent) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    filter?: (event: AgentEvent) => boolean;
  }>> = new Map();
  private defaultTimeout: number;
  private connected = false;

  constructor(options: E2ETestClientOptions = {}) {
    this.baseUrl = options.baseUrl || E2E_CONFIG.baseUrl;
    this.sessionCookie = options.sessionCookie || null;
    this.defaultTimeout = options.timeout || E2E_CONFIG.defaultTimeout;
  }

  // ==================== Authentication ====================

  /**
   * Set the session cookie for authenticated requests
   */
  setSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
  }

  /**
   * Get the current session cookie
   */
  getSessionCookie(): string | null {
    return this.sessionCookie;
  }

  /**
   * Clear the session cookie
   */
  clearSession(): void {
    this.sessionCookie = null;
  }

  // ==================== HTTP Methods ====================

  /**
   * Make an HTTP request
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      redirect?: RequestRedirect;
    }
  ): Promise<E2EHttpResponse<T>> {
    let url = `${this.baseUrl}${path}`;

    // Add query parameters
    if (options?.query) {
      const params = new URLSearchParams(options.query);
      url += `?${params.toString()}`;
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Add session cookie if available
    if (this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    }

    // Make request
    const response = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
      redirect: options?.redirect,
    });

    // Parse response body
    let body: T;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      body = await response.json() as T;
    } else {
      body = await response.text() as unknown as T;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body,
      ok: response.ok,
    };
  }

  /**
   * GET request
   */
  async get<T = unknown>(
    path: string,
    query?: Record<string, string>
  ): Promise<E2EHttpResponse<T>> {
    return this.request<T>('GET', path, { query });
  }

  /**
   * POST request
   */
  async post<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<E2EHttpResponse<T>> {
    return this.request<T>('POST', path, { body });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<E2EHttpResponse<T>> {
    return this.request<T>('PUT', path, { body });
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(path: string): Promise<E2EHttpResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Upload a file (multipart/form-data)
   */
  async uploadFile(
    path: string,
    file: Buffer | Blob,
    filename: string,
    additionalFields?: Record<string, string>
  ): Promise<E2EHttpResponse<unknown>> {
    const formData = new FormData();

    // Add file
    const blob = file instanceof Buffer ? new Blob([file]) : file;
    formData.append('file', blob, filename);

    // Add additional fields
    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        formData.append(key, value);
      }
    }

    const headers: Record<string, string> = {};
    if (this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    let body: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body,
      ok: response.ok,
    };
  }

  // ==================== WebSocket Methods ====================

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socketOptions: Parameters<typeof io>[1] = {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: false,
        timeout: this.defaultTimeout,
      };

      // Add session cookie for authentication
      if (this.sessionCookie) {
        socketOptions.extraHeaders = {
          Cookie: this.sessionCookie,
        };
      }

      this.socket = io(this.baseUrl, socketOptions);

      // Connection success
      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });

      // Connection error
      this.socket.on('connect_error', (error: Error) => {
        this.connected = false;
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });

      // Disconnect
      this.socket.on('disconnect', (reason: string) => {
        this.connected = false;
        if (reason !== 'io client disconnect') {
          console.warn(`[E2ETestClient] Unexpected disconnect: ${reason}`);
        }
      });

      // Listen for agent events
      this.socket.on('agent:event', (data: AgentEvent) => {
        this.handleEvent('agent:event', data);
      });

      // Listen for agent errors
      this.socket.on('agent:error', (data: unknown) => {
        this.handleEvent('agent:error', data as AgentEvent);
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

      // Connection timeout
      setTimeout(() => {
        if (!this.connected) {
          this.socket?.disconnect();
          reject(new Error(`WebSocket connection timeout after ${this.defaultTimeout}ms`));
        }
      }, this.defaultTimeout);
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected to WebSocket
   */
  isConnected(): boolean {
    return this.connected && this.socket !== null;
  }

  /**
   * Get the socket ID
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Join a session room
   */
  async joinSession(sessionId: string, timeoutMs?: number): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to WebSocket');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Join session timeout after ${timeoutMs || this.defaultTimeout}ms`));
      }, timeoutMs || this.defaultTimeout);

      const onJoined = (data: { sessionId: string }) => {
        if (data.sessionId === sessionId) {
          clearTimeout(timeout);
          this.socket?.off('session:joined', onJoined);
          this.socket?.off('session:error', onError);
          resolve();
        }
      };

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
   */
  async leaveSession(sessionId: string): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to WebSocket');
    }

    this.socket.emit('session:leave', { sessionId });
  }

  /**
   * Send a chat message
   */
  async sendMessage(
    sessionId: string,
    message: string,
    options?: {
      userId?: string;
      enableThinking?: boolean;
      thinkingBudget?: number;
    }
  ): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to WebSocket');
    }

    const payload = {
      sessionId,
      message,
      userId: options?.userId,
      thinking: options?.enableThinking !== undefined ? {
        enableThinking: options.enableThinking,
        thinkingBudget: options.thinkingBudget,
      } : undefined,
    };

    this.socket.emit('chat:message', payload);
  }

  /**
   * Respond to an approval request
   */
  async respondToApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    reason?: string
  ): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to WebSocket');
    }

    this.socket.emit('approval:response', { approvalId, decision, reason });
  }

  /**
   * Emit a raw event (for testing edge cases)
   */
  emitRaw(event: string, data: unknown): void {
    if (!this.socket) {
      throw new Error('Not connected to WebSocket');
    }
    this.socket.emit(event, data);
  }

  // ==================== Event Collection ====================

  /**
   * Wait for a specific event type
   */
  async waitForEvent(
    eventType: string,
    options?: {
      timeout?: number;
      filter?: (event: AgentEvent) => boolean;
    }
  ): Promise<AgentEvent> {
    const timeout = options?.timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      // Check existing events first
      const existing = this.findEvent(eventType, options?.filter);
      if (existing) {
        resolve(existing.data);
        return;
      }

      // Set up waiter
      const timeoutHandle = setTimeout(() => {
        this.removeWaiter(eventType, waiter);
        reject(new Error(`Timeout waiting for event: ${eventType} (${timeout}ms)`));
      }, timeout);

      const waiter = { resolve, reject, timeout: timeoutHandle, filter: options?.filter };
      const waiters = this.eventWaiters.get(eventType) || [];
      waiters.push(waiter);
      this.eventWaiters.set(eventType, waiters);
    });
  }

  /**
   * Wait for an agent event with specific type
   */
  async waitForAgentEvent(
    agentEventType: AgentEvent['type'],
    options?: {
      timeout?: number;
      filter?: (event: AgentEvent) => boolean;
    }
  ): Promise<AgentEvent> {
    return this.waitForEvent(`agent:${agentEventType}`, options);
  }

  /**
   * Wait for the 'complete' event
   */
  async waitForComplete(timeout?: number): Promise<AgentEvent> {
    return this.waitForAgentEvent('complete', { timeout });
  }

  /**
   * Collect multiple events
   */
  async collectEvents(
    count: number,
    options?: {
      eventType?: string;
      timeout?: number;
    }
  ): Promise<AgentEvent[]> {
    const timeout = options?.timeout || this.defaultTimeout;
    const eventType = options?.eventType;

    return new Promise((resolve, reject) => {
      const collected: AgentEvent[] = [];

      const timeoutHandle = setTimeout(() => {
        reject(new Error(
          `Timeout collecting ${count} events (got ${collected.length}) after ${timeout}ms`
        ));
      }, timeout);

      // Check existing events
      for (const event of this.receivedEvents) {
        if (!eventType || event.type === eventType || event.data.type === eventType) {
          collected.push(event.data);
          if (collected.length >= count) {
            clearTimeout(timeoutHandle);
            resolve(collected);
            return;
          }
        }
      }

      // Set up collector
      const key = `collect:${Date.now()}`;
      const waiter = {
        resolve: (event: AgentEvent) => {
          collected.push(event);
          if (collected.length >= count) {
            clearTimeout(timeoutHandle);
            this.eventWaiters.delete(key);
            resolve(collected);
          }
        },
        reject,
        timeout: timeoutHandle,
      };
      this.eventWaiters.set(key, [waiter]);
    });
  }

  /**
   * Get all received events
   */
  getReceivedEvents(): E2EReceivedEvent[] {
    return [...this.receivedEvents];
  }

  /**
   * Get events of a specific type
   */
  getEventsByType(eventType: string): AgentEvent[] {
    return this.receivedEvents
      .filter(e => e.type === eventType || e.data.type === eventType)
      .map(e => e.data);
  }

  /**
   * Clear collected events
   */
  clearEvents(): void {
    this.receivedEvents = [];
  }

  /**
   * Get the last event of a type
   */
  getLastEvent(eventType?: string): E2EReceivedEvent | undefined {
    if (!eventType) {
      return this.receivedEvents[this.receivedEvents.length - 1];
    }
    const filtered = this.receivedEvents.filter(
      e => e.type === eventType || e.data.type === eventType
    );
    return filtered[filtered.length - 1];
  }

  // ==================== Private Methods ====================

  private handleEvent(socketEventType: string, data: AgentEvent): void {
    const event: E2EReceivedEvent = {
      type: socketEventType,
      socketEventType,
      data,
      timestamp: new Date(),
    };

    this.receivedEvents.push(event);

    // Resolve waiters
    const keysToCheck = [
      socketEventType,
      `agent:${data.type}`,
      ...Array.from(this.eventWaiters.keys()).filter(k => k.startsWith('collect:')),
    ];

    for (const key of keysToCheck) {
      const waiters = this.eventWaiters.get(key);
      if (waiters && waiters.length > 0) {
        const waiter = waiters[0];
        if (waiter) {
          // Check filter if provided
          if (waiter.filter && !waiter.filter(data)) {
            continue;
          }

          clearTimeout(waiter.timeout);
          waiter.resolve(data);

          // Remove resolved waiter (except for collectors)
          if (!key.startsWith('collect:')) {
            waiters.shift();
            if (waiters.length === 0) {
              this.eventWaiters.delete(key);
            }
          }
        }
      }
    }
  }

  private findEvent(
    eventType: string,
    filter?: (event: AgentEvent) => boolean
  ): E2EReceivedEvent | undefined {
    return this.receivedEvents.find(e => {
      const typeMatch = e.type === eventType ||
        e.data.type === eventType ||
        (eventType.startsWith('agent:') && e.data.type === eventType.replace('agent:', ''));

      if (!typeMatch) return false;
      if (filter && !filter(e.data)) return false;
      return true;
    });
  }

  private removeWaiter(
    eventType: string,
    waiter: { timeout: ReturnType<typeof setTimeout> }
  ): void {
    const waiters = this.eventWaiters.get(eventType);
    if (waiters) {
      const index = waiters.findIndex(w => w.timeout === waiter.timeout);
      if (index !== -1) {
        waiters.splice(index, 1);
        if (waiters.length === 0) {
          this.eventWaiters.delete(eventType);
        }
      }
    }
  }
}

/**
 * Create an E2E test client
 */
export function createE2ETestClient(options?: E2ETestClientOptions): E2ETestClient {
  return new E2ETestClient(options);
}
