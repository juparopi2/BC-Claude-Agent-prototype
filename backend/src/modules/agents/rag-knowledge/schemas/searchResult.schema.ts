/**
 * Zod Schema for Structured Search Results
 *
 * Defines the JSON structure returned by the RAG tool's search_knowledge_base function.
 * Used for validation, type inference, and ensuring consistent output format.
 *
 * @module modules/agents/rag-knowledge/schemas/searchResult
 */

import { z } from 'zod';

/**
 * Schema for a single excerpt from a source document.
 * Represents a chunk of text that matched the search query.
 */
export const SourceExcerptSchema = z.object({
  /** Text content from the source */
  content: z.string().describe('Text content from the source document'),
  /** Relevance score for this excerpt (0-1) */
  score: z.number().min(0).max(1).describe('Chunk relevance score'),
  /** Position in original document (chunk index) */
  chunkIndex: z.number().int().nonnegative().optional().describe('Position in original document'),
});

/**
 * Schema for source type enumeration.
 * Matches SourceType from source.types.ts.
 */
export const SourceTypeSchema = z.enum([
  'blob_storage',
  'sharepoint',
  'onedrive',
  'email',
  'web',
]);

/**
 * Schema for a single search source (file).
 * Contains all metadata needed for frontend rendering.
 */
export const SearchSourceSchema = z.object({
  /** Unique file identifier */
  fileId: z.string().describe('Unique file identifier'),
  /** Display name of the file */
  fileName: z.string().describe('Display name of the file'),
  /** Source type for routing fetch requests */
  sourceType: SourceTypeSchema.default('blob_storage').describe('Source type for routing'),
  /** MIME type for icon/preview rendering */
  mimeType: z.string().describe('MIME type (e.g., application/pdf)'),
  /** Overall file relevance score (0-1) */
  relevanceScore: z.number().min(0).max(1).describe('Overall file relevance'),
  /** Whether this is an image file */
  isImage: z.boolean().default(false).describe('Whether this is an image file'),
  /** Top matching excerpts from this file */
  excerpts: z.array(SourceExcerptSchema).describe('Top matching excerpts'),
});

/**
 * Schema for search metadata.
 * Contains information about the search operation itself.
 */
export const SearchMetadataSchema = z.object({
  /** Original search query */
  query: z.string().describe('Original search query'),
  /** Total number of chunks analyzed */
  totalChunksSearched: z.number().int().nonnegative().describe('Total chunks analyzed'),
  /** Minimum similarity threshold used */
  threshold: z.number().min(0).max(1).describe('Minimum similarity threshold used'),
});

/**
 * Schema for the complete structured search result.
 * This is the top-level schema returned by the RAG tool.
 */
export const StructuredSearchResultSchema = z.object({
  /** Array of source files found by the search */
  sources: z.array(SearchSourceSchema).describe('Files found by search'),
  /** Metadata about the search operation */
  searchMetadata: SearchMetadataSchema.describe('Search operation metadata'),
  /** Optional error message if search failed */
  error: z.string().optional().describe('Error message if search failed'),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

/** Type for a single excerpt from a source document */
export type SourceExcerpt = z.infer<typeof SourceExcerptSchema>;

/** Type for source type enumeration */
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** Type for a single search source (file) */
export type SearchSource = z.infer<typeof SearchSourceSchema>;

/** Type for search metadata */
export type SearchMetadata = z.infer<typeof SearchMetadataSchema>;

/** Type for the complete structured search result */
export type StructuredSearchResult = z.infer<typeof StructuredSearchResultSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse a JSON string as a StructuredSearchResult.
 * Returns a Result type for safe error handling.
 *
 * @param jsonString - The JSON string to parse and validate
 * @returns Parsed result or validation errors
 *
 * @example
 * ```typescript
 * const result = parseStructuredSearchResult(toolOutput);
 * if (result.success) {
 *   console.log(result.data.sources);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function parseStructuredSearchResult(
  jsonString: string
): z.SafeParseReturnType<unknown, StructuredSearchResult> {
  try {
    const parsed = JSON.parse(jsonString);
    return StructuredSearchResultSchema.safeParse(parsed);
  } catch {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: 'Invalid JSON string',
        },
      ]),
    };
  }
}

/**
 * Create an empty/no-results structured search result.
 * Useful for consistent error handling and empty state.
 *
 * @param query - The original search query
 * @param threshold - The threshold used (default: 0.7)
 * @returns A valid StructuredSearchResult with empty sources
 */
export function createEmptySearchResult(
  query: string,
  threshold = 0.7
): StructuredSearchResult {
  return {
    sources: [],
    searchMetadata: {
      query,
      totalChunksSearched: 0,
      threshold,
    },
  };
}

/**
 * Create an error search result.
 * Useful for returning structured errors from the RAG tool.
 *
 * @param query - The original search query
 * @param errorMessage - The error message
 * @returns A valid StructuredSearchResult with error field
 */
export function createErrorSearchResult(
  query: string,
  errorMessage: string
): StructuredSearchResult {
  return {
    sources: [],
    searchMetadata: {
      query,
      totalChunksSearched: 0,
      threshold: 0.7,
    },
    error: errorMessage,
  };
}
