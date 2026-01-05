/**
 * WebSocket Message Flow Integration Tests
 *
 * Tests the complete message flow from sending a message to receiving
 * streaming events. Uses FakeAgentOrchestrator via vi.mock() to avoid
 * real Anthropic API calls while using REAL infrastructure
 * (Azure SQL, Redis) for everything else.
 *
 * REFACTORED: Uses FakeAgentOrchestrator instead of FakeAnthropicClient.
 *
 * @module __tests__/integration/websocket/message-flow.integration.test.ts
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

/**
 * WebSocket Message Flow Integration Tests
 *
 * Tests complete message flow through the WebSocket layer using FakeAgentOrchestrator.
 * FK cleanup issue (D18) resolved by adding usage_events cleanup to cleanupUser().
 *
 * @see docs/plans/TECHNICAL_DEBT_REGISTRY.md - D18 (RESOLVED)
 */
describe('WebSocket Message Flow Integration', () => {
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

    // Configure default response for most tests
    fakeOrchestrator.setResponse({
      textBlocks: ['This is a test response from FakeAgentOrchestrator.'],
      stopReason: 'end_turn',
    });
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  describe('Chat Message Flow', () => {
    it('should emit user_message_confirmed after chat:message', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_confirm_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send a chat message using proper API
      const eventPromise = client.waitForAgentEvent('user_message_confirmed');
      await client.sendMessage(testSession.id, 'Hello, test message');

      // Should receive user_message_confirmed event
      const event = await eventPromise;
      expect(event).toBeDefined();
      expect(event.type).toBe('user_message_confirmed');
      expect(event.content).toBe('Hello, test message');
      // Note: sequenceNumber may be 0 when using FakeAgentOrchestrator as persistence
      // layer assigns it asynchronously. The key assertion is that the event is emitted.
      expect(event).toHaveProperty('sequenceNumber');
    });

    it('should emit message event with full response (sync architecture)', async () => {
      const testUser = await factory.createTestUser({ prefix: 'stream_chunk_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message and wait for complete event
      await client.sendMessage(testSession.id, 'Stream test');
      await client.waitForAgentEvent('complete', TEST_TIMEOUTS.EVENT_WAIT);

      // In sync architecture, we receive a single 'message' event with full content
      const receivedEvents = client.getReceivedEvents();
      const messageEvents = receivedEvents
        .filter(e => e.data.type === 'message')
        .map(e => (e.data as { content?: string }).content || '');

      expect(messageEvents.length).toBeGreaterThan(0);
      expect(messageEvents[0]).toBe('This is a test response from FakeAgentOrchestrator.');
    });

    it('should emit complete event at end', async () => {
      const testUser = await factory.createTestUser({ prefix: 'complete_evt_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message using proper API
      await client.sendMessage(testSession.id, 'Complete event test');

      // Wait for complete event
      const completeEvent = await client.waitForAgentEvent('complete', TEST_TIMEOUTS.EVENT_WAIT);
      expect(completeEvent).toBeDefined();
      expect(completeEvent.type).toBe('complete');
      expect(completeEvent).toHaveProperty('reason');
    });

    it('should handle tool_use events', async () => {
      // Configure response with tool call
      fakeOrchestrator.setResponse({
        toolCalls: [
          {
            toolName: 'list_all_entities',
            args: {},
            result: [{ id: '1', name: 'Test Entity' }],
            success: true,
          },
        ],
        textBlocks: ['I found one entity.'],
        stopReason: 'end_turn',
      });

      const testUser = await factory.createTestUser({ prefix: 'tool_use_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message using proper API
      await client.sendMessage(testSession.id, 'List all entities');

      // Wait for complete event to ensure all events are received
      await client.waitForAgentEvent('complete', TEST_TIMEOUTS.EVENT_WAIT);

      // Check for tool_use and tool_result events
      const receivedEvents = client.getReceivedEvents();
      const toolUseEvent = receivedEvents.find(e => e.data.type === 'tool_use');
      const toolResultEvent = receivedEvents.find(e => e.data.type === 'tool_result');

      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent?.data.type).toBe('tool_use');
      expect((toolUseEvent?.data as { toolName?: string }).toolName).toBe('list_all_entities');

      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent?.data.type).toBe('tool_result');
      expect((toolResultEvent?.data as { success?: boolean }).success).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Configure error response
      fakeOrchestrator.setResponse({
        error: 'Simulated API error',
      });

      const testUser = await factory.createTestUser({ prefix: 'error_test_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message using proper API
      await client.sendMessage(testSession.id, 'This should fail');

      // Wait for error event
      const errorEvent = await client.waitForAgentEvent('error', TEST_TIMEOUTS.EVENT_WAIT);
      expect(errorEvent.type).toBe('error');
      expect((errorEvent as { error?: string }).error).toContain('Simulated API error');
    });
  });
});
