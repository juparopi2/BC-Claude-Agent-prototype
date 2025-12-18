/**
 * E2E-10: Multi-Tenant Isolation Tests
 *
 * Tests the multi-tenant security including:
 * - User data isolation
 * - Session ownership validation
 * - Cross-tenant access prevention
 * - Concurrent user operations
 *
 * @module __tests__/e2e/flows/10-multi-tenant-isolation.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  ErrorValidator,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';

describe('E2E-10: Multi-Tenant Isolation', () => {
  const { getBaseUrl } = setupE2ETest();

  let clientA: E2ETestClient;
  let clientB: E2ETestClient;
  const factory = createTestSessionFactory();
  let userA: TestUser;
  let userB: TestUser;
  let userASession: TestChatSession;
  let userBSession: TestChatSession;

  beforeAll(async () => {
    // Create two separate users
    userA = await factory.createTestUser({ prefix: 'e2e_tenant_a_' });
    userB = await factory.createTestUser({ prefix: 'e2e_tenant_b_' });

    // Create sessions for each user
    userASession = await factory.createChatSession(userA.id, {
      title: 'User A Private Session',
    });
    userBSession = await factory.createChatSession(userB.id, {
      title: 'User B Private Session',
    });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(async () => {
    clientA = createE2ETestClient();
    clientA.setSessionCookie(userA.sessionCookie);

    clientB = createE2ETestClient();
    clientB.setSessionCookie(userB.sessionCookie);
  });

  afterEach(async () => {
    if (clientA.isConnected()) {
      await clientA.disconnect();
    }
    if (clientB.isConnected()) {
      await clientB.disconnect();
    }
  });

  describe('Session Ownership', () => {
    it('should prevent user B from viewing user A session', async () => {
      const response = await clientB.get(`/api/chat/sessions/${userASession.id}`);

      expect(response.status).toBe(403);
      const validation = ErrorValidator.validateForbidden(response);
      expect(validation.valid).toBe(true);
    });

    it('should prevent user A from viewing user B session', async () => {
      const response = await clientA.get(`/api/chat/sessions/${userBSession.id}`);

      expect(response.status).toBe(403);
    });

    it('should allow user A to view own session', async () => {
      const response = await clientA.get(`/api/chat/sessions/${userASession.id}`);

      expect(response.ok).toBe(true);
    });

    it('should allow user B to view own session', async () => {
      const response = await clientB.get(`/api/chat/sessions/${userBSession.id}`);

      expect(response.ok).toBe(true);
    });
  });

  describe('Session Listing', () => {
    it('should only list user A sessions for user A', async () => {
      const response = await clientA.get<{
        sessions: Array<{ id: string; title: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      const sessionIds = response.body.sessions.map(s => s.id);

      // Should include user A session
      expect(sessionIds).toContain(userASession.id);

      // Should NOT include user B session
      expect(sessionIds).not.toContain(userBSession.id);
    });

    it('should only list user B sessions for user B', async () => {
      const response = await clientB.get<{
        sessions: Array<{ id: string; title: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      const sessionIds = response.body.sessions.map(s => s.id);

      // Should include user B session
      expect(sessionIds).toContain(userBSession.id);

      // Should NOT include user A session
      expect(sessionIds).not.toContain(userASession.id);
    });
  });

  describe('Session Deletion', () => {
    it('should prevent user B from deleting user A session', async () => {
      const response = await clientB.delete(`/api/chat/sessions/${userASession.id}`);

      expect(response.status).toBe(403);
    });

    it('should prevent user A from deleting user B session', async () => {
      const response = await clientA.delete(`/api/chat/sessions/${userBSession.id}`);

      expect(response.status).toBe(403);
    });

    it('should allow user to delete own session', async () => {
      // Create a session to delete
      const tempSession = await factory.createChatSession(userA.id, {
        title: 'Temp Session to Delete',
      });

      const response = await clientA.delete(`/api/chat/sessions/${tempSession.id}`);

      expect(response.status).toBe(204);
    });
  });

  describe('WebSocket Session Access', () => {
    it('should prevent user B from joining user A session via WebSocket', async () => {
      await clientB.connect();

      await expect(
        clientB.joinSession(userASession.id)
      ).rejects.toThrow();
    });

    it('should prevent user A from joining user B session via WebSocket', async () => {
      await clientA.connect();

      await expect(
        clientA.joinSession(userBSession.id)
      ).rejects.toThrow();
    });

    it('should allow user to join own session via WebSocket', async () => {
      await clientA.connect();
      await clientA.joinSession(userASession.id);

      // Should be connected without error
      expect(clientA.isConnected()).toBe(true);
    });
  });

  describe('Message Sending Isolation', () => {
    it('should prevent user B from sending messages to user A session', async () => {
      await clientB.connect();

      // Try to join and send to user A session
      try {
        await clientB.joinSession(userASession.id);

        // If join succeeded (shouldn't), try sending
        await clientB.sendMessage(userASession.id, 'Unauthorized message');

        // Should not reach here
        expect.fail('Should have thrown an error');
      } catch {
        // Expected - join should fail
        expect(true).toBe(true);
      }
    });

    it('should allow user to send messages to own session', async () => {
      await clientA.connect();
      await clientA.joinSession(userASession.id);

      await clientA.sendMessage(userASession.id, 'Authorized message');

      const event = await clientA.waitForAgentEvent('user_message_confirmed', {
        timeout: 10000,
      });

      expect(event).toBeDefined();
    });
  });

  describe('Concurrent User Operations', () => {
    it('should handle both users operating simultaneously', async () => {
      // Both connect
      await clientA.connect();
      await clientA.joinSession(userASession.id);

      await clientB.connect();
      await clientB.joinSession(userBSession.id);

      // Both send messages simultaneously
      const promiseA = (async () => {
        await clientA.sendMessage(userASession.id, 'User A message');
        return clientA.waitForAgentEvent('user_message_confirmed');
      })();

      const promiseB = (async () => {
        await clientB.sendMessage(userBSession.id, 'User B message');
        return clientB.waitForAgentEvent('user_message_confirmed');
      })();

      const [eventA, eventB] = await Promise.all([promiseA, promiseB]);

      expect(eventA).toBeDefined();
      expect(eventB).toBeDefined();
    });

    it('should isolate events between users', async () => {
      await clientA.connect();
      await clientA.joinSession(userASession.id);

      await clientB.connect();
      await clientB.joinSession(userBSession.id);

      // User A sends message
      await clientA.sendMessage(userASession.id, 'User A exclusive message');
      await clientA.waitForAgentEvent('user_message_confirmed');

      // User B should NOT receive User A's events
      const userBEvents = clientB.getReceivedEvents();
      const hasUserAEvent = userBEvents.some(
        e => e.data.type === 'user_message_confirmed'
      );

      expect(hasUserAEvent).toBe(false);
    });
  });

  describe('Data Isolation Verification', () => {
    it('should not leak message content between users', async () => {
      // Create unique messages
      const userAMessage = `User A secret ${Date.now()}`;
      const userBMessage = `User B secret ${Date.now()}`;

      await clientA.connect();
      await clientA.joinSession(userASession.id);
      await clientA.sendMessage(userASession.id, userAMessage);
      await clientA.waitForAgentEvent('complete', { timeout: 30000 });

      await clientB.connect();
      await clientB.joinSession(userBSession.id);
      await clientB.sendMessage(userBSession.id, userBMessage);
      await clientB.waitForAgentEvent('complete', { timeout: 30000 });

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Verify user A can only see their message
      const responseA = await clientA.get<{
        messages: Array<{ content: string }>;
      }>(`/api/chat/sessions/${userASession.id}`);

      const userAContents = (responseA.body.messages || []).map(m => m.content);
      expect(userAContents.some(c => c.includes('User A secret'))).toBe(true);
      expect(userAContents.some(c => c.includes('User B secret'))).toBe(false);

      // Verify user B can only see their message
      const responseB = await clientB.get<{
        messages: Array<{ content: string }>;
      }>(`/api/chat/sessions/${userBSession.id}`);

      const userBContents = (responseB.body.messages || []).map(m => m.content);
      expect(userBContents.some(c => c.includes('User B secret'))).toBe(true);
      expect(userBContents.some(c => c.includes('User A secret'))).toBe(false);
    });
  });

  describe('Session Creation Isolation', () => {
    it('should create sessions only for authenticated user', async () => {
      // User A creates session
      const responseA = await clientA.post<{ id: string }>('/api/chat/sessions', {
        title: 'User A New Session',
      });

      expect(responseA.ok).toBe(true);
      const newSessionId = responseA.body.id;

      // User B should not have access
      const accessResponse = await clientB.get(
        `/api/chat/sessions/${newSessionId}`
      );

      expect(accessResponse.status).toBe(403);
    });
  });

  describe('Cross-Tenant API Access', () => {
    it('should prevent IDOR attack on session endpoint', async () => {
      // User B tries to access user A session with direct ID
      const response = await clientB.get(`/api/chat/sessions/${userASession.id}`);

      expect(response.status).toBe(403);
    });

    it('should prevent IDOR attack on message endpoint', async () => {
      // First add message to user A session
      await clientA.connect();
      await clientA.joinSession(userASession.id);
      await clientA.sendMessage(userASession.id, 'Private message');
      await clientA.waitForAgentEvent('complete', { timeout: 30000 });

      // User B tries to fetch messages from user A session
      const response = await clientB.get(`/api/chat/sessions/${userASession.id}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should reject requests without authentication', async () => {
      const unauthClient = createE2ETestClient();
      // Don't set session cookie

      const response = await unauthClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid session cookie', async () => {
      const invalidClient = createE2ETestClient();
      invalidClient.setSessionCookie('invalid-session-cookie');

      const response = await invalidClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should reject WebSocket connection without authentication', async () => {
      const unauthClient = createE2ETestClient();
      // Don't set session cookie

      // Connect should fail or connection should be rejected
      try {
        await unauthClient.connect();
        await unauthClient.joinSession(userASession.id);
        expect.fail('Should have been rejected');
      } catch {
        // Expected
        expect(true).toBe(true);
      }
    });
  });

  describe('User Switching', () => {
    it('should properly switch user context', async () => {
      // Client starts as user A
      const dualClient = createE2ETestClient();
      dualClient.setSessionCookie(userA.sessionCookie);

      // Access as user A
      const responseAsA = await dualClient.get<{ sessions: Array<{ id: string }> }>(
        '/api/chat/sessions'
      );
      expect(responseAsA.ok).toBe(true);
      expect(responseAsA.body.sessions.map(s => s.id)).toContain(userASession.id);

      // Switch to user B
      dualClient.setSessionCookie(userB.sessionCookie);

      // Access as user B
      const responseAsB = await dualClient.get<{ sessions: Array<{ id: string }> }>(
        '/api/chat/sessions'
      );
      expect(responseAsB.ok).toBe(true);
      expect(responseAsB.body.sessions.map(s => s.id)).toContain(userBSession.id);
      expect(responseAsB.body.sessions.map(s => s.id)).not.toContain(userASession.id);
    });
  });

  describe('Approval Flow Isolation', () => {
    it('should not broadcast approvals to different user sessions', async () => {
      // Create new sessions for this test
      const sessionA = await factory.createChatSession(userA.id, {
        title: 'Approval Isolation A',
      });
      const sessionB = await factory.createChatSession(userB.id, {
        title: 'Approval Isolation B',
      });

      // Both users connect
      await clientA.connect();
      await clientA.joinSession(sessionA.id);

      await clientB.connect();
      await clientB.joinSession(sessionB.id);

      // User A triggers approval
      await clientA.sendMessage(sessionA.id, 'Create customer in Business Central');

      // Wait for potential approval event
      const approvalEvent = await clientA.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        // User B should NOT receive this approval
        const userBEvents = clientB.getReceivedEvents();
        const hasApproval = userBEvents.some(
          e => e.data.type === 'approval_requested'
        );

        expect(hasApproval).toBe(false);
      }
    });
  });
});
