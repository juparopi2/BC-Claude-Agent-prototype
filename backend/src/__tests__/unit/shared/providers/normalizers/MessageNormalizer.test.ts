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

    describe('server tool events (web_search, code_execution)', () => {
      it('should place tool_request before tool_response for server tools', () => {
        const message = createMockMessage({
          content: [
            { type: 'text', text: 'Let me search for that.' },
            { type: 'server_tool_use', id: 'srvtoolu_123', name: 'web_search', input: { query: 'test query' } },
            { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_123', content: [{ type: 'web_search_result', url: 'https://example.com', title: 'Example' }] },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_srv1',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual(['assistant_message', 'tool_request', 'tool_response']);

        // Verify tool_request and tool_response share the same toolUseId
        const toolReq = events.find(e => e.type === 'tool_request') as any;
        const toolRes = events.find(e => e.type === 'tool_response') as any;
        expect(toolReq.toolUseId).toBe('srvtoolu_123');
        expect(toolRes.toolUseId).toBe('srvtoolu_123');
      });

      it('should interleave multiple server tool requests and responses correctly', () => {
        const message = createMockMessage({
          content: [
            { type: 'server_tool_use', id: 'srv_a', name: 'web_search', input: { query: 'first' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_a', content: [{ type: 'web_search_result', url: 'https://a.com' }] },
            { type: 'server_tool_use', id: 'srv_b', name: 'web_search', input: { query: 'second' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_b', content: [{ type: 'web_search_result', url: 'https://b.com' }] },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_srv2',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual(['tool_request', 'tool_response', 'tool_request', 'tool_response']);

        // Verify pairing
        expect((events[0] as any).toolUseId).toBe('srv_a');
        expect((events[1] as any).toolUseId).toBe('srv_a');
        expect((events[2] as any).toolUseId).toBe('srv_b');
        expect((events[3] as any).toolUseId).toBe('srv_b');
      });

      it('should emit server tool pair in source order, then regular tools at end', () => {
        const message = createMockMessage({
          content: [
            { type: 'tool_use', id: 'toolu_regular', name: 'search_docs', input: { q: 'test' } },
            { type: 'server_tool_use', id: 'srv_ws', name: 'web_search', input: { query: 'test' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_ws', content: [] },
          ],
          responseMetadata: { stop_reason: 'tool_use', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_srv3',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        // Server tool pair first (from segments), then regular tool at end
        expect(types).toEqual(['tool_request', 'tool_response', 'tool_request']);

        // Server tool pair
        expect((events[0] as any).toolUseId).toBe('srv_ws');
        expect((events[1] as any).toolUseId).toBe('srv_ws');
        // Regular tool last (its response comes from ToolMessage separately)
        expect((events[2] as any).toolUseId).toBe('toolu_regular');
      });

      it('should have monotonically increasing originalIndex after server tool interleaving', () => {
        const message = createMockMessage({
          content: [
            { type: 'thinking', thinking: 'Let me search...' },
            { type: 'text', text: 'Searching now.' },
            { type: 'server_tool_use', id: 'srv_idx', name: 'web_search', input: { query: 'test' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_idx', content: [] },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_srv4',
        });

        const events = normalizeAIMessage(message, 2, SESSION_ID);

        // Verify monotonically increasing originalIndex
        for (let i = 1; i < events.length; i++) {
          expect(events[i].originalIndex).toBeGreaterThan(events[i - 1].originalIndex);
        }

        // All should be in messageIndex=2 range (200+)
        for (const event of events) {
          expect(event.originalIndex).toBeGreaterThanOrEqual(200);
          expect(event.originalIndex).toBeLessThan(300);
        }
      });

      it('should split text into separate messages around server tools', () => {
        const message = createMockMessage({
          content: [
            { type: 'text', text: 'Let me search for that.' },
            { type: 'server_tool_use', id: 'srv_split', name: 'web_search', input: { query: 'test' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_split', content: [{ type: 'web_search_result', url: 'https://example.com', title: 'Example' }] },
            { type: 'text', text: 'Here are the results I found.' },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_split1',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual(['assistant_message', 'tool_request', 'tool_response', 'assistant_message']);

        // Verify text content is split correctly
        expect((events[0] as any).content).toBe('Let me search for that.');
        expect((events[3] as any).content).toBe('Here are the results I found.');

        // Each text segment must have a unique messageId (frontend dedup depends on this)
        const firstMsgId = (events[0] as any).messageId;
        const secondMsgId = (events[3] as any).messageId;
        expect(firstMsgId).toBe('msg_split1');  // First keeps original
        expect(secondMsgId).not.toBe(firstMsgId);  // Second gets new UUID
      });

      it('should attach usage only to first text segment when split by server tools', () => {
        const message = createMockMessage({
          content: [
            { type: 'text', text: 'Before the search.' },
            { type: 'server_tool_use', id: 'srv_usage', name: 'web_search', input: { query: 'test' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_usage', content: [] },
            { type: 'text', text: 'After the search.' },
          ],
          responseMetadata: {
            stop_reason: 'end_turn',
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          id: 'msg_usage_split',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        // First text segment gets the usage
        const firstMsg = events[0] as any;
        expect(firstMsg.type).toBe('assistant_message');
        expect(firstMsg.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });

        // Second text segment gets zero usage
        const secondMsg = events[3] as any;
        expect(secondMsg.type).toBe('assistant_message');
        expect(secondMsg.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
      });

      it('should handle text-tool-text-tool-text pattern', () => {
        const message = createMockMessage({
          content: [
            { type: 'text', text: 'First part.' },
            { type: 'server_tool_use', id: 'srv_a', name: 'web_search', input: { query: 'first' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_a', content: [] },
            { type: 'text', text: 'Middle part.' },
            { type: 'server_tool_use', id: 'srv_b', name: 'web_search', input: { query: 'second' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_b', content: [] },
            { type: 'text', text: 'Final part.' },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_multi_split',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual([
          'assistant_message', 'tool_request', 'tool_response',
          'assistant_message', 'tool_request', 'tool_response',
          'assistant_message',
        ]);

        expect((events[0] as any).content).toBe('First part.');
        expect((events[3] as any).content).toBe('Middle part.');
        expect((events[6] as any).content).toBe('Final part.');
      });

      it('should handle server tool with no preceding text', () => {
        const message = createMockMessage({
          content: [
            { type: 'server_tool_use', id: 'srv_no_pre', name: 'web_search', input: { query: 'test' } },
            { type: 'web_search_tool_result', tool_use_id: 'srv_no_pre', content: [] },
            { type: 'text', text: 'Here are the results.' },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_no_pre',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual(['tool_request', 'tool_response', 'assistant_message']);

        expect((events[2] as any).content).toBe('Here are the results.');
      });

      it('should push orphan server tool_response to end when no matching request found', () => {
        const message = createMockMessage({
          content: [
            { type: 'text', text: 'Some text.' },
            // Orphan result with no matching server_tool_use
            { type: 'web_search_tool_result', tool_use_id: 'srv_orphan', content: [] },
          ],
          responseMetadata: { stop_reason: 'end_turn', model: 'claude-sonnet-4-5-20250929' },
          id: 'msg_srv5',
        });

        const events = normalizeAIMessage(message, 0, SESSION_ID);

        const types = events.map(e => e.type);
        expect(types).toEqual(['assistant_message', 'tool_response']);

        // Orphan pushed to end
        expect((events[events.length - 1] as any).toolUseId).toBe('srv_orphan');
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

  describe('cache token extraction', () => {
    it('should extract cache tokens from usage_metadata.input_token_details', () => {
      const message = createMockMessage({
        content: 'test',
        usageMetadata: {
          input_tokens: 100,
          output_tokens: 50,
          input_token_details: {
            cache_creation: 2921,
            cache_read: 500,
          },
        },
        id: 'msg-cache-1',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { tokenUsage: unknown }).tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 2921,
        cacheReadTokens: 500,
      });
    });

    it('should extract cache tokens from response_metadata.usage (raw Anthropic)', () => {
      const message = createMockMessage({
        content: 'test',
        responseMetadata: {
          usage: {
            input_tokens: 19,
            output_tokens: 355,
            cache_creation_input_tokens: 2921,
            cache_read_input_tokens: 0,
          },
          model: 'claude-haiku-4-5-20251001',
        },
        id: 'msg-cache-2',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      expect((events[0] as { tokenUsage: unknown }).tokenUsage).toEqual({
        inputTokens: 19,
        outputTokens: 355,
        cacheCreationTokens: 2921,
        cacheReadTokens: 0,
      });
    });

    it('should NOT set cache tokens when not present (non-Anthropic provider)', () => {
      const message = createMockMessage({
        content: 'test',
        usageMetadata: {
          input_tokens: 100,
          output_tokens: 50,
        },
        id: 'msg-no-cache',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      const tokenUsage = (events[0] as { tokenUsage: Record<string, unknown> }).tokenUsage;
      expect(tokenUsage.inputTokens).toBe(100);
      expect(tokenUsage.outputTokens).toBe(50);
      expect(tokenUsage.cacheCreationTokens).toBeUndefined();
      expect(tokenUsage.cacheReadTokens).toBeUndefined();
    });

    it('should handle zero cache_read in input_token_details', () => {
      const message = createMockMessage({
        content: 'test',
        usageMetadata: {
          input_tokens: 100,
          output_tokens: 50,
          input_token_details: {
            cache_creation: 0,
            cache_read: 0,
          },
        },
        id: 'msg-zero-cache',
      });

      const events = normalizeAIMessage(message, 0, SESSION_ID);

      const tokenUsage = (events[0] as { tokenUsage: Record<string, unknown> }).tokenUsage;
      expect(tokenUsage.cacheCreationTokens).toBe(0);
      expect(tokenUsage.cacheReadTokens).toBe(0);
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
