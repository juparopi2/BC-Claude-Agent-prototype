/**
 * @module AgentEventEmitter.test
 *
 * Unit tests for AgentEventEmitter (stateless architecture).
 * Tests event emission with index tracking via ExecutionContext.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';
import {
  AgentEventEmitter,
  createAgentEventEmitter,
  getAgentEventEmitter,
  __resetAgentEventEmitter,
} from '@domains/agent/emission';
import {
  createExecutionContext,
  type ExecutionContext,
} from '@domains/agent/orchestration/ExecutionContext';

/**
 * Helper to create test execution context.
 */
function createTestContext(options?: {
  sessionId?: string;
  userId?: string;
  callback?: (event: AgentEvent) => void;
}): ExecutionContext {
  return createExecutionContext(
    options?.sessionId ?? 'test-session',
    options?.userId ?? 'test-user',
    options?.callback,
    { enableThinking: false }
  );
}

describe('AgentEventEmitter', () => {
  let emitter: AgentEventEmitter;
  let receivedEvents: AgentEvent[];
  let ctx: ExecutionContext;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    receivedEvents = [];
    ctx = createTestContext({
      callback: (event) => receivedEvents.push(event),
    });
  });

  describe('emit()', () => {
    it('should emit event with eventIndex', () => {
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      }, ctx);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
    });

    it('should increment eventIndex for each emission', () => {
      for (let i = 0; i < 5; i++) {
        emitter.emit({
          type: 'message_chunk',
          sessionId: 'test',
          timestamp: new Date().toISOString(),
          content: `Message ${i}`,
          blockIndex: 0,
        }, ctx);
      }

      expect(receivedEvents).toHaveLength(5);
      receivedEvents.forEach((event, i) => {
        expect(event).toHaveProperty('eventIndex', i);
      });
    });

    it('should silently ignore null events', () => {
      emitter.emit(null, ctx);

      expect(receivedEvents).toHaveLength(0);
    });

    it('should silently ignore events when no callback in context', () => {
      const ctxWithoutCallback = createTestContext(); // No callback

      expect(() => {
        emitter.emit({
          type: 'message_chunk',
          sessionId: 'test',
          timestamp: new Date().toISOString(),
          content: 'Hello',
          blockIndex: 0,
        }, ctxWithoutCallback);
      }).not.toThrow();
    });

    it('should not increment index for null events', () => {
      emitter.emit(null, ctx);
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      }, ctx);

      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
    });

    it('should preserve all event properties', () => {
      const originalEvent: AgentEvent = {
        type: 'tool_use',
        sessionId: 'session-123',
        timestamp: '2024-01-15T10:00:00.000Z',
        toolName: 'get_customers',
        toolArgs: { limit: 10 },
        toolUseId: 'toolu_123',
      };

      emitter.emit(originalEvent, ctx);

      expect(receivedEvents[0]).toMatchObject(originalEvent);
      expect(receivedEvents[0]).toHaveProperty('eventIndex');
    });

    it('should emit different event types', () => {
      emitter.emit({
        type: 'thinking',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Thinking...',
      }, ctx);

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      }, ctx);

      emitter.emit({
        type: 'complete',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      }, ctx);

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0]?.type).toBe('thinking');
      expect(receivedEvents[1]?.type).toBe('message_chunk');
      expect(receivedEvents[2]?.type).toBe('complete');
    });
  });

  describe('emitUserMessageConfirmed()', () => {
    it('should emit user_message_confirmed with correct structure', () => {
      emitter.emitUserMessageConfirmed('session-123', {
        messageId: 'msg-1',
        sequenceNumber: 5,
        eventId: 'evt-1',
        content: 'Hello, agent!',
        userId: 'user-1',
      }, ctx);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'user_message_confirmed',
        sessionId: 'session-123',
        messageId: 'msg-1',
        sequenceNumber: 5,
        eventId: 'evt-1',
        content: 'Hello, agent!',
        userId: 'user-1',
        persistenceState: 'persisted',
      });
    });

    it('should include timestamp', () => {
      const before = new Date().toISOString();
      emitter.emitUserMessageConfirmed('session-123', {
        messageId: 'msg-1',
        sequenceNumber: 1,
        eventId: 'evt-1',
        content: 'Test',
        userId: 'user-1',
      }, ctx);
      const after = new Date().toISOString();

      expect(receivedEvents[0]?.timestamp).toBeDefined();
      expect(receivedEvents[0]?.timestamp! >= before).toBe(true);
      expect(receivedEvents[0]?.timestamp! <= after).toBe(true);
    });

    it('should include eventIndex', () => {
      emitter.emitUserMessageConfirmed('session-1', {
        messageId: 'msg-1',
        sequenceNumber: 1,
        eventId: 'evt-1',
        content: 'First',
        userId: 'user-1',
      }, ctx);
      emitter.emitUserMessageConfirmed('session-1', {
        messageId: 'msg-2',
        sequenceNumber: 2,
        eventId: 'evt-2',
        content: 'Second',
        userId: 'user-1',
      }, ctx);

      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 1);
    });

    it('should not emit if no callback in context', () => {
      const ctxWithoutCallback = createTestContext();

      expect(() => {
        emitter.emitUserMessageConfirmed('session-123', {
          messageId: 'msg-1',
          sequenceNumber: 1,
          eventId: 'evt-1',
          content: 'Test',
          userId: 'user-1',
        }, ctxWithoutCallback);
      }).not.toThrow();
    });
  });

  describe('emitError()', () => {
    it('should emit error event', () => {
      emitter.emitError('session-123', 'Something went wrong', 'AGENT_ERROR', ctx);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'error',
        sessionId: 'session-123',
        error: 'Something went wrong',
        code: 'AGENT_ERROR',
      });
    });

    it('should include timestamp', () => {
      const before = new Date().toISOString();
      emitter.emitError('session-123', 'Error', 'CODE', ctx);
      const after = new Date().toISOString();

      expect(receivedEvents[0]?.timestamp).toBeDefined();
      expect(receivedEvents[0]?.timestamp! >= before).toBe(true);
      expect(receivedEvents[0]?.timestamp! <= after).toBe(true);
    });

    it('should include eventIndex', () => {
      emitter.emitError('session-123', 'Error 1', 'CODE1', ctx);
      emitter.emitError('session-123', 'Error 2', 'CODE2', ctx);

      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 1);
    });

    it('should not emit if no callback in context', () => {
      const ctxWithoutCallback = createTestContext();

      expect(() => {
        emitter.emitError('session-123', 'Error', 'CODE', ctxWithoutCallback);
      }).not.toThrow();
    });
  });

  describe('getEventIndex()', () => {
    it('should return 0 initially', () => {
      expect(emitter.getEventIndex(ctx)).toBe(0);
    });

    it('should return current index after emissions', () => {
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      }, ctx);

      expect(emitter.getEventIndex(ctx)).toBe(1);
    });

    it('should not increment index on read', () => {
      expect(emitter.getEventIndex(ctx)).toBe(0);
      expect(emitter.getEventIndex(ctx)).toBe(0);
      expect(emitter.getEventIndex(ctx)).toBe(0);
    });
  });

  describe('context isolation (multi-tenant)', () => {
    it('should isolate event indices between contexts', () => {
      const events1: AgentEvent[] = [];
      const events2: AgentEvent[] = [];

      const ctx1 = createTestContext({
        sessionId: 'session-1',
        callback: (e) => events1.push(e),
      });
      const ctx2 = createTestContext({
        sessionId: 'session-2',
        callback: (e) => events2.push(e),
      });

      // Emit to ctx1
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: 'Hello from 1',
        blockIndex: 0,
      }, ctx1);

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: 'Second from 1',
        blockIndex: 0,
      }, ctx1);

      // Emit to ctx2
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-2',
        timestamp: new Date().toISOString(),
        content: 'Hello from 2',
        blockIndex: 0,
      }, ctx2);

      // ctx1 should have indices 0, 1
      expect(events1).toHaveLength(2);
      expect(events1[0]).toHaveProperty('eventIndex', 0);
      expect(events1[1]).toHaveProperty('eventIndex', 1);

      // ctx2 should start at 0 (isolated)
      expect(events2).toHaveLength(1);
      expect(events2[0]).toHaveProperty('eventIndex', 0);
    });

    it('should not cross-contaminate callbacks between contexts', () => {
      const events1: AgentEvent[] = [];
      const events2: AgentEvent[] = [];

      const ctx1 = createTestContext({
        sessionId: 'session-1',
        callback: (e) => events1.push(e),
      });
      const ctx2 = createTestContext({
        sessionId: 'session-2',
        callback: (e) => events2.push(e),
      });

      // Emit to ctx1
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: 'For session 1',
        blockIndex: 0,
      }, ctx1);

      // Emit to ctx2
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-2',
        timestamp: new Date().toISOString(),
        content: 'For session 2',
        blockIndex: 0,
      }, ctx2);

      // Each callback only received its own events
      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect((events1[0] as { content: string }).content).toBe('For session 1');
      expect((events2[0] as { content: string }).content).toBe('For session 2');
    });
  });

  describe('createAgentEventEmitter()', () => {
    it('should create new instances', () => {
      const emitter1 = createAgentEventEmitter();
      const emitter2 = createAgentEventEmitter();

      expect(emitter1).not.toBe(emitter2);
    });

    it('should create independent emitters (but context provides isolation)', () => {
      const emitter1 = createAgentEventEmitter();
      const emitter2 = createAgentEventEmitter();

      const events1: AgentEvent[] = [];
      const events2: AgentEvent[] = [];

      const ctx1 = createTestContext({
        callback: (e) => events1.push(e),
      });
      const ctx2 = createTestContext({
        callback: (e) => events2.push(e),
      });

      emitter1.emit({
        type: 'message_chunk',
        sessionId: 'test1',
        timestamp: new Date().toISOString(),
        content: 'Hello 1',
        blockIndex: 0,
      }, ctx1);

      emitter2.emit({
        type: 'message_chunk',
        sessionId: 'test2',
        timestamp: new Date().toISOString(),
        content: 'Hello 2',
        blockIndex: 0,
      }, ctx2);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]).toHaveProperty('eventIndex', 0);
      expect(events2[0]).toHaveProperty('eventIndex', 0);
    });

    it('should return AgentEventEmitter instances', () => {
      const emitter = createAgentEventEmitter();
      expect(emitter).toBeInstanceOf(AgentEventEmitter);
    });
  });

  describe('getAgentEventEmitter() singleton', () => {
    beforeEach(() => {
      __resetAgentEventEmitter();
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = getAgentEventEmitter();
      const instance2 = getAgentEventEmitter();

      expect(instance1).toBe(instance2);
    });

    it('should be safe for concurrent use with different contexts', () => {
      const singleton = getAgentEventEmitter();

      const events1: AgentEvent[] = [];
      const events2: AgentEvent[] = [];

      const ctx1 = createTestContext({
        sessionId: 'session-1',
        callback: (e) => events1.push(e),
      });
      const ctx2 = createTestContext({
        sessionId: 'session-2',
        callback: (e) => events2.push(e),
      });

      // Both use the same singleton emitter
      singleton.emit({
        type: 'message_chunk',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: 'User A message',
        blockIndex: 0,
      }, ctx1);

      singleton.emit({
        type: 'message_chunk',
        sessionId: 'session-2',
        timestamp: new Date().toISOString(),
        content: 'User B message',
        blockIndex: 0,
      }, ctx2);

      // Events are isolated by context
      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect((events1[0] as { content: string }).content).toBe('User A message');
      expect((events2[0] as { content: string }).content).toBe('User B message');
    });
  });

  describe('realistic streaming scenario', () => {
    it('should handle typical agent response stream', () => {
      // Simulate agent response stream
      emitter.emit({
        type: 'session_start',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        metadata: { provider: 'anthropic' },
      }, ctx);

      emitter.emit({
        type: 'thinking',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Let me analyze...',
      }, ctx);

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Here is ',
        blockIndex: 0,
      }, ctx);

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'my response.',
        blockIndex: 0,
      }, ctx);

      emitter.emit({
        type: 'complete',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      }, ctx);

      expect(receivedEvents).toHaveLength(5);
      // Verify ordering is preserved
      for (let i = 0; i < receivedEvents.length; i++) {
        expect(receivedEvents[i]).toHaveProperty('eventIndex', i);
      }
    });

    it('should handle tool use flow', () => {
      emitter.emit({
        type: 'tool_use',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        toolName: 'get_customers',
        toolArgs: { limit: 10 },
        toolUseId: 'toolu_abc',
      }, ctx);

      emitter.emit({
        type: 'tool_result',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        toolName: 'get_customers',
        toolUseId: 'toolu_abc',
        result: [{ name: 'Customer 1' }],
        success: true,
      }, ctx);

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]?.type).toBe('tool_use');
      expect(receivedEvents[1]?.type).toBe('tool_result');
    });

    it('should handle error in middle of stream', () => {
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Starting...',
        blockIndex: 0,
      }, ctx);

      emitter.emitError('session-123', 'Connection lost', 'NETWORK_ERROR', ctx);

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]?.type).toBe('message_chunk');
      expect(receivedEvents[1]?.type).toBe('error');
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 1);
    });

    it('should handle multi-turn with separate contexts', () => {
      const allEvents: AgentEvent[][] = [[], []];

      // Turn 1 - Create new context
      const ctx1 = createTestContext({
        callback: (event) => allEvents[0]!.push(event),
      });

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Turn 1',
        blockIndex: 0,
      }, ctx1);
      emitter.emit({
        type: 'complete',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      }, ctx1);

      // Turn 2 - Create fresh context (simulating new executeAgent call)
      const ctx2 = createTestContext({
        callback: (event) => allEvents[1]!.push(event),
      });

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Turn 2',
        blockIndex: 0,
      }, ctx2);

      // Turn 1 events
      expect(allEvents[0]).toHaveLength(2);
      expect(allEvents[0]?.[0]).toHaveProperty('eventIndex', 0);
      expect(allEvents[0]?.[1]).toHaveProperty('eventIndex', 1);

      // Turn 2 starts fresh with new context
      expect(allEvents[1]).toHaveLength(1);
      expect(allEvents[1]?.[0]).toHaveProperty('eventIndex', 0);
    });
  });
});
