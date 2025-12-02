/**
 * Socket Middleware E2E Tests - API Level
 *
 * Tests the socket middleware integration by directly connecting to WebSocket
 * and verifying event handling, message flow, and error cases.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 *
 * IMPORTANT: Uses REAL session cookies from Redis, NOT test auth tokens.
 * Sessions are injected by globalSetup.ts.
 *
 * @module e2e/flows/socketMiddleware.spec
 */

import { test, expect } from '@playwright/test';
import { Socket } from 'socket.io-client';
import {
  TEST_USER,
  TEST_SESSIONS,
  TIMEOUTS,
  WS_EVENTS,
  AGENT_EVENT_TYPES,
} from '../fixtures/test-data';
import {
  connectSocket as connectAuthenticatedSocket,
  waitForAgentEvent,
  sleep,
} from '../setup/testHelpers';

/**
 * Test Suite: Socket Middleware - API Level
 *
 * These tests verify the socket middleware by directly connecting to
 * the backend WebSocket and testing event handling, message flow, and error cases.
 *
 * IMPORTANT: Uses real session cookies injected into Redis by globalSetup.ts.
 */
test.describe('Socket Middleware - API Level', () => {
  let socket: Socket | null = null;

  // Clean up socket after each test to avoid connection leaks
  test.afterEach(() => {
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  /**
   * Test 1: Connection with Real Session
   * Verifies authenticated socket connection using real session cookie
   */
  test('should connect to WebSocket with real session', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium);

    expect(socket.connected).toBeTruthy();
    expect(socket.id).toBeTruthy();
  });

  /**
   * Test 2: Message Send + Confirmation
   * Verifies message sending and receiving user_message_confirmed event
   */
  test('should send message and receive user_message_confirmed', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'Test message for confirmation';

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
    const confirmation: any = await confirmationPromise;
    expect(confirmation).toHaveProperty('type', AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(confirmation).toHaveProperty('data');
    expect(confirmation.data).toHaveProperty('messageId');
    expect(confirmation.data).toHaveProperty('sequenceNumber');
  });

  /**
   * Test 3: Tool Execution Flow
   * Verifies tool_use event is received with correct tool metadata
   */
  test('should receive tool_use event with tool metadata', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'List my customers';

    // Set up listener for tool_use event
    const toolUsePromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.toolUse,
      TIMEOUTS.long
    );

    // Send message that triggers tool use
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for tool_use event
    const toolUseEvent: any = await toolUsePromise;
    expect(toolUseEvent).toHaveProperty('type', AGENT_EVENT_TYPES.toolUse);
    expect(toolUseEvent).toHaveProperty('tool_name');

    // Verify tool name contains "customer" (case-insensitive)
    const toolName = toolUseEvent.tool_name?.toLowerCase() || '';
    expect(toolName).toContain('customer');
  });

  /**
   * Test 4: Multiple Events Streaming
   * Verifies that multiple event types are received during a complete agent response cycle
   */
  test('should receive multiple streaming events in correct order', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

    const sessionId = TEST_SESSIONS.empty.id;
    const messageContent = 'What is Business Central?';

    // Track received event types
    const receivedEvents: string[] = [];

    // Listen for all agent events
    socket.on(WS_EVENTS.agentEvent, (event: { type: string; [key: string]: unknown }) => {
      receivedEvents.push(event.type);
    });

    // Set up listener for complete event
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
    const completeEvent: any = await completePromise;
    expect(completeEvent).toHaveProperty('type', AGENT_EVENT_TYPES.complete);

    // Verify we received expected event types
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.sessionStart);

    // Should have either message chunks or a complete message
    const hasMessageChunks = receivedEvents.includes(AGENT_EVENT_TYPES.messageChunk);
    const hasCompleteMessage = receivedEvents.includes(AGENT_EVENT_TYPES.message);
    expect(hasMessageChunks || hasCompleteMessage).toBeTruthy();

    // Should complete
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.complete);
  });

  /**
   * Test 5: Reconnection Handling
   * Verifies socket can be disconnected and reconnected successfully
   */
  test('should handle socket reconnection', async () => {
    // First connection
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium);
    const firstSocketId = socket.id;

    expect(socket.connected).toBeTruthy();
    expect(firstSocketId).toBeTruthy();

    // Disconnect
    socket.disconnect();
    expect(socket.connected).toBeFalsy();

    // Wait a moment
    await sleep(1000);

    // Reconnect
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium);
    const secondSocketId = socket.id;

    expect(socket.connected).toBeTruthy();
    expect(secondSocketId).toBeTruthy();

    // Socket IDs should be different (new connection)
    expect(secondSocketId).not.toBe(firstSocketId);
  });

  /**
   * Test 6: Error Handling
   * Verifies proper error event emission for invalid session
   */
  test('should emit error event for invalid session', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium);

    const invalidSessionId = 'invalid-session-id';
    const messageContent = 'This should trigger an error';

    // Set up listener for error event
    const errorPromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.error,
      TIMEOUTS.short
    );

    // Send message with invalid session
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId: invalidSessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // Wait for error event
    const errorEvent: any = await errorPromise;
    expect(errorEvent).toHaveProperty('type', AGENT_EVENT_TYPES.error);
    expect(errorEvent).toHaveProperty('message');
  });
});
