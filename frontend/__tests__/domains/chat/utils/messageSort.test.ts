/**
 * Tests for Message Sorting Utility
 *
 * @module __tests__/domains/chat/utils/messageSort
 */

import { describe, it, expect } from 'vitest';
import {
  sortMessages,
  sortMessagesInPlace,
  type SortableMessage,
} from '@/src/domains/chat/utils/messageSort';

// ============================================================================
// Test Helpers
// ============================================================================

function createMessage(overrides: Partial<SortableMessage> = {}): SortableMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    type: 'standard',
    session_id: 'test-session',
    role: 'user',
    content: 'Test message',
    sequence_number: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as SortableMessage;
}

// ============================================================================
// Tests: sortMessages
// ============================================================================

describe('sortMessages', () => {
  describe('persisted messages (with sequence_number)', () => {
    it('should sort by sequence_number in ascending order', () => {
      const messages = [
        createMessage({ sequence_number: 3, created_at: '2024-01-01T00:00:00Z' }),
        createMessage({ sequence_number: 1, created_at: '2024-01-01T00:02:00Z' }),
        createMessage({ sequence_number: 2, created_at: '2024-01-01T00:01:00Z' }),
      ];

      const sorted = [...messages].sort(sortMessages);

      expect(sorted[0].sequence_number).toBe(1);
      expect(sorted[1].sequence_number).toBe(2);
      expect(sorted[2].sequence_number).toBe(3);
    });

    it('should ignore timestamp when both have sequence_number', () => {
      const older = createMessage({
        sequence_number: 2,
        created_at: '2024-01-01T00:00:00Z',
      });
      const newer = createMessage({
        sequence_number: 1,
        created_at: '2024-01-01T01:00:00Z',
      });

      const result = sortMessages(older, newer);
      expect(result).toBeGreaterThan(0); // older should come after newer (seq 2 > seq 1)
    });

    it('should handle sequence_number of 0 as non-persisted', () => {
      const persisted = createMessage({ sequence_number: 1 });
      const zeroed = createMessage({ sequence_number: 0 });

      const result = sortMessages(persisted, zeroed);
      expect(result).toBeLessThan(0); // persisted should come first
    });
  });

  describe('mixed persisted and transient messages', () => {
    it('should place persisted messages before transient', () => {
      const persisted = createMessage({
        sequence_number: 5,
        created_at: '2024-01-01T01:00:00Z',
      });
      const transient = createMessage({
        sequence_number: null,
        created_at: '2024-01-01T00:00:00Z', // Earlier timestamp
      });

      const result = sortMessages(persisted, transient);
      expect(result).toBeLessThan(0); // persisted should come first
    });

    it('should place transient messages after persisted', () => {
      const transient = createMessage({
        sequence_number: null,
        created_at: '2024-01-01T00:00:00Z',
      });
      const persisted = createMessage({
        sequence_number: 1,
        created_at: '2024-01-01T01:00:00Z',
      });

      const result = sortMessages(transient, persisted);
      expect(result).toBeGreaterThan(0); // transient should come after
    });
  });

  describe('transient messages (no sequence_number)', () => {
    it('should sort by eventIndex when both have eventIndex', () => {
      const first = createMessage({
        sequence_number: null,
        eventIndex: 1,
        created_at: '2024-01-01T01:00:00Z',
      });
      const second = createMessage({
        sequence_number: null,
        eventIndex: 2,
        created_at: '2024-01-01T00:00:00Z', // Earlier timestamp
      });

      const result = sortMessages(first, second);
      expect(result).toBeLessThan(0); // first (eventIndex 1) should come first
    });

    it('should sort by blockIndex when both have blockIndex', () => {
      const first = createMessage({
        sequence_number: null,
        blockIndex: 0,
        created_at: '2024-01-01T01:00:00Z',
      });
      const second = createMessage({
        sequence_number: null,
        blockIndex: 1,
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = sortMessages(first, second);
      expect(result).toBeLessThan(0); // blockIndex 0 should come first
    });

    it('should prefer blockIndex over eventIndex when both present', () => {
      const withBlock = createMessage({
        sequence_number: null,
        blockIndex: 2,
        eventIndex: 1, // Lower eventIndex but blockIndex takes precedence
      });
      const withEvent = createMessage({
        sequence_number: null,
        blockIndex: 1,
        eventIndex: 5,
      });

      const result = sortMessages(withBlock, withEvent);
      expect(result).toBeGreaterThan(0); // blockIndex 2 > blockIndex 1
    });

    it('should fall back to timestamp when no eventIndex/blockIndex', () => {
      const earlier = createMessage({
        sequence_number: null,
        created_at: '2024-01-01T00:00:00Z',
      });
      const later = createMessage({
        sequence_number: null,
        created_at: '2024-01-01T01:00:00Z',
      });

      const result = sortMessages(earlier, later);
      expect(result).toBeLessThan(0); // earlier should come first
    });

    it('should fall back to timestamp when eventIndex is -1', () => {
      const earlier = createMessage({
        sequence_number: null,
        eventIndex: -1,
        created_at: '2024-01-01T00:00:00Z',
      });
      const later = createMessage({
        sequence_number: null,
        eventIndex: -1,
        created_at: '2024-01-01T01:00:00Z',
      });

      const result = sortMessages(earlier, later);
      expect(result).toBeLessThan(0);
    });
  });

  describe('edge cases', () => {
    it('should return 0 for identical messages', () => {
      const timestamp = '2024-01-01T00:00:00Z';
      const msg1 = createMessage({
        sequence_number: 1,
        created_at: timestamp,
      });
      const msg2 = createMessage({
        sequence_number: 1,
        created_at: timestamp,
      });

      const result = sortMessages(msg1, msg2);
      expect(result).toBe(0);
    });

    it('should handle undefined eventIndex/blockIndex', () => {
      const msg1 = createMessage({
        sequence_number: null,
        created_at: '2024-01-01T00:00:00Z',
      });
      const msg2 = createMessage({
        sequence_number: null,
        eventIndex: 0,
        created_at: '2024-01-01T01:00:00Z',
      });

      // msg1 has no index (treated as -1), msg2 has eventIndex 0
      // Since msg1 has -1 and msg2 has 0, and only one has a valid index,
      // they should fall back to timestamp comparison
      const result = sortMessages(msg1, msg2);
      expect(result).toBeLessThan(0); // Earlier timestamp first
    });
  });
});

// ============================================================================
// Tests: sortMessagesInPlace
// ============================================================================

describe('sortMessagesInPlace', () => {
  it('should sort the array in place and return it', () => {
    const messages = [
      createMessage({ sequence_number: 3 }),
      createMessage({ sequence_number: 1 }),
      createMessage({ sequence_number: 2 }),
    ];

    const result = sortMessagesInPlace(messages);

    // Should be same reference
    expect(result).toBe(messages);

    // Should be sorted
    expect(messages[0].sequence_number).toBe(1);
    expect(messages[1].sequence_number).toBe(2);
    expect(messages[2].sequence_number).toBe(3);
  });

  it('should handle empty array', () => {
    const messages: SortableMessage[] = [];
    const result = sortMessagesInPlace(messages);
    expect(result).toEqual([]);
  });

  it('should handle single element array', () => {
    const messages = [createMessage({ sequence_number: 1 })];
    const result = sortMessagesInPlace(messages);
    expect(result).toHaveLength(1);
    expect(result[0].sequence_number).toBe(1);
  });
});
