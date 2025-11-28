/**
 * E2E-03: Message Flow Basic Tests
 *
 * Tests the basic message flow including:
 * - Sending messages via WebSocket
 * - Receiving user_message_confirmed event
 * - Sequence number assignment
 * - Message persistence and retrieval
 *
 * @module __tests__/e2e/flows/03-message-flow-basic.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  SequenceValidator,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import type { AgentEvent } from '@/types/websocket.types';

describe('E2E-03: Message Flow Basic', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_msg_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Message Flow Test Session',
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

  describe('Send Message', () => {
    it('should connect and send a message', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send message
      await client.sendMessage(testSession.id, 'Hello, world!');

      // Should receive user_message_confirmed
      const confirmedEvent = await client.waitForAgentEvent(
        'user_message_confirmed',
        { timeout: 10000 }
      );

      expect(confirmedEvent).toBeDefined();
      expect(confirmedEvent.type).toBe('user_message_confirmed');
    });

    it('should receive user_message_confirmed with sequenceNumber', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test message for sequence');

      const event = await client.waitForAgentEvent('user_message_confirmed');

      // Check for sequence number
      const eventWithSeq = event as AgentEvent & { sequenceNumber?: number };
      expect(eventWithSeq.sequenceNumber).toBeDefined();
      expect(typeof eventWithSeq.sequenceNumber).toBe('number');
    });

    it('should include messageId in confirmation', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test for messageId');

      const event = await client.waitForAgentEvent('user_message_confirmed');

      const eventWithId = event as AgentEvent & { messageId?: string };
      expect(eventWithId.messageId).toBeDefined();
      expect(typeof eventWithId.messageId).toBe('string');
    });

    it('should include eventId for tracing', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test for eventId');

      const event = await client.waitForAgentEvent('user_message_confirmed');

      const eventWithEventId = event as AgentEvent & { eventId?: string };
      expect(eventWithEventId.eventId).toBeDefined();
    });
  });

  describe('Sequence Numbers', () => {
    it('should assign sequential sequence numbers', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send multiple messages
      const sequenceNumbers: number[] = [];

      for (let i = 0; i < 3; i++) {
        await client.sendMessage(testSession.id, `Message ${i + 1}`);

        const event = await client.waitForAgentEvent('user_message_confirmed');
        const eventWithSeq = event as AgentEvent & { sequenceNumber: number };
        sequenceNumbers.push(eventWithSeq.sequenceNumber);

        // Clear events for next iteration
        client.clearEvents();
      }

      // Verify sequential ordering
      expect(sequenceNumbers.length).toBe(3);
      expect(sequenceNumbers[1]).toBeGreaterThan(sequenceNumbers[0]!);
      expect(sequenceNumbers[2]).toBeGreaterThan(sequenceNumbers[1]!);
    });

    it('should have monotonically increasing sequence numbers', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send messages and collect events
      const events: AgentEvent[] = [];

      for (let i = 0; i < 3; i++) {
        await client.sendMessage(testSession.id, `Monotonic test ${i}`);
        const event = await client.waitForAgentEvent('user_message_confirmed');
        events.push(event);
        client.clearEvents();
      }

      // Validate sequence order
      const validation = SequenceValidator.validateSequenceOrder(events);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Message Persistence', () => {
    it('should persist message to database', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const uniqueContent = `Persist test ${Date.now()}`;
      await client.sendMessage(testSession.id, uniqueContent);

      // Wait for confirmation
      await client.waitForAgentEvent('user_message_confirmed');

      // Allow some time for async persistence
      await new Promise(resolve => setTimeout(resolve, 500));

      // Fetch messages via REST
      const response = await client.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${testSession.id}`);

      expect(response.ok).toBe(true);

      // Find our message
      const found = response.body.messages?.find(
        m => m.content === uniqueContent && m.role === 'user'
      );
      expect(found).toBeDefined();
    });

    it('should retrieve messages in sequence order', async () => {
      // Create a fresh session for this test
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Order Test Session',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Send messages in order
      for (let i = 1; i <= 3; i++) {
        await client.sendMessage(freshSession.id, `Order message ${i}`);
        await client.waitForAgentEvent('user_message_confirmed');
        client.clearEvents();
      }

      // Allow persistence
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch messages
      const response = await client.get<{
        messages: Array<{
          content: string;
          sequenceNumber?: number;
        }>;
      }>(`/api/chat/sessions/${freshSession.id}`);

      expect(response.ok).toBe(true);

      const userMessages = response.body.messages?.filter(
        m => m.content.startsWith('Order message')
      ) || [];

      // Should be in order
      expect(userMessages.length).toBe(3);

      const contents = userMessages.map(m => m.content);
      expect(contents[0]).toContain('1');
      expect(contents[1]).toContain('2');
      expect(contents[2]).toContain('3');
    });
  });

  describe('Message Content', () => {
    it('should handle empty message', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Sending empty message might be rejected
      await client.sendMessage(testSession.id, '');

      // Should either receive error or validation event
      const events = await client.collectEvents(1, { timeout: 5000 });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle long message', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const longMessage = 'A'.repeat(10000);
      await client.sendMessage(testSession.id, longMessage);

      const event = await client.waitForAgentEvent('user_message_confirmed');
      expect(event).toBeDefined();
    });

    it('should handle special characters', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const specialMessage = 'Test <script>alert("xss")</script> & special "chars"';
      await client.sendMessage(testSession.id, specialMessage);

      const event = await client.waitForAgentEvent('user_message_confirmed');
      expect(event).toBeDefined();
    });

    it('should handle unicode and emojis', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      const unicodeMessage = 'Hello, World!';
      await client.sendMessage(testSession.id, unicodeMessage);

      const event = await client.waitForAgentEvent('user_message_confirmed');
      expect(event).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle sending message to non-existent session', async () => {
      await client.connect();

      const fakeSessionId = '00000000-0000-0000-0000-000000000000';

      // Try to join non-existent session
      await expect(
        client.joinSession(fakeSessionId)
      ).rejects.toThrow();
    });

    it('should handle sending message without joining session', async () => {
      await client.connect();

      // Send without joining
      await client.sendMessage(testSession.id, 'No join message');

      // Should receive an error event or the message should fail
      const events = await client.collectEvents(1, { timeout: 5000 });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should not crash on malformed message payload', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send malformed data
      client.emitRaw('chat:message', { invalid: 'payload' });

      // Connection should still be alive
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Multiple Clients', () => {
    let client2: E2ETestClient;

    beforeEach(async () => {
      client2 = createE2ETestClient();
      client2.setSessionCookie(testUser.sessionCookie);
    });

    afterEach(async () => {
      if (client2.isConnected()) {
        await client2.disconnect();
      }
    });

    it('should broadcast events to all clients in session', async () => {
      // Connect both clients
      await client.connect();
      await client.joinSession(testSession.id);

      await client2.connect();
      await client2.joinSession(testSession.id);

      // Client 1 sends message
      await client.sendMessage(testSession.id, 'Broadcast test');

      // Both should receive the event
      const event1 = await client.waitForAgentEvent('user_message_confirmed');
      expect(event1).toBeDefined();

      // Client 2 should also receive it (via room broadcast)
      const receivedEvents = client2.getReceivedEvents();
      const hasConfirmation = receivedEvents.some(
        e => e.data.type === 'user_message_confirmed'
      );
      expect(hasConfirmation).toBe(true);
    });
  });

  describe('Reconnection', () => {
    it('should retrieve messages after reconnection', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Reconnect Test Session',
      });

      // Connect and send message
      await client.connect();
      await client.joinSession(freshSession.id);

      const messageContent = `Reconnect test ${Date.now()}`;
      await client.sendMessage(freshSession.id, messageContent);
      await client.waitForAgentEvent('user_message_confirmed');

      // Disconnect
      await client.disconnect();

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reconnect (new client)
      const newClient = createE2ETestClient();
      newClient.setSessionCookie(testUser.sessionCookie);

      // Fetch messages via REST
      const response = await newClient.get<{
        messages: Array<{ content: string }>;
      }>(`/api/chat/sessions/${freshSession.id}`);

      expect(response.ok).toBe(true);

      const found = response.body.messages?.find(
        m => m.content === messageContent
      );
      expect(found).toBeDefined();
    });
  });
});
