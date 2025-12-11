import type { ChunkingStrategy, ChunkingOptions, ChunkResult } from './types';

import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger({ service: 'RecursiveChunkingStrategy' });

/**
 * Recursive text chunking strategy
 *
 * Splits text hierarchically:
 * 1. Try splitting by paragraphs (\n\n)
 * 2. If paragraph too large, split by sentences (. ! ?)
 * 3. If sentence too large, split by words
 *
 * Includes configurable overlap between chunks for context preservation.
 */
export class RecursiveChunkingStrategy implements ChunkingStrategy {
  readonly name = 'recursive';

  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  // @ts-expect-error - Reserved for future use with actual tokenization (tiktoken)
  private readonly _encoding: string;

  // Hierarchical separators (try in order)
  private readonly separators = [
    '\n\n',           // Paragraph separator
    '\n',             // Line separator
    '. ',             // Sentence separator (period + space)
    '! ',             // Exclamation
    '? ',             // Question
    '; ',             // Semicolon
    ', ',             // Comma
    ' ',              // Word separator
    ''                // Character level (last resort)
  ];

  constructor(options: ChunkingOptions) {
    this.maxTokens = options.maxTokens;
    this.overlapTokens = options.overlapTokens;
    this._encoding = options.encoding || 'cl100k_base';

    logger.debug(
      { maxTokens: this.maxTokens, overlapTokens: this.overlapTokens },
      'RecursiveChunkingStrategy initialized'
    );
  }

  /**
   * Chunk text into smaller pieces using recursive splitting
   */
  chunk(text: string): ChunkResult[] {
    // Normalize line endings (handle \r\n -> \n)
    const normalizedText = text.replace(/\r\n/g, '\n');

    // Trim and check if empty
    const trimmedText = normalizedText.trim();
    if (!trimmedText) {
      return [];
    }

    logger.debug(
      { textLength: trimmedText.length, maxTokens: this.maxTokens },
      'Starting recursive chunking'
    );

    // Start recursive splitting
    const chunks = this.recursiveSplit(trimmedText, this.separators);

    // Build ChunkResult objects with metadata
    const results: ChunkResult[] = [];
    let currentOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      if (!chunkText) continue;
      const tokenCount = this.estimateTokenCount(chunkText);

      // Find offset in original text
      const startOffset = normalizedText.indexOf(chunkText, currentOffset);
      const endOffset = startOffset + chunkText.length;

      results.push({
        text: chunkText,
        chunkIndex: i,
        tokenCount: tokenCount,
        startOffset: startOffset >= 0 ? startOffset : currentOffset,
        endOffset: startOffset >= 0 ? endOffset : currentOffset + chunkText.length
      });

      currentOffset = endOffset;
    }

    logger.info(
      { chunksCreated: results.length, totalTokens: results.reduce((sum, c) => sum + c.tokenCount, 0) },
      'Chunking completed'
    );

    return results;
  }

  /**
   * Recursively split text using hierarchical separators
   */
  private recursiveSplit(text: string, separators: string[]): string[] {
    const trimmedText = text.trim();

    // Base case: empty text
    if (!trimmedText) {
      return [];
    }

    // Try current separator
    const [currentSeparator, ...remainingSeparators] = separators;

    // Base case: no more separators
    if (currentSeparator === undefined) {
      // Last resort: split by token limit
      const tokenCount = this.estimateTokenCount(trimmedText);
      if (tokenCount <= this.maxTokens) {
        return [trimmedText];
      }
      return this.splitByTokenLimit(trimmedText);
    }

    // Split by current separator
    const splits = this.splitText(trimmedText, currentSeparator);

    // If no split occurred (no separator found), try next separator
    if (splits.length === 1) {
      const tokenCount = this.estimateTokenCount(trimmedText);
      if (tokenCount <= this.maxTokens) {
        return [trimmedText];
      }
      return this.recursiveSplit(trimmedText, remainingSeparators);
    }

    // We got splits! Now process each one
    const finalChunks: string[] = [];
    let needsOverlap = false; // Track if any chunk was split due to size

    for (const split of splits) {
      const splitTokens = this.estimateTokenCount(split);

      if (splitTokens <= this.maxTokens) {
        // Split is small enough, keep it
        finalChunks.push(split);
      } else {
        // Split is too large, recursively split with remaining separators
        needsOverlap = true; // We had to split due to size
        const subChunks = this.recursiveSplit(split, remainingSeparators);
        finalChunks.push(...subChunks);
      }
    }

    // Only apply overlap if we had to split chunks due to size limits
    // (not when text was naturally split by paragraphs/sentences)
    if (needsOverlap && finalChunks.length > 1) {
      return this.applyOverlap(finalChunks);
    }

    return finalChunks;
  }

  /**
   * Split text by separator
   */
  private splitText(text: string, separator: string): string[] {
    if (separator === '') {
      // Character-level split
      return text.split('');
    }

    const splits = text.split(separator);

    // Filter out empty strings and return trimmed splits
    return splits
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Split by token limit when no separators work
   */
  private splitByTokenLimit(text: string): string[] {
    const words = text.split(/\s+/).filter(w => w);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = this.estimateTokenCount(word);

      if (currentTokens + wordTokens > this.maxTokens && currentChunk.length > 0) {
        // Save current chunk
        chunks.push(currentChunk.join(' '));
        currentChunk = [word];
        currentTokens = wordTokens;
      } else {
        currentChunk.push(word);
        currentTokens += wordTokens;
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Apply overlap between chunks
   */
  private applyOverlap(chunks: string[]): string[] {
    if (this.overlapTokens === 0 || chunks.length <= 1) {
      return chunks;
    }

    const firstChunk = chunks[0];
    if (!firstChunk) return chunks;

    const overlappedChunks: string[] = [firstChunk]; // First chunk unchanged

    for (let i = 1; i < chunks.length; i++) {
      const currentChunk = chunks[i];
      const previousChunk = chunks[i - 1];

      if (!currentChunk || !previousChunk) continue;

      // Get last N words from previous chunk for overlap
      const overlapText = this.getOverlapText(previousChunk, this.overlapTokens);

      if (overlapText) {
        const withOverlap = overlapText + ' ' + currentChunk;
        overlappedChunks.push(withOverlap);
      } else {
        overlappedChunks.push(currentChunk);
      }
    }

    return overlappedChunks;
  }

  /**
   * Get the last N words from text for overlap (approximate tokens as words)
   */
  private getOverlapText(text: string, tokenCount: number): string {
    const words = text.split(/\s+/).filter(w => w);

    // Use approximately 75% of token count as word count for overlap
    const overlapWords = Math.ceil(tokenCount * 0.75);
    const wordsToTake = Math.min(overlapWords, words.length);

    if (wordsToTake === 0) {
      return '';
    }

    return words.slice(-wordsToTake).join(' ');
  }

  /**
   * Estimate token count for text
   *
   * Uses simple heuristic: ~1.3 tokens per word for English text
   * This is approximate - real tokenization would use tiktoken
   */
  private estimateTokenCount(text: string): number {
    if (!text || !text.trim()) {
      return 0;
    }

    // Count words (split by whitespace)
    const words = text.trim().split(/\s+/);
    const wordCount = words.length;

    // Estimate: ~1.3 tokens per word (English average)
    const estimatedTokens = Math.ceil(wordCount * 1.3);

    return estimatedTokens;
  }
}
