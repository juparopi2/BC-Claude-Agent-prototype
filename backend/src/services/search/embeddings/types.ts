/**
 * Unified Embedding Service Interface (PRD-201)
 *
 * Abstracts over different embedding providers (legacy OpenAI + Vision vs. Cohere Embed 4).
 * Used by SemanticSearchService and file processing pipeline for Cohere Embed v4 embeddings.
 *
 * @module services/search/embeddings/types
 */

/**
 * Cohere Embed 4 input type.
 * - 'search_document': for indexing content into the search index
 * - 'search_query': for query-time embedding of user queries
 *
 * Using the correct input type is critical for retrieval quality —
 * Cohere optimizes the embedding differently for each use case.
 */
export type EmbeddingInputType = 'search_document' | 'search_query';

/**
 * Provider-agnostic embedding result.
 *
 * Intentionally minimal — no userId, createdAt, or raw response.
 * The caller (SemanticSearchService, FileEmbedWorker) adds user context.
 */
export interface EmbeddingResult {
  /** The embedding vector (1536 dimensions for Cohere Embed 4) */
  embedding: number[];
  /** Model identifier for cost tracking */
  model: string;
  /** Number of input tokens consumed (for billing) */
  inputTokens: number;
}

/**
 * Unified embedding service interface.
 *
 * Design principles:
 * - embedText: text-only content (chunks, captions)
 * - embedImage: standalone images (base64 encoded)
 * - embedInterleaved: mixed text+image (PRD-203: docs with charts)
 * - embedTextBatch: bulk indexing (PRD-202: re-embedding pipeline)
 * - embedQuery: convenience for search queries ('search_query' input type)
 */
export interface IEmbeddingService {
  /** Generate embedding for text content */
  embedText(text: string, inputType: EmbeddingInputType): Promise<EmbeddingResult>;

  /** Generate embedding for a base64-encoded image */
  embedImage(imageBase64: string, inputType: EmbeddingInputType): Promise<EmbeddingResult>;

  /** Generate embedding for interleaved text+image content */
  embedInterleaved(
    content: Array<{ type: 'text'; text: string } | { type: 'image_base64'; data: string }>,
    inputType: EmbeddingInputType,
  ): Promise<EmbeddingResult>;

  /** Batch embedding for multiple text inputs */
  embedTextBatch(
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<EmbeddingResult[]>;

  /** Convenience: embed a search query (uses 'search_query' input type) */
  embedQuery(text: string): Promise<EmbeddingResult>;

  /** Model output dimensions (1536 for Cohere Embed 4) */
  readonly dimensions: number;

  /** Model name for cost tracking */
  readonly modelName: string;
}
