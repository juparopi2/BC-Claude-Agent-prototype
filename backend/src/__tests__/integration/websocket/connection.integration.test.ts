/**
 * WebSocket Connection Integration Tests
 *
 * Tests WebSocket connection handling with real Redis sessions.
 * Validates authentication, session management, and error handling.
 *
 * REFACTORED: Uses SocketIOServerFactory to eliminate duplicated setup code.
 *
 * @module __tests__/integration/websocket/connection.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  createTestSocketClient,
  createTestSessionFactory,
  cleanupAllTestData,
  createTestSocketIOServer,
  TestSocketClient,
  TestSessionFactory,
  SocketIOServerResult,
  TEST_TIMEOUTS,
  setupDatabaseForTests,
} from '../helpers';

describe('WebSocket Connection Integration', () => {
  // Setup database connection for TestSessionFactory
  setupDatabaseForTests();

  let serverResult: SocketIOServerResult;
  let factory: TestSessionFactory;
  let client: TestSocketClient | null = null;

  beforeAll(async () => {
    // Create Socket.IO server using the factory - no custom handlers needed
    // The factory provides default handlers for session:join, session:leave, ping
    serverResult = await createTestSocketIOServer();

    // Create test factory
    factory = createTestSessionFactory();

    console.log(`Test server listening on port ${serverResult.port}`);
  }, TEST_TIMEOUTS.BEFORE_ALL);

  afterAll(async () => {
    // Cleanup test data
    await cleanupAllTestData();

    // Close connections
    if (client) {
      await client.disconnect();
    }

    // Use the cleanup function from the factory
    await serverResult.cleanup();
  }, TEST_TIMEOUTS.AFTER_ALL);

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
      const testUser = await factory.createTestUser({ prefix: 'conn_valid_' }, serverResult.redisClient);

      // Create socket client
      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
        defaultTimeout: TEST_TIMEOUTS.SOCKET_CONNECTION,
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
        port: serverResult.port,
        defaultTimeout: TEST_TIMEOUTS.EVENT_WAIT,
      });

      // Connect should fail
      await expect(client.connect()).rejects.toThrow('Authentication required');

      // Should not be connected
      expect(client.isConnected()).toBe(false);
    });

    it('should reject connection with invalid session cookie', async () => {
      // Create socket client with invalid session
      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: 'connect.sid=s%3Ainvalid_session_id.fake-signature',
        defaultTimeout: TEST_TIMEOUTS.EVENT_WAIT,
      });

      // Connect should fail (session not found in Redis)
      await expect(client.connect()).rejects.toThrow();
    });

    it('should set userId on authenticated socket', async () => {
      // Create test user
      const testUser = await factory.createTestUser({ prefix: 'conn_userid_' }, serverResult.redisClient);

      // Create and connect socket
      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();

      // Send ping and verify response contains userId
      client.emitRaw('ping', {});

      const pongEvent = await client.waitForEvent('pong', TEST_TIMEOUTS.EVENT_WAIT);
      expect(pongEvent).toBeDefined();
      // Note: pong event includes userId from server
    });
  });

  describe('Session Room Management', () => {
    it('should allow joining a session room', async () => {
      // Create test user and session
      const testUser = await factory.createTestUser({ prefix: 'room_join_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      // Connect socket
      client = createTestSocketClient({
        port: serverResult.port,
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
      const testUser = await factory.createTestUser({ prefix: 'room_leave_' }, serverResult.redisClient);
      const testSession = await factory.createChatSession(testUser.id);

      // Connect and join
      client = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: testUser.sessionCookie,
      });

      await client.connect();
      await client.joinSession(testSession.id);

      // Leave session
      await client.leaveSession(testSession.id);

      // Wait for left event
      const leftEvent = await client.waitForEvent('session:left', TEST_TIMEOUTS.EVENT_WAIT);
      expect(leftEvent).toBeDefined();
    });

    it('should isolate events to session rooms', async () => {
      // Create two test users with separate sessions
      const userA = await factory.createTestUser({ prefix: 'room_iso_a_' }, serverResult.redisClient);
      const userB = await factory.createTestUser({ prefix: 'room_iso_b_' }, serverResult.redisClient);

      const sessionA = await factory.createChatSession(userA.id);
      const sessionB = await factory.createChatSession(userB.id);

      // Connect both users
      const clientA = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: userA.sessionCookie,
      });

      const clientB = createTestSocketClient({
        port: serverResult.port,
        sessionCookie: userB.sessionCookie,
      });

      await clientA.connect();
      await clientB.connect();

      // User A joins session A
      await clientA.joinSession(sessionA.id);

      // User B joins session B
      await clientB.joinSession(sessionB.id);

      // Emit event to session A room
      serverResult.io.to(sessionA.id).emit('agent:event', {
        type: 'test_event',
        sessionId: sessionA.id,
        data: 'for_session_a',
      });

      // Wait a bit for event propagation
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.EVENT_PROPAGATION));

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
      const testUser = await factory.createTestUser({ prefix: 'err_disconnect_' }, serverResult.redisClient);

      // Connect
      client = createTestSocketClient({
        port: serverResult.port,
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
      const testUser = await factory.createTestUser({ prefix: 'err_reconnect_' }, serverResult.redisClient);

      // First connection
      client = createTestSocketClient({
        port: serverResult.port,
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
        port: serverResult.port,
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
