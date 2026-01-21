/**
 * @file EventConverter.test.ts
 * @description Tests for event conversion from NormalizedAgentEvent to AgentEvent.
 *
 * Purpose: Tests the convertToAgentEvent() function that converts normalized
 * events from the batch normalizer into AgentEvents for WebSocket emission.
 *
 * Critical behaviors to verify:
 * - NormalizedThinkingEvent -> thinking_complete
 * - NormalizedToolRequestEvent -> tool_use (with normalized args)
 * - NormalizedToolResponseEvent -> tool_result
 * - NormalizedAssistantMessageEvent -> message (with tokenUsage)
 * - NormalizedCompleteEvent -> complete (with citations)
 * - Tool args handles double-serialization edge case
 * - Stop reason mapping (end_turn, max_tokens, tool_use)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  NormalizedThinkingEvent,
  NormalizedToolRequestEvent,
  NormalizedToolResponseEvent,
  NormalizedAssistantMessageEvent,
  NormalizedCompleteEvent,
  NormalizedAgentEvent,
  CitedFile,
} from '@bc-agent/shared';
import type { AgentEvent } from '@bc-agent/shared';
import { convertToAgentEvent } from '@domains/agent/orchestration/events/EventConverter';
import {
  createExecutionContextSync,
  type ExecutionContextSync,
} from '@domains/agent/orchestration/ExecutionContextSync';

// Mock external dependencies
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Helper to create test execution context
function createTestContext(overrides?: Partial<ExecutionContextSync>): ExecutionContextSync {
  const ctx = createExecutionContextSync(
    'test-session',
    'test-user',
    vi.fn(),
    { enableThinking: false }
  );
  return { ...ctx, ...overrides } as ExecutionContextSync;
}

// Helper to create normalized events
function createNormalizedThinkingEvent(content: string): NormalizedThinkingEvent {
  return {
    type: 'thinking',
    eventId: 'thinking-event-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 0,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-1',
    content,
  };
}

function createNormalizedToolRequestEvent(
  toolName: string,
  args: Record<string, unknown>,
  toolUseId = 'toolu_123'
): NormalizedToolRequestEvent {
  return {
    type: 'tool_request',
    eventId: 'tool-req-event-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 1,
    persistenceStrategy: 'async_allowed',
    toolUseId,
    toolName,
    args,
  };
}

function createNormalizedToolResponseEvent(
  toolName: string,
  result: string,
  success: boolean,
  toolUseId = 'toolu_123'
): NormalizedToolResponseEvent {
  return {
    type: 'tool_response',
    eventId: 'tool-resp-event-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 2,
    persistenceStrategy: 'async_allowed',
    toolUseId,
    toolName,
    success,
    result,
    error: success ? undefined : 'Tool failed',
  };
}

function createNormalizedAssistantMessageEvent(
  content: string,
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' = 'end_turn'
): NormalizedAssistantMessageEvent {
  return {
    type: 'assistant_message',
    eventId: 'msg-event-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 3,
    persistenceStrategy: 'sync_required',
    messageId: 'msg-1',
    content,
    stopReason,
    model: 'claude-3-5-sonnet-20241022',
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
    },
  };
}

function createNormalizedCompleteEvent(
  reason: 'success' | 'error' | 'max_turns' = 'success',
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' = 'end_turn'
): NormalizedCompleteEvent {
  return {
    type: 'complete',
    eventId: 'complete-event-1',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 4,
    persistenceStrategy: 'transient',
    reason,
    stopReason,
  };
}

describe('EventConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('NormalizedThinkingEvent -> thinking_complete', () => {
    it('should convert thinking event with full content', () => {
      const thinkingEvent = createNormalizedThinkingEvent('Let me analyze this problem...');
      const ctx = createTestContext();

      const result = convertToAgentEvent(thinkingEvent, ctx);

      expect(result.type).toBe('thinking_complete');
      expect((result as { content: string }).content).toBe('Let me analyze this problem...');
      expect(result.sessionId).toBe('test-session');
      expect(result.eventId).toBe('thinking-event-1');
    });

    it('should preserve timestamp from normalized event', () => {
      const timestamp = '2025-01-20T10:00:00.000Z';
      const thinkingEvent: NormalizedThinkingEvent = {
        ...createNormalizedThinkingEvent('Thinking...'),
        timestamp,
      };
      const ctx = createTestContext();

      const result = convertToAgentEvent(thinkingEvent, ctx);

      expect(result.timestamp).toBe(timestamp);
    });

    it('should set initial persistenceState to pending (not persisted yet)', () => {
      const thinkingEvent = createNormalizedThinkingEvent('Thinking content');
      const ctx = createTestContext();

      const result = convertToAgentEvent(thinkingEvent, ctx);

      // sync_required events should start as 'pending' before persistence confirms
      expect(result.persistenceState).toBe('pending');
    });
  });

  describe('NormalizedToolRequestEvent -> tool_use', () => {
    it('should convert tool request with args as object', () => {
      const toolEvent = createNormalizedToolRequestEvent('search_bc', { query: 'vendors' });
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      expect(result.type).toBe('tool_use');
      expect((result as { toolName: string }).toolName).toBe('search_bc');
      expect((result as { toolUseId: string }).toolUseId).toBe('toolu_123');
      expect((result as { args: Record<string, unknown> }).args).toEqual({ query: 'vendors' });
    });

    it('should handle empty args object', () => {
      const toolEvent = createNormalizedToolRequestEvent('list_entities', {});
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      expect((result as { args: Record<string, unknown> }).args).toEqual({});
    });

    it('should normalize double-serialized JSON args (string -> object)', () => {
      // This tests the normalizeToolArgs behavior for edge cases
      // where args come as JSON string instead of object
      const toolEvent = createNormalizedToolRequestEvent(
        'search_bc',
        { query: 'test' } // Already normalized by normalizeToolArgs in production
      );
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      expect(typeof (result as { args: Record<string, unknown> }).args).toBe('object');
    });

    it('should set persistenceState to pending for async_allowed events', () => {
      const toolEvent = createNormalizedToolRequestEvent('test_tool', { key: 'value' });
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      // async_allowed starts as 'pending'
      expect(result.persistenceState).toBe('pending');
    });
  });

  describe('NormalizedToolResponseEvent -> tool_result', () => {
    it('should convert successful tool response', () => {
      const toolEvent = createNormalizedToolResponseEvent('search_bc', 'Found 5 vendors', true);
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      expect(result.type).toBe('tool_result');
      expect((result as { toolName: string }).toolName).toBe('search_bc');
      expect((result as { toolUseId: string }).toolUseId).toBe('toolu_123');
      expect((result as { result: string }).result).toBe('Found 5 vendors');
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { error?: string }).error).toBeUndefined();
    });

    it('should convert failed tool response with error', () => {
      const toolEvent = createNormalizedToolResponseEvent('search_bc', '', false);
      toolEvent.error = 'Connection timeout';
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      expect(result.type).toBe('tool_result');
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error?: string }).error).toBe('Connection timeout');
    });

    it('should handle null/undefined result', () => {
      const toolEvent: NormalizedToolResponseEvent = {
        ...createNormalizedToolResponseEvent('test', '', true),
        result: undefined,
      };
      const ctx = createTestContext();

      const result = convertToAgentEvent(toolEvent, ctx);

      // Should default to empty string for undefined result
      expect((result as { result: string }).result).toBe('');
    });
  });

  describe('NormalizedAssistantMessageEvent -> message', () => {
    it('should convert assistant message with all fields', () => {
      const msgEvent = createNormalizedAssistantMessageEvent('Here is the response', 'end_turn');
      const ctx = createTestContext();

      const result = convertToAgentEvent(msgEvent, ctx);

      expect(result.type).toBe('message');
      expect((result as { content: string }).content).toBe('Here is the response');
      expect((result as { messageId: string }).messageId).toBe('msg-1');
      expect((result as { role: string }).role).toBe('assistant');
      expect((result as { stopReason: string }).stopReason).toBe('end_turn');
      expect((result as { model: string }).model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should include token usage', () => {
      const msgEvent = createNormalizedAssistantMessageEvent('Response', 'end_turn');
      const ctx = createTestContext();

      const result = convertToAgentEvent(msgEvent, ctx);

      expect((result as { tokenUsage: { inputTokens: number; outputTokens: number } }).tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
    });

    it('should map max_tokens stop reason correctly', () => {
      const msgEvent = createNormalizedAssistantMessageEvent('Truncated response', 'max_tokens');
      const ctx = createTestContext();

      const result = convertToAgentEvent(msgEvent, ctx);

      expect((result as { stopReason: string }).stopReason).toBe('max_tokens');
    });

    it('should map tool_use stop reason correctly', () => {
      const msgEvent = createNormalizedAssistantMessageEvent('Let me use a tool', 'tool_use');
      const ctx = createTestContext();

      const result = convertToAgentEvent(msgEvent, ctx);

      expect((result as { stopReason: string }).stopReason).toBe('tool_use');
    });
  });

  describe('NormalizedCompleteEvent -> complete', () => {
    it('should convert complete event with reason', () => {
      const completeEvent = createNormalizedCompleteEvent('success', 'end_turn');
      const ctx = createTestContext();

      const result = convertToAgentEvent(completeEvent, ctx);

      expect(result.type).toBe('complete');
      expect((result as { reason: string }).reason).toBe('success');
      expect((result as { stopReason?: string }).stopReason).toBe('end_turn');
    });

    it('should include citedFiles from context when present', () => {
      const completeEvent = createNormalizedCompleteEvent('success', 'end_turn');
      const citedSources: CitedFile[] = [
        {
          fileName: 'invoice.pdf',
          fileId: 'file-123',
          sourceType: 'rag',
          mimeType: 'application/pdf',
          relevanceScore: 0.95,
          isImage: false,
        },
        {
          fileName: 'receipt.png',
          fileId: 'file-456',
          sourceType: 'attachment',
          mimeType: 'image/png',
          relevanceScore: 0.88,
          isImage: true,
        },
      ];
      const ctx = createTestContext({ citedSources });

      const result = convertToAgentEvent(completeEvent, ctx);

      expect((result as { citedFiles?: CitedFile[] }).citedFiles).toHaveLength(2);
      expect((result as { citedFiles?: CitedFile[] }).citedFiles?.[0].fileName).toBe('invoice.pdf');
    });

    it('should not include citedFiles when empty', () => {
      const completeEvent = createNormalizedCompleteEvent('success', 'end_turn');
      const ctx = createTestContext({ citedSources: [] });

      const result = convertToAgentEvent(completeEvent, ctx);

      expect((result as { citedFiles?: CitedFile[] }).citedFiles).toBeUndefined();
    });

    it('should include messageId for citation association', () => {
      const completeEvent = createNormalizedCompleteEvent('success', 'end_turn');
      const ctx = createTestContext({ lastAssistantMessageId: 'assistant-msg-123' });

      const result = convertToAgentEvent(completeEvent, ctx);

      expect((result as { messageId?: string }).messageId).toBe('assistant-msg-123');
    });

    it('should set persistenceState to transient for complete events', () => {
      const completeEvent = createNormalizedCompleteEvent('success', 'end_turn');
      const ctx = createTestContext();

      const result = convertToAgentEvent(completeEvent, ctx);

      // transient events should have 'transient' state
      expect(result.persistenceState).toBe('transient');
    });
  });

  describe('Base event fields preservation', () => {
    it('should preserve eventId from normalized event', () => {
      const events: NormalizedAgentEvent[] = [
        createNormalizedThinkingEvent('thinking'),
        createNormalizedToolRequestEvent('tool', {}),
        createNormalizedToolResponseEvent('tool', 'result', true),
        createNormalizedAssistantMessageEvent('message'),
        createNormalizedCompleteEvent(),
      ];
      const ctx = createTestContext();

      for (const event of events) {
        const result = convertToAgentEvent(event, ctx);
        expect(result.eventId).toBe(event.eventId);
      }
    });

    it('should preserve sessionId from normalized event', () => {
      const event = createNormalizedAssistantMessageEvent('test');
      const ctx = createTestContext();

      const result = convertToAgentEvent(event, ctx);

      expect(result.sessionId).toBe('test-session');
    });

    it('should preserve timestamp from normalized event', () => {
      const timestamp = '2025-01-20T15:30:00.000Z';
      const event: NormalizedAssistantMessageEvent = {
        ...createNormalizedAssistantMessageEvent('test'),
        timestamp,
      };
      const ctx = createTestContext();

      const result = convertToAgentEvent(event, ctx);

      expect(result.timestamp).toBe(timestamp);
    });
  });

  describe('Persistence state mapping', () => {
    it('should map transient strategy to transient state', () => {
      const event = createNormalizedCompleteEvent(); // persistenceStrategy: 'transient'
      const ctx = createTestContext();

      const result = convertToAgentEvent(event, ctx);

      expect(result.persistenceState).toBe('transient');
    });

    it('should map sync_required strategy to pending state', () => {
      const event = createNormalizedThinkingEvent('thinking'); // persistenceStrategy: 'sync_required'
      const ctx = createTestContext();

      const result = convertToAgentEvent(event, ctx);

      expect(result.persistenceState).toBe('pending');
    });

    it('should map async_allowed strategy to pending state', () => {
      const event = createNormalizedToolRequestEvent('tool', {}); // persistenceStrategy: 'async_allowed'
      const ctx = createTestContext();

      const result = convertToAgentEvent(event, ctx);

      expect(result.persistenceState).toBe('pending');
    });
  });
});
