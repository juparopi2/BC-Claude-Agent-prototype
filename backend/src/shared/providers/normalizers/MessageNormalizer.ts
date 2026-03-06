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
  NormalizedToolResponseEvent,
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

interface ServerToolUseBlock {
  type: 'server_tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ServerToolResultBlock {
  type: string; // 'web_search_tool_result' | 'code_execution_tool_result' | etc.
  tool_use_id: string;
  content: unknown;
}

type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock | ServerToolUseBlock | ServerToolResultBlock;

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

    // Extract cache tokens from LangChain input_token_details (Anthropic provider)
    const details = (usageMeta as {
      input_token_details?: {
        cache_creation?: number;
        cache_read?: number;
      };
    }).input_token_details;
    if (details) {
      if (typeof details.cache_creation === 'number') {
        usage.cacheCreationTokens = details.cache_creation;
      }
      if (typeof details.cache_read === 'number') {
        usage.cacheReadTokens = details.cache_read;
      }
    }

    // Extract server tool use counts (Anthropic web_search, code_execution)
    const serverToolUse = (usageMeta as {
      server_tool_use?: {
        web_search_requests?: number;
        code_execution_requests?: number;
      };
    }).server_tool_use;
    if (serverToolUse) {
      usage.serverToolUse = {
        webSearchRequests: serverToolUse.web_search_requests,
        codeExecutionRequests: serverToolUse.code_execution_requests,
      };
    }

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

    // Extract cache tokens from raw Anthropic response_metadata.usage
    const rawUsage = responseMeta.usage as {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    if (typeof rawUsage.cache_creation_input_tokens === 'number') {
      usage.cacheCreationTokens = rawUsage.cache_creation_input_tokens;
    }
    if (typeof rawUsage.cache_read_input_tokens === 'number') {
      usage.cacheReadTokens = rawUsage.cache_read_input_tokens;
    }

    // Extract server tool use counts from raw Anthropic response_metadata.usage
    const rawServerToolUse = (responseMeta.usage as {
      server_tool_use?: {
        web_search_requests?: number;
        code_execution_requests?: number;
      };
    }).server_tool_use;
    if (rawServerToolUse) {
      usage.serverToolUse = {
        webSearchRequests: rawServerToolUse.web_search_requests,
        codeExecutionRequests: rawServerToolUse.code_execution_requests,
      };
    }

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
 * Checks response_metadata first (non-streaming), then additional_kwargs (streaming).
 * @langchain/anthropic streaming puts model in additional_kwargs, not response_metadata.
 */
function extractModel(message: BaseMessage): string {
  const responseMeta = (message as {
    response_metadata?: { model?: string; model_name?: string; model_id?: string };
  }).response_metadata;

  if (responseMeta?.model) {
    logger.debug({ model: responseMeta.model, source: 'response_metadata.model' }, 'extractModel resolved');
    return responseMeta.model;
  }
  if (responseMeta?.model_name) {
    logger.debug({ model: responseMeta.model_name, source: 'response_metadata.model_name' }, 'extractModel resolved');
    return responseMeta.model_name;
  }
  if (responseMeta?.model_id) {
    logger.debug({ model: responseMeta.model_id, source: 'response_metadata.model_id' }, 'extractModel resolved');
    return responseMeta.model_id;
  }

  // Streaming path: @langchain/anthropic puts model in additional_kwargs
  const additionalKwargs = (message as {
    additional_kwargs?: { model?: string };
  }).additional_kwargs;
  if (additionalKwargs?.model) {
    logger.debug({ model: additionalKwargs.model, source: 'additional_kwargs.model' }, 'extractModel resolved (streaming path)');
    return additionalKwargs.model;
  }

  logger.warn('extractModel: no model found in response_metadata or additional_kwargs, returning unknown');
  return 'unknown';
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

  logger.debug({ model, messageId, messageIndex }, 'Model extracted from AIMessage');

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
        (event as { persistenceStrategy: string }).persistenceStrategy = 'transient';
      }
      events.push(event);
    }

    // String content messages may still have tool_calls (e.g. handoff-back messages
    // created by langgraph-supervisor with addHandoffBackMessages: true).
    // Extract tool_request events so they can be paired with tool_response in BatchResultNormalizer.
    const toolCalls = (message as { tool_calls?: LangChainToolCall[] }).tool_calls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        const toolEvent = createToolRequestEvent(
          sessionId, tc.id ?? randomUUID(), tc.name, tc.args, provider,
          timestamp, messageIndex * 100 + eventIndex++
        );
        toolEvent.sourceAgentId = sourceAgentId;
        if (isHandoffBack) {
          toolEvent.isInternal = true;
          (toolEvent as { persistenceStrategy: string }).persistenceStrategy = 'transient';
        }
        events.push(toolEvent);
      }
    }

    return events;
  }

  // Handle array content (rich blocks)
  if (Array.isArray(content)) {
    let thinkingContent = '';

    // Segment-based tracking: text is split at server tool boundaries so that
    // [text1, server_tool_use, result, text2] produces separate assistant_message events
    // instead of one concatenated message.
    type ContentSegment =
      | { kind: 'text'; content: string }
      | { kind: 'server_tool_request'; event: NormalizedToolRequestEvent }
      | { kind: 'server_tool_response'; event: NormalizedToolResponseEvent };

    const segments: ContentSegment[] = [];
    let pendingText = '';
    const regularToolRequests: NormalizedToolRequestEvent[] = [];
    let hasToolUseContentBlocks = false;

    // Helper to flush accumulated text into a segment
    const flushText = () => {
      if (pendingText.trim()) {
        segments.push({ kind: 'text', content: pendingText });
      }
      pendingText = '';
    };

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
            pendingText += (block as TextBlock).text;
          }
          break;
        case 'tool_use':
          if ('id' in block && 'name' in block) {
            hasToolUseContentBlocks = true;
            const toolBlock = block as ToolUseBlock;
            const toolEvent = createToolRequestEvent(
              sessionId, toolBlock.id, toolBlock.name, toolBlock.input, provider,
              timestamp, messageIndex * 100 + eventIndex++
            );
            toolEvent.sourceAgentId = sourceAgentId;
            regularToolRequests.push(toolEvent);
          }
          break;
        case 'server_tool_use': {
          hasToolUseContentBlocks = true;
          // Flush any pending text BEFORE the server tool
          flushText();
          const serverBlock = block as ServerToolUseBlock;
          if (serverBlock.id && serverBlock.name) {
            const toolEvent = createToolRequestEvent(
              sessionId, serverBlock.id, serverBlock.name, serverBlock.input ?? {}, provider,
              timestamp, messageIndex * 100 + eventIndex++
            );
            toolEvent.sourceAgentId = sourceAgentId;
            segments.push({ kind: 'server_tool_request', event: toolEvent });
          }
          break;
        }
        default: {
          // Handle server tool result blocks (web_search_tool_result, code_execution_tool_result, etc.)
          const resultBlock = block as { type?: string; tool_use_id?: string; content?: unknown };
          if (resultBlock.type?.endsWith('_tool_result') && resultBlock.tool_use_id) {
            // Flush any pending text before the server tool result (handles orphan results)
            flushText();
            // Extract the tool name from the result type (e.g., 'web_search_tool_result' → 'web_search')
            const toolName = resultBlock.type.replace('_tool_result', '');
            const toolResponseEvent = createToolResponseEvent(
              sessionId, resultBlock.tool_use_id, toolName, resultBlock.content, provider,
              timestamp, messageIndex * 100 + eventIndex++
            );
            toolResponseEvent.sourceAgentId = sourceAgentId;
            segments.push({ kind: 'server_tool_response', event: toolResponseEvent });
          }
          break;
        }
      }
    }

    // Flush remaining text after all blocks
    flushText();

    // Prefer LangChain standardized tool_calls if no tool_use content blocks found
    if (!hasToolUseContentBlocks) {
      const toolCalls = (message as { tool_calls?: LangChainToolCall[] }).tool_calls;
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          const toolEvent = createToolRequestEvent(
            sessionId, tc.id ?? randomUUID(), tc.name, tc.args, provider,
            timestamp, messageIndex * 100 + eventIndex++
          );
          toolEvent.sourceAgentId = sourceAgentId;
          regularToolRequests.push(toolEvent);
        }
      }
    }

    // Concatenate all text for handoff-back detection
    const allTextContent = segments
      .filter((s): s is { kind: 'text'; content: string } => s.kind === 'text')
      .map(s => s.content)
      .join('');

    const isHandoffBackArray = HANDOFF_BACK_PATTERN.test(allTextContent.trim()) && !usage;
    if (isHandoffBackArray) {
      logger.debug(
        { sessionId, messageIndex, content: allTextContent.substring(0, 60) },
        'Tagged handoff-back message as internal (array content)'
      );
    }

    // Emit in source order: thinking -> segments -> regular tools

    // 1. Thinking first
    if (thinkingContent) {
      const thinkingEvent = createThinkingEvent(
        sessionId, messageId, thinkingContent, usage?.thinkingTokens, provider,
        timestamp, messageIndex * 100 + eventIndex++
      );
      thinkingEvent.sourceAgentId = sourceAgentId;
      events.push(thinkingEvent);
    }

    // 2. Segments in source order (text, server tool requests, server tool responses)
    let isFirstTextSegment = true;
    for (const segment of segments) {
      switch (segment.kind) {
        case 'text': {
          // Each text segment needs a unique messageId for the frontend store's dedup index.
          // Only the first segment keeps the original messageId; subsequent segments get new UUIDs.
          const segmentMessageId = isFirstTextSegment ? messageId : randomUUID();
          const msgEvent = createAssistantMessageEvent(
            sessionId, segmentMessageId, segment.content, stopReason, model,
            isFirstTextSegment ? usage : null,  // Only first text segment gets usage
            provider, timestamp, messageIndex * 100 + eventIndex++
          );
          msgEvent.sourceAgentId = sourceAgentId;
          if (isHandoffBackArray) {
            msgEvent.isInternal = true;
            (msgEvent as { persistenceStrategy: string }).persistenceStrategy = 'transient';
          }
          events.push(msgEvent);
          isFirstTextSegment = false;
          break;
        }
        case 'server_tool_request':
          events.push(segment.event);
          break;
        case 'server_tool_response':
          events.push(segment.event);
          break;
      }
    }

    // 3. Regular tool requests last (their results come from ToolMessages via BatchResultNormalizer)
    events.push(...regularToolRequests);

    // 4. Re-index originalIndex after segment emission to maintain monotonic ordering
    const hasServerTools = segments.some(s => s.kind === 'server_tool_request');
    if (hasServerTools) {
      let idx = 0;
      for (const evt of events) {
        evt.originalIndex = messageIndex * 100 + idx++;
      }
      eventIndex = idx;
    }
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

function createToolResponseEvent(
  sessionId: string,
  toolUseId: string,
  toolName: string,
  result: unknown,
  provider: NormalizedProvider | undefined,
  timestamp: string,
  originalIndex: number
): NormalizedToolResponseEvent {
  // Serialize the result to a string since NormalizedToolResponseEvent.result is string | undefined
  const resultStr = result === undefined || result === null
    ? undefined
    : typeof result === 'string'
      ? result
      : JSON.stringify(result);

  return {
    type: 'tool_response',
    eventId: randomUUID(),
    sessionId,
    timestamp,
    originalIndex,
    persistenceStrategy: 'async_allowed',
    provider,
    toolUseId,
    toolName,
    result: resultStr,
    success: true,
  };
}
