

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
