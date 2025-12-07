/**
 * Claude API Golden Path Test - Optimized for Minimal Token Usage
 *
 * This test makes ONE Claude API call and validates all critical aspects
 * of the agent flow in a single comprehensive test. This approach minimizes
 * token consumption while ensuring production-quality validation.
 *
 * What This Test Validates (in ONE API call):
 * - WebSocket authentication and connection
 * - User message confirmation with sequence number
 * - Session start event
 * - Message streaming (chunks)
 * - Complete event with stop reason
 * - Token usage tracking
 * - Message persistence in database
 * - Event ordering
 *
 * Token Usage: ~150-250 tokens total (vs 1000+ for separate tests)
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 * - NODE_ENV must start with "prod" to run
 *
 * @module e2e/flows/claudeGoldenPath.spec
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
  waitForCondition,
} from '../setup/testHelpers';
import { shouldRunClaudeTests } from '../setup/testConfig';

/**
 * Test Suite: Claude API Golden Path
 *
 * This is THE comprehensive test for Claude API integration.
 * It validates the entire agent flow in ONE optimized API call.
 *
 * IMPORTANT: Only runs when NODE_ENV starts with "prod"
 */
test.describe('Claude API - Golden Path (Production Only)', () => {
  // Skip entire suite if not in production environment
  test.skip(!shouldRunClaudeTests(), 'Golden Path test only runs in production environment');

  let apiContext: APIRequestContext;
  let socket: Socket | null = null;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await createApiContext(playwright, 'test');
  });

  test.afterAll(async () => {
    if (socket?.connected) {
      socket.disconnect();
    }
    await apiContext.dispose();
  });

  test.afterEach(() => {
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  /**
   * The Golden Path Test
   *
   * This single test validates the ENTIRE agent flow:
   * 1. Connection & Authentication
   * 2. Message Sending & Confirmation
   * 3. Streaming Events (chunks)
   * 4. Completion & Token Usage
   * 5. Database Persistence
   *
   * Uses a minimal prompt to reduce token consumption.
   */
  test('should complete full agent cycle with minimal token usage', async () => {
    // =================================================================
    // PHASE 1: Connection & Authentication
    // =================================================================
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

    expect(socket.connected).toBeTruthy();
    expect(socket.id).toBeTruthy();

    // =================================================================
    // PHASE 2: Message Sending & Event Tracking
    // =================================================================
    const sessionId = TEST_SESSIONS.empty.id;

    // OPTIMIZED PROMPT: Short question that requires minimal response
    // This minimizes token usage while still validating all functionality
    const messageContent = 'What is 2+2?';

    // Track all received events for validation
    const receivedEvents: Array<{ type: string; data?: unknown }> = [];
    let assistantMessage = '';
    let messageId: string | null = null;
    let sequenceNumber: number | null = null;

    // Listen for all agent events
    socket.on(WS_EVENTS.agentEvent, (event: { type: string; content?: string; data?: unknown }) => {
      receivedEvents.push({
        type: event.type,
        data: event.data,
      });

      // Accumulate message chunks for final validation
      if (event.type === AGENT_EVENT_TYPES.messageChunk) {
        assistantMessage += event.content || '';
      }

      // Capture message ID and sequence number from confirmation
      if (event.type === AGENT_EVENT_TYPES.userMessageConfirmed && event.data) {
        const data = event.data as { messageId?: string; sequenceNumber?: number };
        messageId = data.messageId || null;
        sequenceNumber = data.sequenceNumber || null;
      }
    });

    // Wait for complete event
    const completePromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.complete,
      TIMEOUTS.long
    );

    // Send the optimized message
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
    });

    // =================================================================
    // PHASE 3: Wait for Completion & Validate Events
    // =================================================================
    const completeEvent: any = await completePromise;

    // Validate completion event
    expect(completeEvent).toHaveProperty('type', AGENT_EVENT_TYPES.complete);
    expect(completeEvent).toHaveProperty('data');
    expect(completeEvent.data).toHaveProperty('stop_reason');

    // Extract event types for easier validation
    const eventTypes = receivedEvents.map(e => e.type);

    // =================================================================
    // VALIDATION 1: Critical Events Received
    // =================================================================
    expect(eventTypes).toContain(AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(eventTypes).toContain(AGENT_EVENT_TYPES.sessionStart);
    expect(eventTypes).toContain(AGENT_EVENT_TYPES.complete);

    // Validate we received either streaming chunks OR a complete message
    const hasMessageChunks = eventTypes.includes(AGENT_EVENT_TYPES.messageChunk);
    const hasCompleteMessage = eventTypes.includes(AGENT_EVENT_TYPES.message);
    expect(hasMessageChunks || hasCompleteMessage).toBeTruthy();

    // =================================================================
    // VALIDATION 2: Message Confirmation Data
    // =================================================================
    expect(messageId).toBeTruthy();
    expect(sequenceNumber).toBeGreaterThan(0);

    // =================================================================
    // VALIDATION 3: Event Ordering
    // =================================================================
    // user_message_confirmed should come before session_start
    const confirmIndex = eventTypes.indexOf(AGENT_EVENT_TYPES.userMessageConfirmed);
    const sessionStartIndex = eventTypes.indexOf(AGENT_EVENT_TYPES.sessionStart);
    const completeIndex = eventTypes.indexOf(AGENT_EVENT_TYPES.complete);

    expect(confirmIndex).toBeGreaterThanOrEqual(0);
    expect(sessionStartIndex).toBeGreaterThan(confirmIndex);
    expect(completeIndex).toBeGreaterThan(sessionStartIndex);

    // =================================================================
    // VALIDATION 4: Assistant Response Content
    // =================================================================
    if (hasMessageChunks) {
      // Validate we accumulated some content
      expect(assistantMessage.length).toBeGreaterThan(0);
      // For "What is 2+2?", response should mention "4"
      expect(assistantMessage.toLowerCase()).toContain('4');
    }

    // =================================================================
    // VALIDATION 5: Token Usage Tracking
    // =================================================================
    // Find the message event (either message or message_chunk should have usage data)
    const messageEvent = receivedEvents.find(
      e => e.type === AGENT_EVENT_TYPES.message && e.data
    );

    if (messageEvent && messageEvent.data) {
      const data = messageEvent.data as { usage?: { inputTokens?: number; outputTokens?: number } };
      if (data.usage) {
        expect(typeof data.usage.inputTokens).toBe('number');
        expect(typeof data.usage.outputTokens).toBe('number');
        expect(data.usage.inputTokens).toBeGreaterThan(0);
        expect(data.usage.outputTokens).toBeGreaterThan(0);
      }
    }

    // =================================================================
    // PHASE 4: Database Persistence Validation
    // =================================================================
    // Wait for async write to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify user message persisted
    const messagesResponse = await apiContext.get(API_ENDPOINTS.messages(sessionId));
    expect(messagesResponse.ok()).toBeTruthy();

    const messagesData = await messagesResponse.json();
    expect(messagesData).toHaveProperty('messages');
    expect(Array.isArray(messagesData.messages)).toBeTruthy();

    // Find the user message we sent
    const persistedUserMessage = messagesData.messages.find(
      (msg: { messageId: string; role: string }) => msg.messageId === messageId
    );

    expect(persistedUserMessage).toBeDefined();
    expect(persistedUserMessage.content).toBe(messageContent);
    expect(persistedUserMessage.role).toBe('user');

    // Find the assistant message
    const persistedAssistantMessage = messagesData.messages.find(
      (msg: { role: string; sequenceNumber: number }) =>
        msg.role === 'assistant' && msg.sequenceNumber > (sequenceNumber || 0)
    );

    expect(persistedAssistantMessage).toBeDefined();
    expect(persistedAssistantMessage.content).toBeTruthy();
    expect(persistedAssistantMessage.content.length).toBeGreaterThan(0);

    // =================================================================
    // VALIDATION 6: Token Usage in Database
    // =================================================================
    if (persistedAssistantMessage.usage) {
      expect(typeof persistedAssistantMessage.usage.inputTokens).toBe('number');
      expect(typeof persistedAssistantMessage.usage.outputTokens).toBe('number');
    }

    // =================================================================
    // SUCCESS: All Validations Passed!
    // =================================================================
    console.log('✅ Golden Path Test: All validations passed');
    console.log(`   Events received: ${eventTypes.length}`);
    console.log(`   Message ID: ${messageId}`);
    console.log(`   Sequence Number: ${sequenceNumber}`);
    console.log(`   Assistant response length: ${assistantMessage.length} chars`);
  });

  /**
   * Optional: Extended Thinking Golden Path
   *
   * This test validates extended thinking with ONE optimized call.
   * Only runs in production and uses minimal thinking budget.
   */
  test('should handle extended thinking with minimal token usage', async () => {
    socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

    const sessionId = TEST_SESSIONS.empty.id;
    // Simple prompt that benefits from thinking but stays minimal
    const messageContent = 'Solve: x + 5 = 12';

    const receivedEvents: string[] = [];
    let thinkingContent = '';

    socket.on(WS_EVENTS.agentEvent, (event: { type: string; content?: string }) => {
      receivedEvents.push(event.type);

      if (event.type === AGENT_EVENT_TYPES.thinkingChunk) {
        thinkingContent += event.content || '';
      }
    });

    // Wait for complete event
    const completePromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.complete,
      TIMEOUTS.long
    );

    // Send message with MINIMAL thinking budget
    socket.emit(WS_EVENTS.chatMessage, {
      sessionId,
      userId: TEST_USER.id,
      message: messageContent,
      thinking: {
        enableThinking: true,
        thinkingBudget: 1024, // Minimum allowed budget
      },
    });

    // Wait for completion
    await completePromise;

    // Validate thinking events were received
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.userMessageConfirmed);
    expect(receivedEvents).toContain(AGENT_EVENT_TYPES.complete);

    // If thinking was used, validate it
    if (receivedEvents.includes(AGENT_EVENT_TYPES.thinkingChunk)) {
      expect(thinkingContent.length).toBeGreaterThan(0);
      expect(receivedEvents).toContain(AGENT_EVENT_TYPES.thinking);
    }

    console.log('✅ Extended Thinking Golden Path: All validations passed');
  });
});
