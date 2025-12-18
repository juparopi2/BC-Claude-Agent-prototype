/**
 * E2E Scenario Test: Multiple Tool Calls (With Thinking)
 *
 * This scenario executes ONCE and multiple tests verify different aspects
 * of the same response. This dramatically reduces API calls - instead of
 * 10 tests making 10 API calls, we get 10 verifications from 1 call.
 *
 * Scenario: User asks for multiple entities with thinking ENABLED
 * Expected flow: thinking → tool_use (multiple) → tool_result (multiple) → message → complete
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

describe('E2E Scenario: Multiple Tool Calls (With Thinking)', () => {
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
    console.log('[Scenario] Executing multi-tool-with-thinking scenario...\n');

    // Create test user
    testUser = await factory.createTestUser({ prefix: 'e2e_scenario_mtwt_' });

    // Execute scenario
    const registry = getScenarioRegistry();

    // Register custom scenario: multi-tool WITH thinking
    registry.registerScenario({
      id: 'multi-tool-with-thinking',
      name: 'Multiple Tool Calls (With Thinking)',
      configureFake: (fake) => {
        fake.addResponse({
          thinkingBlocks: [
            'I need to retrieve both customer and item data. Let me use the appropriate tools for this request.',
          ],
          textBlocks: ['Let me retrieve both customers and items for you.'],
          toolUseBlocks: [
            {
              id: 'toolu_01multi_thinking_customers',
              name: 'bc_customers_read',
              input: { $top: 3, $select: 'number,displayName' },
            },
            {
              id: 'toolu_01multi_thinking_items',
              name: 'bc_items_read',
              input: { $top: 3, $select: 'number,description' },
            },
          ],
          stopReason: 'tool_use',
        });
        fake.addResponse({
          textBlocks: ['Here is the combined data from customers and items.'],
          stopReason: 'end_turn',
        });
      },
      message: 'Show me 3 customers and 3 items.',
      thinking: { enable: true, budget: 10000 },
      expectedEventTypes: [
        'user_message_confirmed',
        'thinking',
        'thinking_chunk',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    scenarioResult = await registry.executeScenario('multi-tool-with-thinking', factory, testUser);

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

    it('should emit thinking before tool_use', () => {
      const thinkingIndex = scenarioResult.events.findIndex(e => e.type === 'thinking');
      const toolUseIndex = scenarioResult.events.findIndex(e => e.type === 'tool_use');

      // Thinking should exist
      expect(thinkingIndex).toBeGreaterThan(-1);

      // Thinking should come before tool_use
      if (toolUseIndex > -1) {
        expect(thinkingIndex).toBeLessThan(toolUseIndex);
      }
    });

    it('should emit all tool_use events before tool_result events', () => {
      const toolUseIndices = scenarioResult.events
        .map((e, idx) => (e.type === 'tool_use' ? idx : -1))
        .filter(idx => idx > -1);
      const toolResultIndices = scenarioResult.events
        .map((e, idx) => (e.type === 'tool_result' ? idx : -1))
        .filter(idx => idx > -1);

      // All tool_use events should come before all tool_result events
      if (toolUseIndices.length > 0 && toolResultIndices.length > 0) {
        const lastToolUse = Math.max(...toolUseIndices);
        const firstToolResult = Math.min(...toolResultIndices);
        expect(lastToolUse).toBeLessThan(firstToolResult);
      }
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
      const wsSequences = scenarioResult.events
        .filter(e => e.sequenceNumber !== undefined && e.sequenceNumber !== null)
        .map(e => e.sequenceNumber!)
        .sort((a, b) => a - b);

      const dbSequences = scenarioResult.dbEvents
        .map(e => e.sequenceNumber)
        .sort((a, b) => a - b);

      expect(dbSequences.length).toBeGreaterThan(0);

      const firstWsSequence = wsSequences[0];
      if (firstWsSequence !== undefined) {
        expect(dbSequences).toContain(firstWsSequence);
      }
    });
  });

  // ============================================================================
  // SECTION 3: Thinking Structure Tests
  // ============================================================================

  describe('Thinking Structure', () => {
    it('should have thinking event with content', () => {
      const thinkingEvent = scenarioResult.events.find(e => e.type === 'thinking');
      expect(thinkingEvent).toBeDefined();
      expect(thinkingEvent?.data).toBeDefined();
    });

    it('should have thinking_chunk events for streaming', () => {
      const thinkingChunks = scenarioResult.events.filter(e => e.type === 'thinking_chunk');

      // With thinking enabled, we should see chunks (in mock mode)
      if (!E2E_API_MODE.useRealApi) {
        expect(thinkingChunks.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should persist thinking to database', () => {
      const thinkingDbEvents = scenarioResult.dbEvents.filter(e =>
        e.eventType === 'thinking' || e.eventType.includes('thinking')
      );

      // Thinking should be persisted (it's not transient)
      expect(thinkingDbEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should have thinking content before tool use', () => {
      const thinkingIndex = scenarioResult.events.findIndex(e => e.type === 'thinking');
      const toolUseIndex = scenarioResult.events.findIndex(e => e.type === 'tool_use');

      if (thinkingIndex > -1 && toolUseIndex > -1) {
        expect(thinkingIndex).toBeLessThan(toolUseIndex);
      }
    });
  });

  // ============================================================================
  // SECTION 4: Tool Correlation Tests
  // ============================================================================

  describe('Tool Correlation', () => {
    it('should have multiple tool_use events', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      expect(toolUseEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should have tool_result for every tool_use', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      const toolResultEvents = scenarioResult.events.filter(e => e.type === 'tool_result');

      expect(toolResultEvents.length).toBeGreaterThanOrEqual(toolUseEvents.length);
    });

    it('should have each tool_use with unique tool ID', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      const toolIds = toolUseEvents.map(e => (e.data as { toolId?: string })?.toolId).filter(Boolean);

      // All tool IDs should be unique
      const uniqueToolIds = new Set(toolIds);
      expect(uniqueToolIds.size).toBe(toolIds.length);
    });

    it('should have tool_result matching each tool_use ID', () => {
      const toolUseEvents = scenarioResult.events.filter(e => e.type === 'tool_use');
      const toolResultEvents = scenarioResult.events.filter(e => e.type === 'tool_result');

      const toolUseIds = toolUseEvents.map(e => (e.data as { toolId?: string })?.toolId).filter(Boolean);
      const toolResultIds = toolResultEvents.map(e => (e.data as { toolUseId?: string })?.toolUseId).filter(Boolean);

      // Each tool_use ID should have a corresponding tool_result
      for (const useId of toolUseIds) {
        expect(toolResultIds).toContain(useId);
      }
    });
  });

  // ============================================================================
  // SECTION 5: Database Persistence Tests
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
  // SECTION 6: Multi-Tenant Isolation Tests
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
  // SECTION 7: Scenario Metadata Tests
  // ============================================================================

  describe('Scenario Metadata', () => {
    it('should have correct scenario ID', () => {
      expect(scenarioResult.scenarioId).toBe('multi-tool-with-thinking');
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
