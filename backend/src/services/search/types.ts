

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
}

/**
 * Parameters for image search query
 */
export interface ImageSearchQuery {
  embedding: number[];
  userId: string;
  top?: number;
  minScore?: number;
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
}
