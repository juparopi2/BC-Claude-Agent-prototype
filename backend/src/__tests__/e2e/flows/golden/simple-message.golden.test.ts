/**
 * Golden Flow 1: Simple Message (No Thinking, No Tools)
 *
 * Tests the baseline conversational flow where Claude responds
 * with text only, without extended thinking or tool use.
 *
 * Expected sequence (from docs/plans/phase-2.5/golden-snapshots.md):
 * ```
 * 0    user_message_confirmed  persisted
 * *    message_chunk           transient (streaming)
 * N    message                 persisted (final)
 * N+1  complete                transient
 * ```
 *
 * @module __tests__/e2e/flows/golden/simple-message.golden.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG, drainMessageQueue } from '../../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../../helpers/E2ETestClient';
import { TestSessionFactory } from '../../../integration/helpers/TestSessionFactory';
import { configureGoldenFlow } from '../../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: Golden Flow - Simple Message', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let testUser: { id: string; sessionCookie: string };
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'golden_simple_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
      configureGoldenFlow(fakeClient, 'simple');
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

  it('should follow the simple message golden flow', async () => {
    // Create session
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Simple Message',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    // Send message
    await client.sendMessage(session.id, 'Hello, what is Business Central?');

    // Wait for complete
    await client.waitForComplete(60000);

    // Validate event sequence
    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT 1: user_message_confirmed is FIRST
    const userMsgIndex = agentEvents.findIndex(e => e.data.type === 'user_message_confirmed');
    expect(userMsgIndex).toBe(0);
    expect(agentEvents[0]?.data.persistenceState).toBe('persisted');

    // INVARIANT 2: message_chunk events are TRANSIENT
    const chunks = agentEvents.filter(e => e.data.type === 'message_chunk');
    for (const chunk of chunks) {
      expect(chunk.data.persistenceState).toBe('transient');
      expect(chunk.data).not.toHaveProperty('sequenceNumber');
    }

    // INVARIANT 3: Final message is PERSISTED with sequenceNumber
    const messages = agentEvents.filter(e => e.data.type === 'message');
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const finalMessage = messages[messages.length - 1];
    expect(finalMessage?.data.persistenceState).toBe('persisted');
    expect(finalMessage?.data).toHaveProperty('sequenceNumber');

    // INVARIANT 4: complete is LAST
    const lastEvent = agentEvents[agentEvents.length - 1];
    expect(lastEvent?.data.type).toBe('complete');
  });

  it('should have consecutive sequence numbers', async () => {
    // Create session
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Simple Sequence',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    // Send message
    await client.sendMessage(session.id, 'Test sequence numbers');

    // Wait for complete
    await client.waitForComplete(60000);

    // Validate sequence numbers
    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const persistedEvents = agentEvents.filter(
      e => e.data.persistenceState === 'persisted' && e.data.sequenceNumber !== undefined
    );

    // Extract sequence numbers
    const sequenceNumbers = persistedEvents.map(e => e.data.sequenceNumber).filter(n => n !== undefined) as number[];

    // Verify consecutive (no gaps)
    expect(sequenceNumbers.length).toBeGreaterThan(0);
    for (let i = 1; i < sequenceNumbers.length; i++) {
      const diff = sequenceNumbers[i]! - sequenceNumbers[i - 1]!;
      expect(diff).toBe(1); // Must be consecutive
    }
  });

  it('should not include thinking or tool events', async () => {
    // Create session
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Simple No Tools',
    });

    await client.connect();
    await client.joinSession(session.id);
    client.clearEvents();

    // Send message
    await client.sendMessage(session.id, 'Simple response please');

    // Wait for complete
    await client.waitForComplete(60000);

    // Validate no thinking or tools
    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const thinkingEvents = agentEvents.filter(
      e => e.data.type === 'thinking' || e.data.type === 'thinking_chunk'
    );
    expect(thinkingEvents.length).toBe(0);

    const toolEvents = agentEvents.filter(
      e => e.data.type === 'tool_use' || e.data.type === 'tool_result'
    );
    expect(toolEvents.length).toBe(0);
  });
});
