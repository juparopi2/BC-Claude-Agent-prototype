/**
 * SequenceValidator Unit Tests
 *
 * Tests the validation logic for event ordering without needing
 * real Redis/DB connections.
 *
 * @module __tests__/unit/services/events/SequenceValidator.test.ts
 */

import { describe, it, expect } from 'vitest';
import { SequenceValidator } from '../../../e2e/helpers/SequenceValidator';
import type { AgentEvent } from '@/types/websocket.types';

// Helper to create mock events
function createMockEvent(
  type: string,
  sequenceNumber?: number,
  options: {
    eventId?: string;
    persistenceState?: string;
    toolUseId?: string;
  } = {}
): AgentEvent & { sequenceNumber?: number; eventId?: string; persistenceState?: string; toolUseId?: string } {
  return {
    type: type as AgentEvent['type'],
    sessionId: 'test-session-id',
    timestamp: new Date().toISOString(),
    sequenceNumber,
    eventId: options.eventId ?? `evt-${Math.random().toString(36).slice(2)}`,
    persistenceState: options.persistenceState,
    toolUseId: options.toolUseId,
  } as AgentEvent & { sequenceNumber?: number; eventId?: string; persistenceState?: string; toolUseId?: string };
}

describe('SequenceValidator', () => {
  describe('validateSequenceOrder', () => {
    it('should return valid for ordered events with no gaps', () => {
      const events = [
        createMockEvent('user_message_confirmed', 0),
        createMockEvent('thinking', 1),
        createMockEvent('message', 2),
        createMockEvent('complete', undefined), // transient, no sequence
      ];

      const result = SequenceValidator.validateSequenceOrder(events);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect gaps in sequence numbers', () => {
      const events = [
        createMockEvent('user_message_confirmed', 0),
        createMockEvent('thinking', 1),
        createMockEvent('message', 5), // Gap: 2, 3, 4 missing
      ];

      const result = SequenceValidator.validateSequenceOrder(events);

      // Gaps should be warnings, not errors
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('Gap'))).toBe(true);
    });

    it('should detect out-of-order sequences', () => {
      const events = [
        createMockEvent('user_message_confirmed', 2),
        createMockEvent('thinking', 1), // Out of order!
        createMockEvent('message', 3),
      ];

      const result = SequenceValidator.validateSequenceOrder(events);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('out of order'))).toBe(true);
    });

    it('should handle events without sequence numbers gracefully', () => {
      const events = [
        createMockEvent('message_chunk', undefined), // transient
        createMockEvent('message_chunk', undefined), // transient
        createMockEvent('complete', undefined), // transient
      ];

      const result = SequenceValidator.validateSequenceOrder(events);

      // Should be valid (no persisted events to check)
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('No events with sequence numbers'))).toBe(true);
    });

    it('should handle empty event array', () => {
      const result = SequenceValidator.validateSequenceOrder([]);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No events with sequence numbers found');
    });

    it('should skip non-AgentEvent objects', () => {
      const mixedEvents = [
        { data: null, timestamp: new Date() }, // null data
        { data: { someOther: 'structure' }, timestamp: new Date() }, // no type property
        { data: createMockEvent('message', 1), timestamp: new Date() }, // valid
      ];

      // Cast to expected type - the validator should handle invalid events gracefully
      const result = SequenceValidator.validateSequenceOrder(mixedEvents as never[]);

      expect(result.valid).toBe(true);
      // Should only find 1 valid event with sequence number
    });
  });

  describe('validateStreamingOrder', () => {
    it('should validate correct streaming order', () => {
      const events = [
        createMockEvent('user_message_confirmed'),
        createMockEvent('thinking'),
        createMockEvent('thinking_chunk'),
        createMockEvent('message_chunk'),
        createMockEvent('message'),
        createMockEvent('complete'),
      ];

      const result = SequenceValidator.validateStreamingOrder(events as AgentEvent[]);

      expect(result.valid).toBe(true);
    });

    it('should warn on unexpected transitions', () => {
      const events = [
        createMockEvent('user_message_confirmed'),
        createMockEvent('complete'), // Skipped thinking/message
      ];

      const result = SequenceValidator.validateStreamingOrder(events as AgentEvent[]);

      // Unexpected transitions are warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn if stream does not end with complete or error', () => {
      const events = [
        createMockEvent('user_message_confirmed'),
        createMockEvent('message'),
      ];

      const result = SequenceValidator.validateStreamingOrder(events as AgentEvent[]);

      expect(result.warnings.some(w => w.includes('did not end with'))).toBe(true);
    });
  });

  describe('validatePersistenceStates', () => {
    it('should validate correct persistence states', () => {
      const events = [
        createMockEvent('user_message_confirmed', 0, { persistenceState: 'persisted' }),
        createMockEvent('thinking', 1, { persistenceState: 'persisted' }),
        createMockEvent('message_chunk', undefined, { persistenceState: 'transient' }),
        createMockEvent('message', 2, { persistenceState: 'persisted' }),
        createMockEvent('complete', undefined, { persistenceState: 'transient' }),
      ];

      const result = SequenceValidator.validatePersistenceStates(events as AgentEvent[]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error if transient event has sequenceNumber', () => {
      const events = [
        createMockEvent('message_chunk', 5, { persistenceState: 'transient' }), // Error!
      ];

      const result = SequenceValidator.validatePersistenceStates(events as AgentEvent[]);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('transient') && e.includes('sequenceNumber'))).toBe(true);
    });

    it('should error if persisted event lacks sequenceNumber', () => {
      const events = [
        createMockEvent('message', undefined, { persistenceState: 'persisted' }), // Error!
      ];

      const result = SequenceValidator.validatePersistenceStates(events as AgentEvent[]);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('persisted') && e.includes('should have sequenceNumber'))).toBe(true);
    });

    it('should warn on unknown event types', () => {
      const events = [
        createMockEvent('unknown_type', 0, { persistenceState: 'persisted' }),
      ];

      const result = SequenceValidator.validatePersistenceStates(events as AgentEvent[]);

      expect(result.warnings.some(w => w.includes('Unknown event type'))).toBe(true);
    });
  });

  describe('validateToolCorrelation', () => {
    it('should validate matching tool_use and tool_result pairs', () => {
      const events = [
        createMockEvent('tool_use', 1, { toolUseId: 'toolu_123' }),
        createMockEvent('tool_result', 2, { toolUseId: 'toolu_123' }),
      ];

      const result = SequenceValidator.validateToolCorrelation(events as AgentEvent[]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error if tool_use has no corresponding tool_result', () => {
      const events = [
        createMockEvent('tool_use', 1, { toolUseId: 'toolu_123' }),
        // No tool_result!
      ];

      const result = SequenceValidator.validateToolCorrelation(events as AgentEvent[]);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('toolu_123') && e.includes('no corresponding'))).toBe(true);
    });

    it('should warn if tool_result has no corresponding tool_use', () => {
      const events = [
        createMockEvent('tool_result', 1, { toolUseId: 'toolu_orphan' }),
      ];

      const result = SequenceValidator.validateToolCorrelation(events as AgentEvent[]);

      // Orphan tool_result is a warning (might be from previous context)
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('compareWebSocketWithDatabase', () => {
    it('should correctly identify matched events', () => {
      const wsEvents = [
        createMockEvent('message', 1, { eventId: 'evt-001' }),
        createMockEvent('message', 2, { eventId: 'evt-002' }),
      ];

      const dbEvents = [
        { id: 'evt-001', event_type: 'message', sequence_number: 1 },
        { id: 'evt-002', event_type: 'message', sequence_number: 2 },
      ];

      const result = SequenceValidator.compareWebSocketWithDatabase(
        wsEvents as AgentEvent[],
        dbEvents
      );

      expect(result.matched).toBe(2);
      expect(result.wsOnly).toHaveLength(0);
      expect(result.dbOnly).toHaveLength(0);
      expect(result.sequenceMismatches).toHaveLength(0);
    });

    it('should identify events only in WebSocket', () => {
      const wsEvents = [
        createMockEvent('message', 1, { eventId: 'evt-001' }),
        createMockEvent('message', 2, { eventId: 'evt-002' }),
      ];

      const dbEvents = [
        { id: 'evt-001', event_type: 'message', sequence_number: 1 },
        // evt-002 not in DB
      ];

      const result = SequenceValidator.compareWebSocketWithDatabase(
        wsEvents as AgentEvent[],
        dbEvents
      );

      expect(result.matched).toBe(1);
      expect(result.wsOnly).toHaveLength(1);
    });

    it('should identify events only in Database', () => {
      const wsEvents = [
        createMockEvent('message', 1, { eventId: 'evt-001' }),
      ];

      const dbEvents = [
        { id: 'evt-001', event_type: 'message', sequence_number: 1 },
        { id: 'evt-003', event_type: 'message', sequence_number: 3 },
      ];

      const result = SequenceValidator.compareWebSocketWithDatabase(
        wsEvents as AgentEvent[],
        dbEvents
      );

      expect(result.matched).toBe(1);
      expect(result.dbOnly).toHaveLength(1);
    });

    it('should identify sequence number mismatches', () => {
      const wsEvents = [
        createMockEvent('message', 1, { eventId: 'evt-001' }),
      ];

      const dbEvents = [
        { id: 'evt-001', event_type: 'message', sequence_number: 99 }, // Mismatch!
      ];

      const result = SequenceValidator.compareWebSocketWithDatabase(
        wsEvents as AgentEvent[],
        dbEvents
      );

      expect(result.matched).toBe(1);
      expect(result.sequenceMismatches).toHaveLength(1);
      expect(result.sequenceMismatches[0]?.wsSequence).toBe(1);
      expect(result.sequenceMismatches[0]?.dbSequence).toBe(99);
    });
  });

  describe('getEventSummary', () => {
    it('should return formatted event summary with sequence numbers', () => {
      const events = [
        createMockEvent('user_message_confirmed', 0),
        createMockEvent('thinking', 1),
        createMockEvent('message_chunk', undefined),
        createMockEvent('message', 2),
      ];

      const summary = SequenceValidator.getEventSummary(events as AgentEvent[]);

      expect(summary).toEqual([
        'user_message_confirmed[0]',
        'thinking[1]',
        'message_chunk',
        'message[2]',
      ]);
    });
  });

  describe('assertValid', () => {
    it('should not throw for valid events', () => {
      const events = [
        createMockEvent('user_message_confirmed', 0),
        createMockEvent('message', 1),
      ];

      expect(() =>
        SequenceValidator.assertValid(events as AgentEvent[], { checkSequence: true })
      ).not.toThrow();
    });

    it('should throw for invalid sequence order', () => {
      const events = [
        createMockEvent('user_message_confirmed', 2),
        createMockEvent('message', 1), // Out of order
      ];

      expect(() =>
        SequenceValidator.assertValid(events as AgentEvent[], { checkSequence: true })
      ).toThrow('Event validation failed');
    });
  });
});
