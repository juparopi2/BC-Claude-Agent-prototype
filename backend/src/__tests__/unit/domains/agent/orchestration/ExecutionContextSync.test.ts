/**
 * ExecutionContextSync Unit Tests
 *
 * Tests for setUsageSync accumulation behavior and cache token tracking.
 */

import { describe, it, expect } from 'vitest';
import {
  createExecutionContextSync,
  setUsageSync,
  getTotalTokensSync,
} from '@/domains/agent/orchestration/ExecutionContextSync';

describe('ExecutionContextSync', () => {
  describe('setUsageSync', () => {
    it('should ACCUMULATE tokens (not overwrite) when called multiple times', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      // Supervisor response
      setUsageSync(ctx, { inputTokens: 1000, outputTokens: 200 });
      // Worker response
      setUsageSync(ctx, { inputTokens: 500, outputTokens: 300 });

      expect(ctx.totalInputTokens).toBe(1500);
      expect(ctx.totalOutputTokens).toBe(500);
      expect(getTotalTokensSync(ctx)).toBe(2000);
    });

    it('should accumulate cache creation and cache read tokens', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      setUsageSync(ctx, {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 2921,
        cacheReadTokens: 500,
      });

      expect(ctx.totalCacheCreationTokens).toBe(2921);
      expect(ctx.totalCacheReadTokens).toBe(500);
    });

    it('should accumulate cache tokens across multiple calls', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      // First agent: creates cache
      setUsageSync(ctx, {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 3000,
        cacheReadTokens: 0,
      });

      // Second agent: reads from cache
      setUsageSync(ctx, {
        inputTokens: 200,
        outputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 2500,
      });

      expect(ctx.totalCacheCreationTokens).toBe(3000);
      expect(ctx.totalCacheReadTokens).toBe(2500);
      expect(ctx.totalInputTokens).toBe(300);
      expect(ctx.totalOutputTokens).toBe(150);
    });

    it('should handle undefined cache tokens gracefully', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      setUsageSync(ctx, { inputTokens: 100, outputTokens: 50 });

      expect(ctx.totalCacheCreationTokens).toBe(0);
      expect(ctx.totalCacheReadTokens).toBe(0);
    });
  });

  describe('createExecutionContextSync', () => {
    it('should initialize all token counters to zero', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      expect(ctx.totalInputTokens).toBe(0);
      expect(ctx.totalOutputTokens).toBe(0);
      expect(ctx.totalCacheCreationTokens).toBe(0);
      expect(ctx.totalCacheReadTokens).toBe(0);
    });

    it('should initialize perAgentUsage as empty Map', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      expect(ctx.perAgentUsage).toBeInstanceOf(Map);
      expect(ctx.perAgentUsage.size).toBe(0);
    });
  });
});
