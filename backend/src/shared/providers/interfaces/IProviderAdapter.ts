/**
 * Provider Adapter Interface for Batch Result Normalization
 *
 * Provider adapter interface for batch (synchronous) result normalization.
 * Different from IStreamAdapter which handles streaming events.
 *
 * This interface is used by BatchResultNormalizer to convert
 * provider-specific message structures into NormalizedAgentEvent[].
 *
 * @module shared/providers/interfaces/IProviderAdapter
 */

import type { BaseMessage } from '@langchain/core/messages';
import type {
  NormalizedAgentEvent,
  NormalizedStopReason,
  NormalizedTokenUsage,
  NormalizedProvider,
} from '@bc-agent/shared';

/**
 * Block type detected within a message content array.
 */
export type ContentBlockType =
  | 'thinking'    // Extended thinking block
  | 'text'        // Text content block
  | 'tool_use';   // Tool invocation block

/**
 * Adapter interface for provider-specific batch result normalization.
 *
 * Each provider (Anthropic, OpenAI, etc.) has different message formats.
 * Adapters implement this interface to normalize to canonical events.
 *
 * ## Responsibilities
 * 1. Parse provider-specific message content blocks
 * 2. Extract thinking, text, and tool_use from messages
 * 3. Normalize stop reasons to canonical format
 * 4. Extract token usage from response metadata
 *
 * ## Usage
 * ```typescript
 * const adapter = new AnthropicAdapter(sessionId);
 * const events = adapter.normalizeMessage(message, 0);
 * ```
 *
 * ## Implementation Notes
 * - A single message may produce multiple events (thinking + text + tool_use)
 * - Events must be returned in the order they appear in the message
 * - All provider-specific logic should be isolated in the adapter
 */
export interface IProviderAdapter {
  /**
   * Provider identifier.
   */
  readonly provider: NormalizedProvider;

  /**
   * Session ID for context (logging, debugging).
   */
  readonly sessionId: string;

  /**
   * Normalize a single LangChain message into normalized events.
   *
   * A single message may produce multiple events:
   * - Thinking content -> NormalizedThinkingEvent
   * - Text content -> NormalizedAssistantMessageEvent
   * - Tool use blocks -> NormalizedToolRequestEvent[]
   *
   * @param message - LangChain BaseMessage from graph state
   * @param messageIndex - Position in messages array (for ordering)
   * @returns Array of normalized events extracted from this message
   *
   * @example
   * ```typescript
   * // Message with thinking + text produces 2 events
   * const events = adapter.normalizeMessage(aiMessage, 0);
   * // events[0] = NormalizedThinkingEvent
   * // events[1] = NormalizedAssistantMessageEvent
   * ```
   */
  normalizeMessage(
    message: BaseMessage,
    messageIndex: number
  ): NormalizedAgentEvent[];

  /**
   * Detect the type of a content block.
   *
   * Provider-specific logic to identify block types:
   * - Anthropic: block.type === 'thinking' | 'text' | 'tool_use'
   * - OpenAI: Different structure for function calls
   *
   * @param block - Raw content block from provider
   * @returns Detected block type or null if unknown
   */
  detectBlockType(block: unknown): ContentBlockType | null;

  /**
   * Normalize provider-specific stop reason to canonical format.
   *
   * @param stopReason - Provider-specific stop reason string
   * @returns Canonical NormalizedStopReason
   *
   * @example
   * ```typescript
   * adapter.normalizeStopReason('end_turn');   // 'end_turn'
   * adapter.normalizeStopReason('max_tokens'); // 'max_tokens'
   * adapter.normalizeStopReason('tool_use');   // 'tool_use'
   * ```
   */
  normalizeStopReason(stopReason: string | undefined): NormalizedStopReason;

  /**
   * Extract token usage from message response metadata.
   *
   * @param message - LangChain message with response_metadata
   * @returns Token usage or null if not available
   */
  extractUsage(message: BaseMessage): NormalizedTokenUsage | null;

  /**
   * Extract message ID from provider response.
   *
   * @param message - LangChain message
   * @returns Message ID (e.g., msg_01... for Anthropic) or generated UUID
   */
  extractMessageId(message: BaseMessage): string;
}
