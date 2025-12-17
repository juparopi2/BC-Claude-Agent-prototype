/**
 * Message Ordering Types
 *
 * These types are used internally by the message handling services
 * to manage content block accumulation, ordering, and emission.
 *
 * Extracted from DirectAgentService.ts to separate concerns.
 */

import type { TextCitation } from '@anthropic-ai/sdk/resources/messages';
import type { PersistenceState } from '@/types';

/**
 * Block types from Anthropic SDK streaming
 */
export type BlockType = 'text' | 'thinking' | 'tool_use';

/**
 * Delta types from Anthropic SDK streaming
 */
export type DeltaType =
  | 'text_delta'
  | 'thinking_delta'
  | 'input_json_delta'
  | 'citations_delta'
  | 'signature_delta';

/**
 * State of a content block during accumulation
 * Keyed by Anthropic's event.index (positional within message)
 */
export interface ContentBlockState {
  type: BlockType;
  /** Accumulated content - string for text/thinking, object for tool_use */
  data: string | ToolUseData;
  /** Citations for text blocks (from citations_delta) */
  citations?: TextCitation[];
  /** Signature for thinking blocks (from signature_delta) */
  signature?: string;
  /** Whether this block has been completed (content_block_stop received) */
  completed?: boolean;
  /** Anthropic's positional index within the message */
  anthropicIndex?: number;
}

/**
 * Tool use data accumulated during streaming
 */
export interface ToolUseData {
  /** Tool use ID from Anthropic (e.g., "toolu_01ABC...") */
  id: string;
  /** Tool name */
  name: string;
  /** Parsed input arguments */
  input: Record<string, unknown>;
  /** Raw JSON string accumulated from input_json_delta */
  inputJson?: string;
}

/**
 * Tool data accumulator entry
 * Used to track tool arguments during streaming before final persistence
 */
export interface ToolDataAccumulator {
  name: string;
  id: string;
  /** Accumulated JSON string from input_json_delta events */
  args: string;
  /** Sequence number assigned during message_delta */
  sequenceNumber: number;
  /** Anthropic's positional index within the message */
  anthropicIndex: number;
}

/**
 * Completed block ready for persistence/emission
 * Result of ContentBlockAccumulator.completeBlock()
 */
export interface CompletedBlock {
  type: BlockType;
  anthropicIndex: number;
  content: CompletedTextBlock | CompletedThinkingBlock | CompletedToolUseBlock;
}

export interface CompletedTextBlock {
  type: 'text';
  text: string;
  citations: TextCitation[];
}

export interface CompletedThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface CompletedToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Ordering validation result for debugging
 */
export interface OrderingValidation {
  valid: boolean;
  sessionId: string;
  totalEvents: number;
  issues: OrderingIssue[];
}

export interface OrderingIssue {
  type: 'sequence_gap' | 'sequence_duplicate' | 'wrong_order' | 'missing_correlation';
  message: string;
  sequenceNumbers?: number[];
  eventIds?: string[];
}

/**
 * Pre-reserved sequence batch result
 */
export interface ReservedSequenceBatch {
  sessionId: string;
  startSequence: number;
  sequences: number[];
  reservedAt: Date;
}

/**
 * Stream processing result for a single turn
 */
export interface TurnResult {
  /** Anthropic message ID */
  messageId: string | null;
  /** Model used (e.g., "claude-sonnet-4-5-20250929") */
  model: string | null;
  /** Stop reason from Anthropic */
  stopReason: string | null;
  /** Completed blocks in Anthropic index order */
  blocks: CompletedBlock[];
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

/**
 * Event ready for emission (either transient or persisted)
 * Note: timestamp is ISO 8601 string to match shared contract with frontend
 */
export interface EmittableEvent {
  type: string;
  timestamp: string;
  eventId: string;
  persistenceState: PersistenceState;
  sequenceNumber?: number;
  /** Additional fields depend on event type */
  [key: string]: unknown;
}

// ============================================================================
// MessageEmitter Event Data Interfaces
// ============================================================================

/**
 * Token usage data from Anthropic API
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Stop reason from Anthropic API
 */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | null;

/**
 * Data for thinking event emission (persisted)
 */
export interface ThinkingEventData {
  content: string;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
  signature?: string;
  messageId?: string;
}

/**
 * Data for message event emission (persisted)
 */
export interface MessageEventData {
  content: string;
  messageId: string;
  role: 'user' | 'assistant';
  stopReason?: StopReason;
  tokenUsage?: TokenUsage;
  model?: string;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
  /** Optional metadata for special message types */
  metadata?: {
    type?: 'max_tokens_warning' | 'stop_sequence' | 'max_turns_warning';
    [key: string]: unknown;
  };
}

/**
 * Data for tool_use event emission (persisted)
 */
export interface ToolUseEventData {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  blockIndex: number;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
}

/**
 * Data for tool_result event emission (persisted)
 */
export interface ToolResultEventData {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
  /** Error message if success is false */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

/**
 * Data for turn_paused event emission (persisted)
 */
export interface TurnPausedEventData {
  reason: string;
  turnCount: number;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
}

/**
 * Data for content_refused event emission (persisted)
 */
export interface ContentRefusedEventData {
  reason: string;
  sequenceNumber: number;
  eventId: string;
  sessionId?: string;
}

/**
 * Data for tool_use pending state emission (transient, early signal)
 */
export interface ToolUsePendingData {
  toolName: string;
  toolUseId: string;
  blockIndex: number;
}

/**
 * Union type for all persisted event data
 */
export type PersistedEventData =
  | { type: 'thinking'; data: ThinkingEventData }
  | { type: 'message'; data: MessageEventData }
  | { type: 'tool_use'; data: ToolUseEventData }
  | { type: 'tool_result'; data: ToolResultEventData }
  | { type: 'turn_paused'; data: TurnPausedEventData }
  | { type: 'content_refused'; data: ContentRefusedEventData };

/**
 * MessageEmitter event callback type
 */
export type EventCallback = (event: EmittableEvent) => void;
