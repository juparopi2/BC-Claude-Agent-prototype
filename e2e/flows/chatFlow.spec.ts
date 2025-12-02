/**
 * Chat Flow E2E Tests - API Level
 *
 * Tests the complete chat flow by calling the backend REST API
 * and WebSocket directly (no frontend UI required).
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - TEST_AUTH_ENABLED=true in backend/.env or backend/test.env
 * - Database accessible with test data seeded
 *
 * @module e2e/flows/chatFlow.spec
 */

import { test, expect, APIRequestContext } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import {
  TEST_USER,
  TEST_SESSIONS,
  TIMEOUTS,
  API_ENDPOINTS,
  WS_EVENTS,
  AGENT_EVENT_TYPES,
} from '../fixtures/test-data';

// Backend configuration
const BACKEND_URL = 'http://localhost:3002';
const TEST_AUTH_TOKEN = 'test-auth-token-12345';

/**
 * Test Suite: Chat Flow - API Level
 *
 * These tests verify the complete chat flow by directly calling
 * the backend API and WebSocket endpoints, bypassing the frontend UI.
 */
test.describe('Chat Flow - API Level', () => {
  let apiContext: APIRequestContext;
  let socket: Socket | null = null;

  // Create API context with test auth header before all tests
  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      extraHTTPHeaders: {
        'x-test-auth-token': TEST_AUTH_TOKEN,
      },
    });
  });

  // Clean up API context and socket connections after all tests
  test.afterAll(async () => {
    if (socket?.connected) {
      socket.disconnect();
    }
    await apiContext.dispose();
  });

  // Clean up socket after each test to avoid connection leaks
  test.afterEach(() => {
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  /**
   * Test 1: Health Check
   * Verifies backend is running and accessible
   */
  test('should verify backend health', async () => {
    const response = await apiContext.get(API_ENDPOINTS.health);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
  });

  /**
   * Test 2: Authentication with Test Token
   * Verifies test auth token bypasses OAuth and returns user data
   */
  test('should authenticate with test token', async () => {
    const response = await apiContext.get(API_ENDPOINTS.me);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('userId');
    expect(data).toHaveProperty('email');
  });

  /**
   * Test 3: Session CRUD - List Sessions
   * Verifies ability to list all sessions for the authenticated user
   */
  test('should list sessions', async () => {
    const response = await apiContext.get(API_ENDPOINTS.sessions);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThanOrEqual(0);
  });

  /**
   * Test 4: Session CRUD - Create Session
   * Verifies ability to create a new chat session
   */
  test('should create a new session', async () => {
    const newSession = {
      title: 'E2E Test Session - API Created',
    };

    const response = await apiContext.post(API_ENDPOINTS.sessions, {
      data: newSession,
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('sessionId');
    expect(data).toHaveProperty('title', newSession.title);
    expect(data).toHaveProperty('isActive', true);
    expect(data).toHaveProperty('createdAt');
  });

  /**
   * Test 5: Session CRUD - Get Single Session
   * Verifies ability to retrieve a specific session by ID
   */
  test('should get a single session by ID', async () => {
    const sessionId = TEST_SESSIONS.empty.id;
    const response = await apiContext.get(API_ENDPOINTS.session(sessionId));

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('sessionId', sessionId);
    expect(data).toHaveProperty('title');
    expect(data).toHaveProperty('isActive');
  });

  /**
   * Test 6: Get Session Messages (Empty)
   * Verifies ability to retrieve messages for a session with no messages
   */
  test('should get messages for an empty session', async () => {
    const sessionId = TEST_SESSIONS.empty.id;
    const response = await apiContext.get(API_ENDPOINTS.messages(sessionId));

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBe(0);
  });

  /**
   * Test 7: WebSocket Connection
   * Verifies ability to connect to WebSocket with test auth token
   */
  test('should connect to WebSocket with test auth', async () => {
    socket = await connectSocket();

    expect(socket.connected).toBeTruthy();
    expect(socket.id).toBeTruthy();
  });

  /**
   * Test 8: Send Message via WebSocket
   * Verifies ability to send a message and receive user_message_confirmed event
   */
  test('should send message and receive confirmation', async () => {
    socket = await connectSocket();

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'Hello, this is a test message from E2E';

    // Set up listener for user_message_confirmed event
    const confirmationPromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.userMessageConfirmed,
      TIMEOUTS.medium
    );

    // Send message
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for confirmation
    const confirmation = await confirmationPromise;
    expect(confirmation).toHaveProperty('type', AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(confirmation).toHaveProperty('data');
    expect(confirmation.data).toHaveProperty('messageId');
    expect(confirmation.data).toHaveProperty('sequenceNumber');
  });

  /**
   * Test 9: Message Persistence
   * Verifies sent message appears in GET messages API
   */
  test('should persist sent message in database', async () => {
    socket = await connectSocket();

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'Test message for persistence verification';

    // Send message and wait for confirmation
    const confirmationPromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.userMessageConfirmed,
      TIMEOUTS.medium
    );

    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    const confirmation = await confirmationPromise;
    const messageId = confirmation.data.messageId;

    // Wait a moment for async write to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify message appears in GET messages API
    const response = await apiContext.get(API_ENDPOINTS.messages(sessionId));
    expect(response.ok()).toBeTruthy();

    const messages = await response.json();
    expect(Array.isArray(messages)).toBeTruthy();

    const persistedMessage = messages.find((msg) => msg.messageId === messageId);
    expect(persistedMessage).toBeDefined();
    expect(persistedMessage.content).toBe(messageContent);
    expect(persistedMessage.role).toBe('user');
  });

  /**
   * Test 10: Agent Response Flow
   * Verifies complete agent response cycle with streaming events
   */
  test('should receive agent response with streaming events', async () => {
    socket = await connectSocket();

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'What is Business Central?';

    // Track received event types
    const receivedEvents: string[] = [];
    let assistantMessage = '';

    // Listen for all agent events
    socket.on(WS_EVENTS.agentEvent, (event) => {
      receivedEvents.push(event.type);

      // Accumulate message chunks
      if (event.type === AGENT_EVENT_TYPES.messageChunk) {
        assistantMessage += event.data.delta;
      }
    });

    // Wait for complete event
    const completePromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.complete,
      TIMEOUTS.long
    );

    // Send message
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for completion
    const completeEvent = await completePromise;
    expect(completeEvent).toHaveProperty('type', AGENT_EVENT_TYPES.complete);

    // Verify we received expected event types
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.sessionStart);
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.complete);

    // Verify we received message chunks or a complete message
    const hasMessageChunks = receivedEvents.includes(AGENT_EVENT_TYPES.messageChunk);
    const hasCompleteMessage = receivedEvents.includes(AGENT_EVENT_TYPES.message);
    expect(hasMessageChunks || hasCompleteMessage).toBeTruthy();

    // If we received chunks, verify we accumulated some content
    if (hasMessageChunks) {
      expect(assistantMessage.length).toBeGreaterThan(0);
    }
  });

  /**
   * Test 11: WebSocket Error Handling
   * Verifies proper error handling for invalid session
   */
  test('should handle errors for invalid session', async () => {
    socket = await connectSocket();

    const invalidSessionId = 'invalid-session-id-12345';
    const messageContent = 'This should fail';

    // Listen for error event
    const errorPromise = waitForEvent(socket, WS_EVENTS.error, TIMEOUTS.short);

    // Send message with invalid session
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId: invalidSessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for error
    const error = await errorPromise;
    expect(error).toBeDefined();
  });

  /**
   * Test 12: Concurrent Message Handling
   * Verifies backend can handle multiple messages in quick succession
   */
  test('should handle concurrent messages correctly', async () => {
    socket = await connectSocket();

    const sessionId = TEST_SESSIONS.empty.id;
    const messages = [
      'First message',
      'Second message',
      'Third message',
    ];

    // Track confirmations
    const confirmations: any[] = [];
    socket.on(WS_EVENTS.agentEvent, (event) => {
      if (event.type === AGENT_EVENT_TYPES.userMessageConfirmed) {
        confirmations.push(event);
      }
    });

    // Send all messages rapidly
    messages.forEach((content) => {
      socket!.emit(WS_EVENTS.chatMessage, {
        sessionId,
        userId: TEST_USER.id,
        message: content,
      });
    });

    // Wait for all confirmations (with generous timeout)
    await waitForCondition(
      () => confirmations.length === messages.length,
      TIMEOUTS.medium,
      `Expected ${messages.length} confirmations, got ${confirmations.length}`
    );

    expect(confirmations.length).toBe(messages.length);

    // Verify sequence numbers are monotonically increasing
    const sequenceNumbers = confirmations.map((c) => c.data.sequenceNumber);
    for (let i = 1; i < sequenceNumbers.length; i++) {
      expect(sequenceNumbers[i]).toBeGreaterThan(sequenceNumbers[i - 1]);
    }
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Connect to WebSocket with test auth token
 * @returns Promise that resolves to connected Socket
 */
function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      extraHeaders: {
        'x-test-auth-token': TEST_AUTH_TOKEN,
      },
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('WebSocket connection timeout'));
    }, TIMEOUTS.medium);

    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
  });
}

/**
 * Wait for a specific agent event type
 * @param socket Socket.IO socket
 * @param eventType Agent event type to wait for
 * @param timeout Timeout in milliseconds
 * @returns Promise that resolves to the event data
 */
function waitForAgentEvent(
  socket: Socket,
  eventType: string,
  timeout: number = TIMEOUTS.medium
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for agent event: ${eventType}`));
    }, timeout);

    const handler = (event: any) => {
      if (event.type === eventType) {
        clearTimeout(timer);
        socket.off(WS_EVENTS.agentEvent, handler);
        resolve(event);
      }
    };

    socket.on(WS_EVENTS.agentEvent, handler);
  });
}

/**
 * Wait for any event (not just agent events)
 * @param socket Socket.IO socket
 * @param eventName Event name to wait for
 * @param timeout Timeout in milliseconds
 * @returns Promise that resolves to the event data
 */
function waitForEvent(
  socket: Socket,
  eventName: string,
  timeout: number = TIMEOUTS.medium
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Wait for a condition to become true
 * @param condition Function that returns true when condition is met
 * @param timeout Timeout in milliseconds
 * @param errorMessage Error message if timeout occurs
 * @returns Promise that resolves when condition is met
 */
function waitForCondition(
  condition: () => boolean,
  timeout: number = TIMEOUTS.medium,
  errorMessage: string = 'Condition not met within timeout'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer);
        reject(new Error(errorMessage));
      }
    }, checkInterval);
  });
}
