/**
 * Golden Flow 4: Approval Flow (Write Operation)
 *
 * Tests the human-in-the-loop approval flow where Claude
 * requests permission to perform write operations.
 *
 * Expected sequence (from docs/plans/phase-2.5/golden-snapshots.md):
 * ```
 * 0    user_message_confirmed   persisted
 * *    message_chunk            transient
 * 1    message                  persisted (stopReason='tool_use')
 * 2    tool_use                 persisted
 * 3    approval_requested       pending (PAUSES EXECUTION)
 *      [WAITING FOR USER RESPONSE]
 * 4    approval_resolved        transient (approved=true/false)
 * 5    tool_result              persisted (reflects approval)
 * *    message_chunk            transient
 * N    message                  persisted
 * N+1  complete                 transient
 * ```
 *
 * @module __tests__/e2e/flows/golden/approval.golden.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, E2E_CONFIG, drainMessageQueue } from '../../setup.e2e';
import { createE2ETestClient, E2ETestClient } from '../../helpers/E2ETestClient';
import { TestSessionFactory } from '../../../integration/helpers/TestSessionFactory';
import { configureGoldenFlow } from '../../helpers/GoldenResponses';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { getDirectAgentService, __resetDirectAgentService } from '@/services/agent';

describe('E2E: Golden Flow - Approval', () => {
  setupE2ETest();
  const factory = new TestSessionFactory();
  let client: E2ETestClient;
  let testUser: { id: string; sessionCookie: string };
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'golden_approval_' });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    if (!E2E_CONFIG.apiMode.useRealApi) {
      __resetDirectAgentService();
      fakeClient = new FakeAnthropicClient();
      configureGoldenFlow(fakeClient, 'approval');
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

  it('should pause at approval_requested and resume after approval', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Approval',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Create a new customer named Test Corp');

    // Wait for approval_requested
    const approvalEvent = await client.waitForAgentEvent('approval_requested', { timeout: 60000 });
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent).toHaveProperty('approvalId');

    // Respond to approval
    await client.respondToApproval(approvalEvent.approvalId, 'approved');

    // Wait for complete
    await client.waitForComplete(60000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT: approval_resolved follows approval_requested
    const approvalRequestedIndex = agentEvents.findIndex(e => e.data.type === 'approval_requested');
    const approvalResolvedIndex = agentEvents.findIndex(e => e.data.type === 'approval_resolved');
    expect(approvalResolvedIndex).toBeGreaterThan(approvalRequestedIndex);

    // INVARIANT: tool_result follows approval_resolved
    const toolResultIndex = agentEvents.findIndex(e => e.data.type === 'tool_result');
    expect(toolResultIndex).toBeGreaterThan(approvalResolvedIndex);

    // INVARIANT: complete is LAST
    const lastEvent = agentEvents[agentEvents.length - 1];
    expect(lastEvent?.data.type).toBe('complete');
  });

  it('should handle approval rejection', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Approval Rejected',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Delete customer Test Corp');

    const approvalEvent = await client.waitForAgentEvent('approval_requested', { timeout: 60000 });

    // Reject the approval
    await client.respondToApproval(approvalEvent.approvalId, 'rejected', 'User decided not to proceed');

    await client.waitForComplete(60000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // INVARIANT: approval_resolved shows rejected
    const resolvedEvent = agentEvents.find(e => e.data.type === 'approval_resolved');
    expect(resolvedEvent?.data.approved).toBe(false);

    // INVARIANT: tool_result shows failure
    const toolResult = agentEvents.find(e => e.data.type === 'tool_result');
    expect(toolResult?.data.success).toBe(false);
  });

  it('should have approval_requested before approval_resolved', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Approval Order',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Update customer details');

    // Wait for approval_requested
    const approvalEvent = await client.waitForAgentEvent('approval_requested', { timeout: 60000 });
    expect(approvalEvent).toBeDefined();

    // Get events before approval
    const eventsBeforeApproval = client.getReceivedEvents();
    const agentEventsBeforeApproval = eventsBeforeApproval.filter(e => e.data?.type);

    // Should have approval_requested but NOT approval_resolved yet
    const hasApprovalRequested = agentEventsBeforeApproval.some(
      e => e.data.type === 'approval_requested'
    );
    const hasApprovalResolved = agentEventsBeforeApproval.some(
      e => e.data.type === 'approval_resolved'
    );

    expect(hasApprovalRequested).toBe(true);
    expect(hasApprovalResolved).toBe(false);

    // Approve
    await client.respondToApproval(approvalEvent.approvalId, 'approved');
    await client.waitForComplete(60000);

    // Now should have approval_resolved
    const eventsAfterApproval = client.getReceivedEvents();
    const agentEventsAfterApproval = eventsAfterApproval.filter(e => e.data?.type);

    const hasApprovalResolvedAfter = agentEventsAfterApproval.some(
      e => e.data.type === 'approval_resolved'
    );
    expect(hasApprovalResolvedAfter).toBe(true);
  });

  it('should have tool_use before approval_requested', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Approval Tool Order',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Create new item in inventory');

    // Wait for approval_requested
    const approvalEvent = await client.waitForAgentEvent('approval_requested', { timeout: 60000 });
    expect(approvalEvent).toBeDefined();

    // Approve and complete
    await client.respondToApproval(approvalEvent.approvalId, 'approved');
    await client.waitForComplete(60000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // Find indices
    const toolUseIndex = agentEvents.findIndex(e => e.data.type === 'tool_use');
    const approvalRequestedIndex = agentEvents.findIndex(e => e.data.type === 'approval_requested');

    // tool_use should come before approval_requested
    expect(toolUseIndex).toBeGreaterThan(-1);
    expect(approvalRequestedIndex).toBeGreaterThan(-1);
    expect(toolUseIndex).toBeLessThan(approvalRequestedIndex);
  });

  it('should persist approval-related events correctly', async () => {
    const session = await factory.createChatSession(testUser.id, {
      title: 'Golden Approval Persistence',
    });

    await client.joinSession(session.id);
    client.clearEvents();

    await client.sendMessage(session.id, 'Modify customer record');

    // Wait for approval_requested
    const approvalEvent = await client.waitForAgentEvent('approval_requested', { timeout: 60000 });

    // Approve
    await client.respondToApproval(approvalEvent.approvalId, 'approved');
    await client.waitForComplete(60000);

    const events = client.getReceivedEvents();
    const agentEvents = events.filter(e => e.data?.type);

    // tool_use should be persisted
    const toolUseEvents = agentEvents.filter(e => e.data.type === 'tool_use');
    for (const toolUse of toolUseEvents) {
      expect(toolUse.data.persistenceState).toBe('persisted');
      expect(toolUse.data).toHaveProperty('sequenceNumber');
    }

    // tool_result should be persisted
    const toolResultEvents = agentEvents.filter(e => e.data.type === 'tool_result');
    for (const toolResult of toolResultEvents) {
      expect(toolResult.data.persistenceState).toBe('persisted');
      expect(toolResult.data).toHaveProperty('sequenceNumber');
    }

    // approval_resolved should be transient
    const approvalResolvedEvents = agentEvents.filter(e => e.data.type === 'approval_resolved');
    for (const resolved of approvalResolvedEvents) {
      expect(resolved.data.persistenceState).toBe('transient');
      expect(resolved.data).not.toHaveProperty('sequenceNumber');
    }
  });
});
