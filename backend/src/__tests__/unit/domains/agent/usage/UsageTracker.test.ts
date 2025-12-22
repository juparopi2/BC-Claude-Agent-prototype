/**
 * @module UsageTracker.test
 *
 * Unit tests for UsageTracker.
 * Tests token usage accumulation during agent runs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UsageTracker, createUsageTracker } from '@/domains/agent/usage';

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  describe('addUsage()', () => {
    it('should accumulate input tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 0 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 0 });

      expect(tracker.getInputTokens()).toBe(300);
    });

    it('should accumulate output tokens', () => {
      tracker.addUsage({ inputTokens: 0, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 0, outputTokens: 100 });

      expect(tracker.getOutputTokens()).toBe(150);
    });

    it('should accumulate both input and output tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });

      expect(tracker.getInputTokens()).toBe(300);
      expect(tracker.getOutputTokens()).toBe(150);
      expect(tracker.getTotalTokens()).toBe(450);
    });

    it('should handle zero tokens gracefully', () => {
      tracker.addUsage({ inputTokens: 0, outputTokens: 0 });

      expect(tracker.hasUsage()).toBe(false);
      expect(tracker.getTotalTokens()).toBe(0);
    });

    it('should ignore events with zero tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 0, outputTokens: 0 });

      const accumulated = tracker.getAccumulated();
      expect(accumulated.eventCount).toBe(1);
    });

    it('should count events with only input tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 0 });

      expect(tracker.hasUsage()).toBe(true);
      const accumulated = tracker.getAccumulated();
      expect(accumulated.eventCount).toBe(1);
    });

    it('should count events with only output tokens', () => {
      tracker.addUsage({ inputTokens: 0, outputTokens: 50 });

      expect(tracker.hasUsage()).toBe(true);
      const accumulated = tracker.getAccumulated();
      expect(accumulated.eventCount).toBe(1);
    });

    it('should handle large token counts', () => {
      tracker.addUsage({ inputTokens: 100000, outputTokens: 50000 });
      tracker.addUsage({ inputTokens: 200000, outputTokens: 100000 });

      expect(tracker.getTotalTokens()).toBe(450000);
    });

    it('should handle negative values as-is (no validation)', () => {
      tracker.addUsage({ inputTokens: -100, outputTokens: 50 });

      // Note: Validation should happen upstream
      expect(tracker.getInputTokens()).toBe(-100);
    });
  });

  describe('getAccumulated()', () => {
    it('should return zero values initially', () => {
      const accumulated = tracker.getAccumulated();

      expect(accumulated.totalInputTokens).toBe(0);
      expect(accumulated.totalOutputTokens).toBe(0);
      expect(accumulated.totalTokens).toBe(0);
      expect(accumulated.eventCount).toBe(0);
    });

    it('should return correct accumulated values', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });
      tracker.addUsage({ inputTokens: 300, outputTokens: 150 });

      const accumulated = tracker.getAccumulated();

      expect(accumulated.totalInputTokens).toBe(600);
      expect(accumulated.totalOutputTokens).toBe(300);
      expect(accumulated.totalTokens).toBe(900);
      expect(accumulated.eventCount).toBe(3);
    });

    it('should return same values on multiple calls', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });

      const first = tracker.getAccumulated();
      const second = tracker.getAccumulated();

      expect(first).toEqual(second);
    });

    it('should return a new object each time', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });

      const first = tracker.getAccumulated();
      const second = tracker.getAccumulated();

      expect(first).not.toBe(second);
    });
  });

  describe('hasUsage()', () => {
    it('should return false initially', () => {
      expect(tracker.hasUsage()).toBe(false);
    });

    it('should return true after adding usage', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      expect(tracker.hasUsage()).toBe(true);
    });

    it('should return false after zero-only usage', () => {
      tracker.addUsage({ inputTokens: 0, outputTokens: 0 });
      expect(tracker.hasUsage()).toBe(false);
    });

    it('should return false after reset', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.reset();
      expect(tracker.hasUsage()).toBe(false);
    });
  });

  describe('getInputTokens()', () => {
    it('should return 0 initially', () => {
      expect(tracker.getInputTokens()).toBe(0);
    });

    it('should return accumulated input tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });

      expect(tracker.getInputTokens()).toBe(300);
    });
  });

  describe('getOutputTokens()', () => {
    it('should return 0 initially', () => {
      expect(tracker.getOutputTokens()).toBe(0);
    });

    it('should return accumulated output tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });

      expect(tracker.getOutputTokens()).toBe(150);
    });
  });

  describe('getTotalTokens()', () => {
    it('should return 0 initially', () => {
      expect(tracker.getTotalTokens()).toBe(0);
    });

    it('should return sum of input and output tokens', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });

      expect(tracker.getTotalTokens()).toBe(150);
    });
  });

  describe('reset()', () => {
    it('should clear all accumulated usage', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.reset();

      expect(tracker.getInputTokens()).toBe(0);
      expect(tracker.getOutputTokens()).toBe(0);
      expect(tracker.getTotalTokens()).toBe(0);
    });

    it('should reset event count', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });
      tracker.reset();

      const accumulated = tracker.getAccumulated();
      expect(accumulated.eventCount).toBe(0);
    });

    it('should allow re-accumulation after reset', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.reset();
      tracker.addUsage({ inputTokens: 200, outputTokens: 100 });

      expect(tracker.getTotalTokens()).toBe(300);
    });

    it('should be idempotent', () => {
      tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.reset();
      tracker.reset();
      tracker.reset();

      expect(tracker.getTotalTokens()).toBe(0);
    });
  });

  describe('createUsageTracker()', () => {
    it('should create new instances', () => {
      const tracker1 = createUsageTracker();
      const tracker2 = createUsageTracker();

      expect(tracker1).not.toBe(tracker2);
    });

    it('should create independent trackers', () => {
      const tracker1 = createUsageTracker();
      const tracker2 = createUsageTracker();

      tracker1.addUsage({ inputTokens: 100, outputTokens: 50 });
      tracker2.addUsage({ inputTokens: 200, outputTokens: 100 });

      expect(tracker1.getTotalTokens()).toBe(150);
      expect(tracker2.getTotalTokens()).toBe(300);
    });

    it('should return UsageTracker instances', () => {
      const tracker = createUsageTracker();
      expect(tracker).toBeInstanceOf(UsageTracker);
    });
  });

  describe('realistic streaming scenario', () => {
    it('should handle typical Claude response with tool use', () => {
      // Initial response
      tracker.addUsage({ inputTokens: 1500, outputTokens: 200 });

      // Tool call response
      tracker.addUsage({ inputTokens: 800, outputTokens: 150 });

      // Final response
      tracker.addUsage({ inputTokens: 500, outputTokens: 300 });

      const accumulated = tracker.getAccumulated();

      expect(accumulated.totalInputTokens).toBe(2800);
      expect(accumulated.totalOutputTokens).toBe(650);
      expect(accumulated.totalTokens).toBe(3450);
      expect(accumulated.eventCount).toBe(3);
    });

    it('should handle multi-turn conversation with reset', () => {
      // Turn 1
      tracker.addUsage({ inputTokens: 1000, outputTokens: 200 });
      const turn1 = tracker.getAccumulated();

      // Reset for turn 2
      tracker.reset();

      // Turn 2
      tracker.addUsage({ inputTokens: 1500, outputTokens: 300 });
      const turn2 = tracker.getAccumulated();

      expect(turn1.totalTokens).toBe(1200);
      expect(turn2.totalTokens).toBe(1800);
    });

    it('should handle extended thinking session', () => {
      // With thinking enabled, usage can be higher
      tracker.addUsage({ inputTokens: 2000, outputTokens: 5000 }); // Thinking output

      const accumulated = tracker.getAccumulated();

      expect(accumulated.totalInputTokens).toBe(2000);
      expect(accumulated.totalOutputTokens).toBe(5000);
      expect(accumulated.eventCount).toBe(1);
    });

    it('should handle rapid successive usage events', () => {
      // Simulate burst of usage events
      for (let i = 0; i < 10; i++) {
        tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
      }

      const accumulated = tracker.getAccumulated();

      expect(accumulated.totalInputTokens).toBe(1000);
      expect(accumulated.totalOutputTokens).toBe(500);
      expect(accumulated.eventCount).toBe(10);
    });

    it('should handle empty response (no output)', () => {
      // Edge case: prompt processed but no response
      tracker.addUsage({ inputTokens: 500, outputTokens: 0 });

      expect(tracker.getInputTokens()).toBe(500);
      expect(tracker.getOutputTokens()).toBe(0);
      expect(tracker.hasUsage()).toBe(true);
    });
  });
});
