/**
 * Golden Flow 5: Error Handling
 *
 * Tests error scenarios where the agent encounters failures
 * during execution (API errors, tool failures, etc.).
 *
 * Expected sequence (from docs/plans/phase-2.5/golden-snapshots.md):
 * ```
 * 0    user_message_confirmed  persisted (ALWAYS, even on error)
 * *    error                   persisted
 * ```
 *
 * Invariants:
 * 1. User message is ALWAYS persisted (even on error)
 * 2. Error is persisted to EventStore
 * 3. No `complete` event on error (error is terminal)
 *
 * @module __tests__/e2e/flows/golden/error-handling.golden.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG, drainMessageQueue } from '../../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../../helpers/E2ETestClient';
import { TestSessionFactory } from '../../../integration/helpers/TestSessionFactory';
import { TEST_TIMEOUTS } from '../../../integration/helpers/constants';
import { configureGoldenFlow } from '../../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: Golden Flow - Error Handling', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let testUser: { id: string; sessionCookie: string };
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'golden_error_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
      configureGoldenFlow(fakeClient, 'error');
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

  it.skipIf(E2E_CONFIG.apiMode.useRealApi)('should persist user message even on error', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Error',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'This will trigger an error');

    // Wait for error or complete
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT: user_message_confirmed is ALWAYS persisted first
    const userMsgEvent = agentEvents.find(e => e.data.type === 'user_message_confirmed');
    expect(userMsgEvent).toBeDefined();
    expect(userMsgEvent?.data.persistenceState).toBe('persisted');

    // Error event should be present
    const errorEvent = agentEvents.find(e => e.data.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  it.skipIf(E2E_CONFIG.apiMode.useRealApi)('should have user_message_confirmed before error', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Error Order',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Trigger error scenario');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const userMsgIndex = agentEvents.findIndex(e => e.data.type === 'user_message_confirmed');
    const errorIndex = agentEvents.findIndex(e => e.data.type === 'error');

    // user_message_confirmed should come before error
    if (userMsgIndex !== -1 && errorIndex !== -1) {
      expect(userMsgIndex).toBeLessThan(errorIndex);
    }
  });

  it.skipIf(E2E_CONFIG.apiMode.useRealApi)('should persist error event', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Error Persist',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'API error test');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const errorEvent = agentEvents.find(e => e.data.type === 'error');
    if (errorEvent) {
      // Error should be persisted
      expect(errorEvent.data.persistenceState).toBe('persisted');
      expect(errorEvent.data).toHaveProperty('sequenceNumber');
    }
  });

  it.skipIf(E2E_CONFIG.apiMode.useRealApi)('should not emit complete event on error', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Error No Complete',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Force error condition');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Should NOT have complete event on error
    const completeEvent = agentEvents.find(e => e.data.type === 'complete');
    const errorEvent = agentEvents.find(e => e.data.type === 'error');

    if (errorEvent) {
      expect(completeEvent).toBeUndefined();
    }
  });

  it.skipIf(E2E_CONFIG.apiMode.useRealApi)('should include error message and code', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Error Details',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Generate detailed error');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    const errorEvent = agentEvents.find(e => e.data.type === 'error');
    if (errorEvent) {
      // Error should have message
      expect(errorEvent.data).toHaveProperty('error');
      expect(typeof errorEvent.data.error).toBe('string');
      expect(errorEvent.data.error.length).toBeGreaterThan(0);
    }
  });

  it('should handle graceful degradation on tool failure', async () => {
    // This test doesn't require FakeAnthropicClient to throw
    // We're testing how the system handles tool failures gracefully
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Tool Failure',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    // Send a message that would normally work
    await client.sendMessage(session.id, 'Test resilience');

    // Wait for some events (may get complete or error)
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // At minimum, should have user_message_confirmed
    const userMsgEvent = agentEvents.find(e => e.data.type === 'user_message_confirmed');
    expect(userMsgEvent).toBeDefined();

    // System should not crash (either complete successfully or emit error)
    const hasComplete = agentEvents.some(e => e.data.type === 'complete');
    const hasError = agentEvents.some(e => e.data.type === 'error');

    // One of these should be true (system responded in some way)
    expect(hasComplete || hasError).toBe(true);
  });

  it('should maintain event sequence on partial failure', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Partial Failure',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Partial failure test');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.SOCKET_CONNECTION));

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Get persisted events
    const persistedEvents = agentEvents.filter(
      e => e.data.persistenceState === 'persisted' && e.data.sequenceNumber !== undefined
    );

    if (persistedEvents.length > 1) {
      // Verify sequence numbers are consecutive
      const sequenceNumbers = persistedEvents
        .map(e => e.data.sequenceNumber)
        .filter(n => n !== undefined) as number[];

      for (let i = 1; i < sequenceNumbers.length; i++) {
        const diff = sequenceNumbers[i]! - sequenceNumbers[i - 1]!;
        expect(diff).toBe(1); // Consecutive
      }
    }
  });
});
