/**
 * SDK Type Re-exports
 *
 * This file provides a central location for importing Anthropic SDK types.
 *
 * **IMPORTANT**: Always import SDK types from this file instead of hardcoding types.
 * This ensures compatibility when the SDK is updated and prevents type drift.
 *
 * @example
 * // ✅ GOOD - Import from SDK types
 * import type { Message, StopReason, TextBlock } from '@/types/sdk';
 *
 * // ❌ BAD - Hardcoded types
 * type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';
 */

import { ContentBlock, TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

// Message types
export type {
  Message,
  MessageParam,
  MessageCreateParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/messages';

// Response types
export type {
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

// Content block types
export type {
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';

// Tool types
export type {
  Tool,
  ToolChoice,
  ToolChoiceAuto,
  ToolChoiceAny,
  ToolChoiceTool,
} from '@anthropic-ai/sdk/resources/messages';

// Stop reason
export type { StopReason } from '@anthropic-ai/sdk/resources/messages';

// Usage types
export type { Usage } from '@anthropic-ai/sdk/resources/messages';

// Model types
export type { Model } from '@anthropic-ai/sdk/resources/messages';

/**
 * Type guard to check if a ContentBlock is a TextBlock
 *
 * @example
 * if (isTextBlock(block)) {
 *   console.log(block.text); // Type-safe access
 * }
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

/**
 * Type guard to check if a ContentBlock is a ToolUseBlock
 *
 * @example
 * if (isToolUseBlock(block)) {
 *   console.log(block.name, block.input); // Type-safe access
 * }
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}
