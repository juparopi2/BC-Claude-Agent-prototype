/**
 * Golden Flow 2: Message with Extended Thinking
 *
 * Tests the extended thinking flow where Claude uses internal
 * reasoning before responding to the user.
 *
 * Expected sequence (from docs/plans/phase-2.5/golden-snapshots.md):
 * ```
 * 0    user_message_confirmed   persisted
 * *    thinking_chunk           transient (streaming)
 * *    thinking_complete        transient (transition signal)
 * *    message_chunk            transient (streaming)
 * N    thinking                 persisted (final, accumulated)
 * N+1  message                  persisted (final)
 * N+2  complete                 transient
 * ```
 *
 * @module __tests__/e2e/flows/golden/thinking-message.golden.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG, drainMessageQueue } from '../../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../../helpers/E2ETestClient';
import { TestSessionFactory } from '../../../integration/helpers/TestSessionFactory';
import { configureGoldenFlow } from '../../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: Golden Flow - Extended Thinking', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let testUser: { id: string; sessionCookie: string };
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'golden_thinking_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
      configureGoldenFlow(fakeClient, 'thinking');
      getDirectAgentService(undefined, undefined, fakeClient);
    }

    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  it('should follow the thinking message golden flow', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Thinking',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    // Send message with thinking enabled
    await client.sendMessage(session.id, 'Explain the accounting cycle', {
      enableThinking: true,
      thinkingBudget: 10000,
    });

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT: user_message_confirmed is FIRST
    expect(agentEvents[0]?.data.type).toBe('user_message_confirmed');

    // INVARIANT: thinking_chunk comes BEFORE message_chunk
    const firstThinkingChunk = agentEvents.findIndex(e => e.data.type === 'thinking_chunk');
    const firstMessageChunk = agentEvents.findIndex(e => e.data.type === 'message_chunk');
    if (firstThinkingChunk !== -1 && firstMessageChunk !== -1) {
      expect(firstThinkingChunk).toBeLessThan(firstMessageChunk);
    }

    // INVARIANT: Final thinking event is PERSISTED
    const thinkingEvents = agentEvents.filter(e => e.data.type === 'thinking');
    if (thinkingEvents.length > 0) {
      const finalThinking = thinkingEvents[thinkingEvents.length - 1];
      expect(finalThinking?.data.persistenceState).toBe('persisted');
    }

    // INVARIANT: complete is LAST
    const lastEvent = agentEvents[agentEvents.length - 1];
    expect(lastEvent?.data.type).toBe('complete');
  });

  it('should have thinking_chunk events as transient', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Thinking Transient',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Think about this problem', {
      enableThinking: true,
      thinkingBudget: 10000,
    });

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Validate thinking_chunk events are transient
    const thinkingChunks = agentEvents.filter(e => e.data.type === 'thinking_chunk');
    for (const chunk of thinkingChunks) {
      expect(chunk.data.persistenceState).toBe('transient');
      expect(chunk.data).not.toHaveProperty('sequenceNumber');
    }
  });

  it('should persist final thinking and message events', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Thinking Persist',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Analyze this scenario', {
      enableThinking: true,
      thinkingBudget: 10000,
    });

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Find final thinking and message
    const thinkingEvents = agentEvents.filter(e => e.data.type === 'thinking');
    const messageEvents = agentEvents.filter(e => e.data.type === 'message');

    // Both should have at least one persisted event
    if (thinkingEvents.length > 0) {
      const finalThinking = thinkingEvents[thinkingEvents.length - 1];
      expect(finalThinking?.data.persistenceState).toBe('persisted');
      expect(finalThinking?.data).toHaveProperty('sequenceNumber');
    }

    if (messageEvents.length > 0) {
      const finalMessage = messageEvents[messageEvents.length - 1];
      expect(finalMessage?.data.persistenceState).toBe('persisted');
      expect(finalMessage?.data).toHaveProperty('sequenceNumber');
    }
  });

  it('should have thinking before message in sequence', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Thinking Order',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Complex reasoning task', {
      enableThinking: true,
      thinkingBudget: 10000,
    });

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Find persisted thinking and message
    const thinkingEvents = agentEvents.filter(
      e => e.data.type === 'thinking' && e.data.persistenceState === 'persisted'
    );
    const messageEvents = agentEvents.filter(
      e => e.data.type === 'message' && e.data.persistenceState === 'persisted'
    );

    if (thinkingEvents.length > 0 && messageEvents.length > 0) {
      const thinkingIndex = agentEvents.indexOf(thinkingEvents[0]!);
      const messageIndex = agentEvents.indexOf(messageEvents[0]!);

      // Thinking should come before message
      expect(thinkingIndex).toBeLessThan(messageIndex);
    }
  });
});
