/** LLM-facing search strategy (PRD-200) */
export type SearchType = 'keyword' | 'semantic' | 'hybrid';

/** LLM-facing sort order (PRD-200) */
export type SortBy = 'relevance' | 'newest' | 'oldest';

export interface SemanticSearchOptions {
  userId: string;
  query: string;
  threshold?: number;      // Default: 0.55
  maxFiles?: number;       // Default: 5
  maxChunksPerFile?: number; // Default: 3
  excludeFileIds?: string[];
  filterMimeTypes?: string[];  // MIME types to filter results (for RAG filtered search)
  searchMode?: import('@/services/search/types').SearchMode;  // 'text' (default) | 'image' — legacy, use searchType
  searchType?: SearchType;  // PRD-200: takes precedence over searchMode when set
  sortBy?: SortBy;          // PRD-200: result ordering (default: 'relevance')
  dateFilter?: { from?: string; to?: string };  // ISO date range filter on fileModifiedAt
  additionalFilter?: string;  // Additional OData filter expression (e.g., for @mention scope)
}

export interface SemanticChunk {
  chunkId: string;
  content: string;
  score: number;
  chunkIndex: number;
}

export interface SemanticSearchResult {
  fileId: string;
  fileName: string;
  relevanceScore: number;  // Max score from chunks
  topChunks: SemanticChunk[];
  isImage?: boolean;       // true if this is an image result
  mimeType?: string;       // MIME type for frontend display
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  query: string;
  threshold: number;
  totalChunksSearched: number;
}

export const SEMANTIC_THRESHOLD = 0.55;
export const DEFAULT_MAX_FILES = 10;
export const DEFAULT_MAX_CHUNKS_PER_FILE = 5;
