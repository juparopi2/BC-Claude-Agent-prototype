/**
 * Golden Flow 3: Message with Tool Use
 *
 * Tests the tool execution flow where Claude requests to use
 * tools to retrieve or manipulate data.
 *
 * Expected sequence (from docs/plans/phase-2.5/golden-snapshots.md):
 * ```
 * 0    user_message_confirmed  persisted
 * *    message_chunk           transient
 * 1    message                 persisted (stopReason='tool_use')
 * 2    tool_use                persisted
 * 3    tool_result             persisted
 * *    message_chunk           transient (turn 2)
 * N    message                 persisted (final)
 * N+1  complete                transient
 * ```
 *
 * @module __tests__/e2e/flows/golden/tool-use.golden.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG, drainMessageQueue } from '../../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../../helpers/E2ETestClient';
import { TestSessionFactory } from '../../../integration/helpers/TestSessionFactory';
import { configureGoldenFlow } from '../../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: Golden Flow - Tool Use', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let testUser: { id: string; sessionCookie: string };
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'golden_tool_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
      configureGoldenFlow(fakeClient, 'tool_use');
      getDirectAgentService(undefined, undefined, fakeClient);
    }

    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    await client.connect();
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  it('should follow the tool use golden flow', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Use',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'List the first 5 customers');

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT: tool_use ALWAYS followed by tool_result
    const toolUseEvents = agentEvents.filter(e => e.data.type === 'tool_use');
    const toolResultEvents = agentEvents.filter(e => e.data.type === 'tool_result');

    for (const toolUse of toolUseEvents) {
      const matchingResult = toolResultEvents.find(r => r.data.toolUseId === toolUse.data.toolUseId);
      expect(matchingResult).toBeDefined();

      // tool_result should come AFTER tool_use
      const useIndex = agentEvents.indexOf(toolUse);
      const resultIndex = agentEvents.indexOf(matchingResult!);
      expect(resultIndex).toBeGreaterThan(useIndex);
    }

    // INVARIANT: Tool events are PERSISTED
    for (const toolUse of toolUseEvents) {
      expect(toolUse.data.persistenceState).toBe('persisted');
    }
    for (const toolResult of toolResultEvents) {
      expect(toolResult.data.persistenceState).toBe('persisted');
    }

    // INVARIANT: complete is LAST
    const lastEvent = agentEvents[agentEvents.length - 1];
    expect(lastEvent?.data.type).toBe('complete');
  });

  it('should have intermediate message with stopReason=tool_use', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Intermediate',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Get customer data');

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Find messages
    const messageEvents = agentEvents.filter(e => e.data.type === 'message');

    // Should have at least 2 messages: one with tool_use, one final
    expect(messageEvents.length).toBeGreaterThanOrEqual(2);

    // First message should have stopReason='tool_use'
    const firstMessage = messageEvents[0];
    expect(firstMessage?.data.stopReason).toBe('tool_use');
  });

  it('should persist tool_use and tool_result with sequence numbers', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Persistence',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Retrieve customer information');

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Find tool events
    const toolUseEvents = agentEvents.filter(e => e.data.type === 'tool_use');
    const toolResultEvents = agentEvents.filter(e => e.data.type === 'tool_result');

    // Verify persistence
    for (const toolUse of toolUseEvents) {
      expect(toolUse.data.persistenceState).toBe('persisted');
      expect(toolUse.data).toHaveProperty('sequenceNumber');
    }

    for (const toolResult of toolResultEvents) {
      expect(toolResult.data.persistenceState).toBe('persisted');
      expect(toolResult.data).toHaveProperty('sequenceNumber');
    }
  });

  it('should have tool_result after tool_use in sequence', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Order',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Query business central data');

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const toolUseEvents = agentEvents.filter(e => e.data.type === 'tool_use');
    const toolResultEvents = agentEvents.filter(e => e.data.type === 'tool_result');

    // Each tool_use should be followed by tool_result
    for (const toolUse of toolUseEvents) {
      const matchingResult = toolResultEvents.find(
        r => r.data.toolUseId === toolUse.data.toolUseId
      );

      expect(matchingResult).toBeDefined();

      const toolUseIndex = agentEvents.indexOf(toolUse);
      const toolResultIndex = agentEvents.indexOf(matchingResult!);

      // tool_result must come after tool_use
      expect(toolResultIndex).toBeGreaterThan(toolUseIndex);

      // Should be relatively close (no huge gap)
      const gap = toolResultIndex - toolUseIndex;
      expect(gap).toBeLessThan(10); // Reasonable upper bound
    }
  });

  it('should not duplicate tool events', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Dedup',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Fetch data please');

    await client.waitForComplete(90000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const toolUseEvents = agentEvents.filter(e => e.data.type === 'tool_use');

    // Get unique toolUseIds
    const toolUseIds = toolUseEvents.map(e => e.data.toolUseId);
    const uniqueToolUseIds = new Set(toolUseIds);

    // No duplicates
    expect(toolUseIds.length).toBe(uniqueToolUseIds.size);
  });
});
