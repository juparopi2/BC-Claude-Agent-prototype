/**
 * E2E Tests: WebSocket Session Room Management
 *
 * Tests session room join/leave operations and ownership validation.
 *
 * @module __tests__/e2e/websocket/session-rooms.ws.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../helpers/E2ETestClient';
import { TestSessionFactory } from '../../integration/helpers/TestSessionFactory';

describe('E2E: WebSocket Session Rooms', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let userId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    const auth = await factory.createTestUser();
    userId = auth.id;
    sessionCookie = auth.sessionCookie;
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(async () => {
    client = createE2ETestClient();
    client.setSessionCookie(sessionCookie);
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('session:join', () => {
    it('should join session room and receive ready signal', async () => {
      // Create a session via HTTP first
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'WS Join Test' });
      const sessionId = response.body.id;

      // Join the session room
      await client.joinSession(sessionId);
      // joinSession waits for session:ready internally
      expect(client.isConnected()).toBe(true);
    });

    it('should reject joining non-existent session', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      await expect(client.joinSession(fakeSessionId)).rejects.toThrow();
    });

    it('should reject joining session owned by another user', async () => {
      // Create session as first user
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Other User Session' });
      const sessionId = response.body.id;

      // Create second user and client
      const otherAuth = await factory.createTestUser({ prefix: 'other_' });
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherAuth.sessionCookie);
      await otherClient.connect();

      // Try to join first user's session
      await expect(otherClient.joinSession(sessionId)).rejects.toThrow();

      await otherClient.disconnect();
    });

    it('should allow joining multiple sessions sequentially', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);

      // Create two sessions
      const response1 = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Session 1' });
      const sessionId1 = response1.body.id;
      const response2 = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Session 2' });
      const sessionId2 = response2.body.id;

      // Join first session
      await client.joinSession(sessionId1);
      expect(client.isConnected()).toBe(true);

      // Leave first session
      await client.leaveSession(sessionId1);

      // Join second session
      await client.joinSession(sessionId2);
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('session:leave', () => {
    it('should leave session room', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'WS Leave Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      await client.leaveSession(sessionId);
      // Should not throw, leaving is fire-and-forget
      expect(client.isConnected()).toBe(true);
    });

    it('should handle leaving session not joined', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      // Should not throw, leaving is fire-and-forget
      await expect(client.leaveSession(fakeSessionId)).resolves.not.toThrow();
    });
  });

  describe('Session room isolation', () => {
    it('should not receive events from sessions not joined', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);

      // Create two sessions
      const response1 = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Session A' });
      const sessionId1 = response1.body.id;
      const response2 = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Session B' });
      const sessionId2 = response2.body.id;

      // Join only session 1
      await client.joinSession(sessionId1);
      client.clearEvents();

      // Create second client to send message to session 2
      const client2 = createE2ETestClient();
      client2.setSessionCookie(sessionCookie);
      await client2.connect();
      await client2.joinSession(sessionId2);
      await client2.sendMessage(sessionId2, 'Message to session 2');

      // Wait a bit to ensure no events leak
      await new Promise(resolve => setTimeout(resolve, 1000));

      // First client should not receive events from session 2
      const events = client.getReceivedEvents();
      const sessionEvents = events.filter(e =>
        e.data && 'sessionId' in e.data && e.data.sessionId === sessionId2
      );
      expect(sessionEvents.length).toBe(0);

      await client2.disconnect();
    });
  });
});
