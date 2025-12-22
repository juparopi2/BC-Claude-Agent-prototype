/**
 * @module domains/agent/streaming/ContentAccumulator
 *
 * Accumulates message content chunks during Claude streaming.
 * Extracted from DirectAgentService.runGraph() finalResponseChunks array.
 *
 * Message chunks are accumulated during streaming and joined when
 * the message is complete.
 *
 * @example
 * ```typescript
 * const accumulator = new ContentAccumulator();
 *
 * // During streaming
 * accumulator.append("Here is ");
 * accumulator.append("my response.");
 *
 * const content = accumulator.getContent(); // "Here is my response."
 * ```
 */

import type { IContentAccumulator } from './types';

/**
 * Accumulates message content chunks from Claude streaming.
 * Thread-safe within single Node.js event loop iteration.
 */
export class ContentAccumulator implements IContentAccumulator {
  private chunks: string[] = [];

  /**
   * Append a content chunk.
   * @param chunk - Message content chunk
   */
  append(chunk: string): void {
    if (chunk) {
      this.chunks.push(chunk);
    }
  }

  /**
   * Get accumulated content.
   * @returns Joined content chunks
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
  }

  /**
   * Check if any content has been accumulated.
   */
  hasContent(): boolean {
    return this.chunks.length > 0;
  }
}

/**
 * Factory function to create ContentAccumulator.
 * Each agent run needs its own accumulator.
 *
 * @returns New ContentAccumulator instance
 */
export function createContentAccumulator(): ContentAccumulator {
  return new ContentAccumulator();
}
