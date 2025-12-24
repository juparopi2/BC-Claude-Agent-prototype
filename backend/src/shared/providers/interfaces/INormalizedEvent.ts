/**
 * Normalized event definitions for multi-provider support.
 *
 * This file defines the canonical event structure that the application uses internally,
 * regardless of the underlying LLM provider (Anthropic, OpenAI, etc.).
 */

export type ProviderType = 'anthropic' | 'azure-openai' | 'openai' | 'google';

export type NormalizedEventType =
  | 'stream_start'
  | 'reasoning_delta' // Generic term for thinking/reasoning
  | 'content_delta'   // Visible text content
  | 'tool_call'       // Tool execution request
  | 'citation'        // RAG source attribution
  | 'usage'           // Token usage stats
  | 'stream_end';

export interface INormalizedStreamEvent {
  type: NormalizedEventType;
  provider: ProviderType;
  timestamp: Date;

  // Content fields (populated based on type)
  content?: string;
  reasoning?: string;
  toolCall?: NormalizedToolCall;
  citation?: NormalizedCitation;
  usage?: NormalizedUsage;

  // Metadata
  metadata: {
    blockIndex: number;
    messageId?: string;
    isStreaming: boolean;
    isFinal: boolean;
  };

  // Escape hatch for provider-specific raw data
  // Should only be used when strictly necessary and documented
  raw?: unknown;
}

export interface NormalizedToolCall {
  id: string; // Canonical ID (prefer LangChain/generic ID over provider-specific if possible)
  name: string;
  input: Record<string, unknown>;
  
  // Optional provider-specific ID if strictly needed for the provider API
  providerId?: string;
}

export interface NormalizedCitation {
  text: string;
  source: string;
  documentIndex?: number;
  location?: {
    start: number;
    end: number;
  };
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

/**
 * Normalized stop reason for multi-provider support.
 * Provider-agnostic reason why the model stopped generating.
 *
 * - 'success': Normal completion (Anthropic: end_turn, tool_use, stop_sequence; OpenAI: stop)
 * - 'error': An error occurred during generation
 * - 'max_turns': Hit token limit (Anthropic: max_tokens; OpenAI: length)
 * - 'user_cancelled': User manually cancelled the request
 */
export type NormalizedStopReason = 'success' | 'error' | 'max_turns' | 'user_cancelled';

/**
 * Provider-specific stop reason mappings.
 * Each provider has its own terminology for stop reasons.
 */
export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
export type OpenAIStopReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
export type ProviderStopReason = AnthropicStopReason | OpenAIStopReason | string;
