/**
 * Chunking Strategy Types
 *
 * Defines interfaces for document chunking strategies used in Phase 4 RAG implementation.
 */

/**
 * Configuration options for chunking strategies
 */
export interface ChunkingOptions {
  maxTokens: number;        // Maximum tokens per chunk (default: 512)
  overlapTokens: number;    // Overlap between chunks (default: 50)
  encoding?: string;        // Token encoding to use (default: 'cl100k_base')
}

/**
 * Result of chunking a document
 */
export interface ChunkResult {
  text: string;             // The chunk text content
  chunkIndex: number;       // Position in document (0-indexed)
  tokenCount: number;       // Estimated token count for this chunk
  startOffset: number;      // Character offset where chunk starts in original text
  endOffset: number;        // Character offset where chunk ends in original text
}

/**
 * Base interface for all chunking strategies
 */
export interface ChunkingStrategy {
  /**
   * Chunk a text document into smaller pieces
   * @param text The text to chunk
   * @returns Array of chunk results
   */
  chunk(text: string): ChunkResult[];

  /**
   * Get the strategy name for logging/debugging
   */
  readonly name: string;
}

/**
 * Type of chunking strategy to use
 */
export type ChunkingStrategyType = 'recursive' | 'semantic' | 'row-based';
