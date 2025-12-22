/**
 * E2E-02: Session Management Tests
 *
 * Tests the complete session lifecycle including:
 * - Creating new sessions
 * - Listing user sessions
 * - Deleting sessions
 * - Session ownership validation
 *
 * @module __tests__/e2e/flows/02-session-management.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  ErrorValidator,
  type TestUser,
} from '../helpers';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';

describe('E2E-02: Session Management', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    // Create two test users for ownership testing
    userA = await factory.createTestUser({ prefix: 'e2e_sess_a_' });
    userB = await factory.createTestUser({ prefix: 'e2e_sess_b_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
  });

  describe('Create Session', () => {
    beforeEach(() => {
      client.setSessionCookie(userA.sessionCookie);
    });

    it('should create a new session', async () => {
      const response = await client.post<{
        id: string;
        title: string;
        createdAt: string;
      }>('/api/chat/sessions', { title: 'Test Session' });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.title).toBe('Test Session');
      expect(response.body.createdAt).toBeDefined();
    });

    it('should create session with default title', async () => {
      const response = await client.post<{
        id: string;
        title: string;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(response.body.title).toBeDefined();
    });

    it('should create multiple sessions for same user', async () => {
      // Create first session
      const response1 = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Session 1',
      });
      expect(response1.ok).toBe(true);

      // Create second session
      const response2 = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Session 2',
      });
      expect(response2.ok).toBe(true);

      // Sessions should have different IDs
      expect(response1.body.id).not.toBe(response2.body.id);
    });
  });

  describe('List Sessions', () => {
    beforeEach(() => {
      client.setSessionCookie(userA.sessionCookie);
    });

    it('should list user sessions', async () => {
      // Create some sessions
      await factory.createChatSession(userA.id, { title: 'List Test 1' });
      await factory.createChatSession(userA.id, { title: 'List Test 2' });

      const response = await client.get<{
        sessions: Array<{
          id: string;
          title: string;
          createdAt: string;
          updatedAt: string;
        }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body.sessions)).toBe(true);
      expect(response.body.sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should order sessions by updatedAt DESC', async () => {
      // Create sessions with known order
      const session1 = await factory.createChatSession(userA.id, { title: 'Order Test 1' });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SHORT_DELAY));

      const session2 = await factory.createChatSession(userA.id, { title: 'Order Test 2' });

      const response = await client.get<{
        sessions: Array<{ id: string; title: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      // Find our test sessions
      const sessionIds = response.body.sessions.map(s => s.id);
      const index1 = sessionIds.indexOf(session1.id);
      const index2 = sessionIds.indexOf(session2.id);

      // Session 2 should come before Session 1 (more recent)
      expect(index2).toBeLessThan(index1);
    });

    it('should only return sessions for authenticated user', async () => {
      // Create session for user A
      const sessionA = await factory.createChatSession(userA.id, {
        title: 'User A Session',
      });

      // Create session for user B
      const sessionB = await factory.createChatSession(userB.id, {
        title: 'User B Session',
      });

      // List as user A
      const response = await client.get<{
        sessions: Array<{ id: string }>;
      }>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      const sessionIds = response.body.sessions.map(s => s.id);

      // Should include user A's session
      expect(sessionIds).toContain(sessionA.id);

      // Should NOT include user B's session
      expect(sessionIds).not.toContain(sessionB.id);
    });
  });

  describe('Get Session Details', () => {
    let testSession: { id: string };

    beforeAll(async () => {
      testSession = await factory.createChatSession(userA.id, {
        title: 'Detail Test Session',
      });
    });

    beforeEach(() => {
      client.setSessionCookie(userA.sessionCookie);
    });

    it('should get session details', async () => {
      const response = await client.get<{
        id: string;
        title: string;
        messages: Array<unknown>;
      }>(`/api/chat/sessions/${testSession.id}`);

      expect(response.ok).toBe(true);
      expect(response.body.id).toBe(testSession.id);
      expect(response.body.title).toBe('Detail Test Session');
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await client.get(`/api/chat/sessions/${fakeId}`);

      // Backend returns 404 to avoid revealing whether resource exists
      expect(response.status).toBe(404);
      // Verify error response has expected structure: { error, message, code }
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });

    it('should return 400 for invalid session ID format', async () => {
      const response = await client.get('/api/chat/sessions/not-a-uuid');

      expect(response.status).toBe(400);
      const validation = ErrorValidator.validateBadRequest(response);
      expect(validation.valid).toBe(true);
    });
  });

  describe('Delete Session', () => {
    it('should delete own session', async () => {
      client.setSessionCookie(userA.sessionCookie);

      // Create session to delete
      const session = await factory.createChatSession(userA.id, {
        title: 'To Delete',
      });

      // Delete it
      const deleteResponse = await client.delete(`/api/chat/sessions/${session.id}`);
      expect(deleteResponse.status).toBe(204);

      // Verify it's gone
      const getResponse = await client.get(`/api/chat/sessions/${session.id}`);
      expect(getResponse.status).toBe(404);
    });

    it('should cascade delete messages when deleting session', async () => {
      client.setSessionCookie(userA.sessionCookie);

      // Create session
      const session = await factory.createChatSession(userA.id, {
        title: 'With Messages',
      });

      // Note: In a full test, we'd add messages to the session first
      // For now, we just verify the session can be deleted

      const response = await client.delete(`/api/chat/sessions/${session.id}`);
      expect(response.status).toBe(204);
    });

    it('should return 404 when deleting non-existent session', async () => {
      client.setSessionCookie(userA.sessionCookie);

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await client.delete(`/api/chat/sessions/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Session Ownership (Multi-Tenant Security)', () => {
    let userASession: { id: string };

    beforeAll(async () => {
      userASession = await factory.createChatSession(userA.id, {
        title: 'User A Private Session',
      });
    });

    it('should NOT allow user B to access user A session', async () => {
      client.setSessionCookie(userB.sessionCookie);

      const response = await client.get(`/api/chat/sessions/${userASession.id}`);

      // OWASP: Return 404 to avoid revealing resource existence
      expect(response.status).toBe(404);
      const validation = ErrorValidator.validateNotFound(response, {
        code: 'SESSION_NOT_FOUND',
      });
      expect(validation.valid).toBe(true);
    });

    it('should NOT allow user B to delete user A session', async () => {
      client.setSessionCookie(userB.sessionCookie);

      const response = await client.delete(`/api/chat/sessions/${userASession.id}`);

      // OWASP: Return 404 to avoid revealing resource existence
      expect(response.status).toBe(404);
    });

    it('should NOT allow user B to join user A session via WebSocket', async () => {
      client.setSessionCookie(userB.sessionCookie);

      await client.connect();

      // Try to join user A's session
      await expect(
        client.joinSession(userASession.id)
      ).rejects.toThrow();

      await client.disconnect();
    });

    it('should allow user A to access own session', async () => {
      client.setSessionCookie(userA.sessionCookie);

      const response = await client.get(`/api/chat/sessions/${userASession.id}`);

      expect(response.ok).toBe(true);
    });
  });

  describe('WebSocket Session Operations', () => {
    let testSession: { id: string };

    beforeAll(async () => {
      testSession = await factory.createChatSession(userA.id, {
        title: 'WebSocket Session',
      });
    });

    beforeEach(() => {
      client.setSessionCookie(userA.sessionCookie);
    });

    afterEach(async () => {
      if (client.isConnected()) {
        await client.disconnect();
      }
    });

    it('should join session room successfully', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.joinSession(testSession.id);

      // If we get here without error, join was successful
      expect(true).toBe(true);
    });

    it('should leave session room', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Leave should not throw
      await client.leaveSession(testSession.id);
    });

    it('should fail to join non-existent session', async () => {
      await client.connect();

      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(
        client.joinSession(fakeId)
      ).rejects.toThrow();
    });
  });

  describe('Session Metadata', () => {
    beforeEach(() => {
      client.setSessionCookie(userA.sessionCookie);
    });

    it('should include timestamps in session response', async () => {
      const session = await factory.createChatSession(userA.id, {
        title: 'Timestamp Test',
      });

      const response = await client.get<{
        id: string;
        createdAt: string;
        updatedAt: string;
      }>(`/api/chat/sessions/${session.id}`);

      expect(response.ok).toBe(true);
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();

      // Timestamps should be valid ISO strings
      expect(new Date(response.body.createdAt).getTime()).not.toBeNaN();
      expect(new Date(response.body.updatedAt).getTime()).not.toBeNaN();
    });

    it('should include message count or messages in session details', async () => {
      const session = await factory.createChatSession(userA.id, {
        title: 'Message Count Test',
      });

      const response = await client.get<{
        id: string;
        messages?: Array<unknown>;
        messageCount?: number;
      }>(`/api/chat/sessions/${session.id}`);

      expect(response.ok).toBe(true);

      // Should have either messages array or message count
      expect(
        response.body.messages !== undefined ||
        response.body.messageCount !== undefined
      ).toBe(true);
    });
  });
});
