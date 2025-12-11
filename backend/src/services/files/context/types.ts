/**
 * Context Strategy Types
 *
 * Phase 5: Chat Integration with Files
 * Types for determining how to include file content in LLM context.
 */

import type { EmbeddingStatus } from '@/types/file.types';

/**
 * Strategy for how to include file content in LLM context
 *
 * - `DIRECT_CONTENT`: Send raw file to Claude (images via Vision, small PDFs, text files)
 * - `EXTRACTED_TEXT`: Use pre-extracted text from database (for processed documents)
 * - `RAG_CHUNKS`: Use relevant chunks from vector search (for large files)
 */
export type ContextStrategy =
  | 'DIRECT_CONTENT'
  | 'EXTRACTED_TEXT'
  | 'RAG_CHUNKS';

/**
 * File metadata needed for strategy selection
 *
 * Contains the minimum information required to determine
 * the optimal context strategy for a file.
 */
export interface FileForStrategy {
  /** MIME type of the file (e.g., "application/pdf", "image/png") */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** True if text has been extracted from the file */
  hasExtractedText: boolean;

  /** Current status of embedding generation */
  embeddingStatus: EmbeddingStatus;
}

/**
 * Result from strategy selection
 *
 * Contains the selected strategy and a human-readable reason
 * for debugging and logging purposes.
 */
export interface StrategyResult {
  /** The selected context strategy */
  strategy: ContextStrategy;

  /** Human-readable explanation for the selection */
  reason: string;
}
