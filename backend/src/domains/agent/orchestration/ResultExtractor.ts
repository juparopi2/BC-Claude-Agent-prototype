/**
 * @module domains/agent/orchestration/ResultExtractor
 *
 * Extracts structured content from LangGraph invoke() results.
 * Handles both simple string content and rich content blocks (thinking, text, tool_use).
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { ToolExecution, AgentState } from '@/modules/agents/orchestrator/state';

/**
 * Content block types from Anthropic API.
 * Used when message content is an array of blocks.
 */
interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface TextBlock {
  type: 'text' | 'text_delta';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock | { type: string };

/**
 * Extracted content from an agent execution result.
 */
export interface ExtractedContent {
  /**
   * Extended thinking content, if present.
   * Null if thinking was not enabled or no thinking blocks were found.
   */
  thinking: string | null;

  /**
   * Visible response content (text).
   */
  content: string;

  /**
   * Stop reason from the LLM.
   * Common values: 'end_turn', 'tool_use', 'max_tokens'
   */
  stopReason: string;

  /**
   * Tool executions that occurred during the agent execution.
   * Empty array if no tools were called.
   */
  toolExecutions: ToolExecution[];

  /**
   * Token usage from the execution.
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Extract content from a LangGraph invoke() result.
 *
 * This function processes the final state returned by orchestratorGraph.invoke()
 * and extracts the relevant content for event emission.
 *
 * @param state - The final AgentState from invoke()
 * @returns Extracted content with thinking, text, stop reason, and tool executions
 *
 * @example
 * ```typescript
 * const result = await orchestratorGraph.invoke(inputs);
 * const { thinking, content, toolExecutions, stopReason } = extractContent(result);
 * ```
 */
export function extractContent(state: AgentState): ExtractedContent {
  // Get the last AI message from the conversation
  const messages = state.messages;
  const lastMessage = findLastAIMessage(messages);

  if (!lastMessage) {
    return {
      thinking: null,
      content: '',
      stopReason: 'end_turn',
      toolExecutions: state.toolExecutions || [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Extract thinking and text content from the message
  const { thinking, text } = extractContentBlocks(lastMessage);

  // Extract stop reason from response metadata
  const stopReason = extractStopReason(lastMessage);

  // Extract usage from response metadata
  const usage = extractUsage(lastMessage);

  return {
    thinking: thinking || null,
    content: text,
    stopReason,
    toolExecutions: state.toolExecutions || [],
    usage,
  };
}

/**
 * Find the last AI message in the conversation.
 * Skips tool messages and system messages.
 */
function findLastAIMessage(messages: BaseMessage[]): BaseMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const type = msg._getType?.();
    if (type === 'ai' || type === 'assistant') {
      return msg;
    }
  }
  return null;
}

/**
 * Extract thinking and text content from a message.
 * Handles both simple string content and rich content block arrays.
 */
function extractContentBlocks(message: BaseMessage): { thinking: string; text: string } {
  const content = message.content;

  // Simple string content (no thinking)
  if (typeof content === 'string') {
    return { thinking: '', text: content };
  }

  // Array of content blocks
  if (Array.isArray(content)) {
    let thinking = '';
    let text = '';

    for (const block of content as ContentBlock[]) {
      if (isThinkingBlock(block)) {
        thinking += block.thinking;
      } else if (isTextBlock(block)) {
        text += block.text;
      }
      // Tool use blocks are handled separately via toolExecutions
    }

    return { thinking, text };
  }

  // Unknown format - treat as empty
  return { thinking: '', text: '' };
}

/**
 * Type guard for thinking blocks.
 */
function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking' && 'thinking' in block;
}

/**
 * Type guard for text blocks.
 */
function isTextBlock(block: ContentBlock): block is TextBlock {
  return (block.type === 'text' || block.type === 'text_delta') && 'text' in block;
}

/**
 * Extract stop reason from message response metadata.
 */
function extractStopReason(message: BaseMessage): string {
  // LangChain stores response metadata in various places
  const responseMetadata = (message as { response_metadata?: { stop_reason?: string } }).response_metadata;
  if (responseMetadata?.stop_reason) {
    return responseMetadata.stop_reason;
  }

  // Alternative location for some providers
  const additionalKwargs = (message as { additional_kwargs?: { stop_reason?: string } }).additional_kwargs;
  if (additionalKwargs?.stop_reason) {
    return additionalKwargs.stop_reason;
  }

  return 'end_turn';
}

/**
 * Extract usage from message response metadata.
 */
function extractUsage(message: BaseMessage): { inputTokens: number; outputTokens: number } {
  // LangChain stores usage in response_metadata
  const responseMetadata = (message as {
    response_metadata?: {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };
  }).response_metadata;

  if (responseMetadata?.usage) {
    return {
      inputTokens: responseMetadata.usage.input_tokens ?? 0,
      outputTokens: responseMetadata.usage.output_tokens ?? 0,
    };
  }

  // Alternative location: usage_metadata (LangChain 0.3+)
  const usageMetadata = (message as {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  }).usage_metadata;

  if (usageMetadata) {
    return {
      inputTokens: usageMetadata.input_tokens ?? 0,
      outputTokens: usageMetadata.output_tokens ?? 0,
    };
  }

  return { inputTokens: 0, outputTokens: 0 };
}
