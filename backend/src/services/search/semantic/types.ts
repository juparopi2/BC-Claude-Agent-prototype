export interface SemanticSearchOptions {
  userId: string;
  query: string;
  threshold?: number;      // Default: 0.7
  maxFiles?: number;       // Default: 5
  maxChunksPerFile?: number; // Default: 3
  excludeFileIds?: string[];
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
