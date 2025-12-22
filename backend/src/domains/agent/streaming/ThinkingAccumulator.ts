/**
 * @module domains/agent/streaming/ThinkingAccumulator
 *
 * Accumulates thinking chunks during Claude extended thinking streaming.
 * Extracted from DirectAgentService.runGraph() thinkingChunks array.
 *
 * Thinking chunks are accumulated during streaming and joined when
 * thinking is complete (signaled by first message_chunk).
 *
 * @example
 * ```typescript
 * const accumulator = new ThinkingAccumulator();
 *
 * // During streaming
 * accumulator.append("Let me think...");
 * accumulator.append(" about this problem.");
 *
 * // When message content starts
 * accumulator.markComplete();
 * const thinking = accumulator.getContent(); // "Let me think... about this problem."
 * ```
 */

import type { IThinkingAccumulator } from './types';

/**
 * Accumulates thinking chunks from Claude extended thinking.
 * Thread-safe within single Node.js event loop iteration.
 */
export class ThinkingAccumulator implements IThinkingAccumulator {
  private chunks: string[] = [];
  private complete = false;

  /**
   * Append a thinking chunk.
   * @param chunk - Thinking text chunk
   */
  append(chunk: string): void {
    if (chunk) {
      this.chunks.push(chunk);
    }
  }

  /**
   * Check if thinking has been marked as complete.
   * Thinking is complete when message content starts.
   */
  isComplete(): boolean {
    return this.complete;
  }

  /**
   * Mark thinking as complete.
   * Called when first message_chunk is received (text content starts).
   */
  markComplete(): void {
    this.complete = true;
  }

  /**
   * Get accumulated thinking content.
   * @returns Joined thinking chunks
   */
  getContent(): string {
    return this.chunks.join('');
  }

  /**
   * Get number of chunks accumulated.
   */
  getChunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Reset accumulator for new session/turn.
   */
  reset(): void {
    this.chunks = [];
    this.complete = false;
  }

  /**
   * Check if any thinking has been accumulated.
   */
  hasContent(): boolean {
    return this.chunks.length > 0;
  }
}

/**
 * Factory function to create ThinkingAccumulator.
 * Each agent run needs its own accumulator.
 *
 * @returns New ThinkingAccumulator instance
 */
export function createThinkingAccumulator(): ThinkingAccumulator {
  return new ThinkingAccumulator();
}
