/**
 * Source Type System for Multi-Provider File Support
 *
 * Defines types for file/document origins (Blob Storage, SharePoint, etc.)
 * and fetch strategies for frontend content retrieval.
 *
 * @module @bc-agent/shared/types/source
 */

/**
 * Source types for file/document origins.
 * Determines how frontend requests content.
 *
 * Current implementation:
 * - blob_storage: Azure Blob Storage (active)
 *
 * Future providers:
 * - sharepoint: Microsoft SharePoint
 * - onedrive: Microsoft OneDrive
 * - email: Email attachments
 * - web: Web URLs
 */
export type SourceType =
  | 'blob_storage' // Azure Blob (current)
  | 'sharepoint' // Microsoft SharePoint (future)
  | 'onedrive' // Microsoft OneDrive (future)
  | 'email' // Email attachments (future)
  | 'web'; // Web URLs (future)

/**
 * Fetch strategy determines how frontend retrieves content.
 *
 * - internal_api: Use /api/files/:id/content (blob_storage)
 * - oauth_proxy: Use /api/external/:source/:id (sharepoint, onedrive, email)
 * - external: Direct external URL (web)
 */
export type FetchStrategy =
  | 'internal_api' // Use /api/files/:id/content
  | 'oauth_proxy' // Use /api/external/:source/:id
  | 'external'; // Direct external URL

/**
 * Excerpt from a source document.
 * Represents a chunk of text that matched the search query.
 */
export interface SourceExcerpt {
  /** Text content from the source */
  content: string;
  /** Relevance score for this excerpt (0-1) */
  score: number;
  /** Position in original document (chunk index) */
  chunkIndex?: number;
}

/**
 * Maps source type to appropriate fetch strategy.
 *
 * @param sourceType - The source type to map
 * @returns The appropriate fetch strategy for the source
 *
 * @example
 * ```typescript
 * const strategy = getFetchStrategy('blob_storage'); // 'internal_api'
 * const strategy = getFetchStrategy('sharepoint');   // 'oauth_proxy'
 * const strategy = getFetchStrategy('web');          // 'external'
 * ```
 */
export function getFetchStrategy(sourceType: SourceType): FetchStrategy {
  switch (sourceType) {
    case 'blob_storage':
      return 'internal_api';
    case 'sharepoint':
    case 'onedrive':
    case 'email':
      return 'oauth_proxy';
    case 'web':
      return 'external';
    default: {
      // Exhaustive check - TypeScript will error if a case is missed
      const exhaustiveCheck: never = sourceType;
      throw new Error(`Unhandled source type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Default source type for files without explicit source.
 * Used when migrating existing data or handling legacy files.
 */
export const DEFAULT_SOURCE_TYPE: SourceType = 'blob_storage';

/**
 * Default fetch strategy for files without explicit strategy.
 */
export const DEFAULT_FETCH_STRATEGY: FetchStrategy = 'internal_api';
