import type { ChunkingStrategy, ChunkingOptions, ChunkResult } from './types';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'RowBasedChunkingStrategy' });

/**
 * Row-based chunking strategy for tabular data
 *
 * Specialized for:
 * - Markdown tables
 * - CSV data
 * - Excel-exported content
 *
 * Key features:
 * - Preserves table headers in each chunk
 * - Chunks by rows to maintain table structure
 * - Handles non-table text gracefully
 */
export class RowBasedChunkingStrategy implements ChunkingStrategy {
  readonly name = 'row-based';

  private readonly maxTokens: number;
  private readonly overlapTokens: number;
  private readonly encoding: string;

  constructor(options: ChunkingOptions) {
    this.maxTokens = options.maxTokens;
    this.overlapTokens = options.overlapTokens;
    this.encoding = options.encoding || 'cl100k_base';

    logger.debug(
      { maxTokens: this.maxTokens, overlapTokens: this.overlapTokens },
      'RowBasedChunkingStrategy initialized'
    );
  }

  /**
   * Chunk tabular data by rows
   */
  chunk(text: string): ChunkResult[] {
    const normalizedText = text.replace(/\r\n/g, '\n');
    const trimmedText = normalizedText.trim();

    if (!trimmedText) {
      return [];
    }

    logger.debug(
      { textLength: trimmedText.length, maxTokens: this.maxTokens },
      'Starting row-based chunking'
    );

    // Detect table format
    const tableFormat = this.detectTableFormat(trimmedText);

    if (tableFormat === 'markdown') {
      return this.chunkMarkdownTable(trimmedText, normalizedText);
    } else if (tableFormat === 'csv') {
      return this.chunkCsvTable(trimmedText, normalizedText);
    } else {
      // Not a table, fall back to simple chunking
      return this.chunkNonTable(trimmedText, normalizedText);
    }
  }

  /**
   * Detect table format in text
   */
  private detectTableFormat(text: string): 'markdown' | 'csv' | 'none' {
    const lines = text.split('\n');

    // Check for markdown table (has | characters and separator row)
    const hasMarkdownSeparator = lines.some(line =>
      /^\s*\|[\s\-:]+\|[\s\-:]*$/.test(line)
    );
    if (hasMarkdownSeparator) {
      return 'markdown';
    }

    // Check for CSV (has commas and consistent column count)
    const firstLine = lines[0];
    if (firstLine && firstLine.includes(',')) {
      // Simple heuristic: if first line has commas, treat as CSV
      return 'csv';
    }

    return 'none';
  }

  /**
   * Chunk markdown table
   */
  private chunkMarkdownTable(text: string, originalText: string): ChunkResult[] {
    const lines = text.split('\n').filter(line => line.trim());

    // Find header and separator
    let headerIndex = -1;
    let separatorIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|[\s\-:]+\|[\s\-:]*$/.test(lines[i])) {
        separatorIndex = i;
        headerIndex = i - 1;
        break;
      }
    }

    if (headerIndex === -1 || separatorIndex === -1) {
      // No valid table found
      return this.chunkNonTable(text, originalText);
    }

    const header = lines[headerIndex];
    const separator = lines[separatorIndex];
    const dataRows = lines.slice(separatorIndex + 1);

    // Chunk rows while preserving header
    const chunks: string[] = [];

    let currentChunk: string[] = [header, separator];

    for (const row of dataRows) {
      // Try adding this row to current chunk
      const testChunk = [...currentChunk, row];
      const testChunkText = testChunk.join('\n');
      const testTokens = this.estimateTokenCount(testChunkText);

      if (testTokens <= this.maxTokens) {
        // Fits! Add the row
        currentChunk.push(row);
      } else {
        // Doesn't fit. Save current chunk and start new one

        if (currentChunk.length > 2) {
          // Has at least one data row beyond header
          chunks.push(currentChunk.join('\n'));
        } else if (chunks.length === 0) {
          // This is the first chunk and even header + 1 row exceeds limit
          // Include it anyway but warn
          logger.warn(
            { testTokens, maxTokens: this.maxTokens },
            'Single table row + header exceeds token limit'
          );
          chunks.push(testChunkText);
        }

        // Start new chunk with header + this row
        currentChunk = [header, separator, row];
      }
    }

    // Add final chunk (always, even if just header)
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return this.buildChunkResults(chunks, originalText);
  }

  /**
   * Chunk CSV table
   */
  private chunkCsvTable(text: string, originalText: string): ChunkResult[] {
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return [];
    }

    const header = lines[0];
    const dataRows = lines.slice(1);

    // Chunk rows while preserving header
    const chunks: string[] = [];

    let currentChunk: string[] = [header];

    for (const row of dataRows) {
      // Try adding this row to current chunk
      const testChunk = [...currentChunk, row];
      const testChunkText = testChunk.join('\n');
      const testTokens = this.estimateTokenCount(testChunkText);

      if (testTokens <= this.maxTokens) {
        // Fits! Add the row
        currentChunk.push(row);
      } else {
        // Doesn't fit. Save current chunk and start new one
        if (currentChunk.length > 1) {
          // Has at least one data row beyond header
          chunks.push(currentChunk.join('\n'));
        } else if (chunks.length === 0) {
          // This is the first chunk and even header + 1 row exceeds limit
          // Include it anyway but warn
          logger.warn(
            { testTokens, maxTokens: this.maxTokens },
            'Single CSV row + header exceeds token limit'
          );
          chunks.push(testChunkText);
        }

        // Start new chunk with header + this row
        currentChunk = [header, row];
      }
    }

    // Add final chunk (always, even if just header)
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return this.buildChunkResults(chunks, originalText);
  }

  /**
   * Chunk non-table text (fallback)
   */
  private chunkNonTable(text: string, originalText: string): ChunkResult[] {
    const tokenCount = this.estimateTokenCount(text);

    if (tokenCount <= this.maxTokens) {
      return this.buildChunkResults([text], originalText);
    }

    // Split by paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokenCount(paragraph);

      if (currentTokens + paragraphTokens <= this.maxTokens) {
        currentChunk.push(paragraph);
        currentTokens += paragraphTokens;
      } else {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join('\n\n'));
        }
        currentChunk = [paragraph];
        currentTokens = paragraphTokens;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
    }

    return this.buildChunkResults(chunks, originalText);
  }

  /**
   * Build ChunkResult objects with metadata
   */
  private buildChunkResults(chunks: string[], originalText: string): ChunkResult[] {
    const results: ChunkResult[] = [];
    let currentOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
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
      'Row-based chunking completed'
    );

    return results;
  }

  /**
   * Estimate token count for text (specialized for tables)
   *
   * Tables have special characteristics:
   * - Pipes `|` and dashes `-` are often individual tokens
   * - Spaces and padding increase token count
   * - Numbers and short words are often single tokens
   */
  private estimateTokenCount(text: string): number {
    if (!text || !text.trim()) {
      return 0;
    }

    const trimmed = text.trim();

    // Count words (split by whitespace)
    const words = trimmed.split(/\s+/).filter(w => w);
    const wordCount = words.length;

    // Count special table characters (pipes, dashes)
    const pipes = (trimmed.match(/\|/g) || []).length;
    const dashes = (trimmed.match(/-{3,}/g) || []).length; // Groups of 3+ dashes

    // Improved estimation formula for tables:
    // - Words: 1.3 tokens per word (standard English)
    // - Pipes: 0.5 tokens each (often combined with adjacent content)
    // - Dash groups: 1 token per group (separator rows)
    const estimatedTokens = Math.ceil(
      wordCount * 1.3 +
      pipes * 0.5 +
      dashes * 1.0
    );

    return estimatedTokens;
  }
}
