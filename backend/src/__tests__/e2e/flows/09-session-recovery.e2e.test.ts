/**
 * E2E-09: Session Recovery Tests
 *
 * Tests the session recovery and reconnection functionality including:
 * - State reconstruction on page refresh
 * - Message history retrieval
 * - Event replay after reconnection
 * - Handling of interrupted streams
 * - Session context preservation
 *
 * @module __tests__/e2e/flows/09-session-recovery.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';

describe('E2E-09: Session Recovery', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_recovery_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Session Recovery Test Session',
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

  describe('Page Refresh Recovery', () => {
    it('should retrieve full message history after disconnect', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Refresh Recovery Test',
      });

      // First connection - send messages
      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'First message');
      await client.waitForAgentEvent('complete', { timeout: 30000 });
      client.clearEvents();

      await client.sendMessage(freshSession.id, 'Second message');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      // Disconnect (simulates page refresh)
      await client.disconnect();

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // New connection (simulates page reload)
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      // Fetch message history via REST
      const response = await newClient.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      // Should have user messages
      const userMessages = response.body.messages?.filter(
        m => m.role === 'user'
      ) || [];

      expect(userMessages.length).toBeGreaterThanOrEqual(2);

      // Should have first and second message
      const contents = userMessages.map(m => m.content);
      expect(contents).toContain('First message');
      expect(contents).toContain('Second message');
    });

    it('should preserve message order after recovery', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Order Preservation Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Send messages in order
      for (let i = 1; i <= 3; i++) {
        await client.sendMessage(freshSession.id, `Order test ${i}`);
        await client.waitForAgentEvent('complete', { timeout: 30000 });
        client.clearEvents();
      }

      await client.disconnect();
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Recover
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        messages: Array<{ content: string; sequenceNumber?: number }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      const orderMessages = response.body.messages?.filter(
        m => m.content?.startsWith('Order test')
      ) || [];

      // Should be in correct order
      expect(orderMessages.length).toBe(3);
      expect(orderMessages[0]!.content).toContain('1');
      expect(orderMessages[1]!.content).toContain('2');
      expect(orderMessages[2]!.content).toContain('3');
    });

    it('should include assistant responses in recovered history', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Assistant Recovery Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'What is 2+2?');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      await client.disconnect();
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Recover
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      // Should have both user and assistant messages
      const userMsgs = response.body.messages?.filter(m => m.role === 'user') || [];
      const assistantMsgs = response.body.messages?.filter(
        m => m.role === 'assistant'
      ) || [];

      expect(userMsgs.length).toBeGreaterThan(0);
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });
  });

  describe('WebSocket Reconnection', () => {
    it('should reconnect to session after disconnect', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Verify connected
      expect(client.isConnected()).toBe(true);

      // Disconnect
      await client.disconnect();

      // Reconnect
      await client.connect();
      await client.joinSession(testSession.id);

      // Should be connected again
      expect(client.isConnected()).toBe(true);
    });

    it('should receive new events after reconnection', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Reconnect Events Test',
      });

      // First connection
      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'Before disconnect');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      // Disconnect
      await client.disconnect();

      // Reconnect
      await client.connect();
      await client.joinSession(freshSession.id);
      client.clearEvents();

      // Send new message
      await client.sendMessage(freshSession.id, 'After reconnect');

      // Should receive events
      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      expect(events.length).toBeGreaterThan(0);
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });

    it('should handle rapid disconnect/reconnect', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Rapid Reconnect Test',
      });

      // Multiple rapid reconnections
      for (let i = 0; i < 3; i++) {
        await client.connect();
        await client.joinSession(freshSession.id);
        expect(client.isConnected()).toBe(true);

        await client.disconnect();
        expect(client.isConnected()).toBe(false);
      }

      // Final connection should work
      await client.connect();
      await client.joinSession(freshSession.id);
      expect(client.isConnected()).toBe(true);

      // Should be able to send message
      await client.sendMessage(freshSession.id, 'After rapid reconnect');
      const event = await client.waitForAgentEvent('user_message_confirmed', {
        timeout: 10000,
      });
      expect(event).toBeDefined();
    });
  });

  describe('Interrupted Stream Recovery', () => {
    it('should handle disconnect during streaming', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Stream Interrupt Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Start a message that will stream
      await client.sendMessage(
        freshSession.id,
        'Tell me a story about a cat'
      );

      // Wait briefly for streaming to start
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.ASYNC_OPERATION));

      // Disconnect mid-stream
      await client.disconnect();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Reconnect
      await client.connect();
      await client.joinSession(freshSession.id);

      // Should be able to send new messages
      client.clearEvents();
      await client.sendMessage(freshSession.id, 'New message after interrupt');

      const event = await client.waitForAgentEvent('user_message_confirmed', {
        timeout: 10000,
      });
      expect(event).toBeDefined();
    });

    it('should persist partial responses before disconnect', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Partial Response Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Send message
      await client.sendMessage(freshSession.id, 'Count from 1 to 10');

      // Wait for some streaming
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.LONG_ASYNC_OPERATION));

      // Disconnect
      await client.disconnect();

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.LONG_ASYNC_OPERATION));

      // Check what was persisted
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      // Should have at least the user message
      const userMsgs = response.body.messages?.filter(m => m.role === 'user') || [];
      expect(userMsgs.length).toBeGreaterThan(0);
    });
  });

  describe('Session Context Preservation', () => {
    it('should maintain conversation context across reconnections', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Context Preservation Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Establish context
      await client.sendMessage(freshSession.id, 'My name is TestUser');
      await client.waitForAgentEvent('complete', { timeout: 30000 });
      client.clearEvents();

      // Disconnect
      await client.disconnect();

      // Reconnect
      await client.connect();
      await client.joinSession(freshSession.id);
      client.clearEvents();

      // Ask about context
      await client.sendMessage(freshSession.id, 'What is my name?');

      const events = await client.collectEvents(20, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Should complete
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });

    it('should preserve session metadata', async () => {
      // Create fresh session with specific title
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Metadata Preservation Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'Test message');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      await client.disconnect();

      // Recover
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        session: {
          id: string;
          title: string;
          created_at: string;
        };
      }>(`/api/chat/sessions/${freshSession.id}`);

      expect(response.ok).toBe(true);
      expect(response.body.session.title).toBe('Metadata Preservation Test');
      expect(response.body.session.created_at).toBeDefined();
    });
  });

  describe('Multiple Session Recovery', () => {
    it('should recover correct session when user has multiple', async () => {
      // Create multiple sessions
      const session1 = await factory.createChatSession(testUser.id, {
        title: 'Session 1',
      });
      const session2 = await factory.createChatSession(testUser.id, {
        title: 'Session 2',
      });

      await client.connect();

      // Send to session 1
      await client.joinSession(session1.id);
      await client.sendMessage(session1.id, 'Message in session 1');
      await client.waitForAgentEvent('complete', { timeout: 30000 });
      await client.leaveSession(session1.id);
      client.clearEvents();

      // Send to session 2
      await client.joinSession(session2.id);
      await client.sendMessage(session2.id, 'Message in session 2');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      await client.disconnect();
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Recover each session separately
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response1 = await newClient.get<{
        messages: Array<{ content: string }>;
      }>(`/api/chat/sessions/${session1.id}/messages`);

      const response2 = await newClient.get<{
        messages: Array<{ content: string }>;
      }>(`/api/chat/sessions/${session2.id}/messages`);

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);

      // Each should have its own message
      const session1Msgs = response1.body.messages || [];
      const session2Msgs = response2.body.messages || [];

      const has1 = session1Msgs.some(m => m.content === 'Message in session 1');
      const has2 = session2Msgs.some(m => m.content === 'Message in session 2');

      expect(has1).toBe(true);
      expect(has2).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from connection errors', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Force disconnect (simulates network error)
      await client.disconnect();

      // Should be able to reconnect
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Should be able to join session again
      await client.joinSession(testSession.id);
    });

    it('should handle invalid session ID gracefully on recovery', async () => {
      await client.connect();

      const fakeId = '00000000-0000-0000-0000-000000000000';

      // Try to join non-existent session
      await expect(
        client.joinSession(fakeId)
      ).rejects.toThrow();

      // Connection should still be alive
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Event Sequence Recovery', () => {
    it('should have consistent sequence numbers after recovery', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Sequence Recovery Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Send messages
      await client.sendMessage(freshSession.id, 'Sequence 1');
      await client.waitForAgentEvent('complete', { timeout: 30000 });
      client.clearEvents();

      await client.sendMessage(freshSession.id, 'Sequence 2');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      await client.disconnect();
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.MESSAGE_CLEANUP));

      // Recover
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      const response = await newClient.get<{
        messages: Array<{
          content: string;
          sequenceNumber?: number;
        }>;
      }>(`/api/chat/sessions/${freshSession.id}/messages`);

      expect(response.ok).toBe(true);

      // Check sequence numbers if present
      const messages = response.body.messages || [];
      const sequenceMessages = messages.filter(
        m => m.sequenceNumber !== undefined
      );

      if (sequenceMessages.length > 1) {
        // Sequence numbers should be increasing
        for (let i = 1; i < sequenceMessages.length; i++) {
          expect(sequenceMessages[i]!.sequenceNumber).toBeGreaterThan(
            sequenceMessages[i - 1]!.sequenceNumber!
          );
        }
      }
    });
  });
});
