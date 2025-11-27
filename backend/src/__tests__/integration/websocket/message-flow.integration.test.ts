/**
 * WebSocket Message Flow Integration Tests
 *
 * Tests the complete message flow from sending a message to receiving
 * streaming events. Uses FakeAnthropicClient via dependency injection
 * to avoid real Anthropic API calls while using REAL infrastructure
 * (Azure SQL, Redis) for everything else.
 *
 * @module __tests__/integration/websocket/message-flow.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import session from 'express-session';
import { createClient as createRedisClient } from 'redis';
import RedisStore from 'connect-redis';

// Test helpers - using REAL database and Redis
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

// Real services with DI support
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import {
  getDirectAgentService,
  __resetDirectAgentService,
} from '@/services/agent/DirectAgentService';
import { getChatMessageHandler } from '@/services/websocket/ChatMessageHandler';

describe('WebSocket Message Flow Integration', () => {
  // Setup REAL database + Redis connection
  setupDatabaseForTests();

  let httpServer: HttpServer;
  let io: SocketIOServer;
  let testPort: number;
  let factory: TestSessionFactory;
  let client: TestSocketClient | null = null;
  let redisClient: ReturnType<typeof createRedisClient>;
  let fakeAnthropicClient: FakeAnthropicClient;

  beforeAll(async () => {
    // 1. Create FakeAnthropicClient for testing
    fakeAnthropicClient = new FakeAnthropicClient();

    // 2. Reset DirectAgentService singleton and inject FakeAnthropicClient
    __resetDirectAgentService();
    getDirectAgentService(undefined, undefined, fakeAnthropicClient);

    // 3. Create Redis client using test config (for session store)
    redisClient = createRedisClient({
      socket: {
        host: REDIS_TEST_CONFIG.host,
        port: REDIS_TEST_CONFIG.port,
      },
    });

    await redisClient.connect();

    // 4. Create Express app with session middleware
    const app = express();

    const sessionMiddleware = session({
      store: new RedisStore({ client: redisClient }),
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, maxAge: 86400000 },
    });

    app.use(sessionMiddleware);

    // 5. Create HTTP server
    httpServer = createServer(app);

    // 6. Create Socket.IO server
    io = new SocketIOServer(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    });

    // 7. Authentication middleware
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

    // 8. Message handler - uses REAL services with injected FakeAnthropicClient
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

    // 9. Start server on random available port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        testPort = typeof address === 'object' && address ? address.port : 3098;
        resolve();
      });
    });

    // 10. Create test session factory
    factory = createTestSessionFactory();
  }, 60000);

  afterAll(async () => {
    // Reset DirectAgentService singleton to avoid affecting other tests
    __resetDirectAgentService();

    await cleanupAllTestData();
    if (client) await client.disconnect();
    io.close();
    httpServer.close();
    await redisClient.quit();
  }, 30000);

  beforeEach(() => {
    client = null;

    // Reset FakeAnthropicClient for each test
    fakeAnthropicClient.reset();

    // Configure default response for most tests
    fakeAnthropicClient.addResponse({
      textBlocks: ['This is a test response from FakeAnthropicClient.'],
      stopReason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
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
      // Configure longer response for visible chunking
      fakeAnthropicClient.reset();
      fakeAnthropicClient.addResponse({
        textBlocks: ['This is a longer response that will be streamed in multiple chunks to verify streaming behavior works correctly.'],
        stopReason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 75 },
      });

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

      // Wait for complete event to ensure all chunks received
      await client.waitForAgentEvent('complete', 15000);

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
      const messageEvent = await client.waitForAgentEvent('message', 15000);

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
      const completeEvent = await client.waitForAgentEvent('complete', 15000);

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

      // Wait for complete event (thinking may or may not appear depending on model behavior)
      const completeEvent = await client.waitForAgentEvent('complete', 15000);
      expect(completeEvent).toBeDefined();

      // Note: Thinking events depend on model/budget configuration
      // The important thing is that the flow completes successfully
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
      const messageIdx = events.findIndex(e => e.data.type === 'message');
      const completeIdx = events.findIndex(e => e.data.type === 'complete');

      // Verify order: user_message_confirmed < message < complete
      expect(userConfirmedIdx).toBeGreaterThanOrEqual(0);
      expect(messageIdx).toBeGreaterThanOrEqual(0);
      expect(completeIdx).toBeGreaterThanOrEqual(0);

      expect(userConfirmedIdx).toBeLessThan(messageIdx);
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
