/**
 * E2E Scenario Test: Max Tokens Limit
 *
 * This scenario executes ONCE and multiple tests verify different aspects
 * of the same response. This dramatically reduces API calls - instead of
 * 10 tests making 10 API calls, we get 10 verifications from 1 call.
 *
 * Scenario: Token limit exceeded, stop_reason = 'max_tokens'
 * Expected flow: user_message_confirmed → message_chunk → message → complete (with max_tokens stop_reason)
 *
 * NOTE: This scenario requires a custom scenario definition in the registry.
 * Future work: add max-tokens scenario to ResponseScenarioRegistry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupE2ETest, drainMessageQueue, E2E_API_MODE } from '../../setup.e2e';
import {
  getScenarioRegistry,
  resetScenarioRegistry,
  ScenarioResult,
  AgentEvent,
} from '../../helpers/ResponseScenarioRegistry';
import { TestSessionFactory, TestUser } from '../../../integration/helpers/TestSessionFactory';

describe('E2E Scenario: Max Tokens Limit', () => {
  // Setup E2E test environment
  const { getBaseUrl } = setupE2ETest({
    cleanSlate: true,
    cleanSlateOptions: { preserveTestUsers: true },
  });

  const factory = new TestSessionFactory();
  let testUser: TestUser;
  let scenarioResult: ScenarioResult;

  /**
   * Execute the scenario ONCE before all tests.
   * All tests will verify different aspects of this single execution.
   *
   * Uses predefined 'max-tokens' scenario from ResponseScenarioRegistry
   * which configures FakeAgentOrchestrator to simulate max_tokens stop_reason.
   */
  beforeAll(async () => {
    console.log(`\n[Scenario] API Mode: ${E2E_API_MODE.description}`);
    console.log('[Scenario] Executing max-tokens scenario...\n');

    // Create test user
    testUser = await factory.createTestUser({ prefix: 'e2e_scenario_max_tok_' });

    // Use predefined scenario from ResponseScenarioRegistry
    // The registry already has 'max-tokens' configured with FakeScenario pattern
    const registry = getScenarioRegistry();

    scenarioResult = await registry.executeScenario('max-tokens', factory, testUser);

    if (scenarioResult.error) {
      console.error('[Scenario] Execution failed:', scenarioResult.error);
    } else {
      console.log(`[Scenario] Execution complete: ${scenarioResult.events.length} events in ${scenarioResult.durationMs}ms`);
      console.log(`[Scenario] DB Messages: ${scenarioResult.dbMessages.length}`);
      console.log(`[Scenario] DB Events: ${scenarioResult.dbEvents.length}\n`);
    }
  }, 120000); // 2 minute timeout for scenario execution

  afterAll(async () => {
    // Drain message queue before cleanup
    await drainMessageQueue();

    // Cleanup test data
    await factory.cleanup();

    // Reset scenario registry
    resetScenarioRegistry();
  }, 30000);

  // ============================================================================
  // SECTION 1: Event Ordering Tests
  // ============================================================================

  describe('Event Ordering', () => {
    it('should emit user_message_confirmed as first event', () => {
      expect(scenarioResult.error).toBeUndefined();
      expect(scenarioResult.events.length).toBeGreaterThan(0);

      const firstEvent = scenarioResult.events[0];
      expect(firstEvent?.type).toBe('user_message_confirmed');
    });

    it('should emit complete as last event', () => {
      const lastEvent = scenarioResult.events[scenarioResult.events.length - 1];
      expect(lastEvent?.type).toBe('complete');
    });

    it('should emit message_chunk events for streaming', () => {
      const messageChunks = scenarioResult.events.filter(e => e.type === 'message_chunk');
      expect(messageChunks.length).toBeGreaterThan(0);
    });

    it('should have valid event flow according to state machine', () => {
      const eventTypes = scenarioResult.events.map(e => e.type);

      // Basic flow validation
      expect(eventTypes[0]).toBe('user_message_confirmed');
      expect(eventTypes[eventTypes.length - 1]).toBe('complete');

      // No invalid transitions
      const completeIndex = eventTypes.indexOf('complete');
      expect(completeIndex).toBe(eventTypes.length - 1);
    });
  });

  // ============================================================================
  // SECTION 2: Stop Reason Tests
  // ============================================================================

  describe('Stop Reason', () => {
    it('should have stop_reason = max_tokens in complete event', () => {
      const completeEvent = scenarioResult.events.find(e => e.type === 'complete');
      expect(completeEvent).toBeDefined();

      const stopReason = (completeEvent?.data as { stopReason?: string })?.stopReason;
      expect(stopReason).toBe('max_tokens');
    });

    it('should NOT have stop_reason = end_turn', () => {
      const completeEvent = scenarioResult.events.find(e => e.type === 'complete');
      expect(completeEvent).toBeDefined();

      const stopReason = (completeEvent?.data as { stopReason?: string })?.stopReason;
      expect(stopReason).not.toBe('end_turn');
    });

    it('should document max_tokens behavior', () => {
      // This test documents expected behavior: max_tokens means response was truncated
      const completeEvent = scenarioResult.events.find(e => e.type === 'complete');
      const stopReason = (completeEvent?.data as { stopReason?: string })?.stopReason;

      // When max_tokens is reached, the response is incomplete
      // This is different from end_turn which means natural completion
      expect(['max_tokens', 'length']).toContain(stopReason);
    });
  });

  // ============================================================================
  // SECTION 3: Truncated Response Tests
  // ============================================================================

  describe('Truncated Response', () => {
    it('should have assistant message (even if truncated)', () => {
      const assistantMessage = scenarioResult.dbMessages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.content).toBeTruthy();
    });

    it('should have message content that appears incomplete', () => {
      const assistantMessage = scenarioResult.dbMessages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();

      // Message should exist and have content
      // (We can't easily test if it's "incomplete" without knowing expected length)
      expect(assistantMessage?.content.length).toBeGreaterThan(0);
    });

    it('should NOT have error event (max_tokens is not an error)', () => {
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');
      expect(errorEvent).toBeUndefined();
    });

    it('should persist truncated message to database', () => {
      const assistantMessage = scenarioResult.dbMessages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.sessionId).toBe(scenarioResult.session.id);
    });
  });

  // ============================================================================
  // SECTION 4: Persistence Tests
  // ============================================================================

  describe('Persistence', () => {
    it('should persist messages to database', () => {
      expect(scenarioResult.dbMessages.length).toBeGreaterThan(0);
    });

    it('should persist user message', () => {
      const userMessage = scenarioResult.dbMessages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.sessionId).toBe(scenarioResult.session.id);
    });

    it('should persist assistant message (truncated)', () => {
      const assistantMessage = scenarioResult.dbMessages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.sessionId).toBe(scenarioResult.session.id);
    });

    it('should persist events to message_events table', () => {
      expect(scenarioResult.dbEvents.length).toBeGreaterThan(0);
    });

    it('should have all database events scoped to session', () => {
      for (const event of scenarioResult.dbEvents) {
        expect(event.sessionId).toBe(scenarioResult.session.id);
      }
    });

    it('should have valid timestamps on all database records', () => {
      for (const message of scenarioResult.dbMessages) {
        expect(message.createdAt).toBeInstanceOf(Date);
        expect(message.createdAt.getTime()).toBeGreaterThan(0);
      }

      for (const event of scenarioResult.dbEvents) {
        expect(event.createdAt).toBeInstanceOf(Date);
        expect(event.createdAt.getTime()).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================================
  // SECTION 5: Multi-Tenant Isolation Tests
  // ============================================================================

  describe('Multi-Tenant Isolation', () => {
    it('should scope all events to test user', () => {
      expect(scenarioResult.user.id).toBe(testUser.id);
    });

    it('should scope session to test user', () => {
      expect(scenarioResult.session).toBeDefined();
      const sessionUserId = (scenarioResult.session as { userId?: string; user_id?: string }).userId
        || (scenarioResult.session as { userId?: string; user_id?: string }).user_id;
      expect(sessionUserId).toBe(testUser.id);
    });

    it('should not have events from other sessions in database', () => {
      const foreignEvents = scenarioResult.dbEvents.filter(e =>
        e.sessionId !== scenarioResult.session.id
      );
      expect(foreignEvents.length).toBe(0);
    });
  });

  // ============================================================================
  // SECTION 6: Scenario Metadata Tests
  // ============================================================================

  describe('Scenario Metadata', () => {
    it('should have correct scenario ID', () => {
      expect(scenarioResult.scenarioId).toBe('max-tokens');
    });

    it('should have execution timestamp', () => {
      expect(scenarioResult.executedAt).toBeInstanceOf(Date);
      expect(scenarioResult.executedAt.getTime()).toBeGreaterThan(0);
    });

    it('should have positive duration', () => {
      expect(scenarioResult.durationMs).toBeGreaterThan(0);
    });

    it('should have no execution error', () => {
      expect(scenarioResult.error).toBeUndefined();
    });

    it('should document max_tokens is not an error condition', () => {
      // This test documents: max_tokens is a normal stop reason, not an error
      // The response is simply truncated but otherwise valid
      expect(scenarioResult.error).toBeUndefined();

      const errorEvent = scenarioResult.events.find(e => e.type === 'error');
      expect(errorEvent).toBeUndefined();
    });
  });
});
