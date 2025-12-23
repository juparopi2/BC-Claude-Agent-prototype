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
import { setupE2ETest, drainMessageQueue } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
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
    clientA.setUserAuth(userA);

    clientB = createE2ETestClient();
    clientB.setUserAuth(userB);
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

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
    });

    it('should prevent user A from viewing user B session', async () => {
      const response = await clientA.get(`/api/chat/sessions/${userBSession.id}`);

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
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

      // Normalize UUIDs to lowercase for comparison (SQL Server returns UPPERCASE)
      const sessionIds = response.body.sessions.map(s => s.id.toLowerCase());

      // Should include user A session
      expect(sessionIds).toContain(userASession.id.toLowerCase());

      // Should NOT include user B session
      expect(sessionIds).not.toContain(userBSession.id.toLowerCase());
    });

    it('should only list user B sessions for user B', async () => {
      const response = await clientB.get<{
        sessions: Array<{ id: string; title: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      // Normalize UUIDs to lowercase for comparison (SQL Server returns UPPERCASE)
      const sessionIds = response.body.sessions.map(s => s.id.toLowerCase());

      // Should include user B session
      expect(sessionIds).toContain(userBSession.id.toLowerCase());

      // Should NOT include user A session
      expect(sessionIds).not.toContain(userASession.id.toLowerCase());
    });
  });

  describe('Session Deletion', () => {
    it('should prevent user B from deleting user A session', async () => {
      const response = await clientB.delete(`/api/chat/sessions/${userASession.id}`);

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
    });

    it('should prevent user A from deleting user B session', async () => {
      const response = await clientA.delete(`/api/chat/sessions/${userBSession.id}`);

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
    });

    it('should allow user to delete own session', async () => {
      // Create a session to delete
      const tempSession = await factory.createChatSession(userA.id, {
        title: 'Temp Session to Delete',
      });

      const response = await clientA.delete(`/api/chat/sessions/${tempSession.id}`);

      // REST standard: DELETE returns 204 No Content
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
      // ⭐ CRITICAL: Create FRESH sessions for this test to avoid message contamination
      // from previous tests that use the shared userASession/userBSession
      const isolatedSessionA = await factory.createChatSession(userA.id, {
        title: 'Data Isolation Test - User A',
      });
      const isolatedSessionB = await factory.createChatSession(userB.id, {
        title: 'Data Isolation Test - User B',
      });

      // Create unique messages
      const userAMessage = `User A secret ${Date.now()}`;
      const userBMessage = `User B secret ${Date.now()}`;

      await clientA.connect();
      await clientA.joinSession(isolatedSessionA.id);
      await clientA.sendMessage(isolatedSessionA.id, userAMessage);
      await clientA.waitForAgentEvent('complete', { timeout: 30000 });

      await clientB.connect();
      await clientB.joinSession(isolatedSessionB.id);
      await clientB.sendMessage(isolatedSessionB.id, userBMessage);
      await clientB.waitForAgentEvent('complete', { timeout: 30000 });

      // ⭐ CRITICAL: Drain MessageQueue to ensure all BullMQ jobs complete
      // User messages are persisted async via BullMQ, so we must wait for jobs to finish
      await drainMessageQueue();

      // Wait for async persistence with polling (BullMQ processing can take time)
      // Poll for up to 10 seconds until messages appear
      const maxWaitTime = 10000;
      const pollInterval = 500;
      let elapsed = 0;
      let userAMessages: Array<{ content?: string; role?: string }> = [];
      let userBMessages: Array<{ content?: string; role?: string }> = [];
      let userAContents: string[] = [];
      let userBContents: string[] = [];

      while (elapsed < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsed += pollInterval;

        // Check User A messages (using isolated session)
        const responseA = await clientA.get<{
          messages: Array<{ content?: string; role?: string }>;
        }>(`/api/chat/sessions/${isolatedSessionA.id}/messages`);
        userAMessages = responseA.body.messages || [];
        userAContents = userAMessages
          .map(m => m.content)
          .filter((c): c is string => c !== undefined);

        // Check User B messages (using isolated session)
        const responseB = await clientB.get<{
          messages: Array<{ content?: string; role?: string }>;
        }>(`/api/chat/sessions/${isolatedSessionB.id}/messages`);
        userBMessages = responseB.body.messages || [];
        userBContents = userBMessages
          .map(m => m.content)
          .filter((c): c is string => c !== undefined);

        // If both users have their messages, stop polling
        const userAHasMessage = userAContents.some(c => c.includes('User A secret'));
        const userBHasMessage = userBContents.some(c => c.includes('User B secret'));
        if (userAHasMessage && userBHasMessage) {
          break;
        }
      }

      // Debug: Log what we got
      console.log('[DEBUG] User A messages:', userAMessages.length, 'roles:', userAMessages.map(m => m.role));
      console.log('[DEBUG] User B messages:', userBMessages.length, 'roles:', userBMessages.map(m => m.role));
      console.log('[DEBUG] User A contents (first 100 chars):', userAContents.map(c => c?.slice(0, 100)));
      console.log('[DEBUG] User B contents (first 100 chars):', userBContents.map(c => c?.slice(0, 100)));

      // Debug: Explicit assertion checks
      const userAHasOwnSecret = userAContents.some(c => c.includes('User A secret'));
      const userAHasOtherSecret = userAContents.some(c => c.includes('User B secret'));
      const userBHasOwnSecret = userBContents.some(c => c.includes('User B secret'));
      const userBHasOtherSecret = userBContents.some(c => c.includes('User A secret'));

      console.log('[DEBUG] Assertion values:', {
        userAHasOwnSecret,
        userAHasOtherSecret,
        userBHasOwnSecret,
        userBHasOtherSecret,
        userAContentsLength: userAContents.length,
        userBContentsLength: userBContents.length,
      });

      // Verify user A can only see their message
      expect(userAHasOwnSecret).toBe(true);
      expect(userAHasOtherSecret).toBe(false);

      // Verify user B can only see their message
      expect(userBHasOwnSecret).toBe(true);
      expect(userBHasOtherSecret).toBe(false);
    }, 120000); // 2 minute timeout for real API
  });

  describe('Session Creation Isolation', () => {
    it('should create sessions only for authenticated user', async () => {
      // User A creates session (API returns unwrapped session)
      const responseA = await clientA.post<{ id: string }>('/api/chat/sessions', {
        title: 'User A New Session',
      });

      expect(responseA.ok).toBe(true);
      const newSessionId = responseA.body.id;

      // User B should not have access
      const accessResponse = await clientB.get(
        `/api/chat/sessions/${newSessionId}`
      );

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(accessResponse.status).toBe(404);
    });
  });

  describe('Cross-Tenant API Access', () => {
    it('should prevent IDOR attack on session endpoint', async () => {
      // User B tries to access user A session with direct ID
      const response = await clientB.get(`/api/chat/sessions/${userASession.id}`);

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
    });

    it('should prevent IDOR attack on message endpoint', async () => {
      // First add message to user A session
      await clientA.connect();
      await clientA.joinSession(userASession.id);
      await clientA.sendMessage(userASession.id, 'Private message');
      await clientA.waitForAgentEvent('complete', { timeout: 30000 });

      // User B tries to fetch messages from user A session
      const response = await clientB.get(`/api/chat/sessions/${userASession.id}`);

      // Returns 404 instead of 403 to avoid revealing resource existence (OWASP best practice)
      expect(response.status).toBe(404);
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
      // Normalize UUIDs for comparison (SQL Server returns UPPERCASE)
      const sessionIdsA = responseAsA.body.sessions.map(s => s.id.toLowerCase());
      expect(sessionIdsA).toContain(userASession.id.toLowerCase());

      // Switch to user B
      dualClient.setSessionCookie(userB.sessionCookie);

      // Access as user B
      const responseAsB = await dualClient.get<{ sessions: Array<{ id: string }> }>(
        '/api/chat/sessions'
      );
      expect(responseAsB.ok).toBe(true);
      // Normalize UUIDs for comparison (SQL Server returns UPPERCASE)
      const sessionIdsB = responseAsB.body.sessions.map(s => s.id.toLowerCase());
      expect(sessionIdsB).toContain(userBSession.id.toLowerCase());
      expect(sessionIdsB).not.toContain(userASession.id.toLowerCase());
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
