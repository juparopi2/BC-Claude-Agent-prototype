/**
 * Content Block Accumulator
 *
 * Manages content block state during Anthropic streaming.
 * Extracted from DirectAgentService for cleaner separation of concerns.
 *
 * This is a pure state container with no side effects:
 * - No persistence logic
 * - No WebSocket emission
 * - No sequence number management
 *
 * Responsibilities:
 * 1. Track content blocks by Anthropic's event.index
 * 2. Accumulate deltas (text, thinking, tool args, citations, signatures)
 * 3. Return completed blocks in Anthropic's index order
 */

import type { TextCitation } from '@anthropic-ai/sdk/resources/messages';
import type {
  BlockType,
  ContentBlockState,
  ToolUseData,
  ToolDataAccumulator,
  CompletedBlock,
  CompletedTextBlock,
  CompletedThinkingBlock,
  CompletedToolUseBlock,
} from './types';
import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';

export class ContentBlockAccumulator {
  private contentBlocks: Map<number, ContentBlockState> = new Map();
  private toolDataAccumulators: Map<number, ToolDataAccumulator> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = createChildLogger({ service: 'ContentBlockAccumulator' });
  }

  /**
   * Initialize a new content block when content_block_start is received
   *
   * @param index - Anthropic's positional index (event.index)
   * @param type - Block type ('text' | 'thinking' | 'tool_use')
   * @param initialData - Initial data for the block
   */
  startBlock(index: number, type: BlockType, initialData?: { id?: string; name?: string }): void {
    this.logger.debug({ index, type, initialData }, 'Starting content block');

    if (type === 'text') {
      this.contentBlocks.set(index, {
        type: 'text',
        data: '',
        citations: [],
        completed: false,
        anthropicIndex: index,
      });
    } else if (type === 'thinking') {
      this.contentBlocks.set(index, {
        type: 'thinking',
        data: '',
        signature: '',
        completed: false,
        anthropicIndex: index,
      });
    } else if (type === 'tool_use') {
      const toolUseData: ToolUseData = {
        id: initialData?.id || '',
        name: initialData?.name || '',
        input: {},
        inputJson: '',
      };

      this.contentBlocks.set(index, {
        type: 'tool_use',
        data: toolUseData,
        completed: false,
        anthropicIndex: index,
      });

      // Initialize tool data accumulator for JSON arg tracking
      this.toolDataAccumulators.set(index, {
        name: initialData?.name || '',
        id: initialData?.id || '',
        args: '',
        sequenceNumber: -1, // Will be assigned later during message_delta
        anthropicIndex: index,
      });

      this.logger.debug({
        index,
        toolId: initialData?.id,
        toolName: initialData?.name,
      }, 'Tool data accumulator initialized');
    }
  }

  /**
   * Append delta content to a block
   *
   * @param index - Anthropic's positional index
   * @param deltaType - Type of delta
   * @param delta - Delta content
   */
  appendDelta(
    index: number,
    deltaType: 'text_delta' | 'thinking_delta' | 'input_json_delta' | 'citations_delta' | 'signature_delta',
    delta: string | TextCitation
  ): void {
    const block = this.contentBlocks.get(index);

    if (!block) {
      this.logger.warn({ index, deltaType }, 'appendDelta called for unknown block index');
      return;
    }

    switch (deltaType) {
      case 'text_delta':
        if (block.type === 'text' && typeof delta === 'string') {
          block.data = (block.data as string) + delta;
        }
        break;

      case 'thinking_delta':
        if (block.type === 'thinking' && typeof delta === 'string') {
          block.data = (block.data as string) + delta;
        }
        break;

      case 'input_json_delta':
        if (block.type === 'tool_use' && typeof delta === 'string') {
          const toolData = block.data as ToolUseData;
          toolData.inputJson = (toolData.inputJson || '') + delta;

          // Also accumulate in toolDataAccumulators
          const accumulator = this.toolDataAccumulators.get(index);
          if (accumulator) {
            accumulator.args += delta;
            this.logger.debug({
              index,
              partialJsonLength: delta.length,
              accumulatedLength: accumulator.args.length,
            }, 'Accumulating input_json_delta');
          }

          // Try to parse (may be incomplete)
          try {
            toolData.input = JSON.parse(toolData.inputJson);
          } catch {
            // JSON incomplete, will parse on completion
          }
        }
        break;

      case 'citations_delta':
        if (block.type === 'text' && typeof delta !== 'string') {
          if (!block.citations) {
            block.citations = [];
          }
          block.citations.push(delta as TextCitation);
          this.logger.debug({
            index,
            citationsCount: block.citations.length,
          }, 'Citation added');
        }
        break;

      case 'signature_delta':
        if (block.type === 'thinking' && typeof delta === 'string') {
          block.signature = delta;
          this.logger.debug({ index, signatureLength: delta.length }, 'Signature set');
        }
        break;
    }
  }

  /**
   * Mark a block as completed and return the completed block data
   * Called when content_block_stop is received
   *
   * @param index - Anthropic's positional index
   * @returns Completed block or null if not found
   */
  completeBlock(index: number): CompletedBlock | null {
    const block = this.contentBlocks.get(index);

    if (!block) {
      this.logger.warn({ index }, 'completeBlock called for unknown block index');
      return null;
    }

    block.completed = true;

    if (block.type === 'text') {
      const textContent = block.data as string;
      const completedText: CompletedTextBlock = {
        type: 'text',
        text: textContent,
        citations: block.citations || [],
      };

      this.logger.debug({
        index,
        textLength: textContent.length,
        citationsCount: completedText.citations.length,
      }, 'Text block completed');

      return {
        type: 'text',
        anthropicIndex: index,
        content: completedText,
      };
    }

    if (block.type === 'thinking') {
      const thinkingContent = block.data as string;
      const completedThinking: CompletedThinkingBlock = {
        type: 'thinking',
        thinking: thinkingContent,
        signature: block.signature || '',
      };

      this.logger.debug({
        index,
        thinkingLength: thinkingContent.length,
        hasSignature: !!block.signature,
      }, 'Thinking block completed');

      return {
        type: 'thinking',
        anthropicIndex: index,
        content: completedThinking,
      };
    }

    if (block.type === 'tool_use') {
      const toolData = block.data as ToolUseData;

      // Parse final JSON from accumulator
      const accumulator = this.toolDataAccumulators.get(index);
      if (accumulator?.args) {
        try {
          toolData.input = JSON.parse(accumulator.args);
          this.logger.debug({
            index,
            toolId: toolData.id,
            toolName: toolData.name,
            argsKeys: Object.keys(toolData.input),
          }, 'Tool args parsed successfully');
        } catch (e) {
          this.logger.warn({
            index,
            toolId: toolData.id,
            args: accumulator.args,
            error: e instanceof Error ? e.message : String(e),
          }, 'Failed to parse tool args');
        }
      }

      const completedToolUse: CompletedToolUseBlock = {
        type: 'tool_use',
        id: toolData.id,
        name: toolData.name,
        input: toolData.input,
      };

      this.logger.debug({
        index,
        toolId: toolData.id,
        toolName: toolData.name,
      }, 'Tool use block completed');

      return {
        type: 'tool_use',
        anthropicIndex: index,
        content: completedToolUse,
      };
    }

    return null;
  }

  /**
   * Get a specific block's current state
   * Useful for checking accumulated content during streaming
   */
  getBlock(index: number): ContentBlockState | undefined {
    return this.contentBlocks.get(index);
  }

  /**
   * Get tool data accumulator for a specific index
   */
  getToolAccumulator(index: number): ToolDataAccumulator | undefined {
    return this.toolDataAccumulators.get(index);
  }

  /**
   * Get all completed blocks sorted by Anthropic's index order
   * This preserves the order Claude intended for the content
   *
   * @returns Array of completed blocks sorted by anthropicIndex
   */
  getBlocksInAnthropicOrder(): CompletedBlock[] {
    const completedBlocks: CompletedBlock[] = [];

    // Sort by index to maintain Anthropic's intended order
    const sortedEntries = Array.from(this.contentBlocks.entries())
      .sort(([indexA], [indexB]) => indexA - indexB);

    for (const [index, block] of sortedEntries) {
      if (block.completed) {
        const completed = this.completeBlock(index);
        if (completed) {
          completedBlocks.push(completed);
        }
      }
    }

    this.logger.info({
      totalBlocks: completedBlocks.length,
      blockTypes: completedBlocks.map(b => `${b.anthropicIndex}:${b.type}`),
    }, 'Retrieved blocks in Anthropic order');

    return completedBlocks;
  }

  /**
   * Get accumulated text content (for real-time display)
   * Combines all text blocks in order
   */
  getAccumulatedText(): string {
    let text = '';
    const sortedEntries = Array.from(this.contentBlocks.entries())
      .filter(([_, block]) => block.type === 'text')
      .sort(([indexA], [indexB]) => indexA - indexB);

    for (const [_, block] of sortedEntries) {
      text += block.data as string;
    }

    return text;
  }

  /**
   * Get all tool uses (completed or in progress)
   */
  getToolUses(): Array<{ index: number; data: ToolUseData; completed: boolean }> {
    const toolUses: Array<{ index: number; data: ToolUseData; completed: boolean }> = [];

    for (const [index, block] of this.contentBlocks.entries()) {
      if (block.type === 'tool_use') {
        toolUses.push({
          index,
          data: block.data as ToolUseData,
          completed: block.completed || false,
        });
      }
    }

    return toolUses.sort((a, b) => a.index - b.index);
  }

  /**
   * Clear all accumulated state
   * Called at the start of each turn
   */
  clear(): void {
    this.logger.debug({
      blocksCleared: this.contentBlocks.size,
      accumulatorsCleared: this.toolDataAccumulators.size,
    }, 'Clearing accumulator state');

    this.contentBlocks.clear();
    this.toolDataAccumulators.clear();
  }

  /**
   * Get current state summary for debugging
   */
  getStateSummary(): {
    blockCount: number;
    toolAccumulatorCount: number;
    blocks: Array<{ index: number; type: BlockType; completed: boolean; dataLength: number }>;
  } {
    const blocks = Array.from(this.contentBlocks.entries()).map(([index, block]) => ({
      index,
      type: block.type,
      completed: block.completed || false,
      dataLength: typeof block.data === 'string'
        ? block.data.length
        : JSON.stringify(block.data).length,
    }));

    return {
      blockCount: this.contentBlocks.size,
      toolAccumulatorCount: this.toolDataAccumulators.size,
      blocks,
    };
  }
}
