/**
 * @module AgentEventEmitter.test
 *
 * Unit tests for AgentEventEmitter.
 * Tests event emission with index tracking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentEvent } from '@bc-agent/shared';
import {
  AgentEventEmitter,
  createAgentEventEmitter,
  EventIndexTracker,
} from '@/domains/agent/emission';

describe('AgentEventEmitter', () => {
  let emitter: AgentEventEmitter;
  let receivedEvents: AgentEvent[];

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    receivedEvents = [];
  });

  describe('setCallback()', () => {
    it('should set callback function', () => {
      const callback = vi.fn();
      emitter.setCallback(callback);

      expect(emitter.hasCallback()).toBe(true);
    });

    it('should allow setting undefined callback', () => {
      emitter.setCallback(vi.fn());
      emitter.setCallback(undefined);

      expect(emitter.hasCallback()).toBe(false);
    });

    it('should replace previous callback', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.setCallback(callback1);
      emitter.setCallback(callback2);

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('emit()', () => {
    it('should emit event with eventIndex', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
    });

    it('should increment eventIndex for each emission', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      for (let i = 0; i < 5; i++) {
        emitter.emit({
          type: 'message_chunk',
          sessionId: 'test',
          timestamp: new Date().toISOString(),
          content: `Message ${i}`,
          blockIndex: 0,
        });
      }

      expect(receivedEvents).toHaveLength(5);
      receivedEvents.forEach((event, i) => {
        expect(event).toHaveProperty('eventIndex', i);
      });
    });

    it('should silently ignore null events', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit(null);

      expect(receivedEvents).toHaveLength(0);
    });

    it('should silently ignore events when no callback', () => {
      // No callback set
      expect(() => {
        emitter.emit({
          type: 'message_chunk',
          sessionId: 'test',
          timestamp: new Date().toISOString(),
          content: 'Hello',
          blockIndex: 0,
        });
      }).not.toThrow();
    });

    it('should not increment index for null events', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit(null);
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
    });

    it('should preserve all event properties', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      const originalEvent: AgentEvent = {
        type: 'tool_use',
        sessionId: 'session-123',
        timestamp: '2024-01-15T10:00:00.000Z',
        toolName: 'get_customers',
        toolArgs: { limit: 10 },
        toolUseId: 'toolu_123',
      };

      emitter.emit(originalEvent);

      expect(receivedEvents[0]).toMatchObject(originalEvent);
      expect(receivedEvents[0]).toHaveProperty('eventIndex');
    });

    it('should emit different event types', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit({
        type: 'thinking',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Thinking...',
      });

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      emitter.emit({
        type: 'complete',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      });

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents[0]?.type).toBe('thinking');
      expect(receivedEvents[1]?.type).toBe('message_chunk');
      expect(receivedEvents[2]?.type).toBe('complete');
    });
  });

  describe('emitError()', () => {
    it('should emit error event', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emitError('session-123', 'Something went wrong', 'AGENT_ERROR');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        type: 'error',
        sessionId: 'session-123',
        error: 'Something went wrong',
        code: 'AGENT_ERROR',
      });
    });

    it('should include timestamp', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      const before = new Date().toISOString();
      emitter.emitError('session-123', 'Error', 'CODE');
      const after = new Date().toISOString();

      expect(receivedEvents[0]?.timestamp).toBeDefined();
      expect(receivedEvents[0]?.timestamp! >= before).toBe(true);
      expect(receivedEvents[0]?.timestamp! <= after).toBe(true);
    });

    it('should include eventIndex', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emitError('session-123', 'Error 1', 'CODE1');
      emitter.emitError('session-123', 'Error 2', 'CODE2');

      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 1);
    });

    it('should not emit if no callback', () => {
      expect(() => {
        emitter.emitError('session-123', 'Error', 'CODE');
      }).not.toThrow();
    });
  });

  describe('getEventIndex()', () => {
    it('should return 0 initially', () => {
      expect(emitter.getEventIndex()).toBe(0);
    });

    it('should return current index after emissions', () => {
      emitter.setCallback(() => {});

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      expect(emitter.getEventIndex()).toBe(1);
    });

    it('should not increment index on read', () => {
      expect(emitter.getEventIndex()).toBe(0);
      expect(emitter.getEventIndex()).toBe(0);
      expect(emitter.getEventIndex()).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear callback', () => {
      emitter.setCallback(vi.fn());
      emitter.reset();

      expect(emitter.hasCallback()).toBe(false);
    });

    it('should reset event index', () => {
      emitter.setCallback(() => {});
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      emitter.reset();

      expect(emitter.getEventIndex()).toBe(0);
    });

    it('should allow re-use after reset', () => {
      emitter.setCallback((event) => receivedEvents.push(event));
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'First',
        blockIndex: 0,
      });

      emitter.reset();

      emitter.setCallback((event) => receivedEvents.push(event));
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Second',
        blockIndex: 0,
      });

      // Should have 2 events, second one starts at index 0
      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 0);
    });
  });

  describe('hasCallback()', () => {
    it('should return false initially', () => {
      expect(emitter.hasCallback()).toBe(false);
    });

    it('should return true after setting callback', () => {
      emitter.setCallback(vi.fn());
      expect(emitter.hasCallback()).toBe(true);
    });

    it('should return false after setting undefined', () => {
      emitter.setCallback(vi.fn());
      emitter.setCallback(undefined);
      expect(emitter.hasCallback()).toBe(false);
    });

    it('should return false after reset', () => {
      emitter.setCallback(vi.fn());
      emitter.reset();
      expect(emitter.hasCallback()).toBe(false);
    });
  });

  describe('dependency injection', () => {
    it('should accept custom index tracker', () => {
      const customTracker = new EventIndexTracker();
      customTracker.next(); // Advance to 1
      customTracker.next(); // Advance to 2

      const customEmitter = new AgentEventEmitter(customTracker);
      customEmitter.setCallback((event) => receivedEvents.push(event));

      customEmitter.emit({
        type: 'message_chunk',
        sessionId: 'test',
        timestamp: new Date().toISOString(),
        content: 'Hello',
        blockIndex: 0,
      });

      // Should start at 2 (from custom tracker)
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 2);
    });
  });

  describe('createAgentEventEmitter()', () => {
    it('should create new instances', () => {
      const emitter1 = createAgentEventEmitter();
      const emitter2 = createAgentEventEmitter();

      expect(emitter1).not.toBe(emitter2);
    });

    it('should create independent emitters', () => {
      const emitter1 = createAgentEventEmitter();
      const emitter2 = createAgentEventEmitter();

      const events1: AgentEvent[] = [];
      const events2: AgentEvent[] = [];

      emitter1.setCallback((e) => events1.push(e));
      emitter2.setCallback((e) => events2.push(e));

      emitter1.emit({
        type: 'message_chunk',
        sessionId: 'test1',
        timestamp: new Date().toISOString(),
        content: 'Hello 1',
        blockIndex: 0,
      });

      emitter2.emit({
        type: 'message_chunk',
        sessionId: 'test2',
        timestamp: new Date().toISOString(),
        content: 'Hello 2',
        blockIndex: 0,
      });

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

  describe('realistic streaming scenario', () => {
    it('should handle typical agent response stream', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      // Simulate agent response stream
      emitter.emit({
        type: 'session_start',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        metadata: { provider: 'anthropic' },
      });

      emitter.emit({
        type: 'thinking',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Let me analyze...',
      });

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Here is ',
        blockIndex: 0,
      });

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'my response.',
        blockIndex: 0,
      });

      emitter.emit({
        type: 'complete',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      });

      expect(receivedEvents).toHaveLength(5);
      // Verify ordering is preserved
      for (let i = 0; i < receivedEvents.length; i++) {
        expect(receivedEvents[i]).toHaveProperty('eventIndex', i);
      }
    });

    it('should handle tool use flow', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit({
        type: 'tool_use',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        toolName: 'get_customers',
        toolArgs: { limit: 10 },
        toolUseId: 'toolu_abc',
      });

      emitter.emit({
        type: 'tool_result',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        toolName: 'get_customers',
        toolUseId: 'toolu_abc',
        result: [{ name: 'Customer 1' }],
        success: true,
      });

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]?.type).toBe('tool_use');
      expect(receivedEvents[1]?.type).toBe('tool_result');
    });

    it('should handle error in middle of stream', () => {
      emitter.setCallback((event) => receivedEvents.push(event));

      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Starting...',
        blockIndex: 0,
      });

      emitter.emitError('session-123', 'Connection lost', 'NETWORK_ERROR');

      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0]?.type).toBe('message_chunk');
      expect(receivedEvents[1]?.type).toBe('error');
      expect(receivedEvents[0]).toHaveProperty('eventIndex', 0);
      expect(receivedEvents[1]).toHaveProperty('eventIndex', 1);
    });

    it('should handle multi-turn with reset', () => {
      const allEvents: AgentEvent[][] = [[], []];

      // Turn 1
      emitter.setCallback((event) => allEvents[0]!.push(event));
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Turn 1',
        blockIndex: 0,
      });
      emitter.emit({
        type: 'complete',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        stopReason: 'end_turn',
      });

      // Reset for turn 2
      emitter.reset();

      // Turn 2
      emitter.setCallback((event) => allEvents[1]!.push(event));
      emitter.emit({
        type: 'message_chunk',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        content: 'Turn 2',
        blockIndex: 0,
      });

      // Turn 1 events
      expect(allEvents[0]).toHaveLength(2);
      expect(allEvents[0]?.[0]).toHaveProperty('eventIndex', 0);
      expect(allEvents[0]?.[1]).toHaveProperty('eventIndex', 1);

      // Turn 2 starts fresh
      expect(allEvents[1]).toHaveLength(1);
      expect(allEvents[1]?.[0]).toHaveProperty('eventIndex', 0);
    });
  });
});
