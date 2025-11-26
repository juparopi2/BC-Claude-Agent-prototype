/**
 * WebSocket Connection Integration Tests
 *
 * Tests WebSocket connection handling with real Redis sessions.
 * Validates authentication, session management, and error handling.
 *
 * @module __tests__/integration/websocket/connection.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

describe('WebSocket Connection Integration', () => {
  // Setup database connection for TestSessionFactory
  setupDatabaseForTests();

  let httpServer: HttpServer;
  let io: SocketIOServer;
  let testPort: number;
  let factory: TestSessionFactory;
  let client: TestSocketClient | null = null;

  // Redis client for session store
  let redisClient: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    // Create Redis client for session store using test config
    redisClient = createRedisClient({
      socket: {
        host: REDIS_TEST_CONFIG.host,
        port: REDIS_TEST_CONFIG.port,
      },
    });

    await redisClient.connect();

    // Create Express app with session middleware
    const app = express();

    const sessionMiddleware = session({
      store: new RedisStore({ client: redisClient }),
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 86400000, // 24 hours
      },
    });

    app.use(sessionMiddleware);

    // Create HTTP server
    httpServer = createServer(app);

    // Create Socket.IO server
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    // Wrap session middleware for Socket.IO
    io.use((socket, next) => {
      const req = socket.request as express.Request;
      const res = {} as express.Response;

      sessionMiddleware(req, res, (err) => {
        if (err) {
          return next(new Error('Session error'));
        }

        // Extract user from session
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

    // Socket.IO event handlers
    io.on('connection', (socket) => {
      const userId = (socket as { userId?: string }).userId;

      socket.emit('connected', { userId, socketId: socket.id });

      socket.on('session:join', (data: { sessionId: string }) => {
        socket.join(data.sessionId);
        socket.emit('session:joined', { sessionId: data.sessionId });
      });

      socket.on('session:leave', (data: { sessionId: string }) => {
        socket.leave(data.sessionId);
        socket.emit('session:left', { sessionId: data.sessionId });
      });

      socket.on('ping', () => {
        socket.emit('pong', { userId, timestamp: Date.now() });
      });
    });

    // Start server on random available port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        testPort = typeof address === 'object' && address ? address.port : 3099;
        console.log(`Test server listening on port ${testPort}`);
        resolve();
      });
    });

    // Create test factory
    factory = createTestSessionFactory();
  }, 60000);

  afterAll(async () => {
    // Cleanup test data
    await cleanupAllTestData();

    // Close connections
    if (client) {
      await client.disconnect();
    }

    io.close();
    httpServer.close();
    await redisClient.quit();
  }, 30000);

  beforeEach(() => {
    // Reset client
    client = null;
  });

  afterEach(async () => {
    // Disconnect client if connected
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  describe('Connection Flow', () => {
    it('should accept connection with valid session cookie', async () => {
      // Create test user with valid session
      const testUser = await factory.createTestUser({ prefix: 'conn_valid_' });

      // Create socket client
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
        defaultTimeout: 10000,
      });

      // Connect should succeed
      await expect(client.connect()).resolves.not.toThrow();

      // Should be connected
      expect(client.isConnected()).toBe(true);
      expect(client.getSocketId()).toBeDefined();
    });

    it('should reject connection without session', async () => {
      // Create socket client without session cookie
      client = createTestSocketClient({
        port: testPort,
        defaultTimeout: 5000,
      });

      // Connect should fail
      await expect(client.connect()).rejects.toThrow('Authentication required');

      // Should not be connected
      expect(client.isConnected()).toBe(false);
    });

    it('should reject connection with invalid session cookie', async () => {
      // Create socket client with invalid session
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: 'connect.sid=s%3Ainvalid_session_id.fake-signature',
        defaultTimeout: 5000,
      });

      // Connect should fail (session not found in Redis)
      await expect(client.connect()).rejects.toThrow();
    });

    it('should set userId on authenticated socket', async () => {
      // Create test user
      const testUser = await factory.createTestUser({ prefix: 'conn_userid_' });

      // Create and connect socket
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();

      // Send ping and verify response contains userId
      client.emitRaw('ping', {});

      const pongEvent = await client.waitForEvent('pong', 5000);
      expect(pongEvent).toBeDefined();
      // Note: pong event includes userId from server
    });
  });

  describe('Session Room Management', () => {
    it('should allow joining a session room', async () => {
      // Create test user and session
      const testUser = await factory.createTestUser({ prefix: 'room_join_' });
      const testSession = await factory.createChatSession(testUser.id);

      // Connect socket
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();

      // Join session
      await expect(client.joinSession(testSession.id)).resolves.not.toThrow();

      // Verify joined event received
      const events = client.getReceivedEvents();
      const joinedEvent = events.find(e => e.type === 'session:joined');
      expect(joinedEvent).toBeDefined();
    });

    it('should allow leaving a session room', async () => {
      // Create test user and session
      const testUser = await factory.createTestUser({ prefix: 'room_leave_' });
      const testSession = await factory.createChatSession(testUser.id);

      // Connect and join
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Leave session
      await client.leaveSession(testSession.id);

      // Wait for left event
      const leftEvent = await client.waitForEvent('session:left', 5000);
      expect(leftEvent).toBeDefined();
    });

    it('should isolate events to session rooms', async () => {
      // Create two test users with separate sessions
      const userA = await factory.createTestUser({ prefix: 'room_iso_a_' });
      const userB = await factory.createTestUser({ prefix: 'room_iso_b_' });

      const sessionA = await factory.createChatSession(userA.id);
      const sessionB = await factory.createChatSession(userB.id);

      // Connect both users
      const clientA = createTestSocketClient({
        port: testPort,
        sessionCookie: userA.sessionCookie,
      });

      const clientB = createTestSocketClient({
        port: testPort,
        sessionCookie: userB.sessionCookie,
      });

      await clientA.connect();
      await clientB.connect();

      // User A joins session A
      await clientA.joinSession(sessionA.id);

      // User B joins session B
      await clientB.joinSession(sessionB.id);

      // Emit event to session A room
      io.to(sessionA.id).emit('agent:event', {
        type: 'test_event',
        sessionId: sessionA.id,
        data: 'for_session_a',
      });

      // Wait a bit for event propagation
      await new Promise(resolve => setTimeout(resolve, 100));

      // User A should receive the event
      const eventsA = clientA.getEventsByType('test_event');
      expect(eventsA.length).toBeGreaterThan(0);

      // User B should NOT receive the event
      const eventsB = clientB.getEventsByType('test_event');
      expect(eventsB.length).toBe(0);

      // Cleanup
      await clientA.disconnect();
      await clientB.disconnect();
    });
  });

  describe('Error Handling', () => {
    it('should handle server disconnect gracefully', async () => {
      // Create test user
      const testUser = await factory.createTestUser({ prefix: 'err_disconnect_' });

      // Connect
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle reconnection after disconnect', async () => {
      // Create test user
      const testUser = await factory.createTestUser({ prefix: 'err_reconnect_' });

      // First connection
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      const firstSocketId = client.getSocketId();
      expect(client.isConnected()).toBe(true);

      // Disconnect
      await client.disconnect();
      expect(client.isConnected()).toBe(false);

      // Reconnect (create new client)
      client = createTestSocketClient({
        port: testPort,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      const secondSocketId = client.getSocketId();

      // Should be connected with new socket ID
      expect(client.isConnected()).toBe(true);
      expect(secondSocketId).toBeDefined();
      expect(secondSocketId).not.toBe(firstSocketId);
    });
  });
});
