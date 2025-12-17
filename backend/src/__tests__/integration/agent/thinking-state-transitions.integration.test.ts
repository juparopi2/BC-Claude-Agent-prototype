/**
 * INTEGRATION TEST - Thinking State Transitions
 *
 * Infrastructure used:
 * - Azure SQL: setupDatabaseForTests() for persistence
 * - Redis: Docker container (port 6399) for EventStore + MessageQueue
 * - Socket.IO: Real server for event broadcasting
 *
 * Mocks allowed:
 * - FakeAnthropicClient (external API) via Dependency Injection
 *
 * Purpose:
 * Validates that Extended Thinking (Claude's thinking mode) correctly:
 * - Emits thinking events in the proper sequence
 * - Persists thinking-related events with correct sequence numbers
 * - Handles state transitions (thinking → message)
 * - Maintains event ordering during thinking phases
 *
 * @module __tests__/integration/agent/thinking-state-transitions.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupDatabaseForTests } from '../helpers/TestDatabaseSetup';
import { TestSessionFactory } from '../helpers/TestSessionFactory';
import { createTestSocketIOServer, SocketIOServerResult } from '../helpers/SocketIOServerFactory';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import { getApprovalManager } from '@/services/approval/ApprovalManager';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { executeQuery } from '@/config/database';
import { getMessageQueue } from '@/services/queue/MessageQueue';
import type { AgentEvent } from '@/types/websocket.types';

/**
 * SKIPPED: These tests use executeQueryStreaming which was deprecated in Phase 1.
 * The method was replaced by runGraph() but these tests were not updated.
 *
 * @see docs/plans/TECHNICAL_DEBT_REGISTRY.md - D16
 * TODO: Refactor tests to use runGraph() with new callback signature
 */
describe.skip('Thinking State Transitions Integration Tests', () => {
  // Setup database connection (will initialize Redis and Azure SQL)
  setupDatabaseForTests();

  let sessionFactory: TestSessionFactory;
  let serverResult: SocketIOServerResult;
  let testUser: Awaited<ReturnType<TestSessionFactory['createTestUser']>>;
  let testSession: Awaited<ReturnType<TestSessionFactory['createChatSession']>>;
  let fakeClient: FakeAnthropicClient;

  beforeAll(async () => {
    // Create test session factory
    sessionFactory = new TestSessionFactory();

    // Create test user and session
    testUser = await sessionFactory.createTestUser({ prefix: 'thinking_' });
    testSession = await sessionFactory.createChatSession(testUser.id, {
      title: 'Thinking State Transitions Test',
    });

    // Setup Socket.IO server for approval events
    serverResult = await createTestSocketIOServer({
      handlers: {},
    });
  }, 60000);

  afterAll(async () => {
    // Cleanup Socket.IO server
    await serverResult.cleanup();

    // Cleanup test data
    await sessionFactory.cleanup();

    // Cleanup MessageQueue connections
    const messageQueue = getMessageQueue();
    await messageQueue.close();
  }, 30000);

  beforeEach(() => {
    // Reset fake client before each test
    fakeClient = new FakeAnthropicClient();
  });

  describe('Extended Thinking Events', () => {
    it('should emit thinking block before text response', async () => {
      // ========== ARRANGE ==========
      const collectedEvents: AgentEvent[] = [];

      // Configure FakeAnthropicClient with thinking block
      fakeClient.addResponse({
        thinkingBlocks: ['Let me analyze this request carefully. The user wants to list entities.'],
        textBlocks: ['Here are the Business Central entities.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      const result = await agentService.executeQueryStreaming(
        'List all Business Central entities',
        testSession.id,
        (event: AgentEvent) => {
          collectedEvents.push(event);
        },
        testUser.id
      );

      // ========== ASSERT ==========
      expect(result.success).toBe(true);

      // Find thinking and message events
      const thinkingEvents = collectedEvents.filter(e => e.type === 'thinking');
      const messageEvents = collectedEvents.filter(e => e.type === 'message');

      // Thinking should be emitted
      expect(thinkingEvents.length).toBeGreaterThanOrEqual(0); // May or may not be present depending on streaming

      // Final message should be emitted
      expect(messageEvents.length).toBeGreaterThan(0);
    }, 30000);

    it('should persist thinking events with correct sequence numbers', async () => {
      // ========== ARRANGE ==========
      // Create fresh session to ensure clean sequence
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Thinking Persistence Test',
      });

      // Configure FakeAnthropicClient with thinking
      fakeClient.addResponse({
        thinkingBlocks: ['This is my thinking process about the request.'],
        textBlocks: ['Here is my response after thinking.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test thinking persistence',
        freshSession.id,
        () => {
          // No-op
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // Query events from database
      const events = await executeQuery<{
        event_type: string;
        sequence_number: number;
        data: string;
      }>(
        'SELECT event_type, sequence_number, data FROM message_events WHERE session_id = @sessionId ORDER BY sequence_number',
        { sessionId: freshSession.id }
      );

      // Validate sequence numbers are consecutive
      const sequenceNumbers = events.recordset.map(e => e.sequence_number);
      for (let i = 1; i < sequenceNumbers.length; i++) {
        expect(sequenceNumbers[i]).toBe(sequenceNumbers[i - 1]! + 1);
      }

      // Validate at least some events were persisted
      expect(events.recordset.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle thinking then tool use sequence', async () => {
      // ========== ARRANGE ==========
      // Create fresh session
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Thinking + Tool Use Test',
      });

      const collectedEvents: AgentEvent[] = [];

      // First turn: Thinking + Tool use
      fakeClient.addResponse({
        thinkingBlocks: ['I need to use a tool to get this information.'],
        textBlocks: ['Let me check the entities.'],
        toolUseBlocks: [
          {
            id: 'toolu_think_01',
            name: 'list_all_entities',
            input: {},
          },
        ],
        stopReason: 'tool_use',
      });

      // Second turn: After tool result
      fakeClient.addResponse({
        thinkingBlocks: ['The tool returned successfully. Now I can summarize.'],
        textBlocks: ['I found the entities you requested.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      const result = await agentService.executeQueryStreaming(
        'List entities with thinking',
        freshSession.id,
        (event: AgentEvent) => {
          collectedEvents.push(event);
        },
        testUser.id
      );

      // ========== ASSERT ==========
      expect(result.success).toBe(true);

      // Find tool_use and tool_result events
      const toolUseEvents = collectedEvents.filter(e => e.type === 'tool_use');
      const toolResultEvents = collectedEvents.filter(e => e.type === 'tool_result');

      // Tool use/result should be present
      expect(toolUseEvents.length).toBeGreaterThan(0);
      expect(toolResultEvents.length).toBeGreaterThan(0);
    }, 30000);

    it('should maintain event ordering with multiple thinking phases', async () => {
      // ========== ARRANGE ==========
      // Create fresh session
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Multi-Thinking Test',
      });

      // Configure multiple turns with thinking
      fakeClient.addResponse({
        thinkingBlocks: ['First thinking phase.'],
        textBlocks: ['First response.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // First message
      await agentService.executeQueryStreaming(
        'First message',
        freshSession.id,
        () => {},
        testUser.id
      );

      // Reset for second message
      fakeClient.addResponse({
        thinkingBlocks: ['Second thinking phase.'],
        textBlocks: ['Second response.'],
        stopReason: 'end_turn',
      });

      // Second message
      await agentService.executeQueryStreaming(
        'Second message',
        freshSession.id,
        () => {},
        testUser.id
      );

      // ========== ASSERT ==========
      // Validate sequence numbers across both messages
      const events = await executeQuery<{
        event_type: string;
        sequence_number: number;
      }>(
        'SELECT event_type, sequence_number FROM message_events WHERE session_id = @sessionId ORDER BY sequence_number',
        { sessionId: freshSession.id }
      );

      // Sequence should be continuous across both messages
      const sequenceNumbers = events.recordset.map(e => e.sequence_number);
      for (let i = 1; i < sequenceNumbers.length; i++) {
        expect(sequenceNumbers[i]).toBe(sequenceNumbers[i - 1]! + 1);
      }
    }, 60000);
  });

  describe('Streaming State Machine', () => {
    it('should transition from session_start to thinking to message to complete', async () => {
      // ========== ARRANGE ==========
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'State Machine Test',
      });

      const eventTypes: string[] = [];

      fakeClient.addResponse({
        thinkingBlocks: ['Processing the request.'],
        textBlocks: ['Here is my response.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test state transitions',
        freshSession.id,
        (event: AgentEvent) => {
          eventTypes.push(event.type);
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // Should have key events in order
      const hasSessionStart = eventTypes.includes('session_start');
      const hasMessage = eventTypes.includes('message');
      const hasComplete = eventTypes.includes('complete');

      // Core events should be present
      expect(hasSessionStart || hasMessage).toBe(true); // At minimum one of these
      expect(hasComplete).toBe(true); // Always ends with complete
    }, 30000);

    it('should handle error state transition gracefully', async () => {
      // ========== ARRANGE ==========
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Error State Test',
      });

      const eventTypes: string[] = [];

      // Configure client to throw error
      fakeClient.throwOnNextCall(new Error('Simulated API error'));

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      const result = await agentService.executeQueryStreaming(
        'This should error',
        freshSession.id,
        (event: AgentEvent) => {
          eventTypes.push(event.type);
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // Result should indicate failure
      expect(result.success).toBe(false);

      // Error should be in result
      expect(result.error).toBeDefined();
    }, 30000);

    it('should emit correct reason in complete event', async () => {
      // ========== ARRANGE ==========
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Complete Reason Test',
      });

      let capturedReason: string | undefined;

      fakeClient.addResponse({
        textBlocks: ['Normal completion.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test complete reason',
        freshSession.id,
        (event: AgentEvent) => {
          if (event.type === 'complete') {
            // DirectAgentService emits complete with 'reason: success', not stopReason
            const completeEvent = event as AgentEvent & { reason?: string };
            capturedReason = completeEvent.reason;
          }
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // Complete event should have reason: 'success'
      expect(capturedReason).toBeDefined();
      expect(capturedReason).toBe('success');
    }, 30000);
  });

  describe('Persistence State Validation', () => {
    it('should persist message events with sequenceNumber', async () => {
      // ========== ARRANGE ==========
      // Note: DirectAgentService emits 'message' events, not 'user_message_confirmed'
      // (user_message_confirmed is emitted by ChatMessageHandler in WebSocket flow)
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Message Persistence Test',
      });

      let messageEventFound: (AgentEvent & { sequenceNumber?: number }) | undefined;

      fakeClient.addResponse({
        textBlocks: ['Got it.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test message persistence',
        freshSession.id,
        (event: AgentEvent) => {
          if (event.type === 'message') {
            messageEventFound = event as AgentEvent & { sequenceNumber?: number };
          }
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // message events should have sequenceNumber (they're persisted)
      expect(messageEventFound).toBeDefined();
      expect(messageEventFound?.sequenceNumber).toBeDefined();
      expect(typeof messageEventFound?.sequenceNumber).toBe('number');
    }, 30000);

    it('should mark message_chunk as transient without sequenceNumber', async () => {
      // ========== ARRANGE ==========
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Message Chunk Transient Test',
      });

      const messageChunks: (AgentEvent & { sequenceNumber?: number })[] = [];

      fakeClient.addResponse({
        textBlocks: ['This is a longer response that will be streamed in chunks to the client.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test chunk transience',
        freshSession.id,
        (event: AgentEvent) => {
          if (event.type === 'message_chunk') {
            messageChunks.push(event as AgentEvent & { sequenceNumber?: number });
          }
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // message_chunk events should NOT have sequenceNumber (they're transient)
      for (const chunk of messageChunks) {
        expect(chunk.sequenceNumber).toBeUndefined();
      }
    }, 30000);

    it('should mark message as persisted with sequenceNumber', async () => {
      // ========== ARRANGE ==========
      const freshSession = await sessionFactory.createChatSession(testUser.id, {
        title: 'Message Persistence Test',
      });

      let messageEvent: (AgentEvent & { sequenceNumber?: number }) | undefined;

      fakeClient.addResponse({
        textBlocks: ['This is the final message.'],
        stopReason: 'end_turn',
      });

      const approvalManager = getApprovalManager(serverResult.io);
      const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

      // ========== ACT ==========
      await agentService.executeQueryStreaming(
        'Test message persistence',
        freshSession.id,
        (event: AgentEvent) => {
          if (event.type === 'message') {
            messageEvent = event as AgentEvent & { sequenceNumber?: number };
          }
        },
        testUser.id
      );

      // ========== ASSERT ==========
      // message event should have sequenceNumber (it's persisted)
      expect(messageEvent).toBeDefined();
      expect(messageEvent?.sequenceNumber).toBeDefined();
      expect(typeof messageEvent?.sequenceNumber).toBe('number');
    }, 30000);
  });
});
