/**
 * SDK Types - Central Export
 *
 * Re-exports types from @anthropic-ai/sdk to ensure type safety and
 * consistency with backend implementation.
 *
 * IMPORTANT: Always use these types instead of hardcoding SDK types.
 * This prevents type drift when the SDK is updated.
 *
 * Pattern follows backend/src/types/sdk.ts (gold standard)
 */

// Core message types
export type {
  StopReason,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  Message as SDKMessage,
  MessageParam,
  Tool,
  ToolChoiceAuto,
  ToolChoiceAny,
  ToolChoiceTool,
} from '@anthropic-ai/sdk/resources/messages';

/**
 * Type Guards
 *
 * These helpers allow safe type narrowing for ContentBlock unions
 */

import type { ContentBlock, TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';

export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}
