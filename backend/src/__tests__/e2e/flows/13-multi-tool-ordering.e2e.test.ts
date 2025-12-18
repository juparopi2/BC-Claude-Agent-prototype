/**
 * E2E-13: Multi-Tool Ordering Tests
 *
 * Verifies that when Claude requests multiple tools in one response,
 * the tool results appear in the correct order (matching Anthropic's
 * tool array order) regardless of how long each tool takes to execute.
 *
 * This test validates the Phase 4 fix: pre-assigned sequence numbers
 * via MessageOrderingService.reserveSequenceBatch()
 *
 * @module __tests__/e2e/flows/13-multi-tool-ordering.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest, drainMessageQueue } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  SequenceValidator,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import { TEST_TIMEOUTS } from '../../integration/helpers/constants';
import type { AgentEvent } from '@/types/websocket.types';
import { executeQuery } from '@/config/database';

describe('E2E-13: Multi-Tool Ordering', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_multitool_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Multi-Tool Ordering Test Session',
    });
  });

  afterAll(async () => {
    await drainMessageQueue();
    await factory.cleanup();
  });

  beforeEach(async () => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('Core: Multi-Tool Sequence Ordering', () => {
    it('should preserve tool_use sequence order when multiple tools are requested', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Multi-Tool Sequence Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Request that will likely trigger multiple tool calls
      // Using explicit sequential request to ensure multiple tools
      await client.sendMessage(
        freshSession.id,
        'First, get details for the "customers" entity. Then, get details for the "vendors" entity. Execute these as separate tool calls.'
      );

      const events = await client.collectEvents(200, {
        timeout: 90000,
        stopOnEventType: 'complete',
      });

      // Get all events as AgentEvent
      const agentEvents = events.filter(e => e && typeof e === 'object' && 'type' in e) as AgentEvent[];

      // Use the new multi-tool ordering validator
      const validation = SequenceValidator.validateMultiToolOrdering(agentEvents);

      console.log('Multi-Tool Ordering Validation:', {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        toolUseSequences: validation.toolUseSequences,
        toolResultSequences: validation.toolResultSequences,
        ordering: validation.ordering,
      });

      // If we got multiple tools, validate ordering
      if (validation.toolUseSequences.length > 1) {
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);

        // Verify sequences are monotonically increasing
        for (let i = 1; i < validation.toolUseSequences.length; i++) {
          const prev = validation.toolUseSequences[i - 1];
          const curr = validation.toolUseSequences[i];
          expect(curr).toBeGreaterThan(prev!);
        }

        for (let i = 1; i < validation.toolResultSequences.length; i++) {
          const prev = validation.toolResultSequences[i - 1];
          const curr = validation.toolResultSequences[i];
          expect(curr).toBeGreaterThan(prev!);
        }
      }

      // Should complete regardless
      const hasComplete = events.some(e => e.type === 'complete');
      expect(hasComplete).toBe(true);
    });

    it('should maintain tool_result order matching tool_use order', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Tool Order Match Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Request multiple operations that will use different tools
      await client.sendMessage(
        freshSession.id,
        'I need you to: 1) Search for operations related to "customers", and 2) Get entity details for "items". Do both.'
      );

      const events = await client.collectEvents(200, {
        timeout: 90000,
        stopOnEventType: 'complete',
      });

      const agentEvents = events.filter(e => e && typeof e === 'object' && 'type' in e) as AgentEvent[];

      // Extract tool events
      const toolUseEvents = agentEvents.filter(e => e.type === 'tool_use');
      const toolResultEvents = agentEvents.filter(e => e.type === 'tool_result');

      console.log('Tool Events:', {
        toolUseCount: toolUseEvents.length,
        toolResultCount: toolResultEvents.length,
        toolUseIds: toolUseEvents.map(e => (e as AgentEvent & { toolUseId?: string }).toolUseId),
        toolResultIds: toolResultEvents.map(e => (e as AgentEvent & { toolUseId?: string }).toolUseId),
      });

      // If multiple tools were called, use the comprehensive validator
      if (toolUseEvents.length > 1) {
        const validation = SequenceValidator.validateMultiToolOrdering(agentEvents);

        console.log('Multi-Tool Order Match Validation:', {
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings,
          ordering: validation.ordering,
        });

        // The validator checks:
        // 1. tool_use events are in monotonically increasing sequence order
        // 2. tool_result events are in monotonically increasing sequence order
        // 3. Each tool_result comes after its corresponding tool_use
        // 4. The tool_result order matches the tool_use order by toolUseId
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);

        // Verify each tool_result sequence > its tool_use sequence
        for (const order of validation.ordering) {
          expect(order.toolResultSeq).toBeGreaterThan(order.toolUseSeq);
        }
      }
    });
  });

  describe('Core: Sequence Pre-Assignment Validation', () => {
    it('should have consecutive sequence numbers for tool results', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Consecutive Sequence Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Request multiple tools
      await client.sendMessage(
        freshSession.id,
        'Get entity details for customers, then get entity details for vendors.'
      );

      const events = await client.collectEvents(200, {
        timeout: 90000,
        stopOnEventType: 'complete',
      });

      const agentEvents = events.filter(e => e && typeof e === 'object' && 'type' in e) as AgentEvent[];

      // Get all persisted events with sequence numbers
      const persistedEvents = agentEvents
        .filter(e => (e as AgentEvent & { sequenceNumber?: number }).sequenceNumber !== undefined)
        .sort((a, b) => {
          const seqA = (a as AgentEvent & { sequenceNumber?: number }).sequenceNumber ?? 0;
          const seqB = (b as AgentEvent & { sequenceNumber?: number }).sequenceNumber ?? 0;
          return seqA - seqB;
        });

      // Validate overall sequence order
      const validation = SequenceValidator.validateSequenceOrder(persistedEvents);
      expect(validation.valid).toBe(true);

      // Log sequence summary for debugging
      const summary = SequenceValidator.getEventSummary(persistedEvents);
      console.log('Event Sequence Summary:', summary);
    });

    it('should persist tool events to database in correct order', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'DB Order Verification Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(
        freshSession.id,
        'Search for operations related to sales orders, then get entity details for items.'
      );

      await client.waitForAgentEvent('complete', { timeout: 90000 });

      // Wait for async persistence
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.EVENT_WAIT));

      // Query database for tool events
      const dbResult = await executeQuery<{
        id: string;
        event_type: string;
        sequence_number: number;
        data: string;
        timestamp: Date;
      }>(
        `SELECT id, event_type, sequence_number, data, timestamp
         FROM message_events
         WHERE session_id = @sessionId
         AND event_type IN ('tool_use_started', 'tool_use_completed')
         ORDER BY sequence_number ASC`,
        { sessionId: freshSession.id }
      );

      const toolEvents = dbResult.recordset.map(row => ({
        id: row.id,
        event_type: row.event_type,
        sequence_number: row.sequence_number,
        data: row.data ? JSON.parse(row.data) : {},
        timestamp: row.timestamp,
      }));

      console.log('Database Tool Events:', toolEvents.map(e => ({
        event_type: e.event_type,
        sequence_number: e.sequence_number,
        tool_name: e.data?.tool_name || e.data?.toolName,
      })));

      // Verify database sequence numbers are consecutive
      for (let i = 1; i < toolEvents.length; i++) {
        const prev = toolEvents[i - 1];
        const curr = toolEvents[i];
        if (prev && curr) {
          expect(curr.sequence_number).toBeGreaterThan(prev.sequence_number);
        }
      }
    });
  });

  describe('Edge Cases: Ordering Under Load', () => {
    it('should maintain ordering when tools have different execution times', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Varying Execution Time Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Request multiple tools that may have different execution times
      // Note: In the actual BC agent, tool execution times vary based on
      // API response time, but with vendored tools, times are more consistent.
      // This test validates the pre-assignment mechanism works regardless.
      await client.sendMessage(
        freshSession.id,
        'I need information about three different entities. ' +
        'First get details about customers, then about vendors, then about items.'
      );

      const events = await client.collectEvents(300, {
        timeout: 120000,
        stopOnEventType: 'complete',
      });

      const agentEvents = events.filter(e => e && typeof e === 'object' && 'type' in e) as AgentEvent[];
      const validation = SequenceValidator.validateMultiToolOrdering(agentEvents);

      console.log('Ordering Under Load:', {
        toolCount: validation.toolUseSequences.length,
        ordering: validation.ordering,
        valid: validation.valid,
        errors: validation.errors,
      });

      // If multiple tools executed, validate ordering preserved
      if (validation.toolUseSequences.length >= 2) {
        expect(validation.valid).toBe(true);

        // Verify each tool_result comes after its corresponding tool_use
        for (const order of validation.ordering) {
          expect(order.toolResultSeq).toBeGreaterThan(order.toolUseSeq);
        }
      }
    });
  });

  describe('Database Source of Truth Verification', () => {
    it('should match WebSocket events with database events for tool ordering', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'WS-DB Consistency Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(
        freshSession.id,
        'Get entity details for customers, then search for vendor operations.'
      );

      await client.waitForAgentEvent('complete', { timeout: 90000 });

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUTS.EVENT_WAIT));

      // Get WebSocket events
      const wsEvents = client.getReceivedEvents()
        .filter(e => e.data != null && typeof e.data === 'object' && 'type' in e.data)
        .map(e => e.data as AgentEvent & { sequenceNumber?: number; eventId?: string })
        .filter(e => e.type === 'tool_use' || e.type === 'tool_result');

      // Get database events
      const dbResult = await executeQuery<{
        id: string;
        event_type: string;
        sequence_number: number;
        data: string;
      }>(
        `SELECT id, event_type, sequence_number, data
         FROM message_events
         WHERE session_id = @sessionId
         ORDER BY sequence_number ASC`,
        { sessionId: freshSession.id }
      );

      const dbEvents = dbResult.recordset.map(row => ({
        id: row.id,
        event_type: row.event_type,
        sequence_number: row.sequence_number,
      }));

      // Compare using the validator
      const comparison = SequenceValidator.compareWebSocketWithDatabase(
        wsEvents as AgentEvent[],
        dbEvents
      );

      console.log('WS-DB Comparison:', {
        matched: comparison.matched,
        wsOnly: comparison.wsOnly.length,
        dbOnly: comparison.dbOnly.length,
        sequenceMismatches: comparison.sequenceMismatches.length,
      });

      // Sequence mismatches indicate ordering bugs
      expect(comparison.sequenceMismatches).toHaveLength(0);
    });
  });

  describe('Integration: Full Turn with Multiple Tools', () => {
    it('should complete a full conversation turn with multiple tools in correct order', async () => {
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Full Turn Integration Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      // Complex request that requires multiple tool calls
      await client.sendMessage(
        freshSession.id,
        'Help me understand Business Central better. ' +
        'First, search for customer-related operations. ' +
        'Then, get the entity details for "customers". ' +
        'Finally, search for item operations.'
      );

      const events = await client.collectEvents(400, {
        timeout: 180000,
        stopOnEventType: 'complete',
      });

      const agentEvents = events.filter(e => e && typeof e === 'object' && 'type' in e) as AgentEvent[];

      // Validate complete flow
      const sequenceValidation = SequenceValidator.validateSequenceOrder(agentEvents);
      const toolValidation = SequenceValidator.validateMultiToolOrdering(agentEvents);
      const correlationValidation = SequenceValidator.validateToolCorrelation(agentEvents);

      console.log('Full Turn Integration:', {
        eventCount: agentEvents.length,
        toolCount: toolValidation.toolUseSequences.length,
        sequenceValid: sequenceValidation.valid,
        toolOrderValid: toolValidation.valid,
        correlationValid: correlationValidation.valid,
      });

      // All validations should pass
      expect(sequenceValidation.valid).toBe(true);
      expect(correlationValidation.valid).toBe(true);

      // If multiple tools used, ordering should be valid
      if (toolValidation.toolUseSequences.length > 1) {
        expect(toolValidation.valid).toBe(true);
      }

      // Should have completed
      const completeEvent = agentEvents.find(e => e.type === 'complete');
      expect(completeEvent).toBeDefined();
    });
  });
});
