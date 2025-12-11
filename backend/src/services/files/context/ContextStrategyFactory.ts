/**
 * Context Strategy Factory
 *
 * Phase 5: Chat Integration with Files
 * Determines the optimal strategy for including file content in LLM context.
 *
 * Strategy Selection Logic:
 * 1. Images always use DIRECT_CONTENT (Claude Vision)
 * 2. Small native files (<30MB) without extracted text → DIRECT_CONTENT
 * 3. Files with extracted text → EXTRACTED_TEXT
 * 4. Large files (>=30MB) with embeddings → RAG_CHUNKS
 * 5. Fallback: DIRECT_CONTENT or EXTRACTED_TEXT based on availability
 */

import type { FileForStrategy, StrategyResult } from './types';

/** Maximum file size for direct upload to Claude API (30MB) */
const MAX_DIRECT_SIZE = 30 * 1024 * 1024;

/**
 * MIME types that Claude can process natively
 * These files can be sent directly without extraction
 */
const CLAUDE_NATIVE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/html',
  'text/markdown',
  'text/csv',
]);

export class ContextStrategyFactory {
  /**
   * Selects the optimal context strategy for a file
   *
   * @param file - File metadata for strategy selection
   * @returns Strategy result with reason
   *
   * @example
   * ```typescript
   * const factory = new ContextStrategyFactory();
   * const result = factory.selectStrategy({
   *   mimeType: 'application/pdf',
   *   sizeBytes: 1_000_000,
   *   hasExtractedText: true,
   *   embeddingStatus: 'completed'
   * });
   * // result.strategy === 'EXTRACTED_TEXT'
   * ```
   */
  selectStrategy(file: FileForStrategy): StrategyResult {
    // Rule 1: Images always use Claude Vision (DIRECT_CONTENT)
    if (file.mimeType.startsWith('image/')) {
      return {
        strategy: 'DIRECT_CONTENT',
        reason: 'Image - sent to Claude Vision',
      };
    }

    // Rule 2: Large files (>=30MB) with completed embeddings → RAG
    if (file.sizeBytes >= MAX_DIRECT_SIZE && file.embeddingStatus === 'completed') {
      return {
        strategy: 'RAG_CHUNKS',
        reason: 'Large file with embeddings - using RAG chunks',
      };
    }

    // Rule 3: Files with extracted text → EXTRACTED_TEXT
    // This includes large files without embeddings (fallback)
    if (file.hasExtractedText) {
      return {
        strategy: 'EXTRACTED_TEXT',
        reason: 'Using pre-extracted text content',
      };
    }

    // Rule 4: Small native files without extracted text → DIRECT_CONTENT
    if (file.sizeBytes < MAX_DIRECT_SIZE && CLAUDE_NATIVE_TYPES.has(file.mimeType)) {
      return {
        strategy: 'DIRECT_CONTENT',
        reason: 'Small native file - sending directly to Claude',
      };
    }

    // Rule 5: Fallback for unknown types → DIRECT_CONTENT
    // Let Claude handle it (may fail, but provides best UX for edge cases)
    return {
      strategy: 'DIRECT_CONTENT',
      reason: 'Fallback - attempting direct upload',
    };
  }
}

// Singleton instance for convenience
let instance: ContextStrategyFactory | null = null;

/**
 * Gets the singleton instance of ContextStrategyFactory
 */
export function getContextStrategyFactory(): ContextStrategyFactory {
  if (!instance) {
    instance = new ContextStrategyFactory();
  }
  return instance;
}
