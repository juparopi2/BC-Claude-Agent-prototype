/**
 * Provider-Agnostic Message Normalizer
 *
 * Normalizes LangChain AIMessage instances into NormalizedAgentEvent[].
 * Uses LangChain-standard APIs (content blocks, tool_calls, usage_metadata)
 * instead of provider-specific structures.
 *
 * Replaces AnthropicAdapter.normalizeMessage() with a provider-agnostic approach.
 *
 * @module shared/providers/normalizers/MessageNormalizer
 */

import { randomUUID } from 'crypto';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  NormalizedAgentEvent,
  NormalizedThinkingEvent,
  NormalizedAssistantMessageEvent,
  NormalizedToolRequestEvent,
  NormalizedStopReason,
  NormalizedTokenUsage,
  NormalizedProvider,
} from '@bc-agent/shared';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'MessageNormalizer' });

// =============================================================================
// Content Block Types (provider-agnostic)
// =============================================================================

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  thinking_tokens?: number;
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

type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

/**
 * LangChain standardized tool call (from AIMessage.tool_calls).
 */
interface LangChainToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

// =============================================================================
// Stop Reason Normalization
// =============================================================================

/**
 * Normalize provider-specific stop reasons to canonical format.
 * Handles both Anthropic and OpenAI stop reason strings.
 *
 * @param rawStopReason - Provider-specific stop reason string
 * @returns Canonical NormalizedStopReason
 */
export function normalizeStopReason(rawStopReason: string | undefined): NormalizedStopReason {
  if (!rawStopReason) return 'end_turn';

  const mapping: Record<string, NormalizedStopReason> = {
    // Anthropic formats
    'end_turn': 'end_turn',
    'max_tokens': 'max_tokens',
    'tool_use': 'tool_use',
    'stop_sequence': 'end_turn',
    // OpenAI formats
    'stop': 'end_turn',
    'length': 'max_tokens',
    'tool_calls': 'tool_use',
    'content_filter': 'end_turn',
    'function_call': 'tool_use',
  };

  const normalized = mapping[rawStopReason];
  if (!normalized) {
    logger.warn({ rawStopReason }, 'Unknown stop reason, defaulting to end_turn');
    return 'end_turn';
  }

  return normalized;
}

// =============================================================================
// Provider Detection
// =============================================================================

/**
 * Detect provider from response metadata model string.
 */
function detectProvider(message: BaseMessage): NormalizedProvider | undefined {
  const meta = (message as { response_metadata?: { model?: string } }).response_metadata;
  const model = meta?.model;
  if (!model) return undefined;

  if (model.includes('claude')) return 'anthropic';
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai';
  if (model.includes('gemini')) return 'google';
  return undefined;
}

// =============================================================================
// Extraction Helpers
// =============================================================================

/**
 * Extract message ID from LangChain message.
 * Tries: message.id -> response_metadata.id -> fallback UUID.
 */
function extractMessageId(message: BaseMessage, sessionId: string): string {
  const id = (message as { id?: string }).id;
  if (id) return id;

  const responseMeta = (message as { response_metadata?: { id?: string } }).response_metadata;
  if (responseMeta?.id) return responseMeta.id;

  logger.error(
    { sessionId },
    'No message ID found in response - generating UUID fallback. This may affect traceability.'
  );
  return randomUUID();
}

/**
 * Extract token usage from LangChain message.
 * Tries: usage_metadata (LangChain standard) -> response_metadata.usage (provider-specific).
 */
function extractUsage(message: BaseMessage): NormalizedTokenUsage | null {
  // Try usage_metadata first (LangChain 0.3+ standard)
  const usageMeta = (message as {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  }).usage_metadata;

  if (usageMeta) {
    const usage: NormalizedTokenUsage = {
      inputTokens: usageMeta.input_tokens ?? 0,
      outputTokens: usageMeta.output_tokens ?? 0,
    };
    extractThinkingTokens(message, usage);
    return usage;
  }

  // Fallback: response_metadata.usage (provider-specific)
  const responseMeta = (message as {
    response_metadata?: {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };
  }).response_metadata;

  if (responseMeta?.usage) {
    const usage: NormalizedTokenUsage = {
      inputTokens: responseMeta.usage.input_tokens ?? 0,
      outputTokens: responseMeta.usage.output_tokens ?? 0,
    };
    extractThinkingTokens(message, usage);
    return usage;
  }

  return null;
}

/**
 * Extract thinking tokens from content blocks if present.
 */
function extractThinkingTokens(message: BaseMessage, usage: NormalizedTokenUsage): void {
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      const thinkingBlock = block as { type?: string; thinking_tokens?: number };
      if (thinkingBlock.type === 'thinking' && typeof thinkingBlock.thinking_tokens === 'number') {
        usage.thinkingTokens = thinkingBlock.thinking_tokens;
        break;
      }
    }
  }
}

/**
 * Extract stop reason from message metadata.
 */
function extractStopReasonFromMessage(message: BaseMessage): NormalizedStopReason {
  const responseMeta = (message as {
    response_metadata?: { stop_reason?: string; finish_reason?: string };
  }).response_metadata;

  // Anthropic uses stop_reason, OpenAI uses finish_reason
  const rawReason = responseMeta?.stop_reason ?? responseMeta?.finish_reason;

  if (!rawReason) {
    const additionalKwargs = (message as {
      additional_kwargs?: { stop_reason?: string };
    }).additional_kwargs;
    return normalizeStopReason(additionalKwargs?.stop_reason);
  }

  return normalizeStopReason(rawReason);
}

/**
 * Extract model name from message metadata.
 */
function extractModel(message: BaseMessage): string {
  const responseMeta = (message as {
    response_metadata?: { model?: string; model_name?: string };
  }).response_metadata;

  return responseMeta?.model ?? responseMeta?.model_name ?? 'unknown';
}

// =============================================================================
// Main Normalizer
// =============================================================================

/**
 * Normalize a LangChain AIMessage into NormalizedAgentEvent[].
 *
 * Processing order:
 * 1. Extract thinking blocks -> NormalizedThinkingEvent
 * 2. Extract text blocks -> accumulated for assistant_message
 * 3. Extract tool calls (from tool_calls or content blocks) -> NormalizedToolRequestEvent[]
 * 4. Emit events in semantic order: thinking -> text -> tools
 *
 * @param message - LangChain BaseMessage from graph state
 * @param messageIndex - Position in messages array (for ordering)
 * @param sessionId - Session ID for event context
 * @returns Array of normalized events extracted from this message
 */
/**
 * Pattern to detect framework-generated handoff-back messages.
 * These are auto-created by `addHandoffBackMessages: true` in createSupervisor
 * and have no response_metadata (no usage data).
 */
const HANDOFF_BACK_PATTERN = /^(Transferring|transferring)\s+(back\s+)?to\s+\w+/i;

export function normalizeAIMessage(
  message: BaseMessage,
  messageIndex: number,
  sessionId: string
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const timestamp = new Date().toISOString();
  let eventIndex = 0;

  // Only process AI messages
  const messageType = message._getType?.();
  if (messageType !== 'ai' && messageType !== 'assistant') {
    return events;
  }

  // Extract source agent ID from LangGraph AIMessage.name field (per-message attribution)
  const sourceAgentId = (message as { name?: string }).name || undefined;

  const content = message.content;
  const messageId = extractMessageId(message, sessionId);
  const usage = extractUsage(message);
  const stopReason = extractStopReasonFromMessage(message);
  const model = extractModel(message);
  const provider = detectProvider(message);

  // Handle string content (simple case)
  if (typeof content === 'string') {
    // Tag framework-generated handoff-back messages as internal (PRD-061)
    const isHandoffBack = HANDOFF_BACK_PATTERN.test(content.trim()) && !usage;
    if (isHandoffBack) {
      logger.debug(
        { sessionId, messageIndex, content: content.substring(0, 60) },
        'Tagged handoff-back message as internal'
      );
    }

    if (content.trim()) {
      const event = createAssistantMessageEvent(
        sessionId, messageId, content, stopReason, model, usage, provider,
        timestamp, messageIndex * 100 + eventIndex++
      );
      event.sourceAgentId = sourceAgentId;
      if (isHandoffBack) {
        event.isInternal = true;
        event.persistenceStrategy = 'transient';
      }
      events.push(event);
    }
    return events;
  }

  // Handle array content (rich blocks)
  if (Array.isArray(content)) {
    let thinkingContent = '';
    let textContent = '';
    const toolRequests: NormalizedToolRequestEvent[] = [];

    // Parse content blocks
    for (const block of content as ContentBlock[]) {
      switch (block.type) {
        case 'thinking':
          if ('thinking' in block) {
            thinkingContent += (block as ThinkingBlock).thinking;
          }
          break;
        case 'text':
        case 'text_delta':
          if ('text' in block) {
            textContent += (block as TextBlock).text;
          }
          break;
        case 'tool_use':
          if ('id' in block && 'name' in block) {
            const toolBlock = block as ToolUseBlock;
            const toolEvent = createToolRequestEvent(
              sessionId, toolBlock.id, toolBlock.name, toolBlock.input, provider,
              timestamp, messageIndex * 100 + eventIndex++
            );
            toolEvent.sourceAgentId = sourceAgentId;
            toolRequests.push(toolEvent);
          }
          break;
      }
    }

    // Prefer LangChain standardized tool_calls if available and no tool_use blocks found
    if (toolRequests.length === 0) {
      const toolCalls = (message as { tool_calls?: LangChainToolCall[] }).tool_calls;
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          const toolEvent = createToolRequestEvent(
            sessionId, tc.id ?? randomUUID(), tc.name, tc.args, provider,
            timestamp, messageIndex * 100 + eventIndex++
          );
          toolEvent.sourceAgentId = sourceAgentId;
          toolRequests.push(toolEvent);
        }
      }
    }

    // Tag handoff-back text content as internal (PRD-061)
    const isHandoffBackArray = HANDOFF_BACK_PATTERN.test(textContent.trim()) && !usage;
    if (isHandoffBackArray) {
      logger.debug(
        { sessionId, messageIndex, content: textContent.substring(0, 60) },
        'Tagged handoff-back message as internal (array content)'
      );
    }

    // Emit in semantic order: thinking -> text -> tools

    // 1. Thinking first
    if (thinkingContent) {
      const thinkingEvent = createThinkingEvent(
        sessionId, messageId, thinkingContent, usage?.thinkingTokens, provider,
        timestamp, messageIndex * 100 + eventIndex++
      );
      thinkingEvent.sourceAgentId = sourceAgentId;
      events.push(thinkingEvent);
    }

    // 2. Assistant message (text) before tools
    if (textContent.trim()) {
      const msgEvent = createAssistantMessageEvent(
        sessionId, messageId, textContent, stopReason, model, usage, provider,
        timestamp, messageIndex * 100 + eventIndex++
      );
      msgEvent.sourceAgentId = sourceAgentId;
      if (isHandoffBackArray) {
        msgEvent.isInternal = true;
        msgEvent.persistenceStrategy = 'transient';
      }
      events.push(msgEvent);
    }

    // 3. Tool requests last
    events.push(...toolRequests);
  }

  return events;
}

// =============================================================================
// Event Factory Helpers
// =============================================================================

function createThinkingEvent(
  sessionId: string,
  messageId: string,
  content: string,
  thinkingTokens: number | undefined,
  provider: NormalizedProvider | undefined,
  timestamp: string,
  originalIndex: number
): NormalizedThinkingEvent {
  return {
    type: 'thinking',
    eventId: randomUUID(),
    sessionId,
    timestamp,
    originalIndex,
    persistenceStrategy: 'sync_required',
    provider,
    messageId,
    content,
    tokenUsage: thinkingTokens !== undefined
      ? { inputTokens: 0, outputTokens: 0, thinkingTokens }
      : undefined,
  };
}

function createToolRequestEvent(
  sessionId: string,
  toolUseId: string,
  toolName: string,
  args: Record<string, unknown>,
  provider: NormalizedProvider | undefined,
  timestamp: string,
  originalIndex: number
): NormalizedToolRequestEvent {
  return {
    type: 'tool_request',
    eventId: randomUUID(),
    sessionId,
    timestamp,
    originalIndex,
    persistenceStrategy: 'async_allowed',
    provider,
    toolUseId,
    toolName,
    args,
  };
}

function createAssistantMessageEvent(
  sessionId: string,
  messageId: string,
  content: string,
  stopReason: NormalizedStopReason,
  model: string,
  usage: NormalizedTokenUsage | null,
  provider: NormalizedProvider | undefined,
  timestamp: string,
  originalIndex: number
): NormalizedAssistantMessageEvent {
  return {
    type: 'assistant_message',
    eventId: randomUUID(),
    sessionId,
    timestamp,
    originalIndex,
    persistenceStrategy: 'sync_required',
    provider,
    messageId,
    content,
    stopReason,
    model,
    tokenUsage: usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}
