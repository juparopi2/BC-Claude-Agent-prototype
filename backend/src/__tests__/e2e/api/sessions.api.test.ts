/**
 * E2E API Tests: Sessions Endpoints
 *
 * Tests the chat sessions endpoints:
 * - POST /api/chat/sessions - Create new session
 * - GET /api/chat/sessions - List user sessions
 * - GET /api/chat/sessions/:id - Get specific session
 * - GET /api/chat/sessions/:id/messages - Get session messages
 * - PATCH /api/chat/sessions/:id - Update session
 * - DELETE /api/chat/sessions/:id - Delete session
 *
 * @module __tests__/e2e/api/sessions.api.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  createE2ETestClient,
  createTestSessionFactory,
  type E2ETestClient,
  type TestSessionFactory,
  type TestUser,
} from '../helpers';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';

describe('E2E API: Sessions Endpoints', () => {
  setupE2ETest();

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'sessions_' });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
  });

  describe('POST /api/chat/sessions', () => {
    it('should create a new session', async () => {
      const response = await client.post<{
        id: string;
        title: string;
        userId: string;
      }>('/api/chat/sessions', {
        title: 'E2E Test Session',
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('title', 'E2E Test Session');
      expect(response.body).toHaveProperty('userId', testUser.id);
    });

    it('should create session with default title if not provided', async () => {
      const response = await client.post<{ title: string }>('/api/chat/sessions', {});

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('title');
      expect(response.body.title.length).toBeGreaterThan(0);
    });

    it('should return session timestamps', async () => {
      const response = await client.post<{
        createdAt: string;
        updatedAt: string;
      }>('/api/chat/sessions', {
        title: 'Timestamp Test',
      });

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('updatedAt');

      // Verify timestamps are valid ISO 8601 dates
      const createdAt = new Date(response.body.createdAt);
      expect(createdAt.getTime()).not.toBeNaN();
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.post('/api/chat/sessions', {
        title: 'Unauth Test',
      });

      expect(response.status).toBe(401);
    });

    it('should generate unique session IDs', async () => {
      const response1 = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Session 1',
      });
      const response2 = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Session 2',
      });

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);
      expect(response1.body.id).not.toBe(response2.body.id);
    });
  });

  describe('GET /api/chat/sessions', () => {
    it('should list user sessions', async () => {
      // Create a session first
      await client.post('/api/chat/sessions', { title: 'List Test' });

      const response = await client.get<Array<{
        id: string;
        title: string;
        userId: string;
      }>>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should return sessions with correct structure', async () => {
      // Create a test session
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Structure Test',
      });

      const response = await client.get<Array<{
        id: string;
        title: string;
        userId: string;
        createdAt: string;
        updatedAt: string;
      }>>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      const session = response.body.find(s => s.id === createResponse.body.id);
      expect(session).toBeDefined();
      expect(session?.title).toBe('Structure Test');
      expect(session?.userId).toBe(testUser.id);
      expect(session?.createdAt).toBeTruthy();
      expect(session?.updatedAt).toBeTruthy();
    });

    it('should return empty array for user with no sessions', async () => {
      // Create a new user with no sessions
      const newUser = await factory.createTestUser({ prefix: 'empty_' });
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(newUser.sessionCookie);

      const response = await newClient.get<Array<unknown>>('/api/chat/sessions');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should require authentication', async () => {
      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should order sessions by creation date (newest first)', async () => {
      // Create multiple sessions with small delays
      await client.post('/api/chat/sessions', { title: 'First' });
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SHORT_DELAY));
      await client.post('/api/chat/sessions', { title: 'Second' });
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SHORT_DELAY));
      await client.post('/api/chat/sessions', { title: 'Third' });

      const response = await client.get<Array<{
        title: string;
        createdAt: string;
      }>>('/api/chat/sessions');

      expect(response.ok).toBe(true);

      // Find our test sessions
      const testSessions = response.body.filter(s =>
        ['First', 'Second', 'Third'].includes(s.title)
      );

      expect(testSessions.length).toBe(3);

      // Verify newest first (Third should come before First)
      const thirdIndex = testSessions.findIndex(s => s.title === 'Third');
      const firstIndex = testSessions.findIndex(s => s.title === 'First');
      expect(thirdIndex).toBeLessThan(firstIndex);
    });
  });

  describe('GET /api/chat/sessions/:id', () => {
    it('should get a specific session', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Get Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<{
        id: string;
        title: string;
        userId: string;
      }>(`/api/chat/sessions/${sessionId}`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', sessionId);
      expect(response.body).toHaveProperty('title', 'Get Test');
      expect(response.body).toHaveProperty('userId', testUser.id);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.get(`/api/chat/sessions/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Auth Test',
      });
      const sessionId = createResponse.body.id;

      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get(`/api/chat/sessions/${sessionId}`);

      expect(response.status).toBe(401);
    });

    it('should include message count', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Message Count Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<{ messageCount?: number }>(
        `/api/chat/sessions/${sessionId}`
      );

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('messageCount');
      expect(typeof response.body.messageCount).toBe('number');
    });
  });

  describe('GET /api/chat/sessions/:id/messages', () => {
    it('should get messages for a session', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Messages Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<Array<{
        id: string;
        role: string;
        content: string;
      }>>(`/api/chat/sessions/${sessionId}/messages`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array for session with no messages', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Empty Messages',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<Array<unknown>>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should support limit parameter', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Limit Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<Array<unknown>>(
        `/api/chat/sessions/${sessionId}/messages`,
        { limit: '10' }
      );

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(10);
    });

    it('should support offset parameter', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Offset Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<Array<unknown>>(
        `/api/chat/sessions/${sessionId}/messages`,
        { offset: '0' }
      );

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should support pagination with limit and offset', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Pagination Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.get<Array<unknown>>(
        `/api/chat/sessions/${sessionId}/messages`,
        { limit: '5', offset: '0' }
      );

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(5);
    });

    it('should require authentication', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Auth Messages Test',
      });
      const sessionId = createResponse.body.id;

      const unauthClient = createE2ETestClient();
      const response = await unauthClient.get(`/api/chat/sessions/${sessionId}/messages`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.get(`/api/chat/sessions/${fakeId}/messages`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/chat/sessions/:id', () => {
    it('should update session title', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Original Title',
      });
      const sessionId = createResponse.body.id;

      const response = await client.request<{
        id: string;
        title: string;
      }>('PATCH', `/api/chat/sessions/${sessionId}`, {
        body: { title: 'Updated Title' },
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title', 'Updated Title');
      expect(response.body).toHaveProperty('id', sessionId);
    });

    it('should persist title update', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Before Update',
      });
      const sessionId = createResponse.body.id;

      // Update title
      await client.request('PATCH', `/api/chat/sessions/${sessionId}`, {
        body: { title: 'After Update' },
      });

      // Verify persistence
      const getResponse = await client.get<{ title: string }>(
        `/api/chat/sessions/${sessionId}`
      );

      expect(getResponse.ok).toBe(true);
      expect(getResponse.body.title).toBe('After Update');
    });

    it('should update updatedAt timestamp', async () => {
      const createResponse = await client.post<{
        id: string;
        updatedAt: string;
      }>('/api/chat/sessions', {
        title: 'Timestamp Test',
      });
      const sessionId = createResponse.body.id;
      const originalUpdatedAt = createResponse.body.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SHORT_DELAY));

      const updateResponse = await client.request<{ updatedAt: string }>(
        'PATCH',
        `/api/chat/sessions/${sessionId}`,
        { body: { title: 'Updated' } }
      );

      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.body.updatedAt).not.toBe(originalUpdatedAt);

      // Verify new timestamp is more recent
      const originalTime = new Date(originalUpdatedAt).getTime();
      const newTime = new Date(updateResponse.body.updatedAt).getTime();
      expect(newTime).toBeGreaterThan(originalTime);
    });

    it('should require authentication', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Auth Update Test',
      });
      const sessionId = createResponse.body.id;

      const unauthClient = createE2ETestClient();
      const response = await unauthClient.request('PATCH', `/api/chat/sessions/${sessionId}`, {
        body: { title: 'Unauthorized Update' },
      });

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.request('PATCH', `/api/chat/sessions/${fakeId}`, {
        body: { title: 'Nonexistent' },
      });

      expect(response.status).toBe(404);
    });

    it('should validate title is not empty', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Valid Title',
      });
      const sessionId = createResponse.body.id;

      const response = await client.request('PATCH', `/api/chat/sessions/${sessionId}`, {
        body: { title: '' },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/chat/sessions/:id', () => {
    it('should delete a session', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Delete Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.delete(`/api/chat/sessions/${sessionId}`);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    it('should return success message on deletion', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Delete Message Test',
      });
      const sessionId = createResponse.body.id;

      const response = await client.delete<{ success: boolean }>(
        `/api/chat/sessions/${sessionId}`
      );

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should verify session is deleted', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Verify Delete',
      });
      const sessionId = createResponse.body.id;

      // Delete session
      const deleteResponse = await client.delete(`/api/chat/sessions/${sessionId}`);
      expect(deleteResponse.ok).toBe(true);

      // Verify deletion
      const getResponse = await client.get(`/api/chat/sessions/${sessionId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should not appear in session list after deletion', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'List Delete Test',
      });
      const sessionId = createResponse.body.id;

      // Delete session
      await client.delete(`/api/chat/sessions/${sessionId}`);

      // Verify not in list
      const listResponse = await client.get<Array<{ id: string }>>('/api/chat/sessions');
      expect(listResponse.ok).toBe(true);

      const deletedSession = listResponse.body.find(s => s.id === sessionId);
      expect(deletedSession).toBeUndefined();
    });

    it('should require authentication', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Auth Delete Test',
      });
      const sessionId = createResponse.body.id;

      const unauthClient = createE2ETestClient();
      const response = await unauthClient.delete(`/api/chat/sessions/${sessionId}`);

      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = factory.generateTestId();
      const response = await client.delete(`/api/chat/sessions/${fakeId}`);

      expect(response.status).toBe(404);
    });

    it('should return 404 for already deleted session', async () => {
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Double Delete',
      });
      const sessionId = createResponse.body.id;

      // First deletion
      const firstDelete = await client.delete(`/api/chat/sessions/${sessionId}`);
      expect(firstDelete.ok).toBe(true);

      // Second deletion attempt
      const secondDelete = await client.delete(`/api/chat/sessions/${sessionId}`);
      expect(secondDelete.status).toBe(404);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should not allow access to other user sessions', async () => {
      // Create session as first user
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Isolation Test',
      });
      const sessionId = createResponse.body.id;

      // Create second user
      const otherUser = await factory.createTestUser({ prefix: 'other_user_' });
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      // Try to access first user's session
      const response = await otherClient.get(`/api/chat/sessions/${sessionId}`);
      expect(response.status).toBe(404); // Should not find it
    });

    it('should not allow updating other user sessions', async () => {
      // Create session as first user
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Update Isolation',
      });
      const sessionId = createResponse.body.id;

      // Create second user
      const otherUser = await factory.createTestUser({ prefix: 'update_other_' });
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      // Try to update first user's session
      const response = await otherClient.request('PATCH', `/api/chat/sessions/${sessionId}`, {
        body: { title: 'Unauthorized Update' },
      });

      expect(response.status).toBe(404);
    });

    it('should not allow deleting other user sessions', async () => {
      // Create session as first user
      const createResponse = await client.post<{ id: string }>('/api/chat/sessions', {
        title: 'Delete Isolation',
      });
      const sessionId = createResponse.body.id;

      // Create second user
      const otherUser = await factory.createTestUser({ prefix: 'delete_other_' });
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      // Try to delete first user's session
      const response = await otherClient.delete(`/api/chat/sessions/${sessionId}`);
      expect(response.status).toBe(404);

      // Verify original user can still access it
      const verifyResponse = await client.get(`/api/chat/sessions/${sessionId}`);
      expect(verifyResponse.ok).toBe(true);
    });

    it('should not show other user sessions in list', async () => {
      // Create sessions for first user
      await client.post('/api/chat/sessions', { title: 'User 1 Session 1' });
      await client.post('/api/chat/sessions', { title: 'User 1 Session 2' });

      // Create second user and their sessions
      const otherUser = await factory.createTestUser({ prefix: 'list_other_' });
      const otherClient = createE2ETestClient();
      otherClient.setSessionCookie(otherUser.sessionCookie);

      await otherClient.post('/api/chat/sessions', { title: 'User 2 Session 1' });

      // Get sessions for first user
      const user1Sessions = await client.get<Array<{ title: string }>>('/api/chat/sessions');
      expect(user1Sessions.ok).toBe(true);

      // Verify no sessions from user 2
      const hasUser2Session = user1Sessions.body.some(s => s.title === 'User 2 Session 1');
      expect(hasUser2Session).toBe(false);

      // Get sessions for second user
      const user2Sessions = await otherClient.get<Array<{ title: string }>>(
        '/api/chat/sessions'
      );
      expect(user2Sessions.ok).toBe(true);

      // Verify no sessions from user 1
      const hasUser1Session = user2Sessions.body.some(
        s => s.title === 'User 1 Session 1' || s.title === 'User 1 Session 2'
      );
      expect(hasUser1Session).toBe(false);
    });
  });
});
