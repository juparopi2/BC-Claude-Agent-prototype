/**
 * E2E Tests: WebSocket Error Handling
 *
 * Tests error scenarios including invalid sessions, malformed events,
 * and invalid approval responses.
 *
 * @module __tests__/e2e/websocket/error-handling.ws.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../helpers/E2ETestClient';
import { TestSessionFactory } from '../../integration/helpers/TestSessionFactory';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';

describe('E2E: WebSocket Error Handling', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let sessionCookie: string;

  beforeAll(async () => {
    const auth = await factory.createTestUser();
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

  describe('Invalid session join', () => {
    it('should handle joining non-existent session', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      await expect(client.joinSession(fakeSessionId)).rejects.toThrow();
    });

    it('should handle joining with invalid UUID format', async () => {
      const invalidSessionId = 'not-a-valid-uuid';
      await expect(client.joinSession(invalidSessionId)).rejects.toThrow();
    });

    it('should remain connected after join failure', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000';
      try {
        await client.joinSession(fakeSessionId);
      } catch {
        // Expected to fail
      }

      // Connection should still be active
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Malformed events', () => {
    it('should handle chat:message without sessionId', async () => {
      // Create valid session first
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Error Test' });
      const sessionId = response.body.id;
      await client.joinSession(sessionId);

      // Send malformed message (missing sessionId)
      client.emitRaw('chat:message', { message: 'test' });

      // Should not crash, just log error
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle chat:message without message content', async () => {
      // Create valid session first
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Error Test 2' });
      const sessionId = response.body.id;
      await client.joinSession(sessionId);

      // Send malformed message (missing message)
      client.emitRaw('chat:message', { sessionId });

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle session:join without sessionId', async () => {
      // Send malformed join (missing sessionId)
      client.emitRaw('session:join', {});

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle session:leave without sessionId', async () => {
      // Send malformed leave (missing sessionId)
      client.emitRaw('session:leave', {});

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Invalid approval response', () => {
    it('should handle approval response with invalid approvalId', async () => {
      await client.respondToApproval('invalid-approval-id', 'approved');

      // Wait for potential error response
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Connection should remain stable
      expect(client.isConnected()).toBe(true);
    });

    it('should handle approval response with missing approvalId', async () => {
      // Send malformed approval response
      client.emitRaw('approval:response', { decision: 'approved' });

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle approval response with invalid decision', async () => {
      // Send approval with invalid decision value
      client.emitRaw('approval:response', {
        approvalId: '00000000-0000-0000-0000-000000000000',
        decision: 'invalid_decision',
      });

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Connection resilience', () => {
    it('should handle rapid connect/disconnect cycles', async () => {
      await client.disconnect();

      // Rapid reconnections
      for (let i = 0; i < 3; i++) {
        client = createE2ETestClient();
        client.setSessionCookie(sessionCookie);
        await client.connect();
        expect(client.isConnected()).toBe(true);
        await client.disconnect();
        expect(client.isConnected()).toBe(false);
      }
    });

    it('should handle sending message after disconnect', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Disconnect Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      await client.disconnect();

      // Try to send message after disconnect
      await expect(
        client.sendMessage(sessionId, 'Should fail')
      ).rejects.toThrow('Not connected');
    });

    it('should handle joining session after disconnect', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Join After Disconnect' });
      const sessionId = response.body.id;

      await client.disconnect();

      // Try to join session after disconnect
      await expect(
        client.joinSession(sessionId)
      ).rejects.toThrow('Not connected');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty message', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Empty Message Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);

      // Send empty message
      await client.sendMessage(sessionId, '');

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle very long message', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Long Message Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);

      // Send very long message
      const longMessage = 'A'.repeat(10000);
      await client.sendMessage(sessionId, longMessage);

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });

    it('should handle special characters in message', async () => {
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Special Chars Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);

      // Send message with special characters
      const specialMessage = 'Test 🚀 "quotes" \'apostrophes\' <html> & symbols';
      await client.sendMessage(sessionId, specialMessage);

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Timeout handling', () => {
    it('should timeout if session:ready not received', async () => {
      // Use a very short timeout to test timeout behavior
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Timeout Test' });
      const sessionId = response.body.id;

      // Try to join with 1ms timeout (should timeout)
      await expect(
        client.joinSession(sessionId, 1)
      ).rejects.toThrow(/timeout/i);

      // Connection should still be active
      expect(client.isConnected()).toBe(true);
    });
  });
});
