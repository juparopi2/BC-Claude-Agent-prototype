/**
 * @module domains/agent/context/SemanticSearchHandler
 *
 * Wraps SemanticSearchService for simplified file search.
 * Extracted from DirectAgentService context preparation logic.
 *
 * Transforms SemanticSearchService results into a simpler format
 * for FileContextPreparer to consume.
 *
 * @example
 * ```typescript
 * const handler = createSemanticSearchHandler();
 * const results = await handler.search('user-1', 'How to create invoices?');
 * console.log(results); // [{ fileId, fileName, content, score }]
 * ```
 */

import { createChildLogger } from '@/shared/utils/logger';
import {
  getSemanticSearchService,
  SemanticSearchService,
} from '@/services/search/semantic/SemanticSearchService';
import type {
  SemanticSearchOptions as ServiceSearchOptions,
} from '@/services/search/semantic/types';
import type {
  ISemanticSearchHandler,
  SearchResult,
  SemanticSearchOptions,
} from './types';
import {
  SEMANTIC_SEARCH_THRESHOLD,
  SEMANTIC_SEARCH_MAX_FILES,
} from './types';

export class SemanticSearchHandler implements ISemanticSearchHandler {
  private readonly logger = createChildLogger({ service: 'SemanticSearchHandler' });

  constructor(private searchService?: SemanticSearchService) {
    this.searchService = searchService ?? getSemanticSearchService();
  }

  async search(
    userId: string,
    query: string,
    options?: SemanticSearchOptions
  ): Promise<SearchResult[]> {
    const threshold = options?.threshold ?? SEMANTIC_SEARCH_THRESHOLD;
    const maxFiles = options?.maxFiles ?? SEMANTIC_SEARCH_MAX_FILES;
    const excludeFileIds = options?.excludeFileIds ?? [];

    this.logger.debug(
      {
        userId,
        queryLength: query.length,
        threshold,
        maxFiles,
        excludeCount: excludeFileIds.length,
      },
      'Starting semantic search'
    );

    try {
      const serviceOptions: ServiceSearchOptions = {
        userId,
        query,
        threshold,
        maxFiles,
        excludeFileIds,
      };

      const response = await this.searchService!.searchRelevantFiles(serviceOptions);

      // Transform results to simpler format
      const results: SearchResult[] = response.results.map((result) => ({
        fileId: result.fileId,
        fileName: result.fileName,
        // Concatenate top chunks content
        content: result.topChunks.map((chunk) => chunk.content).join('\n\n'),
        score: result.relevanceScore,
      }));

      this.logger.info(
        {
          userId,
          resultsCount: results.length,
          query: query.substring(0, 50),
        },
        'Semantic search completed'
      );

      return results;
    } catch (error) {
      this.logger.error(
        {
          error,
          userId,
          query: query.substring(0, 50),
        },
        'Semantic search failed'
      );

      // Return empty array on error (graceful degradation)
      return [];
    }
  }
}

/**
 * Factory function to create SemanticSearchHandler instances.
 */
export function createSemanticSearchHandler(
  searchService?: SemanticSearchService
): SemanticSearchHandler {
  return new SemanticSearchHandler(searchService);
}
