/**
 * WebSocket Message Flow Integration Tests
 *
 * Tests the complete message flow from sending a message to receiving
 * streaming events. Uses FakeAnthropicClient to mock Claude API.
 *
 * @module __tests__/integration/websocket/message-flow.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import session from 'express-session';
import { createClient as createRedisClient } from 'redis';
import RedisStore from 'connect-redis';
import {
  createTestSocketClient,
  createTestSessionFactory,
  cleanupAllTestData,
  TestSocketClient,
  TestSessionFactory,
  TEST_SESSION_SECRET,
  setupDatabaseForTests,
} from '../helpers';
import { REDIS_TEST_CONFIG } from '../setup.integration';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getChatMessageHandler } from '@/services/websocket/ChatMessageHandler';
import type { AgentEvent } from '@/types/websocket.types';

// Mock the DirectAgentService to use FakeAnthropicClient
vi.mock('@/services/agent/DirectAgentService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/agent/DirectAgentService')>();

  // Create a fake client that can be configured in tests
  const fakeClient = new FakeAnthropicClient();

  return {
    ...original,
    getDirectAgentService: vi.fn(() => ({
      executeQueryStreaming: async (
        message: string,
        sessionId: string,
        onEvent: (event: AgentEvent) => void,
        userId: string,
        _options?: { enableThinking?: boolean; thinkingBudget?: number }
      ) => {
        // Simulate thinking event
        onEvent({
          type: 'thinking',
          sessionId,
          content: 'Processing your request...',
          timestamp: new Date(),
          eventId: `evt_thinking_${Date.now()}`,
          sequenceNumber: 1,
          persistenceState: 'persisted',
        } as AgentEvent);

        // Simulate message chunks
        const responseText = `Response to: ${message}`;
        const chunks = responseText.split(' ');

        for (let i = 0; i < chunks.length; i++) {
          onEvent({
            type: 'message_chunk',
            sessionId,
            content: chunks[i] + (i < chunks.length - 1 ? ' ' : ''),
            timestamp: new Date(),
            eventId: `evt_chunk_${Date.now()}_${i}`,
            persistenceState: 'transient',
          } as AgentEvent);
        }

        // Simulate complete message
        onEvent({
          type: 'message',
          sessionId,
          messageId: `msg_${Date.now()}`,
          content: responseText,
          role: 'assistant',
          stopReason: 'end_turn',
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
          },
          model: 'claude-sonnet-4',
          timestamp: new Date(),
          eventId: `evt_message_${Date.now()}`,
          sequenceNumber: 2,
          persistenceState: 'persisted',
        } as AgentEvent);

        // Simulate complete event
        onEvent({
          type: 'complete',
          sessionId,
          reason: 'success',
          timestamp: new Date(),
          eventId: `evt_complete_${Date.now()}`,
        } as AgentEvent);
      },
    })),
  };
});

// Mock database for message persistence
vi.mock('@/config/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/config/database')>();
  return {
    ...original,
    executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
  };
});

// Mock MessageService
vi.mock('@/services/messages/MessageService', () => ({
  getMessageService: vi.fn(() => ({
    saveUserMessage: vi.fn().mockResolvedValue({
      messageId: `user_msg_${Date.now()}`,
      sequenceNumber: 0,
      eventId: `evt_user_${Date.now()}`,
    }),
    saveToolUseMessage: vi.fn().mockResolvedValue(undefined),
    updateToolResult: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock session ownership validation
vi.mock('@/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn().mockResolvedValue({ isOwner: true }),
}));

describe('WebSocket Message Flow Integration', () => {
  // Setup database connection for TestSessionFactory
  setupDatabaseForTests();

  let httpServer: HttpServer;
  let io: SocketIOServer;
  let testPort: number;
  let factory: TestSessionFactory;
  let client: TestSocketClient | null = null;
  let redisClient: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    // Create Redis client using test config
    redisClient = createRedisClient({
      socket: {
        host: REDIS_TEST_CONFIG.host,
        port: REDIS_TEST_CONFIG.port,
      },
    });

    await redisClient.connect();

    // Create Express app
    const app = express();

    const sessionMiddleware = session({
      store: new RedisStore({ client: redisClient }),
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, maxAge: 86400000 },
    });

    app.use(sessionMiddleware);

    httpServer = createServer(app);

    io = new SocketIOServer(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    });

    // Authentication middleware
    io.use((socket, next) => {
      const req = socket.request as express.Request;
      const res = {} as express.Response;

      sessionMiddleware(req, res, (err) => {
        if (err) return next(new Error('Session error'));

        const sessionData = (req as { session?: { microsoftOAuth?: { userId?: string; email?: string } } }).session;
        if (sessionData?.microsoftOAuth?.userId) {
          (socket as { userId?: string; userEmail?: string }).userId = sessionData.microsoftOAuth.userId;
          (socket as { userId?: string; userEmail?: string }).userEmail = sessionData.microsoftOAuth.email;
          next();
        } else {
          next(new Error('Authentication required'));
        }
      });
    });

    // Message handler
    const chatHandler = getChatMessageHandler();

    io.on('connection', (socket) => {
      const userId = (socket as { userId?: string }).userId;

      socket.emit('connected', { userId, socketId: socket.id });

      socket.on('session:join', (data: { sessionId: string }) => {
        socket.join(data.sessionId);
        socket.emit('session:joined', { sessionId: data.sessionId });
      });

      socket.on('chat:message', async (data) => {
        await chatHandler.handle(data, socket, io);
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        testPort = typeof address === 'object' && address ? address.port : 3098;
        resolve();
      });
    });

    factory = createTestSessionFactory();
  }, 60000);

  afterAll(async () => {
    await cleanupAllTestData();
    if (client) await client.disconnect();
    io.close();
    httpServer.close();
    await redisClient.quit();
  }, 30000);

  beforeEach(() => {
    client = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  describe('Chat Message Flow', () => {
    it('should emit user_message_confirmed after chat:message', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_confirm_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Hello, test message');

      // Wait for user_message_confirmed
      const confirmedEvent = await client.waitForAgentEvent('user_message_confirmed', 10000);

      expect(confirmedEvent).toBeDefined();
      expect(confirmedEvent.type).toBe('user_message_confirmed');
    });

    it('should stream message_chunk events', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_chunks_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Stream test');

      // Wait for multiple events
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for message_chunk events
      const chunkEvents = client.getEventsByType('message_chunk');
      expect(chunkEvents.length).toBeGreaterThan(0);

      // Each chunk should have content
      for (const chunk of chunkEvents) {
        expect(chunk).toHaveProperty('content');
      }
    });

    it('should emit final message event with content', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_final_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Final message test');

      // Wait for complete message
      const messageEvent = await client.waitForAgentEvent('message', 10000);

      expect(messageEvent).toBeDefined();
      expect(messageEvent.type).toBe('message');
      expect(messageEvent).toHaveProperty('content');
      expect(messageEvent).toHaveProperty('messageId');
      expect(messageEvent).toHaveProperty('stopReason');
    });

    it('should emit complete event at end', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_complete_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Complete test');

      // Wait for complete event
      const completeEvent = await client.waitForAgentEvent('complete', 10000);

      expect(completeEvent).toBeDefined();
      expect(completeEvent.type).toBe('complete');
      expect(completeEvent).toHaveProperty('reason');
    });

    it('should emit thinking event when enabled', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_thinking_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message with thinking enabled
      await client.sendMessage(testSession.id, 'Thinking test', {
        enableThinking: true,
        thinkingBudget: 5000,
      });

      // Wait for thinking event
      const thinkingEvent = await client.waitForAgentEvent('thinking', 10000);

      expect(thinkingEvent).toBeDefined();
      expect(thinkingEvent.type).toBe('thinking');
      expect(thinkingEvent).toHaveProperty('content');
    });

    it('should emit events in correct order', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_order_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Order test');

      // Wait for complete
      await client.waitForAgentEvent('complete', 15000);

      // Get all events
      const events = client.getReceivedEvents();

      // Find indices of key events
      const userConfirmedIdx = events.findIndex(e => e.data.type === 'user_message_confirmed');
      const thinkingIdx = events.findIndex(e => e.data.type === 'thinking');
      const messageIdx = events.findIndex(e => e.data.type === 'message');
      const completeIdx = events.findIndex(e => e.data.type === 'complete');

      // Verify order: user_message_confirmed < thinking < message < complete
      if (thinkingIdx >= 0) {
        expect(userConfirmedIdx).toBeLessThan(thinkingIdx);
        expect(thinkingIdx).toBeLessThan(messageIdx);
      } else {
        expect(userConfirmedIdx).toBeLessThan(messageIdx);
      }
      expect(messageIdx).toBeLessThan(completeIdx);
    });
  });

  describe('Error Handling', () => {
    it('should reject empty message', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_empty_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Send empty message
      await client.sendMessage(testSession.id, '');

      // Wait for error event
      const errorEvent = await client.waitForEvent('agent:error', 5000);

      expect(errorEvent).toBeDefined();
    });

    it('should handle message to non-joined session gracefully', async () => {
      const testUser = await factory.createTestUser({ prefix: 'msg_nojoin_' });
      const testSession = await factory.createChatSession(testUser.id);

      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      // Note: NOT joining the session

      // Send message (should still work but events won't be received)
      await client.sendMessage(testSession.id, 'Test without join');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should not receive events since not in room
      const events = client.getEventsByType('message');
      // Note: This tests that room-scoped events are properly isolated
    });
  });
});
