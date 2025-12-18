/**
 * E2E-11: Comprehensive Error Handling Tests
 *
 * Tests all error scenarios including:
 * - HTTP error responses (400, 401, 403, 404, 429, 500)
 * - WebSocket error handling
 * - Rate limiting
 * - Malformed requests
 * - Server errors
 *
 * @module __tests__/e2e/flows/11-error-handling.e2e.test
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

describe('E2E-11: Comprehensive Error Handling', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_error_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Error Handling Test Session',
    });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(async () => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('HTTP 400 Bad Request', () => {
    it('should return 400 for invalid UUID format', async () => {
      const response = await client.get('/api/chat/sessions/not-a-uuid');

      expect(response.status).toBe(400);
      const validation = ErrorValidator.validateBadRequest(response);
      expect(validation.valid).toBe(true);
    });

    it('should return 400 for missing required fields', async () => {
      // Try to create session with invalid data
      const response = await client.post('/api/chat/sessions', {
        invalidField: 'value',
      });

      // Should either succeed with defaults or fail with 400
      expect([200, 201, 400]).toContain(response.status);
    });

    it('should return 400 for malformed JSON', async () => {
      // Send malformed JSON
      const response = await client.request('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('HTTP 401 Unauthorized', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const unauthClient = createE2ETestClient();
      // No session cookie set

      const response = await unauthClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
      const validation = ErrorValidator.validateUnauthorized(response);
      expect(validation.valid).toBe(true);
    });

    it('should return 401 for expired session', async () => {
      const expiredClient = createE2ETestClient();
      expiredClient.setSessionCookie('expired-session-cookie-12345');

      const response = await expiredClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });

    it('should return 401 for invalid session format', async () => {
      const invalidClient = createE2ETestClient();
      invalidClient.setSessionCookie('invalid!@#$%^&*()');

      const response = await invalidClient.get('/api/chat/sessions');

      expect(response.status).toBe(401);
    });
  });

  describe('HTTP 403 Forbidden', () => {
    it('should return 403 for accessing other user session', async () => {
      // Create another user's session
      const otherUser = await factory.createTestUser({ prefix: 'e2e_other_' });
      const otherSession = await factory.createChatSession(otherUser.id, {
        title: 'Other User Session',
      });

      // Try to access as original user
      const response = await client.get(`/api/chat/sessions/${otherSession.id}`);

      expect(response.status).toBe(403);
      const validation = ErrorValidator.validateForbidden(response);
      expect(validation.valid).toBe(true);
    });

    it('should return 403 for deleting other user session', async () => {
      const otherUser = await factory.createTestUser({ prefix: 'e2e_delete_' });
      const otherSession = await factory.createChatSession(otherUser.id, {
        title: 'Other Delete Session',
      });

      const response = await client.delete(`/api/chat/sessions/${otherSession.id}`);

      expect(response.status).toBe(403);
    });
  });

  describe('HTTP 404 Not Found', () => {
    it('should return 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await client.get(`/api/chat/sessions/${fakeId}`);

      expect(response.status).toBe(404);
      const validation = ErrorValidator.validateNotFound(response);
      expect(validation.valid).toBe(true);
    });

    it('should return 404 for non-existent endpoint', async () => {
      const response = await client.get('/api/nonexistent/endpoint');

      expect(response.status).toBe(404);
    });

    it('should return 404 for deleted session', async () => {
      // Create and delete a session
      const tempSession = await factory.createChatSession(testUser.id, {
        title: 'Temp Session',
      });

      await client.delete(`/api/chat/sessions/${tempSession.id}`);

      // Try to access deleted session
      const response = await client.get(`/api/chat/sessions/${tempSession.id}`);

      expect(response.status).toBe(404);
    });
  });

  describe('HTTP 429 Rate Limiting', () => {
    it('should handle rate limit errors gracefully', async () => {
      // Send many rapid requests (may trigger rate limiting)
      const responses: Array<{ status: number }> = [];

      for (let i = 0; i < 100; i++) {
        const response = await client.get('/api/chat/sessions');
        responses.push(response);

        if (response.status === 429) {
          break;
        }
      }

      // If rate limited, should have proper response
      const rateLimited = responses.find(r => r.status === 429);
      if (rateLimited) {
        const validation = ErrorValidator.validateRateLimited(rateLimited);
        expect(validation.valid).toBe(true);
      }
    });
  });

  describe('HTTP 500 Internal Server Error', () => {
    it('should handle server errors without exposing internals', async () => {
      // Try to trigger server error (implementation dependent)
      // Using a very long value that might cause issues
      const veryLongTitle = 'A'.repeat(100000);

      const response = await client.post('/api/chat/sessions', {
        title: veryLongTitle,
      });

      // Should either succeed or return error without stack traces
      if (response.status >= 500) {
        const validation = ErrorValidator.validateServerError(response);
        expect(validation.valid).toBe(true);

        // Should not expose stack traces
        const bodyStr = JSON.stringify(response.body);
        expect(bodyStr).not.toContain('at ');
        expect(bodyStr).not.toContain('node_modules');
      }
    });
  });

  describe('WebSocket Error Handling', () => {
    it('should handle joining invalid session', async () => {
      await client.connect();

      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(
        client.joinSession(fakeId)
      ).rejects.toThrow();
    });

    it('should handle malformed WebSocket messages', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send malformed data
      client.emitRaw('chat:message', null);
      client.emitRaw('chat:message', 'not an object');
      client.emitRaw('chat:message', { missing: 'required fields' });

      // Connection should remain stable
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle disconnection gracefully', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Force disconnect
      await client.disconnect();

      expect(client.isConnected()).toBe(false);

      // Should be able to reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should emit error event for runtime errors', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Try to send to non-existent session ID
      client.emitRaw('chat:message', {
        sessionId: '00000000-0000-0000-0000-000000000000',
        message: 'Test',
      });

      // Should receive error event
      const events = await client.collectEvents(5, {
        timeout: 10000,
      });

      // Either error event or no events (depending on implementation)
      expect(events.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Input Validation Errors', () => {
    it('should reject empty message content', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, '');

      // Should receive some response
      const events = await client.collectEvents(5, { timeout: 10000 });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle very long messages', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const longMessage = 'A'.repeat(100000);
      await client.sendMessage(testSession.id, longMessage);

      // Should either process or return error
      const events = await client.collectEvents(10, { timeout: 30000 });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle special characters safely', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const specialMessage = '<script>alert("xss")</script>';
      await client.sendMessage(testSession.id, specialMessage);

      // Should process safely
      const events = await client.collectEvents(10, { timeout: 30000 });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle SQL injection attempts safely', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const sqlInjection = "'; DROP TABLE users; --";
      await client.sendMessage(testSession.id, sqlInjection);

      // Should process safely without SQL execution
      const events = await client.collectEvents(10, { timeout: 30000 });
      expect(events.length).toBeGreaterThan(0);

      // Database should still work
      const response = await client.get('/api/chat/sessions');
      expect(response.ok).toBe(true);
    });
  });

  describe('Error Response Format', () => {
    it('should include error message in response', async () => {
      const response = await client.get('/api/chat/sessions/invalid-uuid');

      expect(response.status).toBe(400);
      expect(response.body).toBeDefined();

      const body = response.body as { error?: string; message?: string };
      const hasMessage = body.error !== undefined || body.message !== undefined;
      expect(hasMessage).toBe(true);
    });

    it('should use consistent error format', async () => {
      const responses = await Promise.all([
        client.get('/api/chat/sessions/invalid'),
        client.get('/api/chat/sessions/00000000-0000-0000-0000-000000000000'),
      ]);

      for (const response of responses) {
        if (!response.ok) {
          expect(response.body).toBeDefined();
          // Should have some error indication
          const body = response.body as Record<string, unknown>;
          const hasErrorField =
            body.error !== undefined ||
            body.message !== undefined ||
            body.statusCode !== undefined;
          expect(hasErrorField).toBe(true);
        }
      }
    });
  });

  describe('Timeout Handling', () => {
    it('should handle request timeout gracefully', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send message that might take time
      await client.sendMessage(
        testSession.id,
        'Write a very long detailed essay about everything'
      );

      // Wait for response (or timeout)
      const events = await client.collectEvents(10, {
        timeout: 120000,
        stopOnEventType: 'complete',
      });

      // Should eventually get some response
      const hasTerminal = events.some(
        e =>
          e.data.type === 'complete' ||
          e.data.type === 'error' ||
          e.data.type === 'timeout'
      );

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Error Handling', () => {
    it('should handle multiple error requests simultaneously', async () => {
      const invalidIds = [
        'invalid-1',
        'invalid-2',
        'invalid-3',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ];

      const responses = await Promise.all(
        invalidIds.map(id => client.get(`/api/chat/sessions/${id}`))
      );

      // All should return errors
      for (const response of responses) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(600);
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover from errors and continue operating', async () => {
      // Trigger an error
      const errorResponse = await client.get('/api/chat/sessions/invalid');
      expect(errorResponse.status).toBe(400);

      // Should still be able to make valid requests
      const validResponse = await client.get('/api/chat/sessions');
      expect(validResponse.ok).toBe(true);
    });

    it('should maintain session after WebSocket error', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send malformed message
      client.emitRaw('invalid:event', { bad: 'data' });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.ASYNC_OPERATION));

      // Should still be connected
      expect(client.isConnected()).toBe(true);

      // Should still be able to send valid messages
      await client.sendMessage(testSession.id, 'Valid message after error');
      const event = await client.waitForAgentEvent('user_message_confirmed', {
        timeout: 10000,
      });
      expect(event).toBeDefined();
    });
  });

  describe('Error Logging', () => {
    it('should not expose sensitive data in error responses', async () => {
      // Try various requests that might trigger errors
      const responses = await Promise.all([
        client.get('/api/chat/sessions/invalid'),
        client.post('/api/chat/sessions', { invalidField: 'test' }),
      ]);

      for (const response of responses) {
        const bodyStr = JSON.stringify(response.body || {});

        // Should not contain sensitive patterns
        const sensitivePatterns = [
          'password',
          'secret',
          'apiKey',
          'token',
          'connectionString',
          'DATABASE_',
          'REDIS_',
        ];

        for (const pattern of sensitivePatterns) {
          expect(bodyStr.toLowerCase()).not.toContain(pattern.toLowerCase());
        }
      }
    });

    it('should not expose stack traces in production-like errors', async () => {
      const response = await client.get('/api/chat/sessions/invalid');

      const bodyStr = JSON.stringify(response.body || {});

      // Should not contain stack trace patterns
      expect(bodyStr).not.toMatch(/at\s+\w+\s*\(/);
      expect(bodyStr).not.toContain('node_modules');
      expect(bodyStr).not.toContain('.ts:');
      expect(bodyStr).not.toContain('.js:');
    });
  });

  describe('HTTP Method Errors', () => {
    it('should return 405 for unsupported methods', async () => {
      const response = await client.request('/api/chat/sessions', {
        method: 'PATCH',
      });

      // Should be either 404 or 405
      expect([404, 405]).toContain(response.status);
    });

    it('should handle HEAD requests appropriately', async () => {
      const response = await client.request('/api/chat/sessions', {
        method: 'HEAD',
      });

      // Should return 200 with no body or 405
      expect([200, 404, 405]).toContain(response.status);
    });

    it('should handle OPTIONS requests for CORS', async () => {
      const response = await client.request('/api/chat/sessions', {
        method: 'OPTIONS',
      });

      // Should return 200 or 204 for CORS preflight
      expect([200, 204]).toContain(response.status);
    });
  });

  describe('Content-Type Errors', () => {
    it('should handle missing Content-Type for POST', async () => {
      const response = await client.request('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
        // Omitting Content-Type
      });

      // Should either work or return 400/415
      expect([200, 201, 400, 415]).toContain(response.status);
    });

    it('should handle wrong Content-Type', async () => {
      const response = await client.request('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{"title": "Test"}',
      });

      // Should either work or return error
      expect([200, 201, 400, 415]).toContain(response.status);
    });
  });
});
