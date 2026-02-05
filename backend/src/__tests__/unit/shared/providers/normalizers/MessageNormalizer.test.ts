/**
 * MessageNormalizer Unit Tests
 *
 * Tests for the provider-agnostic message normalizer that converts
 * LangChain AIMessages to NormalizedAgentEvent[].
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizeAIMessage, normalizeStopReason } from '@/shared/providers/normalizers/MessageNormalizer';
import type { BaseMessage } from '@langchain/core/messages';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const SESSION_ID = 'test-session-123';

/**
 * Helper to create a mock BaseMessage
 */
function createMockMessage(options: {
  content: string | Array<{ type: string; [key: string]: unknown }>;
  type?: 'ai' | 'human' | 'tool';
  responseMetadata?: Record<string, unknown>;
  usageMetadata?: Record<string, unknown>;
  id?: string;
  tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
}): BaseMessage {
  return {
    _getType: () => options.type ?? 'ai',
    content: options.content,
    response_metadata: options.responseMetadata,
    usage_metadata: options.usageMetadata,
    id: options.id,
    additional_kwargs: {},
    tool_calls: options.tool_calls,
    name: undefined,
  } as unknown as BaseMessage;
}

describe('MessageNormalizer', () => {
  describe('normalizeAIMessage', () => {
    describe('simple text message', () => {
      it('should produce assistant_message event for string content', () => {
        const message = createMockMessage({
          content: 'Hello, I am an AI!',
          responseMetadata: {
            stop_reason: 'end_turn',
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
          id: 'msg_123',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('assistant_message');
        expect(events[0].sessionId).toBe(SESSION_ID);
        expect(events[0].persistenceStrategy).toBe('sync_required');
        expect(events[0]).toMatchObject({
          content: 'Hello, I am an AI!',
          stopReason: 'end_turn',
          model: 'claude-sonnet-4-5-20250929',
        });
      });

      it('should return empty array for empty string content', () => {
        const message = createMockMessage({
          content: '   ',
          responseMetadata: { stop_reason: 'end_turn' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(0);
      });
    });

    describe('thinking + text message', () => {
      it('should produce thinking event first, then assistant_message', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'Let me think about this...' },
            { type: 'text', text: 'Here is my response.' },
          ],
          responseMetadata: {
            stop_reason: 'end_turn',
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 10, output_tokens: 20 },
          },
          id: 'msg_456',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(2);
        expect(events[0].type).toBe('thinking');
        expect(events[0]).toMatchObject({
          content: 'Let me think about this...',
          persistenceStrategy: 'sync_required',
        });

        expect(events[1].type).toBe('assistant_message');
        expect(events[1]).toMatchObject({
          content: 'Here is my response.',
          stopReason: 'end_turn',
        });
      });

      it('should preserve order via originalIndex', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'Thinking...' },
            { type: 'text', text: 'Response' },
          ],
          responseMetadata: { stop_reason: 'end_turn' },
        });

        const events = normalizeAIMessage(message, 5, SESSION_ID);

        expect(events[0].originalIndex).toBeLessThan(events[1].originalIndex);
      });
    });

    describe('tool_use message (content blocks)', () => {
      it('should produce tool_request event from content blocks', () => {
        const message = createMockMessage({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123abc',
              name: 'search_documents',
              input: { query: 'invoice 2024' },
            },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('tool_request');
        expect(events[0]).toMatchObject({
          toolUseId: 'toolu_123abc',
          toolName: 'search_documents',
          args: { query: 'invoice 2024' },
          persistenceStrategy: 'async_allowed',
        });
      });

      it('should extract complex tool args', () => {
        const complexArgs = {
          filters: { status: 'active', type: 'invoice' },
          limit: 10,
          includeMetadata: true,
        };

        const message = createMockMessage({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_xyz',
              name: 'complex_query',
              input: complexArgs,
            },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events[0]).toMatchObject({ args: complexArgs });
      });
    });

    describe('tool_calls (LangChain standard)', () => {
      it('should use tool_calls when no tool_use content blocks exist', () => {
        const message = createMockMessage({
          content: [],
          tool_calls: [
            { id: 'call_abc', name: 'get_weather', args: { city: 'London' } },
          ],
          responseMetadata: { finish_reason: 'tool_calls' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('tool_request');
        expect(events[0]).toMatchObject({
          toolUseId: 'call_abc',
          toolName: 'get_weather',
          args: { city: 'London' },
        });
      });

      it('should prefer tool_use content blocks over tool_calls', () => {
        const message = createMockMessage({
          content: [
            { type: 'tool_use', id: 'toolu_from_content', name: 'search', input: { q: 'test' } },
          ],
          tool_calls: [
            { id: 'call_from_toolcalls', name: 'search', args: { q: 'test' } },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const toolReq = events.find(e => e.type === 'tool_request');
        expect((toolReq as { toolUseId: string }).toolUseId).toBe('toolu_from_content');
      });
    });

    describe('mixed content blocks', () => {
      it('should handle thinking + text + tool_use in semantic order', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'Analyzing the request...' },
            { type: 'text', text: 'I will search for that.' },
            { type: 'tool_use', id: 'toolu_mixed', name: 'search', input: { q: 'test' } },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('thinking');
        expect(events[1].type).toBe('assistant_message');
        expect(events[2].type).toBe('tool_request');
      });

      it('should produce events in semantic order (text before tools)', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'First' },
            { type: 'tool_use', id: 'toolu_1', name: 'tool1', input: {} },
            { type: 'tool_use', id: 'toolu_2', name: 'tool2', input: {} },
            { type: 'text', text: 'Final' },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(4);
        expect(events.map(e => e.type)).toEqual([
          'thinking',
          'assistant_message',
          'tool_request',
          'tool_request',
        ]);
      });
    });

    describe('non-AI messages', () => {
      it('should return empty array for human messages', () => {
        const message = createMockMessage({ content: 'User input', type: 'human' });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(0);
      });

      it('should return empty array for tool messages', () => {
        const message = createMockMessage({ content: 'Tool result', type: 'tool' });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events).toHaveLength(0);
      });
    });

    describe('provider detection', () => {
      it('should detect anthropic from model name', () => {
        const message = createMockMessage({
          content: 'Test',
          responseMetadata: { model: 'claude-sonnet-4-5-20250929' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events[0].provider).toBe('anthropic');
      });

      it('should detect openai from model name', () => {
        const message = createMockMessage({
          content: 'Test',
          responseMetadata: { model: 'gpt-4o' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events[0].provider).toBe('openai');
      });

      it('should detect google from model name', () => {
        const message = createMockMessage({
          content: 'Test',
          responseMetadata: { model: 'gemini-2.0-flash' },
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        expect(events[0].provider).toBe('google');
      });
    });
  });

  describe('normalizeStopReason', () => {
    it('should map Anthropic end_turn', () => {
      expect(normalizeStopReason('end_turn')).toBe('end_turn');
    });

    it('should map OpenAI stop to end_turn', () => {
      expect(normalizeStopReason('stop')).toBe('end_turn');
    });

    it('should map Anthropic tool_use', () => {
      expect(normalizeStopReason('tool_use')).toBe('tool_use');
    });

    it('should map OpenAI tool_calls to tool_use', () => {
      expect(normalizeStopReason('tool_calls')).toBe('tool_use');
    });

    it('should map Anthropic max_tokens', () => {
      expect(normalizeStopReason('max_tokens')).toBe('max_tokens');
    });

    it('should map OpenAI length to max_tokens', () => {
      expect(normalizeStopReason('length')).toBe('max_tokens');
    });

    it('should map stop_sequence to end_turn', () => {
      expect(normalizeStopReason('stop_sequence')).toBe('end_turn');
    });

    it('should default unknown to end_turn', () => {
      expect(normalizeStopReason('unknown_reason')).toBe('end_turn');
    });

    it('should handle undefined', () => {
      expect(normalizeStopReason(undefined)).toBe('end_turn');
    });
  });

  describe('usage extraction', () => {
    it('should extract from response_metadata.usage', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: {
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-5-20250929',
        },
        id: 'msg-1',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { tokenUsage: unknown }).tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
    });

    it('should fallback to usage_metadata', () => {
      const message = createMockMessage({
        content: 'test',
        usageMetadata: { input_tokens: 200, output_tokens: 75 },
        id: 'msg-2',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { tokenUsage: unknown }).tokenUsage).toEqual({
        inputTokens: 200,
        outputTokens: 75,
      });
    });

    it('should extract thinkingTokens from content blocks', () => {
      const message = createMockMessage({
        content: [
          { type: 'thinking', thinking: 'Thinking...', thinking_tokens: 150 },
        ],
        responseMetadata: {
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-5-20250929',
        },
        id: 'msg-3',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);
      const thinkingEvent = events.find(e => e.type === 'thinking');

      expect(thinkingEvent).toBeDefined();
      expect((thinkingEvent as { tokenUsage?: unknown }).tokenUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 150,
      });
    });

    it('should default to zero usage when none found', () => {
      const message = createMockMessage({
        content: 'test',
        id: 'msg-4',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { tokenUsage: unknown }).tokenUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });
  });

  describe('message ID extraction', () => {
    it('should extract id from message property', () => {
      const message = createMockMessage({
        content: 'test',
        id: 'msg_direct_id',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { messageId: string }).messageId).toBe('msg_direct_id');
    });

    it('should extract id from response_metadata', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: { id: 'msg_meta_id' },
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { messageId: string }).messageId).toBe('msg_meta_id');
    });

    it('should generate UUID fallback when no id found', () => {
      const message = createMockMessage({ content: 'test' });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { messageId: string }).messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });
});
