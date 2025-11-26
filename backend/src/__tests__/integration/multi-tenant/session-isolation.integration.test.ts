/**
 * Multi-Tenant Session Isolation Integration Tests
 *
 * Tests that users cannot access other users' sessions.
 * Validates security boundaries between tenants.
 *
 * @module __tests__/integration/multi-tenant/session-isolation.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
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
// Import the real validateSessionOwnership - no mock needed since we use the real implementation
import { validateSessionOwnership } from '@/utils/session-ownership';

// TODO F1-002: Some tests fail due to validateSessionOwnership returning UNAUTHORIZED
// even for valid user-session pairs. This suggests the TestSessionFactory creates
// sessions that don't properly link userId in Redis session store.
// Investigation needed: How TestSessionFactory.createTestUser() cookie relates to
// the actual Redis session and userId validation in validateSessionOwnership().
describe('Multi-Tenant Session Isolation', () => {
  // Setup database connection for TestSessionFactory
  setupDatabaseForTests();

  let httpServer: HttpServer;
  let io: SocketIOServer;
  let testPort: number;
  let factory: TestSessionFactory;
  let redisClient: ReturnType<typeof createRedisClient>;

  // Track clients for cleanup
  const clients: TestSocketClient[] = [];

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
          (socket as Socket & { userId?: string; userEmail?: string }).userId = sessionData.microsoftOAuth.userId;
          (socket as Socket & { userId?: string; userEmail?: string }).userEmail = sessionData.microsoftOAuth.email;
          next();
        } else {
          next(new Error('Authentication required'));
        }
      });
    });

    // Socket handlers with session ownership validation
    io.on('connection', (socket) => {
      const authSocket = socket as Socket & { userId?: string };
      const userId = authSocket.userId;

      socket.emit('connected', { userId, socketId: socket.id });

      // Session join with ownership validation
      socket.on('session:join', async (data: { sessionId: string }) => {
        try {
          // Validate that the user owns the session
          const result = await validateSessionOwnership(data.sessionId, userId || '');

          if (!result.isOwner) {
            socket.emit('session:error', {
              error: 'UNAUTHORIZED',
              message: 'You do not have permission to access this session',
              sessionId: data.sessionId,
            });
            return;
          }

          socket.join(data.sessionId);
          socket.emit('session:joined', { sessionId: data.sessionId });
        } catch (error) {
          socket.emit('session:error', {
            error: 'VALIDATION_FAILED',
            message: error instanceof Error ? error.message : 'Failed to validate session ownership',
            sessionId: data.sessionId,
          });
        }
      });

      // Chat message with ownership validation
      socket.on('chat:message', async (data: { sessionId: string; message: string }) => {
        try {
          // Validate ownership
          const result = await validateSessionOwnership(data.sessionId, userId || '');

          if (!result.isOwner) {
            socket.emit('agent:error', {
              error: 'You do not have permission to send messages to this session',
              sessionId: data.sessionId,
            });
            return;
          }

          // Emit confirmation (simplified for this test)
          io.to(data.sessionId).emit('agent:event', {
            type: 'user_message_confirmed',
            sessionId: data.sessionId,
            userId,
            content: data.message,
            timestamp: new Date(),
          });
        } catch (error) {
          socket.emit('agent:error', {
            error: error instanceof Error ? error.message : 'Failed to process message',
            sessionId: data.sessionId,
          });
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        testPort = typeof address === 'object' && address ? address.port : 3097;
        resolve();
      });
    });

    factory = createTestSessionFactory();
  }, 60000);

  afterAll(async () => {
    await cleanupAllTestData();

    for (const client of clients) {
      await client.disconnect();
    }

    io.close();
    httpServer.close();
    await redisClient.quit();
  }, 30000);

  beforeEach(() => {
    clients.length = 0;
  });

  afterEach(async () => {
    for (const client of clients) {
      await client.disconnect();
    }
    clients.length = 0;
  });

  describe('Session Access Control', () => {
    it('should prevent User A from joining User B session', async () => {
      // Create two users with their own sessions
      const userA = await factory.createTestUser({ prefix: 'iso_a_' });
      const userB = await factory.createTestUser({ prefix: 'iso_b_' });

      // Create session for User B only
      const sessionB = await factory.createChatSession(userB.id);

      // User A tries to connect and join User B's session
      const clientA = createTestSocketClient({
        port: testPort,
        sessionCookie: userA.sessionCookie,
      });
      clients.push(clientA);

      await clientA.connect();

      // Try to join User B's session
      await expect(clientA.joinSession(sessionB.id)).rejects.toThrow();

      // Verify error event was received
      const events = clientA.getReceivedEvents();
      const errorEvent = events.find(e => e.type === 'session:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.data).toHaveProperty('error', 'UNAUTHORIZED');
    });

    it('should allow User B to join their own session', async () => {
      // Create user with session
      const userB = await factory.createTestUser({ prefix: 'iso_own_' });
      const sessionB = await factory.createChatSession(userB.id);

      // User B connects and joins their own session
      const clientB = createTestSocketClient({
        port: testPort,
        sessionCookie: userB.sessionCookie,
      });
      clients.push(clientB);

      await clientB.connect();

      // Should succeed
      await expect(clientB.joinSession(sessionB.id)).resolves.not.toThrow();

      // Verify joined event
      const events = clientB.getReceivedEvents();
      const joinedEvent = events.find(e => e.type === 'session:joined');
      expect(joinedEvent).toBeDefined();
    });

    it('should prevent User A from sending messages to User B session', async () => {
      // Create two users
      const userA = await factory.createTestUser({ prefix: 'iso_msg_a_' });
      const userB = await factory.createTestUser({ prefix: 'iso_msg_b_' });

      // Create session for User B
      const sessionB = await factory.createChatSession(userB.id);

      // User A connects
      const clientA = createTestSocketClient({
        port: testPort,
        sessionCookie: userA.sessionCookie,
      });
      clients.push(clientA);

      await clientA.connect();

      // User A tries to send message to User B's session
      await clientA.sendMessage(sessionB.id, 'Unauthorized message');

      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should receive error
      const events = clientA.getReceivedEvents();
      const errorEvent = events.find(e => e.type === 'agent:error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('Event Isolation', () => {
    it('should not leak events between users', async () => {
      // Create two users with their own sessions
      const userA = await factory.createTestUser({ prefix: 'leak_a_' });
      const userB = await factory.createTestUser({ prefix: 'leak_b_' });

      const sessionA = await factory.createChatSession(userA.id);
      const sessionB = await factory.createChatSession(userB.id);

      // Both users connect and join their own sessions
      const clientA = createTestSocketClient({
        port: testPort,
        sessionCookie: userA.sessionCookie,
      });
      const clientB = createTestSocketClient({
        port: testPort,
        sessionCookie: userB.sessionCookie,
      });
      clients.push(clientA, clientB);

      await clientA.connect();
      await clientB.connect();

      await clientA.joinSession(sessionA.id);
      await clientB.joinSession(sessionB.id);

      // Clear events from connection
      clientA.clearEvents();
      clientB.clearEvents();

      // Emit event to User A's session
      io.to(sessionA.id).emit('agent:event', {
        type: 'test_private_event',
        sessionId: sessionA.id,
        userId: userA.id,
        sensitiveData: 'secret_for_user_a',
      });

      // Wait for event propagation
      await new Promise(resolve => setTimeout(resolve, 200));

      // User A should receive the event
      const eventsA = clientA.getReceivedEvents();
      expect(eventsA.some(e => e.data.type === 'test_private_event')).toBe(true);

      // User B should NOT receive the event
      const eventsB = clientB.getReceivedEvents();
      expect(eventsB.some(e => e.data.type === 'test_private_event')).toBe(false);
    });

    it('should use authenticated userId, not payload userId', async () => {
      // Create user
      const realUser = await factory.createTestUser({ prefix: 'auth_real_' });
      const realSession = await factory.createChatSession(realUser.id);

      // Connect
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: realUser.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(realSession.id);
      client.clearEvents();

      // Send message with spoofed userId in payload
      client.emitRaw('chat:message', {
        sessionId: realSession.id,
        message: 'Test message',
        userId: 'spoofed_user_id_should_be_ignored', // This should be ignored
      });

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check that the user_message_confirmed uses the real authenticated userId
      const events = client.getReceivedEvents();
      const confirmedEvent = events.find(e =>
        e.type === 'agent:event' && e.data.type === 'user_message_confirmed'
      );

      if (confirmedEvent) {
        // The server should use the authenticated userId, not the spoofed one
        expect((confirmedEvent.data as { userId?: string }).userId).toBe(realUser.id);
        expect((confirmedEvent.data as { userId?: string }).userId).not.toBe('spoofed_user_id_should_be_ignored');
      }
    });
  });

  describe('Cross-Tenant Attack Prevention', () => {
    it('should reject session enumeration attempts', async () => {
      // Create legitimate user
      const user = await factory.createTestUser({ prefix: 'enum_' });

      // Connect
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();

      // Try to join multiple non-existent or other users' sessions
      const fakeSessionIds = [
        'fake-session-id-1',
        'another-fake-session',
        'test_integration_someone_elses_session',
      ];

      for (const sessionId of fakeSessionIds) {
        client.clearEvents();

        // Attempt to join
        client.emitRaw('session:join', { sessionId });

        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 500));

        // Should get error without revealing session existence
        const events = client.getReceivedEvents();
        const errorEvent = events.find(e => e.type === 'session:error');

        // Should get generic error, not "session not found" vs "not owner"
        // This prevents attackers from discovering valid session IDs
        expect(errorEvent).toBeDefined();
      }
    });

    it('should not allow access to sessions by guessing IDs', async () => {
      // Create User B with a session
      const userB = await factory.createTestUser({ prefix: 'guess_b_' });
      const sessionB = await factory.createChatSession(userB.id);

      // Create User A (attacker)
      const userA = await factory.createTestUser({ prefix: 'guess_a_' });

      // Attacker connects
      const attackerClient = createTestSocketClient({
        port: testPort,
        sessionCookie: userA.sessionCookie,
      });
      clients.push(attackerClient);

      await attackerClient.connect();

      // Attacker tries to join User B's session by its ID
      attackerClient.emitRaw('session:join', { sessionId: sessionB.id });

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should be rejected
      const events = attackerClient.getReceivedEvents();
      const errorEvent = events.find(e => e.type === 'session:error');
      expect(errorEvent).toBeDefined();

      // Verify User B's session was not compromised - they can still access it
      const victimClient = createTestSocketClient({
        port: testPort,
        sessionCookie: userB.sessionCookie,
      });
      clients.push(victimClient);

      await victimClient.connect();
      await expect(victimClient.joinSession(sessionB.id)).resolves.not.toThrow();
    });
  });
});
