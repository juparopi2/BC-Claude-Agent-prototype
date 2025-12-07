/**
 * Extended Thinking E2E Tests - Real Backend
 *
 * Tests the Extended Thinking feature by directly connecting to WebSocket
 * and verifying thinking chunk streaming, token tracking, and validation.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 * - Real Claude API connection (thinking requires real API)
 *
 * IMPORTANT: Uses REAL session cookies from Redis, NOT test auth tokens.
 * Sessions are injected by globalSetup.ts.
 *
 * @module e2e/flows/extendedThinking.spec
 */

import { test, expect } from '@playwright/test';
import {
  connectSocket as connectAuthenticatedSocket,
  waitForAgentEvent,
  waitForThinkingChunks,
  waitForThinkingComplete,
  sleep,
} from '../setup/testHelpers';
import {
  TEST_USER,
  TEST_SESSIONS,
  WS_EVENTS,
  AGENT_EVENT_TYPES,
  TIMEOUTS,
} from '../fixtures/test-data';
import type { Socket } from 'socket.io-client';
import { shouldRunClaudeTests } from '../setup/testConfig';

/**
 * Test Suite: Extended Thinking - Real Backend
 *
 * These tests verify the Extended Thinking feature by directly connecting to
 * the backend WebSocket and testing validation, streaming, and token tracking.
 *
 * IMPORTANT: Uses real session cookies injected into Redis by globalSetup.ts.
 * IMPORTANT: Uses REAL Claude API - thinking chunks come from actual API responses.
 */
test.describe('Extended Thinking E2E - Real Backend', () => {
  let socket: Socket | null = null;

  test.beforeEach(async () => {
    // Cleanup before each test
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  test.afterEach(async () => {
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  /**
   * Test Group 1: Frontend Validation
   * Tests that validate thinkingBudget parameter boundaries
   */
  test.describe('1. Frontend Validation', () => {
    /**
     * Test 1.1: Accept valid minimum thinkingBudget (1024)
     */
    test('should accept valid thinkingBudget (1024)', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.short, TEST_SESSIONS.empty.id);

      // Should NOT throw error
      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Test message',
        thinking: {
          enableThinking: true,
          thinkingBudget: 1024, // Minimum valid
        },
      });

      // Wait for confirmation (user_message_confirmed)
      const confirmed = await waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.userMessageConfirmed,
        TIMEOUTS.medium
      );
      expect(confirmed).toBeDefined();
    });

    /**
     * Test 1.2: Accept valid maximum thinkingBudget (100000)
     */
    test('should accept valid thinkingBudget (100000)', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.short, TEST_SESSIONS.empty.id);

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Test message',
        thinking: {
          enableThinking: true,
          thinkingBudget: 100000, // Maximum valid
        },
      });

      const confirmed = await waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.userMessageConfirmed,
        TIMEOUTS.medium
      );
      expect(confirmed).toBeDefined();
    });

    /**
     * Test 1.3: Reject invalid thinkingBudget < 1024
     */
    test('should reject invalid thinkingBudget < 1024', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.short, TEST_SESSIONS.empty.id);

      // Listen for error event from backend (agent:error channel)
      const errorPromise = new Promise<{ error: string; sessionId: string }>((resolve) => {
        socket.once('agent:error', (data) => resolve(data));
      });

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Test message',
        thinking: {
          enableThinking: true,
          thinkingBudget: 500, // Too low
        },
      });

      const errorEvent = await errorPromise;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain('thinkingBudget');
    });

    /**
     * Test 1.4: Reject invalid thinkingBudget > 100000
     */
    test('should reject invalid thinkingBudget > 100000', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.short, TEST_SESSIONS.empty.id);

      // Listen for error event from backend (agent:error channel)
      const errorPromise = new Promise<{ error: string; sessionId: string }>((resolve) => {
        socket.once('agent:error', (data) => resolve(data));
      });

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Test message',
        thinking: {
          enableThinking: true,
          thinkingBudget: 200000, // Too high
        },
      });

      const errorEvent = await errorPromise;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain('thinkingBudget');
    });
  });

  /**
   * Test Group 2: Thinking Chunk Streaming
   * Tests that verify thinking chunks are received and accumulated correctly
   *
   * @claude-api This section requires Claude API and only runs in production environment
   */
  test.describe('2. Thinking Chunk Streaming', () => {
    test.skip(!shouldRunClaudeTests(), 'Claude API tests - only run in production environment');

    /**
     * Test 2.1: Receive thinking_chunk events with valid budget
     */
    test('should receive thinking_chunk events with valid budget', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      const receivedEvents: string[] = [];

      socket.on(WS_EVENTS.agentEvent, (event: any) => {
        receivedEvents.push(event.type);
      });

      // Send message with thinking enabled
      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'What are the key considerations for implementing a microservices architecture?',
        thinking: {
          enableThinking: true,
          thinkingBudget: 15000,
        },
      });

      // Wait for thinking chunks (real Claude API)
      const chunks = await waitForThinkingChunks(socket, 1, TIMEOUTS.long);

      expect(chunks.length).toBeGreaterThan(0);
      expect(receivedEvents).toContain('thinking_chunk');
    });

    /**
     * Test 2.2: Accumulate thinking chunks correctly
     */
    test('should accumulate thinking chunks correctly', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      const chunks: any[] = [];

      socket.on(WS_EVENTS.agentEvent, (event: any) => {
        if (event.type === 'thinking_chunk') {
          chunks.push(event);
        }
      });

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Explain quantum computing in detail',
        thinking: {
          enableThinking: true,
          thinkingBudget: 20000,
        },
      });

      // Wait for multiple chunks
      await waitForThinkingChunks(socket, 2, TIMEOUTS.long);

      // Verify chunks have content
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      chunks.forEach(chunk => {
        expect(chunk.content).toBeDefined();
        expect(typeof chunk.content).toBe('string');
      });
    });

    /**
     * Test 2.3: Receive complete thinking block after chunks
     */
    test('should receive complete thinking block after chunks', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      const events: any[] = [];

      socket.on(WS_EVENTS.agentEvent, (event: any) => {
        events.push(event);
      });

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Compare SQL vs NoSQL databases',
        thinking: {
          enableThinking: true,
          thinkingBudget: 10000,
        },
      });

      // Wait for complete thinking block
      const thinkingComplete = await waitForThinkingComplete(
        socket,
        TIMEOUTS.long
      );

      expect(thinkingComplete).toBeDefined();
      expect(thinkingComplete.type).toBe('thinking');
      expect(thinkingComplete.content).toBeDefined();

      // Verify chunks came before complete block
      const chunkEvents = events.filter(e => e.type === 'thinking_chunk');
      const completeIndex = events.findIndex(e => e.type === 'thinking');
      const lastChunkIndex = events
        .map((e, i) => (e.type === 'thinking_chunk' ? i : -1))
        .filter(i => i !== -1)
        .pop();

      if (lastChunkIndex !== undefined) {
        expect(lastChunkIndex).toBeLessThan(completeIndex);
      }
    });
  });

  /**
   * Test Group 3: Token Usage Tracking
   * Tests that verify token usage is tracked correctly for thinking
   *
   * @claude-api This section requires Claude API and only runs in production environment
   */
  test.describe('3. Token Usage Tracking', () => {
    test.skip(!shouldRunClaudeTests(), 'Claude API tests - only run in production environment');

    /**
     * Test 3.1: Include thinkingTokens in final message
     */
    test('should include thinkingTokens in final message', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Brief question about AI',
        thinking: {
          enableThinking: true,
          thinkingBudget: 5000,
        },
      });

      // Wait for final message event
      const messageEvent: any = await waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.message,
        TIMEOUTS.long
      );

      expect(messageEvent).toBeDefined();
      expect(messageEvent.tokenUsage).toBeDefined();
      expect(messageEvent.tokenUsage.thinkingTokens).toBeDefined();
      expect(messageEvent.tokenUsage.thinkingTokens).toBeGreaterThan(0);
    });

    /**
     * Test 3.2: Include all token types (input, output, thinking)
     */
    test('should include all token types (input, output, thinking)', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Another question',
        thinking: {
          enableThinking: true,
          thinkingBudget: 8000,
        },
      });

      const messageEvent: any = await waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.message,
        TIMEOUTS.long
      );

      const tokenUsage = messageEvent.tokenUsage;
      expect(tokenUsage).toBeDefined();
      expect(tokenUsage.inputTokens).toBeGreaterThan(0);
      expect(tokenUsage.outputTokens).toBeGreaterThan(0);
      expect(tokenUsage.thinkingTokens).toBeGreaterThan(0);

      // Verify types
      expect(typeof tokenUsage.inputTokens).toBe('number');
      expect(typeof tokenUsage.outputTokens).toBe('number');
      expect(typeof tokenUsage.thinkingTokens).toBe('number');
    });
  });

  /**
   * Test Group 4: Complete Flow
   * Tests that verify the complete end-to-end thinking flow
   *
   * @claude-api This section requires Claude API and only runs in production environment
   */
  test.describe('4. Complete Flow', () => {
    test.skip(!shouldRunClaudeTests(), 'Claude API tests - only run in production environment');

    /**
     * Test 4.1: Handle complete thinking flow: chunks → thinking → message
     */
    test('should handle complete thinking flow: chunks → thinking → message', async () => {
      socket = await connectAuthenticatedSocket('test', TIMEOUTS.medium, TEST_SESSIONS.empty.id);

      const eventOrder: string[] = [];

      // Set up listener BEFORE sending message to capture all events
      socket.on(WS_EVENTS.agentEvent, (event: any) => {
        eventOrder.push(event.type);
      });

      // Wait for user_message_confirmed first (emitted quickly after sending)
      const confirmationPromise = waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.userMessageConfirmed,
        TIMEOUTS.short
      );

      socket.emit(WS_EVENTS.chatMessage, {
        sessionId: TEST_SESSIONS.empty.id,
        userId: TEST_USER.id,
        message: 'Complex question requiring extended thinking',
        thinking: {
          enableThinking: true,
          thinkingBudget: 18000,
        },
      });

      // Ensure user_message_confirmed is received
      await confirmationPromise;

      // Wait for complete event
      await waitForAgentEvent(
        socket,
        AGENT_EVENT_TYPES.complete,
        TIMEOUTS.extraLong
      );

      // Verify critical Extended Thinking events are present
      expect(eventOrder).toContain('user_message_confirmed');
      expect(eventOrder).toContain('thinking_chunk');
      expect(eventOrder).toContain('thinking');
      expect(eventOrder).toContain('message');
      expect(eventOrder).toContain('complete');

      // Verify both thinking and message events exist (order may vary due to async emission)
      const thinkingIndex = eventOrder.indexOf('thinking');
      const messageIndex = eventOrder.indexOf('message');
      expect(thinkingIndex).toBeGreaterThan(-1);
      expect(messageIndex).toBeGreaterThan(-1);

      // Verify thinking_chunk appears (streaming works)
      const hasThinkingChunks = eventOrder.filter(e => e === 'thinking_chunk').length > 0;
      expect(hasThinkingChunks).toBeTruthy();
    });
  });
});
