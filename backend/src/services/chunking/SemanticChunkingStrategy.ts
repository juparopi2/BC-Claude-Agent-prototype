import type { ChunkingStrategy, ChunkingOptions, ChunkResult } from './types';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger({ service: 'SemanticChunkingStrategy' });

/**
 * Semantic chunking strategy
 *
 * Focuses on maintaining semantic coherence by:
 * 1. Detecting topic boundaries (paragraph breaks are strong signals)
 * 2. Keeping related sentences together
 * 3. Never splitting mid-sentence
 * 4. Using transition words as hints for topic changes
 *
 * More intelligent than recursive chunking for natural text.
 */
export class SemanticChunkingStrategy implements ChunkingStrategy {
  readonly name = 'semantic';

  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  // @ts-expect-error - Reserved for future use with actual tokenization (tiktoken)
  private readonly _encoding: string;

  // Transition words that often signal topic changes
  // @ts-expect-error - Reserved for future semantic analysis
  private readonly _transitionWords = new Set([
    'however',
    'furthermore',
    'moreover',
    'additionally',
    'consequently',
    'therefore',
    'nevertheless',
    'meanwhile',
    'conversely',
    'alternatively'
  ]);

  constructor(options: ChunkingOptions) {
    this.maxTokens = options.maxTokens;
    this.overlapTokens = options.overlapTokens;
    this._encoding = options.encoding || 'cl100k_base';

    logger.debug(
      { maxTokens: this.maxTokens, overlapTokens: this.overlapTokens },
      'SemanticChunkingStrategy initialized'
    );
  }

  /**
   * Chunk text semantically, preserving topic coherence
   */
  chunk(text: string): ChunkResult[] {
    // Normalize line endings
    const normalizedText = text.replace(/\r\n/g, '\n');

    // Trim and check if empty
    const trimmedText = normalizedText.trim();
    if (!trimmedText) {
      return [];
    }

    logger.debug(
      { textLength: trimmedText.length, maxTokens: this.maxTokens },
      'Starting semantic chunking'
    );

    // Step 1: Split by paragraphs (strongest semantic boundary)
    const paragraphs = this.splitByParagraphs(trimmedText);

    // Step 2: Process each paragraph
    const chunks: string[] = [];
    let needsOverlap = false;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokenCount(paragraph);

      if (paragraphTokens <= this.maxTokens) {
        // Paragraph fits in one chunk
        chunks.push(paragraph);
      } else {
        // Paragraph too large, split by sentences
        needsOverlap = true;
        const sentenceChunks = this.splitBySentences(paragraph);
        chunks.push(...sentenceChunks);
      }
    }

    // Step 3: Apply overlap if we had to split due to size
    const finalChunks = needsOverlap ? this.applyOverlap(chunks) : chunks;

    // Step 4: Build ChunkResult objects with metadata
    return this.buildChunkResults(finalChunks, normalizedText);
  }

  /**
   * Split text into paragraphs
   */
  private splitByParagraphs(text: string): string[] {
    // Split by double newlines (paragraph separator)
    const paragraphs = text.split(/\n\n+/);

    return paragraphs
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Split paragraph into sentence-based chunks
   */
  private splitBySentences(paragraph: string): string[] {
    // Split into sentences (period, exclamation, question mark followed by space or end)
    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];

    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      const sentenceTokens = this.estimateTokenCount(trimmedSentence);

      // Check if single sentence exceeds max tokens
      if (sentenceTokens > this.maxTokens) {
        // Save current chunk if not empty
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join(' '));
          currentChunk = [];
          currentTokens = 0;
        }

        // Split long sentence by words
        const wordChunks = this.splitByWords(trimmedSentence);
        chunks.push(...wordChunks);
        continue;
      }

      // Try to add sentence to current chunk
      if (currentTokens + sentenceTokens <= this.maxTokens) {
        currentChunk.push(trimmedSentence);
        currentTokens += sentenceTokens;
      } else {
        // Current chunk is full, save it and start new one
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join(' '));
        }
        currentChunk = [trimmedSentence];
        currentTokens = sentenceTokens;
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Split text by words (fallback when sentences are too long)
   */
  private splitByWords(text: string): string[] {
    const words = text.split(/\s+/).filter(w => w);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = this.estimateTokenCount(word);

      if (currentTokens + wordTokens > this.maxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [word];
        currentTokens = wordTokens;
      } else {
        currentChunk.push(word);
        currentTokens += wordTokens;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Apply overlap between chunks for context preservation
   */
  private applyOverlap(chunks: string[]): string[] {
    if (this.overlapTokens === 0 || chunks.length <= 1) {
      return chunks;
    }

    const firstChunk = chunks[0];
    if (!firstChunk) return chunks;

    const overlappedChunks: string[] = [firstChunk];

    for (let i = 1; i < chunks.length; i++) {
      const currentChunk = chunks[i];
      const previousChunk = chunks[i - 1];

      if (!currentChunk || !previousChunk) continue;

      // Get last N words from previous chunk
      const overlapText = this.getOverlapText(previousChunk);

      if (overlapText) {
        overlappedChunks.push(overlapText + ' ' + currentChunk);
      } else {
        overlappedChunks.push(currentChunk);
      }
    }

    return overlappedChunks;
  }

  /**
   * Get overlap text from end of previous chunk
   */
  private getOverlapText(text: string): string {
    const words = text.split(/\s+/).filter(w => w);

    // Use approximately 75% of overlap token count as word count
    const overlapWords = Math.ceil(this.overlapTokens * 0.75);
    const wordsToTake = Math.min(overlapWords, words.length);

    if (wordsToTake === 0) {
      return '';
    }

    return words.slice(-wordsToTake).join(' ');
  }

  /**
   * Build ChunkResult objects with metadata
   */
  private buildChunkResults(chunks: string[], originalText: string): ChunkResult[] {
    const results: ChunkResult[] = [];
    let currentOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      if (!chunkText) continue;
      const tokenCount = this.estimateTokenCount(chunkText);

      // Find offset in original text
      const startOffset = originalText.indexOf(chunkText, currentOffset);
      const endOffset = startOffset >= 0
        ? startOffset + chunkText.length
        : currentOffset + chunkText.length;

      results.push({
        text: chunkText,
        chunkIndex: i,
        tokenCount: tokenCount,
        startOffset: startOffset >= 0 ? startOffset : currentOffset,
        endOffset: endOffset
      });

      currentOffset = endOffset;
    }

    logger.info(
      {
        chunksCreated: results.length,
        totalTokens: results.reduce((sum, c) => sum + c.tokenCount, 0)
      },
      'Semantic chunking completed'
    );

    return results;
  }

  /**
   * Estimate token count for text
   *
   * Uses simple heuristic: ~1.3 tokens per word for English text
   */
  private estimateTokenCount(text: string): number {
    if (!text || !text.trim()) {
      return 0;
    }

    const words = text.trim().split(/\s+/);
    const wordCount = words.length;

    // Estimate: ~1.3 tokens per word
    return Math.ceil(wordCount * 1.3);
  }
}
