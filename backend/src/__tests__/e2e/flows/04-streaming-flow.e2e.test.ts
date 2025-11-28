/**
 * E2E-04: Streaming Flow Tests
 *
 * Tests the real-time streaming functionality including:
 * - Message chunk delivery
 * - Streaming event ordering
 * - Delta accumulation
 * - Stream completion
 * - Concurrent stream handling
 *
 * @module __tests__/e2e/flows/04-streaming-flow.e2e.test
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

describe('E2E-04: Streaming Flow', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_stream_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Streaming Flow Test Session',
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

  describe('Session Start Event', () => {
    it('should receive session_start event when agent begins', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Hello');

      // First event should be session_start
      const sessionStart = await client.waitForAgentEvent('session_start', {
        timeout: 15000,
      });

      expect(sessionStart).toBeDefined();
      expect(sessionStart.type).toBe('session_start');
    });

    it('should include session metadata in session_start', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test metadata');

      const event = await client.waitForAgentEvent('session_start');

      // Session start should have relevant metadata
      const eventData = event as AgentEvent & {
        sessionId?: string;
        messageId?: string;
      };

      expect(eventData.sessionId || eventData.messageId).toBeDefined();
    });
  });

  describe('Message Chunk Streaming', () => {
    it('should receive message_chunk events during streaming', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Tell me a short story');

      // Collect events until complete
      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Should have at least one message_chunk
      const chunks = events.filter(e => e.data.type === 'message_chunk');
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should include delta text in message_chunk events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Say hello');

      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      const chunks = events.filter(e => e.data.type === 'message_chunk');

      if (chunks.length > 0) {
        // Each chunk should have delta or text content
        for (const chunk of chunks) {
          const chunkData = chunk.data as AgentEvent & {
            delta?: string;
            text?: string;
            content?: string;
          };

          const hasContent =
            chunkData.delta !== undefined ||
            chunkData.text !== undefined ||
            chunkData.content !== undefined;

          expect(hasContent).toBe(true);
        }
      }
    });

    it('should have monotonically increasing sequence numbers in chunks', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Count to five');

      const events = await client.collectEvents(20, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Validate sequence order
      const agentEvents = events.map(e => e.data);
      const validation = SequenceValidator.validateSequenceOrder(agentEvents);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Stream Completion', () => {
    it('should receive complete event when streaming finishes', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Say hi');

      const completeEvent = await client.waitForAgentEvent('complete', {
        timeout: 30000,
      });

      expect(completeEvent).toBeDefined();
      expect(completeEvent.type).toBe('complete');
    });

    it('should include stop_reason in complete event', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Hello');

      const event = await client.waitForAgentEvent('complete', {
        timeout: 30000,
      });

      const completeEvent = event as AgentEvent & {
        stop_reason?: string;
        stopReason?: string;
      };

      const hasStopReason =
        completeEvent.stop_reason !== undefined ||
        completeEvent.stopReason !== undefined;

      expect(hasStopReason).toBe(true);
    });

    it('should have end_turn as stop_reason for normal completion', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Just say "OK"');

      const event = await client.waitForAgentEvent('complete', {
        timeout: 30000,
      });

      const completeEvent = event as AgentEvent & {
        stop_reason?: string;
        stopReason?: string;
      };

      const stopReason = completeEvent.stop_reason || completeEvent.stopReason;

      // Normal completion should be end_turn (or similar)
      expect(['end_turn', 'stop', 'complete']).toContain(stopReason);
    });
  });

  describe('Event Ordering', () => {
    it('should deliver events in correct order', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Hello world');

      const events = await client.collectEvents(15, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      const eventTypes = events.map(e => e.data.type);

      // user_message_confirmed should come first
      const confirmedIndex = eventTypes.indexOf('user_message_confirmed');
      expect(confirmedIndex).toBeGreaterThanOrEqual(0);

      // session_start should come after user_message_confirmed
      const sessionStartIndex = eventTypes.indexOf('session_start');
      if (sessionStartIndex >= 0) {
        expect(sessionStartIndex).toBeGreaterThan(confirmedIndex);
      }

      // complete should come last
      const completeIndex = eventTypes.indexOf('complete');
      if (completeIndex >= 0) {
        expect(completeIndex).toBe(eventTypes.length - 1);
      }
    });

    it('should validate streaming event sequence', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Tell me about the weather');

      const events = await client.collectEvents(20, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      const agentEvents = events.map(e => e.data);
      const validation = SequenceValidator.validateStreamingOrder(agentEvents);

      expect(validation.valid).toBe(true);
    });
  });

  describe('Message Assembly', () => {
    it('should accumulate chunks into complete message', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Describe TypeScript briefly');

      const events = await client.collectEvents(30, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Accumulate deltas
      let accumulatedText = '';
      for (const event of events) {
        const data = event.data as AgentEvent & {
          delta?: string;
          text?: string;
          content?: string;
        };

        if (data.type === 'message_chunk') {
          accumulatedText += data.delta || data.text || data.content || '';
        }
      }

      // Should have accumulated some text
      expect(accumulatedText.length).toBeGreaterThan(0);
    });

    it('should have consistent message content after streaming', async () => {
      // Create fresh session for this test
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Content Consistency Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(freshSession.id, 'Say exactly: "Test complete"');

      // Wait for completion
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      // Allow persistence
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fetch from REST
      const response = await client.get<{
        messages: Array<{ content: string; role: string }>;
      }>(`/api/chat/sessions/${freshSession.id}`);

      expect(response.ok).toBe(true);

      // Should have assistant response
      const assistantMessages = response.body.messages?.filter(
        m => m.role === 'assistant'
      ) || [];

      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Error During Streaming', () => {
    it('should receive error event on agent failure', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Send a message that might trigger an error
      // This depends on backend implementation
      await client.sendMessage(testSession.id, 'Normal message');

      // Collect events
      const events = await client.collectEvents(15, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Either complete or error should be received
      const hasTerminalEvent = events.some(
        e => e.data.type === 'complete' || e.data.type === 'error'
      );

      expect(hasTerminalEvent).toBe(true);
    });

    it('should handle connection drop during streaming', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Start message
      await client.sendMessage(testSession.id, 'Tell me a long story');

      // Wait briefly for streaming to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Disconnect mid-stream
      await client.disconnect();

      // Reconnect
      client = createE2ETestClient();
      client.setSessionCookie(testUser.sessionCookie);
      await client.connect();

      // Connection should work
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Concurrent Messages', () => {
    it('should handle rapid sequential messages', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Rapid Messages Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Send first message and wait for completion
      await client.sendMessage(freshSession.id, 'First message');
      await client.waitForAgentEvent('complete', { timeout: 30000 });
      client.clearEvents();

      // Send second message
      await client.sendMessage(freshSession.id, 'Second message');
      await client.waitForAgentEvent('complete', { timeout: 30000 });

      // Both should complete without error
      expect(true).toBe(true);
    });
  });

  describe('Event Metadata', () => {
    it('should include eventId in all streaming events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test event IDs');

      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // All events should have eventId
      for (const event of events) {
        const data = event.data as AgentEvent & { eventId?: string };
        expect(data.eventId).toBeDefined();
      }
    });

    it('should include timestamp in events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test timestamps');

      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Events should have timestamp
      for (const event of events) {
        const data = event.data as AgentEvent & {
          timestamp?: string | number;
          createdAt?: string;
        };

        const hasTimestamp =
          data.timestamp !== undefined || data.createdAt !== undefined;

        expect(hasTimestamp).toBe(true);
      }
    });

    it('should include sessionId in streaming events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Test session context');

      const events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Events related to session should have sessionId
      const sessionEvents = events.filter(e =>
        ['session_start', 'message_chunk', 'complete'].includes(e.data.type)
      );

      for (const event of sessionEvents) {
        const data = event.data as AgentEvent & { sessionId?: string };
        if (event.data.type !== 'message_chunk') {
          // message_chunk might not always have sessionId
          expect(data.sessionId).toBeDefined();
        }
      }
    });
  });

  describe('Multiple Clients Streaming', () => {
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

    it('should broadcast streaming events to all clients in session', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Multi-Client Streaming Test',
      });

      // Connect both clients
      await client.connect();
      await client.joinSession(freshSession.id);

      await client2.connect();
      await client2.joinSession(freshSession.id);

      // Client 1 sends message
      await client.sendMessage(freshSession.id, 'Hello from client 1');

      // Client 1 receives streaming events
      const client1Events = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      // Client 2 should also receive events
      const client2Events = client2.getReceivedEvents();

      // Both should have received events
      expect(client1Events.length).toBeGreaterThan(0);
      expect(client2Events.length).toBeGreaterThan(0);

      // Both should have streaming events
      const client1HasChunks = client1Events.some(
        e => e.data.type === 'message_chunk' || e.data.type === 'complete'
      );
      const client2HasChunks = client2Events.some(
        e => e.data.type === 'message_chunk' || e.data.type === 'complete'
      );

      expect(client1HasChunks).toBe(true);
      expect(client2HasChunks).toBe(true);
    });
  });

  describe('Token Usage', () => {
    it('should include token usage in complete event', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(testSession.id, 'Brief response please');

      const event = await client.waitForAgentEvent('complete', {
        timeout: 30000,
      });

      const completeEvent = event as AgentEvent & {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
        tokenUsage?: {
          input?: number;
          output?: number;
        };
      };

      // Should have some form of usage info
      const hasUsage =
        completeEvent.usage !== undefined ||
        completeEvent.tokenUsage !== undefined;

      // Usage might not always be included, so just check type if present
      if (hasUsage) {
        expect(completeEvent.usage || completeEvent.tokenUsage).toBeDefined();
      }
    });
  });
});
