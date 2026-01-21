/**
 * @file EventSequencer.test.ts
 * @description Tests for sequence number pre-allocation logic.
 *
 * Purpose: Capture the behavior of sequence counting and assignment
 * in AgentOrchestrator (lines 346-380) before extraction.
 *
 * Critical behaviors to verify:
 * - Pre-allocation counts only non-transient events
 * - Sequences assigned in order
 * - Tool events get sequences (request + response)
 * - Transient events do not get sequences
 * - Deterministic: same events -> same sequences
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedCompleteEvent,
} from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

/**
 * Count persistable events (non-transient) - extracts the logic from AgentOrchestrator
 * This is the exact algorithm used in lines 351-356
 */
function countPersistableEvents(events: NormalizedAgentEvent[]): number {
  let sequencesNeeded = 0;
  for (const event of events) {
    if (event.persistenceStrategy !== 'transient') {
      sequencesNeeded++;
    }
  }
  return sequencesNeeded;
}

/**
 * Assign pre-allocated sequences to events - extracts logic from lines 365-370
 */
function assignSequences(
  events: NormalizedAgentEvent[],
  reservedSeqs: number[]
): Map<string, number> {
  const assignments = new Map<string, number>();
  let seqIndex = 0;

  for (const event of events) {
    if (event.persistenceStrategy !== 'transient') {
      event.preAllocatedSequenceNumber = reservedSeqs[seqIndex];
      assignments.set(event.eventId, reservedSeqs[seqIndex]);
      seqIndex++;
    }
  }

  return assignments;
}

// Helper functions to create normalized events
function createThinkingEvent(id: string): NormalizedThinkingEvent {
  return {
    type: 'thinking',
    eventId: `thinking-${id}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 0,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-1',
    content: 'Thinking content',
  };
}

function createToolRequestEvent(id: string, toolUseId: string): NormalizedToolRequestEvent {
  return {
    type: 'tool_request',
    eventId: `tool-req-${id}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 1,
    persistenceStrategy: 'async_allowed',
    toolUseId,
    toolName: 'test_tool',
    args: {},
  };
}

function createToolResponseEvent(id: string, toolUseId: string): NormalizedToolResponseEvent {
  return {
    type: 'tool_response',
    eventId: `tool-resp-${id}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 2,
    persistenceStrategy: 'async_allowed',
    toolUseId,
    toolName: 'test_tool',
    success: true,
    result: 'Tool result',
  };
}

function createAssistantMessageEvent(id: string): NormalizedAssistantMessageEvent {
  return {
    type: 'assistant_message',
    eventId: `msg-${id}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 3,
    persistenceStrategy: 'sync_required',
    messageId: `msg-${id}`,
    content: 'Response',
    stopReason: 'end_turn',
    model: 'claude-3-5-sonnet',
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
  };
}

function createCompleteEvent(id: string): NormalizedCompleteEvent {
  return {
    type: 'complete',
    eventId: `complete-${id}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 4,
    persistenceStrategy: 'transient',
    reason: 'success',
    stopReason: 'end_turn',
  };
}

describe('EventSequencer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('countPersistableEvents', () => {
    it('should count only non-transient events', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),     // sync_required -> counted
        createToolRequestEvent('1', 'toolu_1'),  // async_allowed -> counted
        createToolResponseEvent('1', 'toolu_1'), // async_allowed -> counted
        createAssistantMessageEvent('1'),        // sync_required -> counted
        createCompleteEvent('1'),                // transient -> NOT counted
      ];

      const count = countPersistableEvents(events);

      expect(count).toBe(4);
    });

    it('should return 0 for all transient events', () => {
      const events: NormalizedAgentEvent[] = [
        createCompleteEvent('1'),
        createCompleteEvent('2'),
      ];

      const count = countPersistableEvents(events);

      expect(count).toBe(0);
    });

    it('should count all events when no transient events present', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createAssistantMessageEvent('1'),
      ];

      const count = countPersistableEvents(events);

      expect(count).toBe(2);
    });

    it('should handle empty events array', () => {
      const events: NormalizedAgentEvent[] = [];

      const count = countPersistableEvents(events);

      expect(count).toBe(0);
    });

    it('should count tool request and response as separate events', () => {
      const events: NormalizedAgentEvent[] = [
        createToolRequestEvent('1', 'toolu_1'),
        createToolResponseEvent('1', 'toolu_1'),
      ];

      const count = countPersistableEvents(events);

      // Each tool event (request + response) needs its own sequence
      expect(count).toBe(2);
    });

    it('should handle multiple tool executions', () => {
      const events: NormalizedAgentEvent[] = [
        createToolRequestEvent('1', 'toolu_1'),
        createToolResponseEvent('1', 'toolu_1'),
        createToolRequestEvent('2', 'toolu_2'),
        createToolResponseEvent('2', 'toolu_2'),
        createToolRequestEvent('3', 'toolu_3'),
        createToolResponseEvent('3', 'toolu_3'),
        createAssistantMessageEvent('1'),
        createCompleteEvent('1'),
      ];

      const count = countPersistableEvents(events);

      // 3 tool requests + 3 tool responses + 1 message = 7
      expect(count).toBe(7);
    });
  });

  describe('assignSequences', () => {
    it('should assign sequences in order to non-transient events', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createAssistantMessageEvent('1'),
        createCompleteEvent('1'),
      ];
      const reservedSeqs = [10, 11];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.get('thinking-1')).toBe(10);
      expect(assignments.get('msg-1')).toBe(11);
      expect(assignments.get('complete-1')).toBeUndefined();
    });

    it('should skip transient events when assigning sequences', () => {
      const events: NormalizedAgentEvent[] = [
        createCompleteEvent('1'),  // transient - skipped
        createThinkingEvent('1'),  // gets sequence 5
        createCompleteEvent('2'),  // transient - skipped
        createAssistantMessageEvent('1'), // gets sequence 6
      ];
      const reservedSeqs = [5, 6];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.size).toBe(2);
      expect(assignments.get('thinking-1')).toBe(5);
      expect(assignments.get('msg-1')).toBe(6);
    });

    it('should assign sequences to tool events', () => {
      const events: NormalizedAgentEvent[] = [
        createToolRequestEvent('1', 'toolu_abc'),
        createToolResponseEvent('1', 'toolu_abc'),
      ];
      const reservedSeqs = [100, 101];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.get('tool-req-1')).toBe(100);
      expect(assignments.get('tool-resp-1')).toBe(101);
    });

    it('should set preAllocatedSequenceNumber on event objects', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createAssistantMessageEvent('1'),
      ];
      const reservedSeqs = [42, 43];

      assignSequences(events, reservedSeqs);

      expect(events[0].preAllocatedSequenceNumber).toBe(42);
      expect(events[1].preAllocatedSequenceNumber).toBe(43);
    });

    it('should not modify preAllocatedSequenceNumber on transient events', () => {
      const events: NormalizedAgentEvent[] = [
        createCompleteEvent('1'),
      ];
      const reservedSeqs: number[] = [];

      assignSequences(events, reservedSeqs);

      expect(events[0].preAllocatedSequenceNumber).toBeUndefined();
    });

    it('should handle complex event sequence', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),           // seq 1
        createToolRequestEvent('1', 't1'),   // seq 2
        createToolResponseEvent('1', 't1'),  // seq 3
        createToolRequestEvent('2', 't2'),   // seq 4
        createToolResponseEvent('2', 't2'),  // seq 5
        createAssistantMessageEvent('1'),    // seq 6
        createCompleteEvent('1'),            // no seq (transient)
      ];
      const reservedSeqs = [1, 2, 3, 4, 5, 6];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.size).toBe(6);
      expect(assignments.get('thinking-1')).toBe(1);
      expect(assignments.get('tool-req-1')).toBe(2);
      expect(assignments.get('tool-resp-1')).toBe(3);
      expect(assignments.get('tool-req-2')).toBe(4);
      expect(assignments.get('tool-resp-2')).toBe(5);
      expect(assignments.get('msg-1')).toBe(6);
    });
  });

  describe('determinism', () => {
    it('should produce same sequence assignments for identical event arrays', () => {
      const createEvents = () => [
        createThinkingEvent('1'),
        createToolRequestEvent('1', 'toolu_1'),
        createToolResponseEvent('1', 'toolu_1'),
        createAssistantMessageEvent('1'),
        createCompleteEvent('1'),
      ];

      const events1 = createEvents();
      const events2 = createEvents();
      const reservedSeqs = [10, 20, 30, 40];

      const assignments1 = assignSequences(events1, [...reservedSeqs]);
      const assignments2 = assignSequences(events2, [...reservedSeqs]);

      // Both runs should produce identical assignments
      expect(assignments1.get('thinking-1')).toBe(assignments2.get('thinking-1'));
      expect(assignments1.get('tool-req-1')).toBe(assignments2.get('tool-req-1'));
      expect(assignments1.get('tool-resp-1')).toBe(assignments2.get('tool-resp-1'));
      expect(assignments1.get('msg-1')).toBe(assignments2.get('msg-1'));
    });

    it('should be deterministic regardless of timestamp differences', () => {
      const events1: NormalizedAgentEvent[] = [
        { ...createThinkingEvent('1'), timestamp: '2025-01-01T00:00:00Z' },
        { ...createAssistantMessageEvent('1'), timestamp: '2025-01-01T00:00:01Z' },
      ];

      const events2: NormalizedAgentEvent[] = [
        { ...createThinkingEvent('1'), timestamp: '2025-12-31T23:59:59Z' },
        { ...createAssistantMessageEvent('1'), timestamp: '2026-01-01T00:00:00Z' },
      ];

      const reservedSeqs = [100, 101];

      const assignments1 = assignSequences(events1, [...reservedSeqs]);
      const assignments2 = assignSequences(events2, [...reservedSeqs]);

      // Same eventIds should get same sequences regardless of timestamps
      expect(assignments1.get('thinking-1')).toBe(100);
      expect(assignments2.get('thinking-1')).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('should handle empty reserved sequences array', () => {
      const events: NormalizedAgentEvent[] = [
        createCompleteEvent('1'), // transient only
      ];
      const reservedSeqs: number[] = [];

      expect(() => assignSequences(events, reservedSeqs)).not.toThrow();
    });

    it('should handle events with same eventId (deduplication scenario)', () => {
      // In production, eventIds should be unique, but test defensive behavior
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('dup'),
        createThinkingEvent('dup'), // Same ID
      ];
      const reservedSeqs = [1, 2];

      const assignments = assignSequences(events, reservedSeqs);

      // Second assignment overwrites first in the map
      expect(assignments.size).toBe(1);
      expect(assignments.get('thinking-dup')).toBe(2);
    });

    it('should work with large sequence numbers', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createAssistantMessageEvent('1'),
      ];
      const reservedSeqs = [999999999, 1000000000];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.get('thinking-1')).toBe(999999999);
      expect(assignments.get('msg-1')).toBe(1000000000);
    });

    it('should handle non-contiguous sequence numbers', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createAssistantMessageEvent('1'),
        createAssistantMessageEvent('2'),
      ];
      // Gaps in sequence numbers (e.g., from concurrent sessions)
      const reservedSeqs = [5, 10, 15];

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.get('thinking-1')).toBe(5);
      expect(assignments.get('msg-1')).toBe(10);
      expect(assignments.get('msg-2')).toBe(15);
    });
  });

  describe('integration: count + assign', () => {
    it('should correctly count and then assign sequences', () => {
      const events: NormalizedAgentEvent[] = [
        createThinkingEvent('1'),
        createToolRequestEvent('1', 'toolu_abc'),
        createToolResponseEvent('1', 'toolu_abc'),
        createAssistantMessageEvent('1'),
        createCompleteEvent('1'),
      ];

      const count = countPersistableEvents(events);
      expect(count).toBe(4);

      // Simulate Redis INCRBY returning sequential numbers
      const startSeq = 100;
      const reservedSeqs = Array.from({ length: count }, (_, i) => startSeq + i);
      expect(reservedSeqs).toEqual([100, 101, 102, 103]);

      const assignments = assignSequences(events, reservedSeqs);

      expect(assignments.size).toBe(4);
      expect(events[0].preAllocatedSequenceNumber).toBe(100); // thinking
      expect(events[1].preAllocatedSequenceNumber).toBe(101); // tool_request
      expect(events[2].preAllocatedSequenceNumber).toBe(102); // tool_response
      expect(events[3].preAllocatedSequenceNumber).toBe(103); // assistant_message
      expect(events[4].preAllocatedSequenceNumber).toBeUndefined(); // complete (transient)
    });
  });
});
