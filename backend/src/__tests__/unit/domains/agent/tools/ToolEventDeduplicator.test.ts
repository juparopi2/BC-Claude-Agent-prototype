/**
 * @module ToolEventDeduplicator.test
 *
 * Unit tests for ToolEventDeduplicator.
 * Tests prevention of duplicate tool_use events during streaming.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolEventDeduplicator,
  createToolEventDeduplicator,
} from '@/domains/agent/tools';

describe('ToolEventDeduplicator', () => {
  let deduplicator: ToolEventDeduplicator;

  beforeEach(() => {
    deduplicator = new ToolEventDeduplicator();
  });

  describe('checkAndMark()', () => {
    it('should return isDuplicate=false for first occurrence', () => {
      const result = deduplicator.checkAndMark('toolu_123');

      expect(result.isDuplicate).toBe(false);
      expect(result.toolUseId).toBe('toolu_123');
      expect(result.firstSeenAt).toBeDefined();
    });

    it('should return isDuplicate=true for second occurrence', () => {
      deduplicator.checkAndMark('toolu_123');
      const result = deduplicator.checkAndMark('toolu_123');

      expect(result.isDuplicate).toBe(true);
      expect(result.toolUseId).toBe('toolu_123');
    });

    it('should return isDuplicate=true for third+ occurrence', () => {
      deduplicator.checkAndMark('toolu_123');
      deduplicator.checkAndMark('toolu_123');
      const result = deduplicator.checkAndMark('toolu_123');

      expect(result.isDuplicate).toBe(true);
    });

    it('should track multiple different tool_use_ids independently', () => {
      const result1 = deduplicator.checkAndMark('toolu_aaa');
      const result2 = deduplicator.checkAndMark('toolu_bbb');
      const result3 = deduplicator.checkAndMark('toolu_ccc');

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
      expect(result3.isDuplicate).toBe(false);
    });

    it('should detect duplicates per tool_use_id', () => {
      deduplicator.checkAndMark('toolu_aaa');
      deduplicator.checkAndMark('toolu_bbb');

      const duplicateA = deduplicator.checkAndMark('toolu_aaa');
      const duplicateB = deduplicator.checkAndMark('toolu_bbb');
      const newC = deduplicator.checkAndMark('toolu_ccc');

      expect(duplicateA.isDuplicate).toBe(true);
      expect(duplicateB.isDuplicate).toBe(true);
      expect(newC.isDuplicate).toBe(false);
    });

    it('should preserve firstSeenAt timestamp for duplicates', () => {
      const first = deduplicator.checkAndMark('toolu_123');
      const second = deduplicator.checkAndMark('toolu_123');

      expect(second.firstSeenAt).toBe(first.firstSeenAt);
    });

    it('should handle empty string tool_use_id', () => {
      const result = deduplicator.checkAndMark('');

      expect(result.isDuplicate).toBe(false);
      expect(result.toolUseId).toBe('');
    });

    it('should handle special characters in tool_use_id', () => {
      const specialId = 'toolu_abc-123_xyz!@#$%';
      const result = deduplicator.checkAndMark(specialId);

      expect(result.isDuplicate).toBe(false);
      expect(result.toolUseId).toBe(specialId);
    });

    it('should handle UUID-style tool_use_ids', () => {
      const uuidId = 'toolu_550e8400-e29b-41d4-a716-446655440000';
      const result1 = deduplicator.checkAndMark(uuidId);
      const result2 = deduplicator.checkAndMark(uuidId);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(true);
    });

    it('should handle fallback-style tool_use_ids', () => {
      const fallbackId = 'toolu_fallback_abc123';
      const result = deduplicator.checkAndMark(fallbackId);

      expect(result.isDuplicate).toBe(false);
      expect(result.toolUseId).toBe(fallbackId);
    });
  });

  describe('hasSeen()', () => {
    it('should return false for unseen tool_use_id', () => {
      expect(deduplicator.hasSeen('toolu_123')).toBe(false);
    });

    it('should return true for seen tool_use_id', () => {
      deduplicator.checkAndMark('toolu_123');

      expect(deduplicator.hasSeen('toolu_123')).toBe(true);
    });

    it('should not mark tool_use_id as seen', () => {
      deduplicator.hasSeen('toolu_123');

      expect(deduplicator.hasSeen('toolu_123')).toBe(false);
    });

    it('should work independently of checkAndMark', () => {
      // First check with hasSeen (doesn't mark)
      expect(deduplicator.hasSeen('toolu_123')).toBe(false);
      expect(deduplicator.hasSeen('toolu_123')).toBe(false);

      // Now mark it
      deduplicator.checkAndMark('toolu_123');

      // hasSeen should now return true
      expect(deduplicator.hasSeen('toolu_123')).toBe(true);
    });
  });

  describe('getStats()', () => {
    it('should return zero stats initially', () => {
      const stats = deduplicator.getStats();

      expect(stats.totalTracked).toBe(0);
      expect(stats.duplicatesPrevented).toBe(0);
    });

    it('should count tracked tool_use_ids', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.checkAndMark('toolu_2');
      deduplicator.checkAndMark('toolu_3');

      const stats = deduplicator.getStats();

      expect(stats.totalTracked).toBe(3);
    });

    it('should not double-count duplicates in totalTracked', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.checkAndMark('toolu_1'); // duplicate
      deduplicator.checkAndMark('toolu_2');
      deduplicator.checkAndMark('toolu_2'); // duplicate

      const stats = deduplicator.getStats();

      expect(stats.totalTracked).toBe(2); // Only unique IDs
    });

    it('should count duplicates prevented', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.checkAndMark('toolu_1'); // 1st duplicate
      deduplicator.checkAndMark('toolu_1'); // 2nd duplicate
      deduplicator.checkAndMark('toolu_2');
      deduplicator.checkAndMark('toolu_2'); // 3rd duplicate

      const stats = deduplicator.getStats();

      expect(stats.duplicatesPrevented).toBe(3);
    });

    it('should not count hasSeen() calls as duplicates', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.hasSeen('toolu_1'); // read-only check
      deduplicator.hasSeen('toolu_1'); // read-only check

      const stats = deduplicator.getStats();

      expect(stats.duplicatesPrevented).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear all tracked tool_use_ids', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.checkAndMark('toolu_2');

      deduplicator.reset();

      expect(deduplicator.hasSeen('toolu_1')).toBe(false);
      expect(deduplicator.hasSeen('toolu_2')).toBe(false);
    });

    it('should reset statistics', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.checkAndMark('toolu_1'); // duplicate

      deduplicator.reset();

      const stats = deduplicator.getStats();
      expect(stats.totalTracked).toBe(0);
      expect(stats.duplicatesPrevented).toBe(0);
    });

    it('should allow re-tracking after reset', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.reset();

      const result = deduplicator.checkAndMark('toolu_1');

      expect(result.isDuplicate).toBe(false);
    });

    it('should be idempotent', () => {
      deduplicator.checkAndMark('toolu_1');
      deduplicator.reset();
      deduplicator.reset();
      deduplicator.reset();

      const stats = deduplicator.getStats();
      expect(stats.totalTracked).toBe(0);
    });
  });

  describe('createToolEventDeduplicator()', () => {
    it('should create new instances', () => {
      const ded1 = createToolEventDeduplicator();
      const ded2 = createToolEventDeduplicator();

      expect(ded1).not.toBe(ded2);
    });

    it('should create independent deduplicators', () => {
      const ded1 = createToolEventDeduplicator();
      const ded2 = createToolEventDeduplicator();

      ded1.checkAndMark('toolu_123');

      expect(ded1.hasSeen('toolu_123')).toBe(true);
      expect(ded2.hasSeen('toolu_123')).toBe(false);
    });

    it('should return ToolEventDeduplicator instances', () => {
      const ded = createToolEventDeduplicator();
      expect(ded).toBeInstanceOf(ToolEventDeduplicator);
    });
  });

  describe('realistic streaming scenario', () => {
    it('should handle typical LangGraph duplicate tool events', () => {
      // Simulate LangGraph emitting same tool via different paths
      // Path 1: on_chain_end with tool execution
      const result1 = deduplicator.checkAndMark('toolu_get_customers_123');
      expect(result1.isDuplicate).toBe(false);

      // Path 2: Direct tool callback with same ID
      const result2 = deduplicator.checkAndMark('toolu_get_customers_123');
      expect(result2.isDuplicate).toBe(true);

      // New tool is not duplicate
      const result3 = deduplicator.checkAndMark('toolu_create_order_456');
      expect(result3.isDuplicate).toBe(false);

      // Verify stats
      const stats = deduplicator.getStats();
      expect(stats.totalTracked).toBe(2);
      expect(stats.duplicatesPrevented).toBe(1);
    });

    it('should handle multi-turn conversation with reset', () => {
      // Turn 1: User asks about customers
      deduplicator.checkAndMark('toolu_turn1_tool1');
      deduplicator.checkAndMark('toolu_turn1_tool2');

      // Reset for turn 2
      deduplicator.reset();

      // Turn 2: Same tool names but new IDs are not duplicates
      const result = deduplicator.checkAndMark('toolu_turn2_tool1');
      expect(result.isDuplicate).toBe(false);
    });

    it('should handle rapid successive tool calls', () => {
      // Simulate burst of tool calls
      const toolIds = Array.from({ length: 10 }, (_, i) => `toolu_burst_${i}`);

      for (const id of toolIds) {
        const result = deduplicator.checkAndMark(id);
        expect(result.isDuplicate).toBe(false);
      }

      // All should be tracked
      const stats = deduplicator.getStats();
      expect(stats.totalTracked).toBe(10);
      expect(stats.duplicatesPrevented).toBe(0);
    });

    it('should handle tool retry scenario', () => {
      // Tool fails, agent retries with SAME tool_use_id (LangGraph behavior)
      const toolId = 'toolu_retry_123';

      // First attempt
      const attempt1 = deduplicator.checkAndMark(toolId);
      expect(attempt1.isDuplicate).toBe(false);

      // Retry (should be detected as duplicate)
      const attempt2 = deduplicator.checkAndMark(toolId);
      expect(attempt2.isDuplicate).toBe(true);

      // In reality, retries should use new tool_use_id
      const newAttempt = deduplicator.checkAndMark('toolu_retry_456');
      expect(newAttempt.isDuplicate).toBe(false);
    });
  });
});
