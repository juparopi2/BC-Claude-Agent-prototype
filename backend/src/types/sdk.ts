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
 *
 * @module types/sdk
 * @version SDK 0.71.0
 */

import type {
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
} from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Message types
// ============================================================================
export type {
  Message,
  MessageParam,
  MessageCreateParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Streaming event types
// ============================================================================
export type {
  MessageStreamEvent,
  // Individual event types for precise typing
  MessageStartEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
} from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Content block types
// ============================================================================
export type {
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
} from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Delta types (for streaming content)
// ============================================================================
export type {
  TextDelta,
  InputJSONDelta,
} from '@anthropic-ai/sdk/resources/messages';

// Note: ThinkingDelta may not be exported directly in SDK 0.71.0
// If your SDK version doesn't export it, use this local definition:
/**
 * Delta for thinking content during streaming
 * Used in content_block_delta events with type 'thinking_delta'
 */
export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

// ============================================================================
// Tool types
// ============================================================================
export type {
  Tool,
  ToolChoice,
  ToolChoiceAuto,
  ToolChoiceAny,
  ToolChoiceTool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Stop reason
// ============================================================================
export type { StopReason } from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Usage types
// ============================================================================
export type { Usage } from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Model types
// ============================================================================
export type { Model } from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// SDK Version tracking (for validation scripts)
// ============================================================================
/**
 * Current SDK version - used by validation scripts to detect upgrades
 */
export const ANTHROPIC_SDK_VERSION = '0.71.0';

// ============================================================================
// Type Guards
// ============================================================================

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

/**
 * Type guard to check if a ContentBlock is a ThinkingBlock
 *
 * @example
 * if (isThinkingBlock(block)) {
 *   console.log(block.thinking); // Type-safe access
 * }
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking';
}
