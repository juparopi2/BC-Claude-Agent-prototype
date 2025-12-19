/**
 * ContentBlockAccumulator Unit Tests
 *
 * Tests the content block accumulation logic extracted from DirectAgentService.
 * Focuses on:
 * - Block initialization for all types (text, thinking, tool_use)
 * - Delta accumulation (text, thinking, JSON args, citations, signatures)
 * - Block completion and structured output
 * - Anthropic index ordering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentBlockAccumulator } from '@services/agent/messages/ContentBlockAccumulator';
import type { TextCitation } from '@anthropic-ai/sdk/resources/messages';

// Mock logger to avoid noise in tests
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ContentBlockAccumulator', () => {
  let accumulator: ContentBlockAccumulator;

  beforeEach(() => {
    accumulator = new ContentBlockAccumulator();
  });

  describe('startBlock', () => {
    it('should initialize a text block', () => {
      accumulator.startBlock(0, 'text');

      const block = accumulator.getBlock(0);
      expect(block).toBeDefined();
      expect(block?.type).toBe('text');
      expect(block?.data).toBe('');
      expect(block?.citations).toEqual([]);
      expect(block?.completed).toBe(false);
      expect(block?.anthropicIndex).toBe(0);
    });

    it('should initialize a thinking block', () => {
      accumulator.startBlock(0, 'thinking');

      const block = accumulator.getBlock(0);
      expect(block).toBeDefined();
      expect(block?.type).toBe('thinking');
      expect(block?.data).toBe('');
      expect(block?.signature).toBe('');
      expect(block?.completed).toBe(false);
    });

    it('should initialize a tool_use block with tool data', () => {
      accumulator.startBlock(0, 'tool_use', { id: 'toolu_01ABC', name: 'get_customers' });

      const block = accumulator.getBlock(0);
      expect(block).toBeDefined();
      expect(block?.type).toBe('tool_use');
      expect(block?.data).toEqual({
        id: 'toolu_01ABC',
        name: 'get_customers',
        input: {},
        inputJson: '',
      });

      // Check tool accumulator was created
      const toolAccum = accumulator.getToolAccumulator(0);
      expect(toolAccum).toBeDefined();
      expect(toolAccum?.id).toBe('toolu_01ABC');
      expect(toolAccum?.name).toBe('get_customers');
      expect(toolAccum?.args).toBe('');
    });

    it('should handle multiple blocks with different indices', () => {
      accumulator.startBlock(0, 'thinking');
      accumulator.startBlock(1, 'text');
      accumulator.startBlock(2, 'tool_use', { id: 'toolu_01', name: 'search' });

      expect(accumulator.getBlock(0)?.type).toBe('thinking');
      expect(accumulator.getBlock(1)?.type).toBe('text');
      expect(accumulator.getBlock(2)?.type).toBe('tool_use');
    });
  });

  describe('appendDelta', () => {
    describe('text_delta', () => {
      it('should accumulate text deltas', () => {
        accumulator.startBlock(0, 'text');

        accumulator.appendDelta(0, 'text_delta', 'Hello ');
        accumulator.appendDelta(0, 'text_delta', 'World');

        const block = accumulator.getBlock(0);
        expect(block?.data).toBe('Hello World');
      });

      it('should not accumulate text_delta on wrong block type', () => {
        accumulator.startBlock(0, 'thinking');
        accumulator.appendDelta(0, 'text_delta', 'ignored');

        const block = accumulator.getBlock(0);
        expect(block?.data).toBe('');
      });
    });

    describe('thinking_delta', () => {
      it('should accumulate thinking deltas', () => {
        accumulator.startBlock(0, 'thinking');

        accumulator.appendDelta(0, 'thinking_delta', 'Let me think...');
        accumulator.appendDelta(0, 'thinking_delta', ' about this.');

        const block = accumulator.getBlock(0);
        expect(block?.data).toBe('Let me think... about this.');
      });
    });

    describe('input_json_delta', () => {
      it('should accumulate JSON args for tool_use', () => {
        accumulator.startBlock(0, 'tool_use', { id: 'toolu_01', name: 'search' });

        accumulator.appendDelta(0, 'input_json_delta', '{"key');
        accumulator.appendDelta(0, 'input_json_delta', 'word":"');
        accumulator.appendDelta(0, 'input_json_delta', 'test"}');

        const toolAccum = accumulator.getToolAccumulator(0);
        expect(toolAccum?.args).toBe('{"keyword":"test"}');

        // Should also parse the input
        const block = accumulator.getBlock(0);
        const toolData = block?.data as { input: Record<string, unknown> };
        expect(toolData.input).toEqual({ keyword: 'test' });
      });

      it('should handle incomplete JSON gracefully', () => {
        accumulator.startBlock(0, 'tool_use', { id: 'toolu_01', name: 'search' });

        // Incomplete JSON - should not throw
        accumulator.appendDelta(0, 'input_json_delta', '{"incomplete');

        const toolAccum = accumulator.getToolAccumulator(0);
        expect(toolAccum?.args).toBe('{"incomplete');

        // Input should still be empty (parse failed)
        const block = accumulator.getBlock(0);
        const toolData = block?.data as { input: Record<string, unknown> };
        expect(toolData.input).toEqual({});
      });
    });

    describe('citations_delta', () => {
      it('should accumulate citations for text blocks', () => {
        accumulator.startBlock(0, 'text');

        const citation1: TextCitation = {
          type: 'char_location',
          cited_text: 'Example text',
          document_index: 0,
          document_title: 'Doc 1',
          start_char_index: 0,
          end_char_index: 12,
        };

        const citation2: TextCitation = {
          type: 'char_location',
          cited_text: 'Another text',
          document_index: 1,
          document_title: 'Doc 2',
          start_char_index: 0,
          end_char_index: 12,
        };

        accumulator.appendDelta(0, 'citations_delta', citation1);
        accumulator.appendDelta(0, 'citations_delta', citation2);

        const block = accumulator.getBlock(0);
        expect(block?.citations).toHaveLength(2);
        expect(block?.citations?.[0].cited_text).toBe('Example text');
        expect(block?.citations?.[1].cited_text).toBe('Another text');
      });
    });

    describe('signature_delta', () => {
      it('should set signature for thinking blocks', () => {
        accumulator.startBlock(0, 'thinking');

        accumulator.appendDelta(0, 'signature_delta', 'sig_abc123xyz');

        const block = accumulator.getBlock(0);
        expect(block?.signature).toBe('sig_abc123xyz');
      });
    });

    it('should handle unknown block index gracefully', () => {
      // Should not throw
      accumulator.appendDelta(999, 'text_delta', 'ignored');
      expect(accumulator.getBlock(999)).toBeUndefined();
    });
  });

  describe('completeBlock', () => {
    it('should complete a text block', () => {
      accumulator.startBlock(0, 'text');
      accumulator.appendDelta(0, 'text_delta', 'Hello World');

      const completed = accumulator.completeBlock(0);

      expect(completed).toBeDefined();
      expect(completed?.type).toBe('text');
      expect(completed?.anthropicIndex).toBe(0);
      expect(completed?.content).toEqual({
        type: 'text',
        text: 'Hello World',
        citations: [],
      });

      // Block should be marked completed
      expect(accumulator.getBlock(0)?.completed).toBe(true);
    });

    it('should complete a thinking block with signature', () => {
      accumulator.startBlock(0, 'thinking');
      accumulator.appendDelta(0, 'thinking_delta', 'My reasoning...');
      accumulator.appendDelta(0, 'signature_delta', 'sig_xyz');

      const completed = accumulator.completeBlock(0);

      expect(completed?.type).toBe('thinking');
      expect(completed?.content).toEqual({
        type: 'thinking',
        thinking: 'My reasoning...',
        signature: 'sig_xyz',
      });
    });

    it('should complete a tool_use block with parsed args', () => {
      accumulator.startBlock(0, 'tool_use', { id: 'toolu_01ABC', name: 'get_entity' });
      accumulator.appendDelta(0, 'input_json_delta', '{"entity_name":"customers"}');

      const completed = accumulator.completeBlock(0);

      expect(completed?.type).toBe('tool_use');
      expect(completed?.content).toEqual({
        type: 'tool_use',
        id: 'toolu_01ABC',
        name: 'get_entity',
        input: { entity_name: 'customers' },
      });
    });

    it('should return null for unknown index', () => {
      const completed = accumulator.completeBlock(999);
      expect(completed).toBeNull();
    });
  });

  describe('getBlocksInAnthropicOrder', () => {
    it('should return blocks sorted by Anthropic index', () => {
      // Add blocks out of order
      accumulator.startBlock(2, 'tool_use', { id: 'toolu_01', name: 'search' });
      accumulator.startBlock(0, 'thinking');
      accumulator.startBlock(1, 'text');

      // Complete them
      accumulator.appendDelta(0, 'thinking_delta', 'Thinking...');
      accumulator.appendDelta(0, 'signature_delta', 'sig');
      accumulator.completeBlock(0);

      accumulator.appendDelta(1, 'text_delta', 'Text content');
      accumulator.completeBlock(1);

      accumulator.appendDelta(2, 'input_json_delta', '{}');
      accumulator.completeBlock(2);

      const blocks = accumulator.getBlocksInAnthropicOrder();

      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('thinking');
      expect(blocks[0].anthropicIndex).toBe(0);
      expect(blocks[1].type).toBe('text');
      expect(blocks[1].anthropicIndex).toBe(1);
      expect(blocks[2].type).toBe('tool_use');
      expect(blocks[2].anthropicIndex).toBe(2);
    });

    it('should only return completed blocks', () => {
      accumulator.startBlock(0, 'text');
      accumulator.startBlock(1, 'text');

      accumulator.appendDelta(0, 'text_delta', 'Complete');
      accumulator.completeBlock(0);

      // Block 1 not completed
      accumulator.appendDelta(1, 'text_delta', 'Incomplete');

      const blocks = accumulator.getBlocksInAnthropicOrder();

      expect(blocks).toHaveLength(1);
      expect(blocks[0].anthropicIndex).toBe(0);
    });
  });

  describe('getAccumulatedText', () => {
    it('should combine all text blocks in order', () => {
      accumulator.startBlock(0, 'thinking');
      accumulator.startBlock(1, 'text');
      accumulator.startBlock(2, 'text');

      accumulator.appendDelta(1, 'text_delta', 'First ');
      accumulator.appendDelta(2, 'text_delta', 'Second');

      const text = accumulator.getAccumulatedText();
      expect(text).toBe('First Second');
    });

    it('should ignore non-text blocks', () => {
      accumulator.startBlock(0, 'thinking');
      accumulator.startBlock(1, 'text');

      accumulator.appendDelta(0, 'thinking_delta', 'Ignored');
      accumulator.appendDelta(1, 'text_delta', 'Included');

      const text = accumulator.getAccumulatedText();
      expect(text).toBe('Included');
    });
  });

  describe('getToolUses', () => {
    it('should return all tool uses sorted by index', () => {
      accumulator.startBlock(0, 'text');
      accumulator.startBlock(1, 'tool_use', { id: 'toolu_01', name: 'first_tool' });
      accumulator.startBlock(2, 'tool_use', { id: 'toolu_02', name: 'second_tool' });

      accumulator.completeBlock(1);

      const toolUses = accumulator.getToolUses();

      expect(toolUses).toHaveLength(2);
      expect(toolUses[0].index).toBe(1);
      expect(toolUses[0].data.name).toBe('first_tool');
      expect(toolUses[0].completed).toBe(true);
      expect(toolUses[1].index).toBe(2);
      expect(toolUses[1].data.name).toBe('second_tool');
      expect(toolUses[1].completed).toBe(false);
    });
  });

  describe('clear', () => {
    it('should reset all state', () => {
      accumulator.startBlock(0, 'text');
      accumulator.startBlock(1, 'tool_use', { id: 'toolu_01', name: 'test' });
      accumulator.appendDelta(0, 'text_delta', 'content');

      accumulator.clear();

      expect(accumulator.getBlock(0)).toBeUndefined();
      expect(accumulator.getBlock(1)).toBeUndefined();
      expect(accumulator.getToolAccumulator(1)).toBeUndefined();

      const summary = accumulator.getStateSummary();
      expect(summary.blockCount).toBe(0);
      expect(summary.toolAccumulatorCount).toBe(0);
    });
  });

  describe('getStateSummary', () => {
    it('should return accurate state summary', () => {
      accumulator.startBlock(0, 'text');
      accumulator.startBlock(1, 'tool_use', { id: 'toolu_01', name: 'test' });
      accumulator.appendDelta(0, 'text_delta', 'Hello');
      accumulator.completeBlock(0);

      const summary = accumulator.getStateSummary();

      expect(summary.blockCount).toBe(2);
      expect(summary.toolAccumulatorCount).toBe(1);
      expect(summary.blocks).toHaveLength(2);
      expect(summary.blocks[0]).toEqual({
        index: 0,
        type: 'text',
        completed: true,
        dataLength: 5, // "Hello".length
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty blocks', () => {
      accumulator.startBlock(0, 'text');
      const completed = accumulator.completeBlock(0);

      expect(completed?.content).toEqual({
        type: 'text',
        text: '',
        citations: [],
      });
    });

    it('should handle tool_use with empty args', () => {
      accumulator.startBlock(0, 'tool_use', { id: 'toolu_01', name: 'no_args_tool' });
      const completed = accumulator.completeBlock(0);

      expect(completed?.content).toEqual({
        type: 'tool_use',
        id: 'toolu_01',
        name: 'no_args_tool',
        input: {},
      });
    });

    it('should handle thinking block without signature', () => {
      accumulator.startBlock(0, 'thinking');
      accumulator.appendDelta(0, 'thinking_delta', 'Thinking without sig');
      const completed = accumulator.completeBlock(0);

      expect(completed?.content).toEqual({
        type: 'thinking',
        thinking: 'Thinking without sig',
        signature: '',
      });
    });

    it('should handle tool_use with invalid JSON in args', () => {
      accumulator.startBlock(0, 'tool_use', { id: 'toolu_01', name: 'bad_json' });
      accumulator.appendDelta(0, 'input_json_delta', '{invalid json}');

      const completed = accumulator.completeBlock(0);

      // Should still complete but with empty input
      expect(completed?.content).toEqual({
        type: 'tool_use',
        id: 'toolu_01',
        name: 'bad_json',
        input: {},
      });
    });

    it('should handle citations on non-text blocks (should be ignored)', () => {
      accumulator.startBlock(0, 'thinking');

      const citation: TextCitation = {
        type: 'char_location',
        cited_text: 'Test',
        document_index: 0,
        document_title: 'Doc',
        start_char_index: 0,
        end_char_index: 4,
      };

      accumulator.appendDelta(0, 'citations_delta', citation);

      const block = accumulator.getBlock(0);
      // Citations should not be added to thinking blocks
      expect(block?.citations).toBeUndefined();
    });

    it('should handle multiple sequential completions of same block', () => {
      accumulator.startBlock(0, 'text');
      accumulator.appendDelta(0, 'text_delta', 'Hello');

      const completed1 = accumulator.completeBlock(0);
      const completed2 = accumulator.completeBlock(0);

      // Both should return the same completed block
      expect(completed1?.content).toEqual(completed2?.content);
      expect(accumulator.getBlock(0)?.completed).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should handle interleaved block creation and completion', () => {
      // Start block 0
      accumulator.startBlock(0, 'text');
      accumulator.appendDelta(0, 'text_delta', 'First');

      // Start block 1 before completing block 0
      accumulator.startBlock(1, 'thinking');
      accumulator.appendDelta(1, 'thinking_delta', 'Thought');

      // Complete block 0
      accumulator.completeBlock(0);

      // Start block 2
      accumulator.startBlock(2, 'tool_use', { id: 'toolu_01', name: 'tool' });

      // Complete block 1
      accumulator.completeBlock(1);

      const blocks = accumulator.getBlocksInAnthropicOrder();
      expect(blocks).toHaveLength(2);
      expect(blocks[0].anthropicIndex).toBe(0);
      expect(blocks[1].anthropicIndex).toBe(1);
    });

    it('should handle complex tool arguments with nested objects', () => {
      accumulator.startBlock(0, 'tool_use', { id: 'toolu_01', name: 'complex_tool' });

      const complexJson = JSON.stringify({
        filters: {
          name: { operator: 'contains', value: 'test' },
          date: { operator: 'after', value: '2025-01-01' }
        },
        limit: 10,
        offset: 0
      });

      accumulator.appendDelta(0, 'input_json_delta', complexJson);

      const completed = accumulator.completeBlock(0);
      const content = completed?.content as { input: Record<string, unknown> };

      expect(content.input).toEqual({
        filters: {
          name: { operator: 'contains', value: 'test' },
          date: { operator: 'after', value: '2025-01-01' }
        },
        limit: 10,
        offset: 0
      });
    });

    it('should handle text blocks with multiple citations', () => {
      accumulator.startBlock(0, 'text');
      accumulator.appendDelta(0, 'text_delta', 'Based on the documentation, ');

      const citation1: TextCitation = {
        type: 'char_location',
        cited_text: 'API reference',
        document_index: 0,
        document_title: 'API Docs',
        start_char_index: 0,
        end_char_index: 13,
      };

      accumulator.appendDelta(0, 'citations_delta', citation1);
      accumulator.appendDelta(0, 'text_delta', 'and the guide, ');

      const citation2: TextCitation = {
        type: 'char_location',
        cited_text: 'User guide',
        document_index: 1,
        document_title: 'Guide',
        start_char_index: 0,
        end_char_index: 10,
      };

      accumulator.appendDelta(0, 'citations_delta', citation2);
      accumulator.appendDelta(0, 'text_delta', 'we can proceed.');

      const completed = accumulator.completeBlock(0);
      const content = completed?.content as { text: string; citations: TextCitation[] };

      expect(content.text).toBe('Based on the documentation, and the guide, we can proceed.');
      expect(content.citations).toHaveLength(2);
    });
  });

  describe('memory and performance', () => {
    it('should handle many blocks efficiently', () => {
      // Create 100 blocks
      for (let i = 0; i < 100; i++) {
        accumulator.startBlock(i, 'text');
        accumulator.appendDelta(i, 'text_delta', `Text ${i}`);
      }

      // Complete odd-numbered blocks
      for (let i = 1; i < 100; i += 2) {
        accumulator.completeBlock(i);
      }

      const summary = accumulator.getStateSummary();
      expect(summary.blockCount).toBe(100);

      const completed = accumulator.getBlocksInAnthropicOrder();
      expect(completed).toHaveLength(50); // Only odd numbers

      // Verify ordering
      for (let i = 0; i < completed.length; i++) {
        expect(completed[i].anthropicIndex).toBe(i * 2 + 1);
      }
    });

    it('should handle large text accumulation', () => {
      accumulator.startBlock(0, 'text');

      // Add 1000 small chunks
      for (let i = 0; i < 1000; i++) {
        accumulator.appendDelta(0, 'text_delta', 'chunk ');
      }

      const text = accumulator.getAccumulatedText();
      expect(text.length).toBe(6000); // "chunk " = 6 chars * 1000
    });
  });
});
