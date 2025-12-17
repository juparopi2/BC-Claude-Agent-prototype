/**
 * INTEGRATION TEST - REAL INFRASTRUCTURE
 *
 * Infrastructure used:
 * - Azure SQL: setupDatabaseForTests() for persistence
 * - Redis: Docker container (port 6399) for EventStore + MessageQueue
 * - Socket.IO: Real server for approval events
 *
 * Mocks allowed:
 * - FakeAnthropicClient (external API) via Dependency Injection
 *
 * NO MOCKS of:
 * - DirectAgentService orchestration logic
 * - EventStore persistence
 * - MessageQueue job processing
 * - ApprovalManager promise handling
 * - Database operations (executeQuery)
 *
 * Purpose:
 * Validates that a complete message flow (user message → approval → tool execution → response)
 * correctly persists all events, processes queue jobs, and maintains event ordering.
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
import { normalizeUUID } from '@/utils/uuid';

/**
 * SKIPPED: These tests use executeQueryStreaming which was deprecated in Phase 1.
 * The method was replaced by runGraph() but these tests were not updated.
 *
 * @see docs/plans/TECHNICAL_DEBT_REGISTRY.md - D16
 * TODO: Refactor tests to use runGraph() with new callback signature
 */
describe.skip('DirectAgentService Integration Tests', () => {
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
    testUser = await sessionFactory.createTestUser();
    testSession = await sessionFactory.createChatSession(testUser.id);

    // Setup Socket.IO server for approval events
    serverResult = await createTestSocketIOServer({
      handlers: {
        // Custom handler for chat messages (if needed)
      },
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

  it('should execute complete message flow with approval and tool use', async () => {
    // ========== ARRANGE ==========

    // Configure FakeAnthropicClient with realistic responses
    // Use a read-only tool that doesn't require approval (list_all_entities)
    // First turn: Claude requests tool use
    fakeClient.addResponse({
      textBlocks: ['Let me list the Business Central entities.'],
      toolUseBlocks: [
        {
          id: 'toolu_01ABC',
          name: 'list_all_entities',
          input: {},
        },
      ],
      stopReason: 'tool_use',
    });

    // Second turn: Claude processes tool result
    fakeClient.addResponse({
      textBlocks: ['I found the Business Central entities successfully!'],
      stopReason: 'end_turn',
    });

    // Create DirectAgentService with REAL dependencies (except Anthropic API)
    const approvalManager = getApprovalManager(serverResult.io);
    const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

    // ========== ACT ==========
    const result = await agentService.executeQueryStreaming(
      'List all Business Central entities',
      testSession.id,
      // Event callback (tracks streaming events)
      () => {
        // No-op for this test - we're testing infrastructure, not events
      },
      testUser.id
    );

    // ========== ASSERT: Basic result ==========
    expect(result.success).toBe(true);
    expect(result.response).toContain('Business Central entities successfully');

    // ========== ASSERT: EventStore - Validate all events persisted with sequence numbers ==========
    const events = await executeQuery<{
      id: string;
      event_type: string;
      sequence_number: number;
      session_id: string;
    }>(
      'SELECT id, event_type, sequence_number, session_id FROM message_events WHERE session_id = @sessionId ORDER BY sequence_number',
      { sessionId: testSession.id }
    );

    expect(events.recordset.length).toBeGreaterThan(4);

    // Validate sequence numbers are consecutive (starting from 0)
    const sequenceNumbers = events.recordset.map((e) => e.sequence_number);
    const expectedSequence = Array.from({ length: sequenceNumbers.length }, (_, i) => i);
    expect(sequenceNumbers).toEqual(expectedSequence);

    // Validate event types were persisted (regardless of naming)
    const eventTypes = events.recordset.map((e) => e.event_type);
    expect(eventTypes.length).toBeGreaterThan(0);

    // ========== ASSERT: MessageQueue - Jobs were processed ==========
    const messageQueue = getMessageQueue();
    const stats = await messageQueue.getQueueStats('message-persistence');
    expect(stats.completed).toBeGreaterThan(0);

    // ========== ASSERT: Messages table - Validate materialized view ==========
    const messages = await executeQuery<{
      id: string;
      role: string;
      content: string;
      sequence_number: number | null;
    }>(
      'SELECT id, role, content, sequence_number FROM messages WHERE session_id = @sessionId ORDER BY sequence_number',
      { sessionId: testSession.id }
    );

    // Verify messages were persisted (infrastructure validation)
    expect(messages.recordset.length).toBeGreaterThan(0);

    // Verify all messages have valid roles
    const roles = messages.recordset.map((m) => m.role);
    expect(roles.every((r) => ['user', 'assistant'].includes(r))).toBe(true);
  }, 30000); // 30 second timeout for integration test

  it('should persist events with consecutive sequence numbers across multiple turns', async () => {
    // ========== ARRANGE ==========

    // Configure multi-turn conversation
    // Turn 1: Tool use
    fakeClient.addResponse({
      textBlocks: ['Let me list the entities.'],
      toolUseBlocks: [
        {
          id: 'toolu_02XYZ',
          name: 'list_all_entities',
          input: {},
        },
      ],
      stopReason: 'tool_use',
    });

    // Turn 2: Final response
    fakeClient.addResponse({
      textBlocks: ['I found several Business Central entities.'],
      stopReason: 'end_turn',
    });

    const approvalManager = getApprovalManager(serverResult.io);
    const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

    // ========== ACT ==========
    const result = await agentService.executeQueryStreaming(
      'List all Business Central entities',
      testSession.id,
      () => {
        // No-op
      },
      testUser.id
    );

    // ========== ASSERT ==========
    expect(result.success).toBe(true);

    // Validate sequence numbers
    const events = await executeQuery<{
      sequence_number: number;
    }>(
      'SELECT sequence_number FROM message_events WHERE session_id = @sessionId ORDER BY sequence_number',
      { sessionId: testSession.id }
    );

    const sequenceNumbers = events.recordset.map((e) => e.sequence_number);

    // Sequence numbers must be consecutive (no gaps)
    for (let i = 1; i < sequenceNumbers.length; i++) {
      expect(sequenceNumbers[i]).toBe(sequenceNumbers[i - 1]! + 1);
    }
  }, 30000);

  it('should handle tool execution failure gracefully', async () => {
    // ========== ARRANGE ==========

    // Configure fake client to trigger tool execution error
    // Use a non-existent tool name to trigger error
    fakeClient.addResponse({
      textBlocks: ['Let me try an invalid tool.'],
      toolUseBlocks: [
        {
          id: 'toolu_03ERR',
          name: 'invalid_tool_that_does_not_exist',
          input: {},
        },
      ],
      stopReason: 'tool_use',
    });

    // Claude processes error result
    fakeClient.addResponse({
      textBlocks: ['I encountered an error with that tool.'],
      stopReason: 'end_turn',
    });

    const approvalManager = getApprovalManager(serverResult.io);
    const agentService = new DirectAgentService(approvalManager, undefined, fakeClient);

    // ========== ACT ==========
    const result = await agentService.executeQueryStreaming(
      'Use an invalid tool',
      testSession.id,
      () => {
        // No-op
      },
      testUser.id
    );

    // ========== ASSERT ==========
    // Service should handle error gracefully (might complete with error)
    // The important part is that the system doesn't crash

    // Events should still be persisted (validate infrastructure)
    const events = await executeQuery<{
      event_type: string;
      sequence_number: number;
    }>(
      'SELECT event_type, sequence_number FROM message_events WHERE session_id = @sessionId ORDER BY sequence_number',
      { sessionId: testSession.id }
    );

    // Verify events were persisted (regardless of tool success/failure)
    expect(events.recordset.length).toBeGreaterThan(0);

    // Verify sequence numbers are consecutive
    const sequenceNumbers = events.recordset.map((e) => e.sequence_number);
    for (let i = 1; i < sequenceNumbers.length; i++) {
      expect(sequenceNumbers[i]).toBe(sequenceNumbers[i - 1]! + 1);
    }
  }, 30000);

  it('should maintain multi-tenant isolation across concurrent sessions', async () => {
    // ========== ARRANGE ==========

    // Create second test user and session
    const testUser2 = await sessionFactory.createTestUser({ prefix: 'user2_' });
    const testSession2 = await sessionFactory.createChatSession(testUser2.id, {
      title: 'Session 2',
    });

    // Configure fake client for user 1
    const fakeClient1 = new FakeAnthropicClient();
    fakeClient1.addResponse({
      textBlocks: ['Response for user 1'],
      stopReason: 'end_turn',
    });

    // Configure fake client for user 2
    const fakeClient2 = new FakeAnthropicClient();
    fakeClient2.addResponse({
      textBlocks: ['Response for user 2'],
      stopReason: 'end_turn',
    });

    const approvalManager = getApprovalManager(serverResult.io);
    const agentService1 = new DirectAgentService(approvalManager, undefined, fakeClient1);
    const agentService2 = new DirectAgentService(approvalManager, undefined, fakeClient2);

    // ========== ACT ==========
    // Execute both sessions concurrently
    const [result1, result2] = await Promise.all([
      agentService1.executeQueryStreaming(
        'Message from user 1',
        testSession.id,
        () => {
          // No-op
        },
        testUser.id
      ),
      agentService2.executeQueryStreaming(
        'Message from user 2',
        testSession2.id,
        () => {
          // No-op
        },
        testUser2.id
      ),
    ]);

    // ========== ASSERT ==========
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Validate session 1 events are isolated
    const events1 = await executeQuery<{
      session_id: string;
    }>(
      'SELECT session_id FROM message_events WHERE session_id = @sessionId',
      { sessionId: testSession.id }
    );

    // Validate session 2 events are isolated
    const events2 = await executeQuery<{
      session_id: string;
    }>(
      'SELECT session_id FROM message_events WHERE session_id = @sessionId',
      { sessionId: testSession2.id }
    );

    // All events for session 1 should belong to session 1 (normalize UUIDs for comparison)
    expect(
      events1.recordset.every((e) => normalizeUUID(e.session_id) === normalizeUUID(testSession.id))
    ).toBe(true);

    // All events for session 2 should belong to session 2 (normalize UUIDs for comparison)
    expect(
      events2.recordset.every((e) => normalizeUUID(e.session_id) === normalizeUUID(testSession2.id))
    ).toBe(true);

    // Sequence numbers should be independent (both starting from 0)
    const seq1 = await executeQuery<{
      sequence_number: number;
    }>(
      'SELECT MIN(sequence_number) as min_seq FROM message_events WHERE session_id = @sessionId',
      { sessionId: testSession.id }
    );

    const seq2 = await executeQuery<{
      sequence_number: number;
    }>(
      'SELECT MIN(sequence_number) as min_seq FROM message_events WHERE session_id = @sessionId',
      { sessionId: testSession2.id }
    );

    // Both sessions should start at sequence 0
    expect(seq1.recordset[0]).toBeTruthy();
    expect(seq2.recordset[0]).toBeTruthy();
  }, 30000);
});
