/**
 * @module domains/agent/streaming/types
 *
 * Types for streaming domain.
 * Contains accumulator interfaces.
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
