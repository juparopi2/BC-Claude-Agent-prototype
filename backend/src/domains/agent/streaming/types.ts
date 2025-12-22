/**
 * @module domains/agent/streaming/types
 *
 * Types for streaming domain.
 * Used by ThinkingAccumulator, ContentAccumulator, and GraphStreamProcessor.
 */

/**
 * Interface for ThinkingAccumulator.
 * Accumulates thinking chunks during streaming and tracks completion.
 */
export interface IThinkingAccumulator {
  /** Append a thinking chunk */
  append(chunk: string): void;

  /** Check if thinking has been marked as complete */
  isComplete(): boolean;

  /** Mark thinking as complete (called when text content starts) */
  markComplete(): void;

  /** Get accumulated thinking content */
  getContent(): string;

  /** Get number of chunks accumulated */
  getChunkCount(): number;

  /** Reset accumulator for new session */
  reset(): void;

  /** Check if any thinking has been accumulated */
  hasContent(): boolean;
}

/**
 * Interface for ContentAccumulator.
 * Accumulates message content chunks during streaming.
 */
export interface IContentAccumulator {
  /** Append a content chunk */
  append(chunk: string): void;

  /** Get accumulated content */
  getContent(): string;

  /** Get number of chunks accumulated */
  getChunkCount(): number;

  /** Reset accumulator for new session */
  reset(): void;

  /** Check if any content has been accumulated */
  hasContent(): boolean;
}

/**
 * Processed stream event types from GraphStreamProcessor.
 */
export type ProcessedStreamEvent =
  | { type: 'thinking_chunk'; content: string; blockIndex: number }
  | { type: 'message_chunk'; content: string; blockIndex: number }
  | { type: 'thinking_complete'; content: string; blockIndex: number }
  | { type: 'tool_execution'; execution: ToolExecution }
  | { type: 'turn_end'; content: string; stopReason: string }
  | { type: 'final_response'; content: string; stopReason: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

/**
 * Tool execution details.
 */
export interface ToolExecution {
  toolUseId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
}
