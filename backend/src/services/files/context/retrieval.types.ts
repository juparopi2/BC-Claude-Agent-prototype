/**
 * Content Retrieval Types
 *
 * Phase 5: Chat Integration with Files
 * Types for retrieving file content based on context strategy.
 */

import type { ContextStrategy } from './types';

/**
 * Content retrieved for a file based on strategy
 */
export interface RetrievedContent {
  /** UUID of the file */
  fileId: string;

  /** Original file name for display */
  fileName: string;

  /** Strategy used to retrieve this content */
  strategy: ContextStrategy;

  /** The actual content in appropriate format */
  content: FileContent;
}

/**
 * Union type for different content formats
 *
 * - `text`: Plain text content (from extraction or direct read)
 * - `base64`: Binary content encoded as base64 (images, PDFs for Claude)
 * - `chunks`: Multiple relevant text chunks from RAG search
 */
export type FileContent =
  | { type: 'text'; text: string }
  | { type: 'base64'; mimeType: string; data: string }
  | { type: 'chunks'; chunks: ChunkContent[] };

/**
 * Individual chunk from RAG vector search
 */
export interface ChunkContent {
  /** Index of this chunk within the file */
  chunkIndex: number;

  /** Text content of the chunk */
  text: string;

  /** Relevance score from vector search (0-1, higher is more relevant) */
  relevanceScore?: number;
}

/**
 * Options for content retrieval
 */
export interface RetrievalOptions {
  /** User message for RAG relevance scoring */
  userQuery?: string;

  /** Maximum number of chunks to retrieve for RAG strategy (default: 5) */
  maxChunks?: number;

  /** Maximum total tokens across all files (default: 100000) */
  maxTotalTokens?: number;
}

/**
 * Result from retrieving multiple files
 */
export interface MultiRetrievalResult {
  /** Successfully retrieved content */
  contents: RetrievedContent[];

  /** Files that failed to retrieve (with reasons) */
  failures: RetrievalFailure[];

  /** Total estimated tokens used */
  totalTokens: number;

  /** Whether token limit was reached */
  truncated: boolean;
}

/**
 * Failure information for a file that couldn't be retrieved
 */
export interface RetrievalFailure {
  /** UUID of the file that failed */
  fileId: string;

  /** File name for error reporting */
  fileName: string;

  /** Reason for failure */
  reason: string;
}
