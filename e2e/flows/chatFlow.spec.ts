/**
 * Chat Flow E2E Tests - API Level
 *
 * Tests the complete chat flow by calling the backend REST API
 * and WebSocket directly (no frontend UI required).
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 *
 * IMPORTANT: Uses REAL session cookies from Redis, NOT test auth tokens.
 * Sessions are injected by globalSetup.ts.
 *
 * @module e2e/flows/chatFlow.spec
 */

import { test, expect, APIRequestContext } from '@playwright/test';
import { Socket } from 'socket.io-client';
import {
  TEST_USER,
  TEST_SESSIONS,
  TIMEOUTS,
  API_ENDPOINTS,
  WS_EVENTS,
  AGENT_EVENT_TYPES,
} from '../fixtures/test-data';
import {
  createApiContext,
  connectSocket as connectAuthenticatedSocket,
  waitForAgentEvent,
  waitForEvent,
  waitForCondition,
  getTestUserSession,
} from '../setup/testHelpers';

/**
 * Test Suite: Chat Flow - API Level
 *
 * These tests verify the complete chat flow by directly calling
 * the backend API and WebSocket endpoints, bypassing the frontend UI.
 *
 * IMPORTANT: Uses real session cookies injected into Redis by globalSetup.ts.
 */
test.describe('Chat Flow - API Level', () => {
  let apiContext: APIRequestContext;
  let socket: Socket | null = null;

  // Create API context with real session cookie before all tests
  test.beforeAll(async ({ playwright }) => {
    apiContext = await createApiContext(playwright, 'test');
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
    expect(data).toHaveProperty('status', 'healthy');
    expect(data).toHaveProperty('services');
    expect(data.services).toHaveProperty('database', 'up');
    expect(data.services).toHaveProperty('redis', 'up');
  });

  /**
   * Test 2: Authentication with Test Token
   * Verifies test auth token bypasses OAuth and returns user data
   */
  test('should authenticate with test token', async () => {
    const response = await apiContext.get(API_ENDPOINTS.me);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('email');
    expect(data).toHaveProperty('fullName');
    expect(data).toHaveProperty('role');
  });

  /**
   * Test 3: Session CRUD - List Sessions
   * Verifies ability to list all sessions for the authenticated user
   */
  test('should list sessions', async () => {
    const response = await apiContext.get(API_ENDPOINTS.sessions);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('sessions');
    expect(Array.isArray(data.sessions)).toBeTruthy();
    expect(data.sessions.length).toBeGreaterThanOrEqual(0);
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

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data).toHaveProperty('session');
    expect(data.session).toHaveProperty('id');
    expect(data.session).toHaveProperty('title', newSession.title);
    expect(data.session).toHaveProperty('status', 'active');
    expect(data.session).toHaveProperty('created_at');
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
    expect(data).toHaveProperty('session');
    expect(data.session).toHaveProperty('id', sessionId.toUpperCase()); // DB returns uppercase
    expect(data.session).toHaveProperty('title');
    expect(data.session).toHaveProperty('status');
  });

  /**
   * Test 6: Get Session Messages
   * Verifies ability to retrieve messages for a session
   */
  test('should get messages for an empty session', async () => {
    const sessionId = TEST_SESSIONS.empty.id;
    const response = await apiContext.get(API_ENDPOINTS.messages(sessionId));

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('messages');
    expect(Array.isArray(data.messages)).toBeTruthy();
    // Note: Seed data may add messages, so we just verify structure not count
    expect(data.messages.length).toBeGreaterThanOrEqual(0);
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

      // Accumulate message chunks (use event.content per type definition)
      if (event.type === AGENT_EVENT_TYPES.messageChunk) {
        assistantMessage += event.content || '';
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

    // Listen for error event via agent:event with type='error'
    const errorPromise = waitForAgentEvent(socket, AGENT_EVENT_TYPES.error, TIMEOUTS.short);

    // Send message with invalid session
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId: invalidSessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for error
    const error = await errorPromise;
    expect(error).toBeDefined();
    expect(error.type).toBe('error');
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
// Most helper functions are now imported from testHelpers.ts

/**
 * Connect to WebSocket with real session authentication
 * Wraps connectAuthenticatedSocket from testHelpers
 */
function connectSocket(): Promise<Socket> {
  return connectAuthenticatedSocket('test', TIMEOUTS.medium);
}
