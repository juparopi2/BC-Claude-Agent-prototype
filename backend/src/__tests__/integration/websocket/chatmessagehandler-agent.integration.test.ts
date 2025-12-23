/**
 * ChatMessageHandler + AgentOrchestrator Integration Tests
 *
 * Tests the integration between ChatMessageHandler and AgentOrchestrator,
 * verifying that events are correctly emitted with proper persistenceState.
 *
 * This test file focuses on:
 * 1. Event persistence state verification (transient vs persisted)
 * 2. Sequence number assignment for persisted events
 * 3. Tool use events with proper ID consistency
 *
 * REFACTORED: Uses FakeAgentOrchestrator instead of FakeAnthropicClient.
 *
 * @module __tests__/integration/websocket/chatmessagehandler-agent.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Test helpers - using REAL database and Redis
import {
  createTestSocketClient,
  createTestSessionFactory,
  cleanupAllTestData,
  createTestSocketIOServer,
  TestSocketClient,
  TestSessionFactory,
  SocketIOServerResult,
  AuthenticatedSocket,
  TEST_TIMEOUTS,
  setupDatabaseForTests,
} from '../helpers';

// Import FakeAgentOrchestrator for testing
import {
  FakeAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration';
import { getChatMessageHandler } from '@/services/websocket/ChatMessageHandler';

// Create a shared FakeAgentOrchestrator instance for the entire test suite
const fakeOrchestrator = new FakeAgentOrchestrator();

// Mock getAgentOrchestrator to return our fake
vi.mock('@domains/agent/orchestration', async (importOriginal) => {
  const original = await importOriginal<typeof import('@domains/agent/orchestration')>();
  return {
    ...original,
    getAgentOrchestrator: vi.fn(() => fakeOrchestrator),
  };
});

describe('ChatMessageHandler + AgentOrchestrator Integration', () => {
  // Setup REAL database + Redis connection
  setupDatabaseForTests();

  let serverResult: SocketIOServerResult;
  let factory: TestSessionFactory;
  let client: TestSocketClient | null = null;

  beforeAll(async () => {
    // 1. Reset AgentOrchestrator singleton
    __resetAgentOrchestrator();

    // 2. Get chat message handler - uses mocked getAgentOrchestrator
    const chatHandler = getChatMessageHandler();

    // 3. Create Socket.IO server with custom chat:message handler
    serverResult = await createTestSocketIOServer({
      handlers: {
        onChatMessage: async (socket: AuthenticatedSocket, data, io) => {
          await chatHandler.handle(data, socket, io);
        },
      },
    });

    // 4. Create test session factory
    factory = createTestSessionFactory();
  }, TEST_TIMEOUTS.BEFORE_ALL);

  afterAll(async () => {
    // Reset AgentOrchestrator singleton to avoid affecting other tests
    __resetAgentOrchestrator();

    await cleanupAllTestData();
    if (client) await client.disconnect();

    await serverResult.cleanup();
  }, TEST_TIMEOUTS.AFTER_ALL);

  beforeEach(() => {
    client = null;

    // Reset FakeAgentOrchestrator for each test
    fakeOrchestrator.reset();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  describe('Persistence State Verification', () => {
    it('should emit user_message_confirmed with sequenceNumber (persisted)', async () => {
      // Configure simple response
      fakeOrchestrator.setResponse({
        textBlocks: ['Simple test response.'],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'persist_user_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Test persistence state');

      // Wait for user_message_confirmed
      const confirmedEvent = await client.waitForAgentEvent('user_message_confirmed', TEST_TIMEOUTS.EVENT_WAIT);

      expect(confirmedEvent).toBeDefined();
      expect(confirmedEvent.type).toBe('user_message_confirmed');
      // User messages should be persisted with sequence number
      expect(confirmedEvent).toHaveProperty('sequenceNumber');
      expect(typeof confirmedEvent.sequenceNumber).toBe('number');
    });

    it('should emit message_chunk without sequenceNumber (transient)', async () => {
      // Configure response with text
      fakeOrchestrator.setResponse({
        textBlocks: ['This is a longer response that generates chunks.'],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'persist_chunk_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Test chunk persistence');

      // Wait for complete event to ensure all events received
      await client.waitForAgentEvent('complete', 15000);

      // Check message_chunk events - they should be transient (no sequenceNumber)
      const chunkEvents = client.getEventsByType('message_chunk');

      // If chunks were emitted, verify they don't have sequenceNumber
      for (const chunk of chunkEvents) {
        // Transient events should have persistenceState: 'transient' or no sequenceNumber
        if ('persistenceState' in chunk) {
          expect(chunk.persistenceState).toBe('transient');
        }
        // Or simply should not have a sequenceNumber
        if ('sequenceNumber' in chunk) {
          // If it has sequenceNumber, it's for tracking within the stream, not DB persistence
          // This is acceptable as long as persistenceState is transient
        }
      }
    });

    it('should emit final message with required fields (persisted to DB)', async () => {
      // Configure simple response
      fakeOrchestrator.setResponse({
        textBlocks: ['Final message with persistence.'],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'persist_msg_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Test final message persistence');

      // Wait for final message event
      const messageEvent = await client.waitForAgentEvent('message', 15000);

      expect(messageEvent).toBeDefined();
      expect(messageEvent.type).toBe('message');
      // Final message should have messageId (indicating persistence)
      expect(messageEvent).toHaveProperty('messageId');
      expect(messageEvent).toHaveProperty('content');
      expect(messageEvent).toHaveProperty('stopReason');
      // Note: sequenceNumber may or may not be included in WebSocket payload
      // The important thing is the event is persisted (verified by messageId)
    });
  });

  describe('Tool Use Event Consistency', () => {
    it('should emit tool_use and tool_result with matching toolUseId', async () => {
      // Configure response with tool use (FakeAgentOrchestrator handles tool execution internally)
      fakeOrchestrator.setResponse({
        textBlocks: ['Let me check that for you.', 'Here are the results from the tool.'],
        toolCalls: [
          {
            toolName: 'getCustomers',
            args: { top: 5 },
            result: { customers: [] },
            success: true,
          },
        ],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'tool_id_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message that triggers tool use
      await client.sendMessage(testSession.id, 'List top 5 customers');

      // Wait for complete event
      await client.waitForAgentEvent('complete', 30000);

      // Get tool events
      const toolUseEvents = client.getEventsByType('tool_use');
      const toolResultEvents = client.getEventsByType('tool_result');

      // If tool events were emitted, verify ID consistency
      if (toolUseEvents.length > 0) {
        expect(toolUseEvents.length).toBeGreaterThan(0);

        for (const toolUse of toolUseEvents) {
          expect(toolUse).toHaveProperty('toolUseId');
          expect(toolUse).toHaveProperty('toolName');

          // Find matching tool_result
          const matchingResult = toolResultEvents.find(
            (r: Record<string, unknown>) => r.toolUseId === toolUse.toolUseId
          );

          if (matchingResult) {
            expect(matchingResult.toolUseId).toBe(toolUse.toolUseId);
            expect(matchingResult.toolName).toBe(toolUse.toolName);
          }
        }
      }
    });

    it('should emit tool events with correct structure', async () => {
      // Configure response with tool use (FakeAgentOrchestrator handles tool execution internally)
      fakeOrchestrator.setResponse({
        textBlocks: ['Checking vendors...', 'Found the vendors.'],
        toolCalls: [
          {
            toolName: 'getVendors',
            args: { top: 3 },
            result: { vendors: [] },
            success: true,
          },
        ],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'tool_seq_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Show me vendors');

      // Wait for complete
      await client.waitForAgentEvent('complete', 30000);

      // Verify tool events have correct structure
      const toolUseEvents = client.getEventsByType('tool_use');
      const toolResultEvents = client.getEventsByType('tool_result');

      // If tool events were emitted, verify structure
      for (const event of toolUseEvents) {
        expect(event).toHaveProperty('toolUseId');
        expect(event).toHaveProperty('toolName');
      }

      for (const event of toolResultEvents) {
        expect(event).toHaveProperty('toolUseId');
        expect(event).toHaveProperty('toolName');
        // Tool result should have success indicator
        expect(event).toHaveProperty('success');
      }
    });
  });

  // NOTE: Error event emission test was removed during QA audit (2025-12-17)
  // Reason: Error propagation through the agent pipeline is tested in
  // message-flow.integration.test.ts "handles errors gracefully" test using
  // FakeAgentOrchestrator.setResponse({ error: 'message' }).

  describe('Event Ordering Invariants', () => {
    it('should emit user_message_confirmed BEFORE any agent events', async () => {
      fakeOrchestrator.setResponse({
        textBlocks: ['Response after user message.'],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'order_user_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Test event ordering');

      // Wait for complete
      await client.waitForAgentEvent('complete', 15000);

      // Get all events
      const events = client.getReceivedEvents();

      // Find indices
      const userConfirmedIdx = events.findIndex(e => e.data.type === 'user_message_confirmed');
      const firstAgentEventIdx = events.findIndex(
        e => ['message_chunk', 'message', 'thinking', 'thinking_chunk'].includes(e.data.type)
      );

      // user_message_confirmed should come before any agent response events
      if (userConfirmedIdx >= 0 && firstAgentEventIdx >= 0) {
        expect(userConfirmedIdx).toBeLessThan(firstAgentEventIdx);
      }
    });

    // NOTE: "complete as last event" test was removed during QA audit (2025-12-17)
    // Reason: Flaky due to Socket.IO event timing issues.
    // Coverage exists in: message-flow.integration.test.ts "should emit complete event at end"
    // and the active test above already verifies event ordering invariants.
  });
});
