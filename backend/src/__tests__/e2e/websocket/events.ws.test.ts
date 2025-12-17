/**
 * E2E Tests: WebSocket Agent Events
 *
 * Tests agent:event types including user_message_confirmed, message_chunk, and complete.
 * Uses FakeAnthropicClient configured via GoldenResponses for predictable behavior.
 *
 * @module __tests__/e2e/websocket/events.ws.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG } from '../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../helpers/E2ETestClient';
import { TestSessionFactory } from '../../integration/helpers/TestSessionFactory';
import { configureGoldenFlow } from '../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: WebSocket Agent Events', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let userId: string;
  let sessionCookie: string;
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    const auth = await factory.createTestUser();
    userId = auth.id;
    sessionCookie = auth.sessionCookie;
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(async () => {
    // Reset and configure fake client if not using real API
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
    }

    client = createE2ETestClient();
    client.setSessionCookie(sessionCookie);
    await client.connect();
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('user_message_confirmed event', () => {
    it('should receive user_message_confirmed before agent events', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      // Create session
      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Event Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      // Send message
      await client.sendMessage(sessionId, 'Hello');

      // Wait for user_message_confirmed
      const confirmEvent = await client.waitForAgentEvent('user_message_confirmed', { timeout: 30000 });
      expect(confirmEvent).toBeDefined();
      expect(confirmEvent.type).toBe('user_message_confirmed');
      expect(confirmEvent).toHaveProperty('sequenceNumber');
      expect(confirmEvent).toHaveProperty('messageId');
    });

    it('should include sequence number and message ID', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Sequence Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Test message');

      const confirmEvent = await client.waitForAgentEvent('user_message_confirmed', { timeout: 30000 });
      expect(confirmEvent.sequenceNumber).toBeTypeOf('number');
      expect(confirmEvent.sequenceNumber).toBeGreaterThan(0);
      expect(confirmEvent.messageId).toBeTypeOf('string');
      expect(confirmEvent.messageId).toBeTruthy();
    });
  });

  describe('message_chunk events', () => {
    it('should receive streaming message_chunk events', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Chunk Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Tell me about BC');

      // Wait for complete
      await client.waitForComplete(60000);

      // Check received events
      const events = client.getReceivedEvents();
      const messageChunks = events.filter(e => e.data?.type === 'message_chunk');
      expect(messageChunks.length).toBeGreaterThan(0);
    });

    it('should accumulate chunks into coherent text', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Text Accumulation Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Hello');

      // Wait for complete
      await client.waitForComplete(60000);

      // Accumulate chunks
      const events = client.getReceivedEvents();
      const messageChunks = events.filter(e => e.data?.type === 'message_chunk');
      const accumulatedText = messageChunks
        .map(e => e.data.delta?.text || '')
        .join('');

      // Should have received meaningful text
      expect(accumulatedText.length).toBeGreaterThan(0);
      if (!E2E_CONFIG.apiMode.useRealApi) {
        expect(accumulatedText).toContain('Hello! I am Claude');
      }
    });
  });

  describe('complete event', () => {
    it('should receive complete event at the end', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Complete Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Hi');

      const completeEvent = await client.waitForComplete(60000);
      expect(completeEvent.type).toBe('complete');
      expect(completeEvent).toHaveProperty('reason');
      expect(['end_turn', 'max_tokens', 'tool_use']).toContain(completeEvent.reason);
    });

    it('should be the last event in the sequence', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Event Order Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Test');

      // Wait for complete
      await client.waitForComplete(60000);

      // Give it a moment to ensure no more events arrive
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify complete is last
      const lastEvent = client.getLastEvent();
      expect(lastEvent?.data?.type).toBe('complete');
    });
  });

  describe('Event ordering', () => {
    it('should receive events in correct order', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'simple');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Order Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Hello');

      // Wait for complete
      await client.waitForComplete(60000);

      // Verify event order
      const events = client.getReceivedEvents();
      const eventTypes = events.map(e => e.data?.type).filter(Boolean);

      // Should start with user_message_confirmed
      expect(eventTypes[0]).toBe('user_message_confirmed');

      // Should end with complete
      expect(eventTypes[eventTypes.length - 1]).toBe('complete');

      // Should have message_chunk events in between
      const chunkEvents = eventTypes.filter(t => t === 'message_chunk');
      expect(chunkEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Thinking events', () => {
    it('should receive thinking events when extended thinking is used', async () => {
      if (!E2E_CONFIG.apiMode.useRealApi) {
        configureGoldenFlow(fakeClient, 'thinking');
        getDirectAgentService(undefined, undefined, fakeClient);
      }

      const httpClient = createE2ETestClient();
      httpClient.setSessionCookie(sessionCookie);
      const response = await httpClient.post<{ id: string }>('/api/chat/sessions', { title: 'Thinking Test' });
      const sessionId = response.body.id;

      await client.joinSession(sessionId);
      client.clearEvents();

      await client.sendMessage(sessionId, 'Complex question');

      // Wait for complete
      await client.waitForComplete(60000);

      // Check for thinking events
      const events = client.getReceivedEvents();
      const thinkingEvents = events.filter(e => e.data?.type === 'thinking');

      if (!E2E_CONFIG.apiMode.useRealApi) {
        // FakeAnthropicClient with 'thinking' flow should produce thinking events
        expect(thinkingEvents.length).toBeGreaterThan(0);
      }
    });
  });
});
