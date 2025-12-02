/**
 * Socket Test Helpers
 *
 * Utility functions for testing SocketService with proper setup and teardown.
 *
 * @module __tests__/helpers/socketTestHelpers
 */

import { vi } from 'vitest';
import type { AgentEvent, AgentEventType } from '@bc-agent/shared';
import { SocketService, resetSocketService, type SocketEventHandlers } from '@/lib/services/socket';
import {
  createMockSocket,
  setMockSocket,
  resetMockIo,
  type MockSocket,
} from '../mocks/socketMock';
import { AgentEventFactory } from '../fixtures/AgentEventFactory';
import { useChatStore } from '@/lib/stores/chatStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { useSessionStore } from '@/lib/stores/sessionStore';

/**
 * Test context returned by createTestContext
 */
export interface TestContext {
  /** Mock Socket.IO socket */
  mockSocket: MockSocket;
  /** SocketService instance */
  service: SocketService;
  /** Log of received events */
  eventLog: AgentEvent[];
  /** Log of errors received */
  errorLog: Array<{ error: string; sessionId?: string; code?: string }>;
  /** Connection state changes */
  connectionLog: boolean[];
  /** Handlers passed to SocketService */
  handlers: SocketEventHandlers;
}

/**
 * Options for createTestContext
 */
export interface TestContextOptions {
  /** Auto-connect socket after creation (default: false) */
  autoConnect?: boolean;
  /** Initial connection state (default: false) */
  connected?: boolean;
  /** Custom event handlers */
  handlers?: Partial<SocketEventHandlers>;
  /** Setup auth store with test user (default: true) */
  setupAuth?: boolean;
  /** Test user ID */
  userId?: string;
  /** Test session ID */
  sessionId?: string;
}

/**
 * Create a complete test context for SocketService testing
 *
 * @example
 * ```typescript
 * const { mockSocket, service, eventLog } = createTestContext({ autoConnect: true });
 *
 * service.joinSession('session-123');
 * mockSocket._trigger('agent:event', AgentEventFactory.message());
 *
 * expect(eventLog).toHaveLength(1);
 * expect(eventLog[0].type).toBe('message');
 * ```
 */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  const {
    autoConnect = false,
    connected = false,
    handlers = {},
    setupAuth = true,
    userId = 'test-user-456',
    sessionId = 'test-session-123',
  } = options;

  // Reset previous state
  resetSocketService();
  resetMockIo();
  AgentEventFactory.resetSequence();

  // Setup auth store if requested
  if (setupAuth) {
    useAuthStore.setState({
      user: {
        id: userId,
        microsoftId: 'ms-' + userId,
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  }

  // Create logs
  const eventLog: AgentEvent[] = [];
  const errorLog: Array<{ error: string; sessionId?: string; code?: string }> = [];
  const connectionLog: boolean[] = [];

  // Create mock socket
  const mockSocket = createMockSocket({ connected });
  setMockSocket(mockSocket);

  // Create handlers with logging
  const combinedHandlers: SocketEventHandlers = {
    onAgentEvent: (event) => {
      eventLog.push(event);
      handlers.onAgentEvent?.(event);
    },
    onAgentError: (error) => {
      errorLog.push(error);
      handlers.onAgentError?.(error);
    },
    onConnectionChange: (connected) => {
      connectionLog.push(connected);
      handlers.onConnectionChange?.(connected);
    },
    onSessionReady: handlers.onSessionReady,
    onSessionJoined: handlers.onSessionJoined,
    onSessionLeft: handlers.onSessionLeft,
    onSessionError: handlers.onSessionError,
  };

  // Create service
  const service = new SocketService(combinedHandlers);

  // Auto-connect if requested
  if (autoConnect) {
    service.connect();
    // Simulate connection
    mockSocket.connected = true;
    mockSocket._trigger('connect');
  }

  return {
    mockSocket,
    service,
    eventLog,
    errorLog,
    connectionLog,
    handlers: combinedHandlers,
  };
}

/**
 * Reset all stores to initial state
 */
export function resetStores(): void {
  useChatStore.setState({
    messages: [],
    optimisticMessages: new Map(),
    streaming: null,
    pendingApprovals: new Map(),
    toolExecutions: new Map(),
    isLoading: false,
    isAgentBusy: false,
    error: null,
    currentSessionId: null,
  });

  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    lastChecked: null,
  });

  useSessionStore.setState({
    sessions: [],
    currentSession: null,
    isLoading: false,
    error: null,
    lastFetched: null,
  });
}

/**
 * Reset entire test environment
 */
export function resetTestEnvironment(): void {
  resetSocketService();
  resetMockIo();
  resetStores();
  AgentEventFactory.resetSequence();
  vi.clearAllMocks();
}

/**
 * Wait for a specific event type to appear in the event log
 *
 * @param eventLog - Array to watch for events
 * @param eventType - Event type to wait for
 * @param timeout - Maximum wait time in ms (default: 1000)
 */
export async function waitForEvent(
  eventLog: AgentEvent[],
  eventType: AgentEventType,
  timeout = 1000
): Promise<AgentEvent> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const found = eventLog.find((e) => e.type === eventType);
      if (found) {
        resolve(found);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for event "${eventType}"`));
        return;
      }

      setTimeout(check, 10);
    };

    check();
  });
}

/**
 * Wait for multiple events in order
 */
export async function waitForEvents(
  eventLog: AgentEvent[],
  eventTypes: AgentEventType[],
  timeout = 2000
): Promise<AgentEvent[]> {
  const results: AgentEvent[] = [];

  for (const type of eventTypes) {
    const event = await waitForEvent(eventLog, type, timeout);
    results.push(event);
  }

  return results;
}

/**
 * Wait for event log to reach a specific length
 */
export async function waitForEventCount(
  eventLog: AgentEvent[],
  count: number,
  timeout = 1000
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (eventLog.length >= count) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(
          new Error(`Timeout waiting for ${count} events. Got ${eventLog.length}`)
        );
        return;
      }

      setTimeout(check, 10);
    };

    check();
  });
}

/**
 * Simulate a complete chat flow and wait for completion
 */
export async function simulateAndWaitForComplete(
  mockSocket: MockSocket,
  eventLog: AgentEvent[],
  timeout = 2000
): Promise<AgentEvent[]> {
  const flow = AgentEventFactory.Presets.chatFlow();

  for (const event of flow) {
    mockSocket._trigger('agent:event', event);
    // Small delay to simulate streaming
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  await waitForEvent(eventLog, 'complete', timeout);

  return eventLog;
}

/**
 * Assert chat store state matches expected values
 */
export function assertChatStoreState(expected: {
  messageCount?: number;
  isAgentBusy?: boolean;
  hasError?: boolean;
  pendingApprovalCount?: number;
  toolExecutionCount?: number;
}): void {
  const state = useChatStore.getState();

  if (expected.messageCount !== undefined) {
    expect(state.messages.length).toBe(expected.messageCount);
  }

  if (expected.isAgentBusy !== undefined) {
    expect(state.isAgentBusy).toBe(expected.isAgentBusy);
  }

  if (expected.hasError !== undefined) {
    if (expected.hasError) {
      expect(state.error).not.toBeNull();
    } else {
      expect(state.error).toBeNull();
    }
  }

  if (expected.pendingApprovalCount !== undefined) {
    expect(state.pendingApprovals.size).toBe(expected.pendingApprovalCount);
  }

  if (expected.toolExecutionCount !== undefined) {
    expect(state.toolExecutions.size).toBe(expected.toolExecutionCount);
  }
}

/**
 * Create spy functions for console methods
 */
export function createConsoleSpy(): {
  log: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
  restore: () => void;
} {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  return {
    log,
    warn,
    error,
    restore: () => {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    },
  };
}

/**
 * Delay helper for async tests
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate test UUIDs
 */
export function generateTestUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate test session ID in expected format
 */
export function generateTestSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Generate test user ID in expected format
 */
export function generateTestUserId(): string {
  return crypto.randomUUID();
}
