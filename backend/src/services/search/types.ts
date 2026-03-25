
/** Search mode controls scoring and ranking strategy */
export type SearchMode = 'text' | 'image';

/** Vector weight constants — tunable per search mode */
export const VECTOR_WEIGHTS = {
  TEXT_MODE_CONTENT: 1.0,    // text mode: contentVector (primary)
  TEXT_MODE_IMAGE: 0.5,      // text mode: imageVector (secondary)
  IMAGE_MODE_IMAGE: 3.0,     // image mode: imageVector (PRIMARY)
  IMAGE_MODE_CONTENT: 0.5,   // image mode: contentVector (caption boost)
} as const;

/**
 * Interface representing a file chunk with its embedding, ready for indexing.
 * Aligned with our database schema and Azure AI Search index fields.
 */
export interface FileChunkWithEmbedding {
  chunkId: string;
  fileId: string;
  userId: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  tokenCount: number;
  embeddingModel: string; // Added for cost tracking
  createdAt: Date;
  mimeType?: string; // File MIME type for filtered search
  fileModifiedAt?: string; // ISO 8601 timestamp of original file modification date
  fileName?: string; // Original file name for search
  sizeBytes?: number; // File size in bytes for filtering
  siteId?: string; // SharePoint site ID (from connection_scopes.scope_site_id)
  sourceType?: string; // File source: 'local', 'onedrive', 'sharepoint'
  parentFolderId?: string; // Parent folder ID for scoped folder search
}

/**
 * Interface for vector search query parameters.
 */
export interface SearchQuery {
  embedding: number[];
  userId: string; // Mandatory for multi-tenant isolation
  top?: number;
  filter?: string; // OData filter string
  minScore?: number;
}

/**
 * Interface for hybrid search query parameters (Vector + Keyword)
 */
export interface HybridSearchQuery extends SearchQuery {
  text: string;
  vectorWeight?: number; // 0.0 to 1.0 (currently not directly supported in all Azure AI Search SDK versions cleanly, but useful for logic)
  keywordWeight?: number; // 0.0 to 1.0
}

/**
 * Standardized search result interface.
 */
export interface SearchResult {
  chunkId: string;
  fileId: string;
  content: string;
  score: number;
  chunkIndex: number;
  relevanceStatus?: 'high' | 'medium' | 'low';
}

/**
 * Statistics about the search index.
 */
export interface IndexStats {
  documentCount: number;
  storageSize: number;
}

// ===== Image Search Types =====

/**
 * Parameters for indexing an image embedding
 */
export interface ImageIndexParams {
  fileId: string;
  userId: string;
  embedding: number[];
  fileName: string;
  /** AI-generated caption/description for improved search relevance (D26 feature) */
  caption?: string;
  /** File MIME type for AI Search field population */
  mimeType?: string;
  /** File size in bytes for filtering */
  sizeBytes?: number;
  /** ISO 8601 timestamp of original file modification date */
  fileModifiedAt?: string;
  /** SharePoint site ID (from connection_scopes.scope_site_id) */
  siteId?: string;
  /** File source: 'local', 'onedrive', 'sharepoint' */
  sourceType?: string;
  /** Parent folder ID for scoped folder search */
  parentFolderId?: string;
}

/**
 * Parameters for image search query
 */
export interface ImageSearchQuery {
  embedding: number[];
  userId: string;
  top?: number;
  minScore?: number;
  /** Additional OData filter to append (e.g., scope filter for @mention scoping) */
  additionalFilter?: string;
}

/**
 * Result from image search
 */
export interface ImageSearchResult {
  fileId: string;
  fileName: string;
  score: number;
  isImage: true;
}

// ===== D26: Semantic Search Types =====

/**
 * Parameters for semantic search with reranking
 * D26: Combines vector search with Azure AI Search Semantic Ranker
 */
export interface SemanticSearchQuery {
  /** Text query for semantic understanding */
  text: string;
  /** Optional: pre-computed query embedding for vector search */
  textEmbedding?: number[];
  /** Optional: pre-computed image query embedding for image search */
  imageEmbedding?: number[];
  /** User ID for multi-tenant isolation */
  userId: string;
  /** Number of candidates to fetch before reranking (default: 30) */
  fetchTopK?: number;
  /** Number of final results after reranking (default: 10) */
  finalTopK?: number;
  /** Minimum score threshold for results */
  minScore?: number;
  /** Additional OData filter to append (e.g., mimeType filtering) */
  additionalFilter?: string;
  /** Search mode: 'text' (default) uses Semantic Ranker, 'image' prioritizes visual similarity — legacy, use new fields */
  searchMode?: SearchMode;
  // PRD-200: New fields for power search — all optional, backward-compat via searchMode fallback
  /** Azure AI Search queryType: 'simple' (BM25 only) or 'semantic' (with reranker). Derived from searchMode if not set. */
  queryType?: 'simple' | 'semantic';
  /** When false, skip all vector queries (keyword-only mode). Default: true. */
  useVectorSearch?: boolean;
  /** When false, disable Semantic Ranker. Default: derived from searchMode. */
  useSemanticRanker?: boolean;
  /** Override per-field vector weights for RRF scoring */
  vectorWeights?: { contentVector: number; imageVector: number };
  /** Azure AI Search orderBy clause (e.g., 'fileModifiedAt desc') */
  orderBy?: string;
}

/**
 * Result from semantic search with reranker score
 */
export interface SemanticSearchResult {
  /** Unique chunk/document ID */
  chunkId: string;
  /** Associated file ID */
  fileId: string;
  /** Document content (text chunk or image caption) */
  content: string;
  /** Vector similarity score (0-1) */
  vectorScore: number;
  /** Semantic Ranker score (0-4 scale, higher = more relevant) */
  rerankerScore?: number;
  /** Combined/final score */
  score: number;
  /** Chunk index within file */
  chunkIndex: number;
  /** Whether this is an image result */
  isImage: boolean;
  /** Extractive caption text from Semantic Ranker (PRD-203) */
  captionText?: string;
  /** Highlighted caption with <em> tags from Semantic Ranker (PRD-203) */
  captionHighlights?: string;
}

// ===== PRD-203: Extractive Search Types =====

/**
 * Extractive answer from Azure AI Search Semantic Ranker (PRD-203).
 * Available at the top-level search results (not per-document).
 */
export interface ExtractiveSearchAnswer {
  /** Extracted answer text */
  text: string;
  /** Highlighted answer text with <em> tags */
  highlights?: string;
  /** Relevance score */
  score: number;
  /** Index document key (chunkId) */
  key: string;
}

/**
 * Full result from semanticSearch() including extractive features (PRD-203).
 * Wraps the per-document results with top-level extractive answers.
 */
export interface SemanticSearchFullResult {
  /** Per-document search results */
  results: SemanticSearchResult[];
  /** Top-level extractive answers from Semantic Ranker */
  extractiveAnswers: ExtractiveSearchAnswer[];
}
