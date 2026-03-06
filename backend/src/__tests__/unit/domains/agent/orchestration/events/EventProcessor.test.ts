/**
 * EventProcessor Unit Tests
 *
 * Tests for trackAssistantMessageState with cache tokens and per-agent usage.
 */

import { describe, it, expect } from 'vitest';
import { trackAssistantMessageState } from '@/domains/agent/orchestration/events/EventProcessor';
import { createExecutionContextSync } from '@/domains/agent/orchestration/ExecutionContextSync';
import type { NormalizedAssistantMessageEvent } from '@bc-agent/shared';

function createAssistantEvent(overrides?: Partial<NormalizedAssistantMessageEvent>): NormalizedAssistantMessageEvent {
  return {
    type: 'assistant_message',
    eventId: 'evt-1',
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    originalIndex: 0,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-1',
    content: 'Hello',
    stopReason: 'end_turn',
    model: 'claude-haiku-4-5-20251001',
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    ...overrides,
  };
}

describe('EventProcessor', () => {
  describe('trackAssistantMessageState', () => {
    it('should propagate cache tokens to context', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');
      const event = createAssistantEvent({
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 2921,
          cacheReadTokens: 500,
        },
      });

      trackAssistantMessageState(event, ctx);

      expect(ctx.totalCacheCreationTokens).toBe(2921);
      expect(ctx.totalCacheReadTokens).toBe(500);
    });

    it('should accumulate usage across multiple assistant messages (multi-agent)', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      // Supervisor response
      const supervisorEvent = createAssistantEvent({
        sourceAgentId: 'supervisor',
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 200,
          cacheCreationTokens: 3000,
          cacheReadTokens: 0,
        },
      });

      // Worker response
      const workerEvent = createAssistantEvent({
        sourceAgentId: 'bc_agent',
        messageId: 'msg-2',
        tokenUsage: {
          inputTokens: 500,
          outputTokens: 300,
          cacheCreationTokens: 0,
          cacheReadTokens: 2500,
        },
      });

      trackAssistantMessageState(supervisorEvent, ctx);
      trackAssistantMessageState(workerEvent, ctx);

      // Totals should be accumulated
      expect(ctx.totalInputTokens).toBe(1500);
      expect(ctx.totalOutputTokens).toBe(500);
      expect(ctx.totalCacheCreationTokens).toBe(3000);
      expect(ctx.totalCacheReadTokens).toBe(2500);
    });

    it('should accumulate perAgentUsage map', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');

      const supervisorEvent = createAssistantEvent({
        sourceAgentId: 'supervisor',
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 200,
          cacheCreationTokens: 3000,
        },
      });

      const workerEvent = createAssistantEvent({
        sourceAgentId: 'bc_agent',
        messageId: 'msg-2',
        tokenUsage: {
          inputTokens: 500,
          outputTokens: 300,
          cacheReadTokens: 2500,
        },
      });

      trackAssistantMessageState(supervisorEvent, ctx);
      trackAssistantMessageState(workerEvent, ctx);

      expect(ctx.perAgentUsage.size).toBe(2);

      const supervisorUsage = ctx.perAgentUsage.get('supervisor');
      expect(supervisorUsage).toEqual({
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: 3000,
        cacheReadTokens: 0,
        model: 'claude-haiku-4-5-20251001',
      });

      const workerUsage = ctx.perAgentUsage.get('bc_agent');
      expect(workerUsage).toEqual({
        inputTokens: 500,
        outputTokens: 300,
        cacheCreationTokens: 0,
        cacheReadTokens: 2500,
        model: 'claude-haiku-4-5-20251001',
      });
    });

    it('should use "unknown" as agentId when sourceAgentId is missing', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');
      const event = createAssistantEvent({
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      trackAssistantMessageState(event, ctx);

      expect(ctx.perAgentUsage.has('unknown')).toBe(true);
      const usage = ctx.perAgentUsage.get('unknown');
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.model).toBe('claude-haiku-4-5-20251001');
    });

    it('should not track usage for non-assistant_message events', () => {
      const ctx = createExecutionContextSync('session-1', 'user-1');
      const thinkingEvent = {
        type: 'thinking' as const,
        eventId: 'evt-1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        originalIndex: 0,
        persistenceStrategy: 'sync_required' as const,
        messageId: 'msg-1',
        content: 'thinking...',
      };

      const result = trackAssistantMessageState(thinkingEvent, ctx);

      expect(result).toEqual({});
      expect(ctx.totalInputTokens).toBe(0);
      expect(ctx.perAgentUsage.size).toBe(0);
    });
  });
});
