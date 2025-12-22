import type { ChunkingStrategy, ChunkingOptions, ChunkResult } from './types';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'RowBasedChunkingStrategy' });

export class RowBasedChunkingStrategy implements ChunkingStrategy {
  readonly name = 'row-based';

  private readonly maxTokens: number;
  private readonly overlapTokens: number;

  constructor(options: ChunkingOptions) {
    this.maxTokens = options.maxTokens;
    this.overlapTokens = options.overlapTokens;

    logger.debug(
      { maxTokens: this.maxTokens, overlapTokens: this.overlapTokens },
      'RowBasedChunkingStrategy initialized'
    );
  }

  chunk(text: string): ChunkResult[] {
    const normalizedText = text.replace(/\r\n/g, '\n');
    const trimmedText = normalizedText.trim(); // Still trim for initial check

    if (!trimmedText) {
      return [];
    }
    
    // Use normalizedText for splitting to preserve empty lines at start if needed, 
    // but usually we want to ignore leading whitespace for detection?
    // detectTableFormat uses trimmedText.
    
    const tableFormat = this.detectTableFormat(trimmedText);

    if (tableFormat === 'markdown') {
      return this.chunkMarkdownTable(trimmedText, normalizedText);
    } else if (tableFormat === 'csv') {
      return this.chunkCsvTable(trimmedText, normalizedText);
    } else {
      return this.chunkNonTable(trimmedText, normalizedText);
    }
  }

  private detectTableFormat(text: string): 'markdown' | 'csv' | 'none' {
    const lines = text.split('\n');
    const hasMarkdownSeparator = lines.some(line =>
      /^\s*\|(?:[\s\-:]+\|)+\s*$/.test(line)
    );
    if (hasMarkdownSeparator) {
      return 'markdown';
    }
    const firstLine = lines[0];
    if (firstLine && firstLine.includes(',')) {
      return 'csv';
    }
    return 'none';
  }

  private chunkMarkdownTable(text: string, originalText: string): ChunkResult[] {
    // Keep empty lines to preserve offsets and structure
    const lines = text.split('\n'); 

    let headerIndex = -1;
    let separatorIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|(?:[\s\-:]+\|)+\s*$/.test(lines[i]!)) {
        separatorIndex = i;
        headerIndex = i - 1;
        break;
      }
    }

    if (headerIndex === -1 || separatorIndex === -1) {
      return this.chunkNonTable(text, originalText);
    }

    // Capture preamble (lines before header)
    // Note: headerIndex is separatorIndex - 1. Preamble is 0 to headerIndex.
    const preambleLines = lines.slice(0, headerIndex);
    const preambleChunks = this.getProseChunks(preambleLines.join('\n'));

    const header = lines[headerIndex]!;
    const separator = lines[separatorIndex]!;
    const dataRows = lines.slice(separatorIndex + 1);

    const tableChunks: string[] = [];
    let currentChunk: string[] = [header, separator];
    
    const headerTokens = this.estimateTokenCount(currentChunk.join('\n'));
    if (headerTokens > this.maxTokens) {
        // proceed with warning
    }

    for (const row of dataRows) {
      // Logic same as before but handle empty rows?
      if (!row.trim()) continue; // Skip empty rows inside table structure

      const testChunk = [...currentChunk, row];
      const testChunkText = testChunk.join('\n');
      const testTokens = this.estimateTokenCount(testChunkText);

      if (testTokens <= this.maxTokens) {
        currentChunk.push(row);
      } else {
        if (currentChunk.length > 2) {
             tableChunks.push(currentChunk.join('\n'));
        } 
        
        const newChunkCandidate = [header, separator, row];
        const newChunkTokens = this.estimateTokenCount(newChunkCandidate.join('\n'));
        
        if (newChunkTokens > this.maxTokens) {
             tableChunks.push(newChunkCandidate.join('\n'));
             currentChunk = [header, separator];
        } else {
             currentChunk = newChunkCandidate;
        }
      }
    }

    if (currentChunk.length > 2 || (tableChunks.length === 0 && currentChunk.length > 0)) {
      tableChunks.push(currentChunk.join('\n'));
    }

    return this.buildChunkResults([...preambleChunks, ...tableChunks], originalText);
  }

  private chunkCsvTable(text: string, originalText: string): ChunkResult[] {
    const lines = text.split('\n'); // No filter

    // CSV usually doesn't have preamble if detected as CSV (starts with comma line)
    // But if we want to be robust... detectTableFormat for CSV checks lines[0].
    
    if (lines.length === 0) return [];

    const header = lines[0]!;
    const dataRows = lines.slice(1);
    
    // If lines[0] IS the header, then no preamble.

    const chunks: string[] = [];
    let currentChunk: string[] = [header];
    
    for (const row of dataRows) {
      if (!row.trim()) continue;

      const testChunk = [...currentChunk, row];
      const testChunkText = testChunk.join('\n');
      const testTokens = this.estimateTokenCount(testChunkText);

      if (testTokens <= this.maxTokens) {
        currentChunk.push(row);
      } else {
        if (currentChunk.length > 1) {
           chunks.push(currentChunk.join('\n'));
        }
        
        const newChunkCandidate = [header, row];
        const newChunkTokens = this.estimateTokenCount(newChunkCandidate.join('\n'));
        
        if (newChunkTokens > this.maxTokens) {
             chunks.push(newChunkCandidate.join('\n'));
             currentChunk = [header];
        } else {
             currentChunk = newChunkCandidate;
        }
      }
    }

    if (currentChunk.length > 1 || (chunks.length === 0 && currentChunk.length > 0)) {
      chunks.push(currentChunk.join('\n'));
    }

    return this.buildChunkResults(chunks, originalText);
  }

  private chunkNonTable(text: string, originalText: string): ChunkResult[] {
    const chunks = this.getProseChunks(text);
    return this.buildChunkResults(chunks, originalText);
  }

  private getProseChunks(text: string): string[] {
    if (!text || !text.trim()) return [];
    
    const tokenCount = this.estimateTokenCount(text);
    if (tokenCount <= this.maxTokens) {
        return [text];
    }

    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;
      
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

    if (currentChunk.length > 0) { // Changed from `currentChunk.length > 2 || (tableChunks.length === 0 && currentChunk.length > 0)` to maintain syntactical correctness and scope.
      chunks.push(currentChunk.join('\n\n')); // Changed from `tableChunks.push(currentChunk.join('\n'))` to maintain syntactical correctness and scope.
    }
    
    return chunks;
  }

  private buildChunkResults(chunks: string[], originalText: string): ChunkResult[] {
    const results: ChunkResult[] = [];
    let currentOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]!;
      const tokenCount = this.estimateTokenCount(chunkText);

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

    logger.debug(
      {
        chunksCreated: results.length,
        totalTokens: results.reduce((sum, c) => sum + c.tokenCount, 0)
      },
      'Row-based chunking completed'
    );

    return results;
  }

  private estimateTokenCount(text: string): number {
    if (!text || !text.trim()) return 0;
    const trimmed = text.trim();
    const words = trimmed.split(/[\W_]+/).filter(w => w).length;
    // Count special characters (anything not alphanumeric or whitespace)
    const specialChars = (trimmed.match(/[^\w\s]/g) || []).length;
    const estimatedTokens = Math.ceil(words * 1.3 + specialChars * 0.5);
    return Math.max(1, estimatedTokens);
  }
}
