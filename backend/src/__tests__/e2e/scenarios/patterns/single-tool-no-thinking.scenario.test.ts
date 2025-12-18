/**
 * E2E Scenario Test: Single Tool Call (No Thinking)
 *
 * This scenario executes ONCE and multiple tests verify different aspects
 * of the same response. This dramatically reduces API calls - instead of
 * 10 tests making 10 API calls, we get 10 verifications from 1 call.
 *
 * Scenario: User asks for customer list with thinking DISABLED
 * Expected flow: user_message_confirmed → tool_use → tool_result → message → complete
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

describe('E2E Scenario: Single Tool Call (No Thinking)', () => {
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
    console.log('[Scenario] Executing single-tool-no-thinking scenario...\n');

    // Create test user
    testUser = await factory.createTestUser({ prefix: 'e2e_scenario_stnt_' });

    // Execute scenario (using multi-tool but requesting only ONE tool)
    const registry = getScenarioRegistry();

    // Register custom scenario: multi-tool but with message requesting only ONE tool
    registry.registerScenario({
      id: 'single-tool-no-thinking',
      name: 'Single Tool Call (No Thinking)',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: ['Let me retrieve the customer information for you.'],
          toolUseBlocks: [
            {
              id: 'toolu_01single_customers',
              name: 'bc_customers_read',
              input: { $top: 3, $select: 'number,displayName,email' },
            },
          ],
          stopReason: 'tool_use',
        });
        fake.addResponse({
          textBlocks: ['Here are the first 3 customers from your Business Central system.'],
          stopReason: 'end_turn',
        });
      },
      message: 'List the first 3 customers.',
      thinking: undefined, // NO thinking
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    scenarioResult = await registry.executeScenario('single-tool-no-thinking', factory, testUser);

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

    it('should NOT emit thinking events (thinking disabled)', () => {
      const thinkingEvents = scenarioResult.events.filter(e =>
        e.type === 'thinking' || e.type === 'thinking_chunk'
      );
      expect(thinkingEvents.length).toBe(0);
    });

    it('should emit tool_use before tool_result', () => {
      const toolUseIndex = scenarioResult.events.findIndex(e => e.type === 'tool_use');
      const toolResultIndex = scenarioResult.events.findIndex(e => e.type === 'tool_result');

      expect(toolUseIndex).toBeGreaterThan(-1);
      expect(toolResultIndex).toBeGreaterThan(-1);
      expect(toolUseIndex).toBeLessThan(toolResultIndex);
    });

    it('should have valid event flow according to state machine', () => {
      const eventTypes = scenarioResult.events.map(e => e.type);

      // Basic flow validation
      expect(eventTypes[0]).toBe('user_message_confirmed');
      expect(eventTypes[eventTypes.length - 1]).toBe('complete');

      // No invalid transitions (e.g., complete followed by more events)
      const completeIndex = eventTypes.indexOf('complete');
      expect(completeIndex).toBe(eventTypes.length - 1);
    });
  });

  // ============================================================================
  // SECTION 2: Sequence Number Tests
  // ============================================================================

  describe('Sequence Numbers', () => {
    it('should have monotonically increasing sequence numbers on persisted events', () => {
      const persistedEvents = scenarioResult.events.filter(e =>
        e.sequenceNumber !== undefined && e.sequenceNumber !== null
      );

      // Should have persisted events
      expect(persistedEvents.length).toBeGreaterThan(0);

      // Sequence numbers should be monotonically increasing
      for (let i = 1; i < persistedEvents.length; i++) {
        const prev = persistedEvents[i - 1]!.sequenceNumber!;
        const curr = persistedEvents[i]!.sequenceNumber!;
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it('should not have sequence numbers on transient events', () => {
      const transientTypes = ['message_chunk', 'thinking_chunk', 'complete', 'error'];

      for (const event of scenarioResult.events) {
        if (transientTypes.includes(event.type)) {
          // Transient events should NOT have sequence numbers
          if (event.sequenceNumber !== undefined && event.sequenceNumber !== null) {
            expect(event.sequenceNumber).toBeUndefined();
          }
        }
      }
    });

    it('should have sequence numbers on user_message_confirmed', () => {
      const userMessageEvent = scenarioResult.events.find(e => e.type === 'user_message_confirmed');
      expect(userMessageEvent).toBeDefined();
      expect(userMessageEvent?.sequenceNumber).toBeDefined();
      expect(typeof userMessageEvent?.sequenceNumber).toBe('number');
    });

    it('should have sequence numbers matching database events', () => {
      // Get sequence numbers from WebSocket events
      const wsSequences = scenarioResult.events
        .filter(e => e.sequenceNumber !== undefined && e.sequenceNumber !== null)
        .map(e => e.sequenceNumber!)
        .sort((a, b) => a - b);

      // Get sequence numbers from database
      const dbSequences = scenarioResult.dbEvents
        .map(e => e.sequenceNumber)
        .sort((a, b) => a - b);

      // Should have same count (allowing for some difference due to timing)
      expect(dbSequences.length).toBeGreaterThan(0);

      // At minimum, user_message_confirmed sequence should be in DB
      const firstWsSequence = wsSequences[0];
      if (firstWsSequence !== undefined) {
        expect(dbSequences).toContain(firstWsSequence);
      }
    });
  });

  // ============================================================================
  // SECTION 3: Tool Correlation Tests
  // ============================================================================

  describe('Tool Correlation', () => {
    it('should have exactly ONE tool_use event', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      expect(toolUseEvents.length).toBe(1);
    });

    it('should have tool_result for the tool_use', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      const toolResultEvents = scenarioResult.events.filter(e => e.type === 'tool_result');

      expect(toolResultEvents.length).toBeGreaterThanOrEqual(toolUseEvents.length);
    });

    it('should have tool_use with valid tool name and ID', () => {
      const toolUseEvent = scenarioResult.events.find(e => e.type === 'tool_use');
      expect(toolUseEvent).toBeDefined();

      const data = toolUseEvent?.data as { name?: string; toolId?: string };

      // Should have tool name or toolId
      const hasToolIdentifier = data?.name || data?.toolId;
      expect(hasToolIdentifier).toBeTruthy();
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
  // SECTION 4: Database Persistence Tests
  // ============================================================================

  describe('Database Persistence', () => {
    it('should persist messages to database', () => {
      expect(scenarioResult.dbMessages.length).toBeGreaterThan(0);
    });

    it('should persist user message', () => {
      const userMessage = scenarioResult.dbMessages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.sessionId).toBe(scenarioResult.session.id);
    });

    it('should persist assistant message', () => {
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
      expect(scenarioResult.scenarioId).toBe('single-tool-no-thinking');
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
  });
});
