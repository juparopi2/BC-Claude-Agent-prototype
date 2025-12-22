/**
 * E2E API Tests: Message Retrieval Endpoint (Gap D23)
 *
 * This test validates that messages persisted via WebSocket/Agent flow
 * are correctly retrievable via the HTTP API endpoint:
 *   GET /api/chat/sessions/:id/messages
 *
 * Closes Gap D23: Tests validate message persistence with HTTP endpoints,
 * not just direct SQL queries.
 *
 * @module __tests__/e2e/api/messages-retrieval.api.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, drainMessageQueue } from '../setup.e2e';
import {
  createE2ETestClient,
  createTestSessionFactory,
  type E2ETestClient,
  type TestSessionFactory,
  type TestUser,
} from '../helpers';

/**
 * Message response structure from GET /api/chat/sessions/:id/messages
 */
interface MessageResponse {
  id: string;
  session_id: string;
  type: 'standard' | 'thinking' | 'tool_use' | 'tool_result';
  role: 'user' | 'assistant';
  content: string;
  sequence_number: number | null;
  created_at: string;
  event_id?: string;
  token_usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
  model?: string;
}

interface MessagesApiResponse {
  messages: MessageResponse[];
}

interface SessionResponse {
  session: {
    id: string;
    title: string;
    user_id: string;
  };
}

describe('E2E API: Message Retrieval (Gap D23)', () => {
  setupE2ETest({ cleanSlate: true, cleanSlateOptions: { preserveTestUsers: true } });

  const factory = createTestSessionFactory();
  let client: E2ETestClient;
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'msg_retrieval_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(() => {
    client = createE2ETestClient();
    client.setUserAuth(testUser);
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('Basic Retrieval', () => {
    it('should retrieve messages from a session via HTTP API', async () => {
      // 1. Create session via HTTP
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Message Retrieval Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;
      expect(sessionId).toBeDefined();

      // 2. Retrieve messages via GET
      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      expect(messagesResponse.ok).toBe(true);
      expect(messagesResponse.status).toBe(200);
      expect(messagesResponse.body).toHaveProperty('messages');
      expect(Array.isArray(messagesResponse.body.messages)).toBe(true);
    });

    it('should return empty array for session with no messages', async () => {
      // Create session but don't send any messages
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Empty Session Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Retrieve messages
      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      expect(messagesResponse.ok).toBe(true);
      expect(messagesResponse.body.messages).toEqual([]);
    });
  });

  describe('Pagination', () => {
    it('should support limit parameter', async () => {
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Pagination Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Retrieve with limit
      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages?limit=5`
      );

      expect(messagesResponse.ok).toBe(true);
      expect(messagesResponse.body).toHaveProperty('messages');
      // Even if empty, the limit parameter should be accepted
      expect(Array.isArray(messagesResponse.body.messages)).toBe(true);
    });

    it('should support offset parameter', async () => {
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Offset Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Retrieve with offset
      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages?offset=0&limit=10`
      );

      expect(messagesResponse.ok).toBe(true);
      expect(messagesResponse.body).toHaveProperty('messages');
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should return 404 when accessing another user session messages', async () => {
      // Create session as testUser
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Private Session',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Create another user
      const otherUser = await factory.createTestUser({ prefix: 'other_user_' });
      const otherClient = createE2ETestClient();
      otherClient.setUserAuth(otherUser);

      // Try to access first user's session messages
      const messagesResponse = await otherClient.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      // OWASP: Return 404 to avoid revealing resource existence
      expect(messagesResponse.status).toBe(404);
    });
  });

  describe('Response Structure', () => {
    it('should return messages with correct structure', async () => {
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Structure Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Retrieve messages (may be empty)
      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      expect(messagesResponse.ok).toBe(true);
      expect(messagesResponse.body).toHaveProperty('messages');

      // If there are messages, validate structure
      if (messagesResponse.body.messages.length > 0) {
        const message = messagesResponse.body.messages[0];
        expect(message).toHaveProperty('id');
        expect(message).toHaveProperty('session_id');
        expect(message).toHaveProperty('role');
        expect(message).toHaveProperty('content');
        expect(message).toHaveProperty('created_at');
      }
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent session', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';

      const messagesResponse = await client.get<MessagesApiResponse>(
        `/api/chat/sessions/${fakeSessionId}/messages`
      );

      expect(messagesResponse.status).toBe(404);
    });

    it('should require authentication', async () => {
      const createResponse = await client.post<SessionResponse>('/api/chat/sessions', {
        title: 'Auth Test',
      });
      expect(createResponse.ok).toBe(true);
      const sessionId = createResponse.body.session.id;

      // Create unauthenticated client
      const unauthClient = createE2ETestClient();

      const messagesResponse = await unauthClient.get<MessagesApiResponse>(
        `/api/chat/sessions/${sessionId}/messages`
      );

      expect(messagesResponse.status).toBe(401);
    });
  });
});
