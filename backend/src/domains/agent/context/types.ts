/**
 * @module domains/agent/context/types
 *
 * Types for context preparation and semantic search.
 * Used by SemanticSearchHandler and FileContextPreparer.
 */

// === SemanticSearchHandler Types ===

/**
 * Default threshold for semantic search relevance.
 * Files below this score are not included.
 */
export const SEMANTIC_SEARCH_THRESHOLD = 0.7;

/**
 * Default maximum number of files to return from search.
 */
export const SEMANTIC_SEARCH_MAX_FILES = 5;

/**
 * Options for semantic search.
 */
export interface SemanticSearchOptions {
  /** Minimum relevance score (0-1). Default: 0.7 */
  threshold?: number;

  /** Maximum number of files to return. Default: 5 */
  maxFiles?: number;

  /** File IDs to exclude from results */
  excludeFileIds?: string[];
}

/**
 * A single search result from semantic search.
 */
export interface SearchResult {
  /** Unique file identifier */
  fileId: string;

  /** Display name of the file */
  fileName: string;

  /** Concatenated content from top matching chunks */
  content: string;

  /** Relevance score (0-1, higher is more relevant) */
  score: number;
}

/**
 * Interface for SemanticSearchHandler.
 * Wraps SemanticSearchService for simplified file search.
 */
export interface ISemanticSearchHandler {
  /**
   * Search for files relevant to a query.
   * @param userId - User ID for file ownership filtering
   * @param query - Search query (natural language)
   * @param options - Search options (threshold, maxFiles, excludeFileIds)
   * @returns Array of search results sorted by relevance
   */
  search(
    userId: string,
    query: string,
    options?: SemanticSearchOptions
  ): Promise<SearchResult[]>;
}

// === FileContextPreparer Types (for future implementation) ===

/**
 * Source of a file in the context.
 */
export type FileSource = 'attachment' | 'semantic_search';

/**
 * A file reference with content for context preparation.
 */
export interface FileReference {
  /** Unique file identifier */
  id: string;

  /** Display name of the file */
  name: string;

  /** File content (full or relevant chunks) */
  content: string;

  /** How this file was included */
  source: FileSource;

  /** Relevance score if from semantic search */
  score?: number;
}

/**
 * Options for file context preparation.
 */
export interface FileContextOptions {
  /** Explicit file attachment IDs */
  attachments?: string[];

  /** Enable automatic semantic search for relevant files */
  enableAutoSemanticSearch?: boolean;

  /** Threshold for semantic search (if enabled) */
  semanticThreshold?: number;

  /** Max files from semantic search (if enabled) */
  maxSemanticFiles?: number;
}

/**
 * Result of file context preparation.
 */
export interface FileContextPreparationResult {
  /** Formatted context text to include in prompt */
  contextText: string;

  /** Files included in the context */
  filesIncluded: FileReference[];

  /** Whether semantic search was used */
  semanticSearchUsed: boolean;

  /** Total number of files processed */
  totalFilesProcessed: number;
}

/**
 * Interface for FileContextPreparer (future implementation).
 */
export interface IFileContextPreparer {
  /**
   * Prepare file context for the agent prompt.
   * @param userId - User ID for file access
   * @param prompt - User's prompt (for semantic search)
   * @param options - Context preparation options
   * @returns Prepared file context
   */
  prepare(
    userId: string,
    prompt: string,
    options?: FileContextOptions
  ): Promise<FileContextPreparationResult>;
}
