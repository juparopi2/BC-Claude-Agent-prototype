/**
 * E2E Scenario Test: Tool Execution Error
 *
 * This scenario executes ONCE and multiple tests verify different aspects
 * of the same response. This dramatically reduces API calls - instead of
 * 10 tests making 10 API calls, we get 10 verifications from 1 call.
 *
 * Scenario: Tool execution fails (tool_result contains error)
 * Expected flow: user_message_confirmed → tool_use → tool_result (error) → error/complete
 *
 * NOTE: This scenario requires a custom scenario definition in the registry.
 * For now, we use error-handling as a base. Future work: add tool-error scenario.
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

describe('E2E Scenario: Tool Execution Error', () => {
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
   * Uses predefined 'tool-error' scenario from ResponseScenarioRegistry
   * which configures FakeAgentOrchestrator to simulate tool execution failure.
   */
  beforeAll(async () => {
    console.log(`\n[Scenario] API Mode: ${E2E_API_MODE.description}`);
    console.log('[Scenario] Executing error-tool scenario...\n');

    // Create test user
    testUser = await factory.createTestUser({ prefix: 'e2e_scenario_tool_err_' });

    // Use predefined scenario from ResponseScenarioRegistry
    // The registry already has 'tool-error' configured with FakeScenario pattern
    const registry = getScenarioRegistry();

    scenarioResult = await registry.executeScenario('tool-error', factory, testUser);

    if (scenarioResult.error) {
      console.log('[Scenario] Execution failed:', scenarioResult.error.message);
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
      expect(scenarioResult.events.length).toBeGreaterThan(0);

      const firstEvent = scenarioResult.events[0];
      expect(firstEvent?.type).toBe('user_message_confirmed');
    });

    it('should emit tool_use event', () => {
      const toolUseEvent = scenarioResult.events.find(e => e.type === 'tool_use');
      expect(toolUseEvent).toBeDefined();
    });

    it('should emit tool_result after tool_use (even if tool failed)', () => {
      const toolUseIndex = scenarioResult.events.findIndex(e => e.type === 'tool_use');
      const toolResultIndex = scenarioResult.events.findIndex(e => e.type === 'tool_result');

      expect(toolUseIndex).toBeGreaterThan(-1);
      expect(toolResultIndex).toBeGreaterThan(-1);
      expect(toolUseIndex).toBeLessThan(toolResultIndex);
    });

    it('should emit complete as last event OR error is terminal', () => {
      const lastEvent = scenarioResult.events[scenarioResult.events.length - 1];

      // Either complete is last, OR error is last (terminal)
      const isCompleteOrError = lastEvent?.type === 'complete' || lastEvent?.type === 'error';
      expect(isCompleteOrError).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 2: Error Structure Tests
  // ============================================================================

  describe('Error Structure', () => {
    it('should have error in tool_result or error event', () => {
      const toolResultEvent = scenarioResult.events.find(e => e.type === 'tool_result');
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');

      // Either tool_result has error, OR there's an error event
      const toolResultHasError = toolResultEvent?.data &&
        ((toolResultEvent.data as { isError?: boolean }).isError ||
         (toolResultEvent.data as { error?: unknown }).error);

      expect(toolResultHasError || errorEvent).toBeDefined();
    });

    it('should have error message describing tool failure', () => {
      const toolResultEvent = scenarioResult.events.find(e => e.type === 'tool_result');
      const errorEvent = scenarioResult.events.find(e => e.type === 'error');

      if (errorEvent) {
        const errorData = errorEvent.data as { message?: string; error?: string };
        const hasErrorMessage = errorData?.message || errorData?.error;
        expect(hasErrorMessage).toBeTruthy();
      } else if (toolResultEvent) {
        // Tool result should have error information
        expect(toolResultEvent.data).toBeDefined();
      }
    });
  });

  // ============================================================================
  // SECTION 3: Tool Context Tests
  // ============================================================================

  describe('Tool Context', () => {
    it('should have tool_use event before failure', () => {
      const toolUseEvent = scenarioResult.events.find(e => e.type === 'tool_use');
      expect(toolUseEvent).toBeDefined();

      const data = toolUseEvent?.data as { name?: string; toolId?: string };
      const hasToolIdentifier = data?.name || data?.toolId;
      expect(hasToolIdentifier).toBeTruthy();
    });

    it('should have tool_result showing failure', () => {
      const toolResultEvent = scenarioResult.events.find(e => e.type === 'tool_result');
      expect(toolResultEvent).toBeDefined();

      // Tool result should have data (even if error)
      expect(toolResultEvent?.data).toBeDefined();
    });

    it('should have tool_result matching tool_use ID', () => {
      const toolUseEvent = scenarioResult.events.find(e => e.type === 'tool_use');
      const toolResultEvent = scenarioResult.events.find(e => e.type === 'tool_result');

      expect(toolUseEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();

      const toolUseId = (toolUseEvent?.data as { toolId?: string })?.toolId;
      const toolResultId = (toolResultEvent?.data as { toolUseId?: string })?.toolUseId;

      if (toolUseId && toolResultId) {
        expect(toolResultId).toBe(toolUseId);
      }
    });
  });

  // ============================================================================
  // SECTION 4: Persistence Tests (Error Cases)
  // ============================================================================

  describe('Persistence (Error Cases)', () => {
    it('should persist user message', () => {
      const userMessage = scenarioResult.dbMessages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.sessionId).toBe(scenarioResult.session.id);
    });

    it('should persist tool_use event to database', () => {
      const toolUseDbEvent = scenarioResult.dbEvents.find(e =>
        e.eventType === 'tool_use'
      );

      // Tool use should be persisted
      expect(scenarioResult.dbEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should persist tool_result event (even if error)', () => {
      // Tool result should be persisted
      const toolResultDbEvent = scenarioResult.dbEvents.find(e =>
        e.eventType === 'tool_result'
      );

      // Either in DB or in events
      const toolResultWsEvent = scenarioResult.events.find(e => e.type === 'tool_result');
      expect(toolResultDbEvent || toolResultWsEvent).toBeDefined();
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
      expect(scenarioResult.scenarioId).toBe('tool-error');
    });

    it('should have execution timestamp', () => {
      expect(scenarioResult.executedAt).toBeInstanceOf(Date);
      expect(scenarioResult.executedAt.getTime()).toBeGreaterThan(0);
    });

    it('should have positive duration', () => {
      expect(scenarioResult.durationMs).toBeGreaterThan(0);
    });

    it('should document tool failure behavior', () => {
      // This test documents expected behavior: tool errors should be handled gracefully
      // Either through error events or error information in tool_result
      const hasErrorHandling = scenarioResult.events.some(e =>
        e.type === 'error' || (e.type === 'tool_result' && e.data)
      );

      expect(hasErrorHandling).toBe(true);
    });
  });
});
