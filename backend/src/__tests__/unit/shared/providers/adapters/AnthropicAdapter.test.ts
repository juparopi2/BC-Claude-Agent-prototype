/**
 * AnthropicAdapter Unit Tests
 *
 * Tests for the Anthropic provider adapter that normalizes
 * LangChain messages to NormalizedAgentEvent[].
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from '@/shared/providers/adapters/AnthropicAdapter';
import type { BaseMessage } from '@langchain/core/messages';

// Mock logger to avoid actual logging during tests
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock models config
vi.mock('@/infrastructure/config/models', () => ({
  AnthropicModels: {
    SONNET_4_5: 'claude-sonnet-4-5-20250929',
  },
}));

/**
 * Helper to create a mock BaseMessage
 */
function createMockMessage(options: {
  content: string | Array<{ type: string; [key: string]: unknown }>;
  responseMetadata?: Record<string, unknown>;
  usageMetadata?: Record<string, unknown>;
  id?: string;
}): BaseMessage {
  return {
    _getType: () => 'ai',
    content: options.content,
    response_metadata: options.responseMetadata,
    usage_metadata: options.usageMetadata,
    id: options.id,
    additional_kwargs: {},
    name: undefined,
  } as unknown as BaseMessage;
}

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  const sessionId = 'test-session-123';

  beforeEach(() => {
    adapter = new AnthropicAdapter(sessionId);
  });

  describe('constructor', () => {
    it('should use model from config by default', () => {
      expect(adapter.provider).toBe('anthropic');
      expect(adapter.sessionId).toBe(sessionId);
    });

    it('should accept custom default model', () => {
      const customAdapter = new AnthropicAdapter(sessionId, 'custom-model');
      expect(customAdapter.sessionId).toBe(sessionId);
    });
  });

  describe('normalizeMessage', () => {
    describe('simple text message', () => {
      it('should produce assistant_message event for string content', () => {
        const message = createMockMessage({
          content: 'Hello, I am Claude!',
          responseMetadata: {
            stop_reason: 'end_turn',
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
          id: 'msg_123',
        });

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('assistant_message');
        expect(events[0].sessionId).toBe(sessionId);
        expect(events[0].persistenceStrategy).toBe('sync_required');
        expect(events[0]).toMatchObject({
          content: 'Hello, I am Claude!',
          stopReason: 'end_turn',
          model: 'claude-sonnet-4-5-20250929',
        });
      });

      it('should return empty array for empty string content', () => {
        const message = createMockMessage({
          content: '   ',
          responseMetadata: { stop_reason: 'end_turn' },
        });

        const events = adapter.normalizeMessage(message, 0);

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

        const events = adapter.normalizeMessage(message, 0);

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

        const events = adapter.normalizeMessage(message, 5);

        // Events should have increasing originalIndex values
        expect(events[0].originalIndex).toBeLessThan(events[1].originalIndex);
      });
    });

    describe('tool_use message', () => {
      it('should produce tool_request event', () => {
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

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('tool_request');
        expect(events[0]).toMatchObject({
          toolUseId: 'toolu_123abc',
          toolName: 'search_documents',
          args: { query: 'invoice 2024' },
          persistenceStrategy: 'async_allowed',
        });
      });

      it('should extract toolArgs from block.input', () => {
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

        const events = adapter.normalizeMessage(message, 0);

        expect(events[0]).toMatchObject({
          args: complexArgs,
        });
      });
    });

    describe('mixed content blocks', () => {
      it('should handle thinking + text + tool_use in order', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'Analyzing the request...' },
            { type: 'text', text: 'I will search for that.' },
            {
              type: 'tool_use',
              id: 'toolu_mixed',
              name: 'search',
              input: { q: 'test' },
            },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('thinking');
        expect(events[1].type).toBe('tool_request');
        expect(events[2].type).toBe('assistant_message');
      });

      it('should produce events in block order', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'First' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'tool1',
              input: {},
            },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'tool2',
              input: {},
            },
            { type: 'text', text: 'Final' },
          ],
          responseMetadata: { stop_reason: 'tool_use' },
        });

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(4);
        // Verify order: thinking, tool1, tool2, text
        expect(events.map(e => e.type)).toEqual([
          'thinking',
          'tool_request',
          'tool_request',
          'assistant_message',
        ]);
      });
    });

    describe('non-AI messages', () => {
      it('should return empty array for human messages', () => {
        const message = {
          _getType: () => 'human',
          content: 'User input',
        } as unknown as BaseMessage;

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(0);
      });

      it('should return empty array for tool messages', () => {
        const message = {
          _getType: () => 'tool',
          content: 'Tool result',
        } as unknown as BaseMessage;

        const events = adapter.normalizeMessage(message, 0);

        expect(events).toHaveLength(0);
      });
    });
  });

  describe('normalizeStopReason', () => {
    it('should map end_turn to end_turn', () => {
      expect(adapter.normalizeStopReason('end_turn')).toBe('end_turn');
    });

    it('should map stop to end_turn', () => {
      expect(adapter.normalizeStopReason('stop')).toBe('end_turn');
    });

    it('should map tool_use to tool_use', () => {
      expect(adapter.normalizeStopReason('tool_use')).toBe('tool_use');
    });

    it('should map max_tokens to max_tokens', () => {
      expect(adapter.normalizeStopReason('max_tokens')).toBe('max_tokens');
    });

    it('should map stop_sequence to end_turn', () => {
      expect(adapter.normalizeStopReason('stop_sequence')).toBe('end_turn');
    });

    it('should default unknown to end_turn with warning', () => {
      const result = adapter.normalizeStopReason('unknown_reason');
      expect(result).toBe('end_turn');
    });

    it('should handle undefined stop reason', () => {
      expect(adapter.normalizeStopReason(undefined)).toBe('end_turn');
    });
  });

  describe('extractUsage', () => {
    it('should extract from response_metadata.usage', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: {
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const usage = adapter.extractUsage(message);

      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
    });

    it('should fallback to usage_metadata', () => {
      const message = createMockMessage({
        content: 'test',
        usageMetadata: { input_tokens: 200, output_tokens: 75 },
      });

      const usage = adapter.extractUsage(message);

      expect(usage).toEqual({
        inputTokens: 200,
        outputTokens: 75,
      });
    });

    it('should extract thinkingTokens from content blocks', () => {
      const message = createMockMessage({
        content: [
          { type: 'thinking', thinking: 'Thinking...', thinking_tokens: 150 },
          { type: 'text', text: 'Response' },
        ],
        responseMetadata: {
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const usage = adapter.extractUsage(message);

      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 150,
      });
    });

    it('should return null if no usage found', () => {
      const message = createMockMessage({ content: 'test' });

      const usage = adapter.extractUsage(message);

      expect(usage).toBeNull();
    });

    it('should handle missing token values with defaults', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: {
          usage: {},
        },
      });

      const usage = adapter.extractUsage(message);

      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });
  });

  describe('extractMessageId', () => {
    it('should extract id from message property', () => {
      const message = createMockMessage({
        content: 'test',
        id: 'msg_direct_id',
      });

      const messageId = adapter.extractMessageId(message);

      expect(messageId).toBe('msg_direct_id');
    });

    it('should extract id from response_metadata', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: { id: 'msg_meta_id' },
      });

      const messageId = adapter.extractMessageId(message);

      expect(messageId).toBe('msg_meta_id');
    });

    it('should generate UUID fallback when no id found', () => {
      const message = createMockMessage({ content: 'test' });

      const messageId = adapter.extractMessageId(message);

      // Should be a valid UUID format
      expect(messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('detectBlockType', () => {
    it('should detect thinking blocks', () => {
      expect(adapter.detectBlockType({ type: 'thinking' })).toBe('thinking');
    });

    it('should detect text blocks', () => {
      expect(adapter.detectBlockType({ type: 'text' })).toBe('text');
    });

    it('should detect text_delta blocks as text', () => {
      expect(adapter.detectBlockType({ type: 'text_delta' })).toBe('text');
    });

    it('should detect tool_use blocks', () => {
      expect(adapter.detectBlockType({ type: 'tool_use' })).toBe('tool_use');
    });

    it('should return null for unknown block types', () => {
      expect(adapter.detectBlockType({ type: 'unknown' })).toBeNull();
    });
  });

  describe('token usage in events', () => {
    it('should include tokenUsage in thinking event when available', () => {
      const message = createMockMessage({
        content: [
          { type: 'thinking', thinking: 'Thinking...', thinking_tokens: 100 },
        ],
        responseMetadata: {
          usage: { input_tokens: 50, output_tokens: 30 },
        },
      });

      const events = adapter.normalizeMessage(message, 0);
      const thinkingEvent = events.find(e => e.type === 'thinking');

      expect(thinkingEvent).toBeDefined();
      expect((thinkingEvent as { tokenUsage?: unknown }).tokenUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 100,
      });
    });

    it('should include full tokenUsage in assistant_message event', () => {
      const message = createMockMessage({
        content: 'Hello!',
        responseMetadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });

      const events = adapter.normalizeMessage(message, 0);
      const msgEvent = events.find(e => e.type === 'assistant_message');

      expect(msgEvent).toBeDefined();
      expect((msgEvent as { tokenUsage?: unknown }).tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
    });
  });
});
