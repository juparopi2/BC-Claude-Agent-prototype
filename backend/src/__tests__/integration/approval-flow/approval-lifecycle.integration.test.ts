/**
 * Approval Flow Integration Tests
 *
 * Tests the complete approval lifecycle including request, response,
 * and timeout handling with real database and Redis.
 *
 * @module __tests__/integration/approval-flow/approval-lifecycle.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import express from 'express';
import session from 'express-session';
import { createClient, RedisClientType } from 'redis';
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
import { getApprovalManager, ApprovalManager } from '@/domains/approval/ApprovalManager';
import { resetEventStore } from '@/services/events/EventStore';
import { getMessageQueue, hasMessageQueueInstance } from '@/infrastructure/queue/MessageQueue';



// F1-002: Approval Flow Integration Tests
// Fixed: chk_approvals_action_type constraint now documented in 03-database-schema.md
// ApprovalManager.getActionType() updated to return correct values: 'create', 'update', 'delete', 'custom'
describe('Approval Flow Integration', () => {
  // Setup database connection for TestSessionFactory
  setupDatabaseForTests();

  let httpServer: HttpServer;
  let io: SocketIOServer;
  let testPort: number;
  let factory: TestSessionFactory;
  let approvalManager: ApprovalManager;
  let redisClient: RedisClientType;

  const clients: TestSocketClient[] = [];

  beforeAll(async () => {
    // Configure timeout for tests
    process.env.APPROVAL_TIMEOUT = '5000';

    // Create Redis client using test config
    // NOTE: connect-redis@7 requires redis package (not ioredis)
    redisClient = createClient({
      socket: {
        host: REDIS_TEST_CONFIG.host,
        port: REDIS_TEST_CONFIG.port,
      },
    });

    await redisClient.connect();

    // Create Express app
    const app = express();

    const sessionMiddleware = session({
      store: new RedisStore({
        client: redisClient,
        prefix: 'sess:',
        ttl: 86400, // 24 hours
      }),
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

    // Initialize approval manager with Socket.IO
    approvalManager = getApprovalManager(io);

    // Authentication middleware
    io.use((socket, next) => {
      const req = socket.request as express.Request;
      const res = {} as express.Response;

      sessionMiddleware(req, res, (err) => {
        if (err) return next(new Error('Session error'));

        const sessionData = (req as { session?: { microsoftOAuth?: { userId?: string; email?: string } } }).session;
        if (sessionData?.microsoftOAuth?.userId) {
          (socket as Socket & { userId?: string }).userId = sessionData.microsoftOAuth.userId;
          next();
        } else {
          next(new Error('Authentication required'));
        }
      });
    });

    // Socket handlers
    io.on('connection', (socket) => {
      const authSocket = socket as Socket & { userId?: string };

      socket.on('session:join', (data: { sessionId: string }) => {
        socket.join(data.sessionId);
        socket.emit('session:joined', { sessionId: data.sessionId });
      });

      // Handle approval response
      socket.on('approval:response', async (data: {
        approvalId: string;
        decision: 'approved' | 'rejected';
      }) => {
        try {
          const result = await approvalManager.respondToApprovalAtomic(
            data.approvalId,
            data.decision,
            authSocket.userId || ''
          );

          if (result.success) {
            socket.emit('approval:response:success', { approvalId: data.approvalId });
          } else {
            socket.emit('approval:response:error', {
              approvalId: data.approvalId,
              error: result.error,
            });
          }
        } catch (error) {
          socket.emit('approval:response:error', {
            approvalId: data.approvalId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        testPort = typeof address === 'object' && address ? address.port : 3096;
        resolve();
      });
    });

    factory = createTestSessionFactory();
  }, 60000);

  afterAll(async () => {
    // Drain BullMQ jobs before cleanup to prevent FK_messages_event_id violation
    // See docs/plans/Refactor/FK-errors.md for details
    // IMPORTANT: Only close if instance exists - don't create new connections!
    if (hasMessageQueueInstance()) {
      try {
        const messageQueue = getMessageQueue();
        await messageQueue.close();
      } catch {
        // MessageQueue may not be initialized in all test scenarios
      }
    }

    await cleanupAllTestData();
    for (const client of clients) {
      await client.disconnect();
    }
    io.close();
    httpServer.close();
    await redisClient.quit();
    delete process.env.APPROVAL_TIMEOUT;
  }, 30000);

  beforeEach(() => {
    clients.length = 0;
    resetEventStore();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up sequence keys to prevent duplicate key errors
    const keys = await redisClient.keys('event:sequence:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  });

  describe('Approval Request Lifecycle', () => {
    it('should create approval via request() method', async () => {
      // Create test user and session
      const user = await factory.createTestUser({ prefix: 'appr_create_' }, redisClient);
      const session = await factory.createChatSession(user.id);

      // Connect client to receive events
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(session.id);
      client.clearEvents();

      // Request approval - this creates the approval and returns a Promise
      // that resolves when user responds (we won't wait for it in this test)
      const approvalPromise = approvalManager.request({
        sessionId: session.id,
        toolName: 'create_customer',
        toolArgs: { name: 'Test Corp', email: 'test@example.com' },
      });

      // Wait for approval_requested event to be emitted
      const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);

      expect(approvalEvent).toBeDefined();
      expect(approvalEvent.type).toBe('approval_requested');
      expect(approvalEvent).toHaveProperty('approvalId');
      expect(approvalEvent).toHaveProperty('toolName', 'create_customer');

      // Cleanup: Respond to avoid dangling promise
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;
      await approvalManager.respondToApprovalAtomic(approvalId, 'rejected', user.id);

      // Wait for the promise to resolve
      const result = await approvalPromise;
      expect(result).toBe(false); // rejected
    });

    it('should return true when user approves', async () => {
      // Create user and session
      const user = await factory.createTestUser({ prefix: 'appr_approve_' }, redisClient);
      const session = await factory.createChatSession(user.id);

      // Connect client
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(session.id);
      client.clearEvents();

      // Start approval request
      const approvalPromise = approvalManager.request({
        sessionId: session.id,
        toolName: 'update_customer',
        toolArgs: { id: '456', name: 'Updated Corp' },
      });

      // Wait for event
      const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;

      // Approve via direct manager call
      await approvalManager.respondToApprovalAtomic(approvalId, 'approved', user.id);

      // Wait for result
      const result = await approvalPromise;

      expect(result).toBe(true); // approved
    });

    it('should return false when user rejects', async () => {
      // Create user and session
      const user = await factory.createTestUser({ prefix: 'appr_deny_' }, redisClient);
      const session = await factory.createChatSession(user.id);

      // Connect client
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(session.id);
      client.clearEvents();

      // Start approval request
      const approvalPromise = approvalManager.request({
        sessionId: session.id,
        toolName: 'delete_customer',
        toolArgs: { id: '789' },
      });

      // Wait for event
      const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;

      // Reject via direct manager call
      await approvalManager.respondToApprovalAtomic(approvalId, 'rejected', user.id);

      // Wait for result
      const result = await approvalPromise;

      expect(result).toBe(false); // rejected
    });
  });

  describe('Approval Security', () => {
    it('should prevent User A from responding to User B approval', async () => {
      // Create two users
      const userA = await factory.createTestUser({ prefix: 'appr_sec_a_' }, redisClient);
      const userB = await factory.createTestUser({ prefix: 'appr_sec_b_' }, redisClient);
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
      clients.push(clientA, clientB);

      await clientA.connect();
      await clientB.connect();
      await clientB.joinSession(sessionB.id);

      // Create approval for User B's session
      const approvalPromise = approvalManager.request({
        sessionId: sessionB.id,
        toolName: 'create_order',
        toolArgs: { customerId: '123' },
      });

      // Wait for event to be emitted
      const approvalEvent = await clientB.waitForAgentEvent('approval_requested', 10000);
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;

      // User A tries to respond (should fail)
      const unauthorizedResult = await approvalManager.respondToApprovalAtomic(
        approvalId,
        'approved',
        userA.id // Wrong user!
      );

      expect(unauthorizedResult.success).toBe(false);
      expect(unauthorizedResult.error).toBe('UNAUTHORIZED');

      // Cleanup: User B responds
      await approvalManager.respondToApprovalAtomic(approvalId, 'rejected', userB.id);
      await approvalPromise;
    });

    it('should use authenticated userId from socket, not payload', async () => {
      // Create user
      const user = await factory.createTestUser({ prefix: 'appr_auth_' }, redisClient);
      const session = await factory.createChatSession(user.id);

      // Connect
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(session.id);
      client.clearEvents();

      // Create approval
      const approvalPromise = approvalManager.request({
        sessionId: session.id,
        toolName: 'test_tool',
        toolArgs: {},
      });

      // Wait for event
      const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;

      // Respond via WebSocket (server uses authenticated userId from socket)
      client.emitRaw('approval:response', {
        approvalId,
        decision: 'approved',
        userId: 'spoofed_user_id_should_be_ignored', // This should be ignored
      });

      // Wait for result
      const result = await approvalPromise;

      // Should succeed because server uses authenticated userId
      expect(result).toBe(true);
    });
  });

  describe('Concurrent Approvals', () => {
    it('should handle first response and reject subsequent responses', async () => {
      // Create user
      const user = await factory.createTestUser({ prefix: 'appr_race_' }, redisClient);
      const session = await factory.createChatSession(user.id);

      // Connect client
      const client = createTestSocketClient({
        port: testPort,
        sessionCookie: user.sessionCookie,
      });
      clients.push(client);

      await client.connect();
      await client.joinSession(session.id);

      // Create approval
      const approvalPromise = approvalManager.request({
        sessionId: session.id,
        toolName: 'concurrent_test',
        toolArgs: {},
      });

      // Wait for event
      const approvalEvent = await client.waitForAgentEvent('approval_requested', 10000);
      const approvalId = (approvalEvent as { approvalId: string }).approvalId;

      // Both calls try to respond simultaneously
      const [result1, result2] = await Promise.all([
        approvalManager.respondToApprovalAtomic(approvalId, 'approved', user.id),
        approvalManager.respondToApprovalAtomic(approvalId, 'rejected', user.id),
      ]);

      // One should succeed, one should fail
      const successes = [result1.success, result2.success].filter(Boolean);
      const failures = [result1.success, result2.success].filter(s => !s);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // The failing one should have ALREADY_RESOLVED error
      const failedResult = result1.success ? result2 : result1;
      expect(failedResult.error).toBe('ALREADY_RESOLVED');

      await approvalPromise;
    });
  });
});
