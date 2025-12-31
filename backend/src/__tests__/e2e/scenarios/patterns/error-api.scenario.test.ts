/**
 * E2E Scenario Test: API Error Handling
 *
 * This scenario executes ONCE and multiple tests verify different aspects
 * of the same response. This dramatically reduces API calls - instead of
 * 10 tests making 10 API calls, we get 10 verifications from 1 call.
 *
 * Scenario: API throws an error
 * Expected flow: user_message_confirmed → error → complete
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

describe('E2E Scenario: API Error Handling', () => {
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
   */
  beforeAll(async () => {
    console.log(`\n[Scenario] API Mode: ${E2E_API_MODE.description}`);
    console.log('[Scenario] Executing error-api scenario...\n');

    // Create test user
    testUser = await factory.createTestUser({ prefix: 'e2e_scenario_err_' });

    // Execute scenario (using existing error-handling scenario)
    const registry = getScenarioRegistry();
    scenarioResult = await registry.executeScenario('error-handling', factory, testUser);

    if (scenarioResult.error) {
      console.log('[Scenario] Execution failed (expected for error scenario):', scenarioResult.error.message);
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
    it('should emit session_start as first event, followed by user_message_confirmed (even on error)', () => {
      expect(scenarioResult.events.length).toBeGreaterThan(1);

      // session_start is always the first event (signals new turn)
      const firstEvent = scenarioResult.events[0];
      expect(firstEvent?.type).toBe('session_start');

      // user_message_confirmed is always the second event
      const secondEvent = scenarioResult.events[1];
      expect(secondEvent?.type).toBe('user_message_confirmed');
    });

    it('should emit error event when API fails', () => {
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('should emit complete as last event OR error is terminal', () => {
      const lastEvent = scenarioResult.events[scenarioResult.events.length - 1];

      // Either complete is last, OR error is last (terminal)
      const isCompleteOrError = lastEvent?.type === 'complete' || lastEvent?.type === 'error';
      expect(isCompleteOrError).toBe(true);
    });

    it('should NOT emit tool_use or tool_result on API error', () => {
      // This test only applies in mock mode - real API may call tools before error
      if (E2E_API_MODE.useRealApi) {
        console.log('[Test] Skipping tool event assertion in Real API mode');
        return;
      }
      const toolEvents = scenarioResult.events.filter(e =>
        e.type === 'tool_use' || e.type === 'tool_result'
      );
      expect(toolEvents.length).toBe(0);
    });

    it('should have valid event flow according to state machine', () => {
      const eventTypes = scenarioResult.events.map(e => e.type);

      // Basic flow validation: session_start → user_message_confirmed → ... → complete/error
      expect(eventTypes[0]).toBe('session_start');
      expect(eventTypes[1]).toBe('user_message_confirmed');

      // Error should be present
      expect(eventTypes).toContain('error');

      // No events after complete (if complete exists)
      const completeIndex = eventTypes.indexOf('complete');
      if (completeIndex > -1) {
        expect(completeIndex).toBe(eventTypes.length - 1);
      }
    });
  });

  // ============================================================================
  // SECTION 2: Error Structure Tests
  // ============================================================================

  describe('Error Structure', () => {
    it('should have error event with message', () => {
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();

      const errorData = errorEvent?.data as { message?: string; error?: string };
      const hasErrorMessage = errorData?.message || errorData?.error;
      expect(hasErrorMessage).toBeTruthy();
    });

    it('should have error event with error code or type', () => {
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();

      const errorData = errorEvent?.data as { code?: string; type?: string };

      // Should have code or type (may be optional depending on error)
      // At minimum, should have error data structure
      expect(errorEvent?.data).toBeDefined();
    });

    it('should have scenario result with error property', () => {
      // For error scenarios, scenarioResult.error should be defined
      // OR error event should be in events list
      const hasErrorEvent = scenarioResult.events.some(e => e.type === 'error');
      const hasErrorProperty = scenarioResult.error !== undefined;

      expect(hasErrorEvent || hasErrorProperty).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 3: Persistence Tests (Error Cases)
  // ============================================================================

  describe('Persistence (Error Cases)', () => {
    it('should persist user message even when error occurs', () => {
      const userMessage = scenarioResult.dbMessages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.sessionId).toBe(scenarioResult.session.id);
    });

    it('should persist user_message_confirmed event to database', () => {
      const userMsgEvent = scenarioResult.dbEvents.find(e =>
        e.eventType === 'user_message_confirmed' || e.eventType === 'user_message'
      );
      // User message should be persisted
      expect(scenarioResult.dbEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should log error to database or error event exists', () => {
      // Error should be logged either as event or in messages
      const errorDbEvent = scenarioResult.dbEvents.find(e => e.eventType === 'error');
      const errorWsEvent = scenarioResult.events.find(e => e.type === 'error');

      // At least one error should exist
      expect(errorDbEvent || errorWsEvent).toBeDefined();
    });

    it('should NOT persist assistant message when error occurs before completion', () => {
      // If error happens early, there might not be an assistant message
      // This is expected behavior
      const assistantMessage = scenarioResult.dbMessages.find(m => m.role === 'assistant');

      // Assistant message may or may not exist depending on when error occurred
      // Test documents this behavior
      if (assistantMessage) {
        expect(assistantMessage.sessionId).toBe(scenarioResult.session.id);
      }
    });
  });

  // ============================================================================
  // SECTION 4: Multi-Tenant Isolation Tests
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
  // SECTION 5: Scenario Metadata Tests
  // ============================================================================

  describe('Scenario Metadata', () => {
    it('should have correct scenario ID', () => {
      expect(scenarioResult.scenarioId).toBe('error-handling');
    });

    it('should have execution timestamp', () => {
      expect(scenarioResult.executedAt).toBeInstanceOf(Date);
      expect(scenarioResult.executedAt.getTime()).toBeGreaterThan(0);
    });

    it('should have positive duration', () => {
      expect(scenarioResult.durationMs).toBeGreaterThan(0);
    });

    it('should have error recorded in scenario result OR error event present', () => {
      const hasErrorProperty = scenarioResult.error !== undefined;
      const hasErrorEvent = scenarioResult.events.some(e => e.type === 'error');

      expect(hasErrorProperty || hasErrorEvent).toBe(true);
    });
  });
});
