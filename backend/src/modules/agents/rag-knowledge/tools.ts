/**
 * RAG Knowledge Tools
 *
 * Tools for semantic search and knowledge retrieval.
 * Returns structured JSON with file metadata for citation extraction.
 *
 * @module modules/agents/rag-knowledge/tools
 */

import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { getSemanticSearchService, SEMANTIC_THRESHOLD } from '@/services/search/semantic';
import {
  type StructuredSearchResult,
  type SearchSource,
  createEmptySearchResult,
  createErrorSearchResult,
} from './schemas';

/**
 * RAG tool threshold multiplier for broader recall.
 * Applied to SEMANTIC_THRESHOLD (0.7) to get ~0.6.
 */
const RAG_THRESHOLD_MULTIPLIER = 0.85;

/**
 * Creates a knowledge retrieval tool bound to a specific user context.
 *
 * Returns structured JSON with full file metadata to enable:
 * - CitationExtractor to extract CitedFile[] for frontend
 * - Rich source attribution in agent responses
 * - Tombstone pattern for deleted files
 *
 * @param userId - The ID of the user performing the search
 *
 * @example
 * ```typescript
 * const tool = createKnowledgeSearchTool(userId);
 * const result = await tool.invoke({ query: 'invoice workflow' });
 * // result is JSON string: { sources: [...], searchMetadata: {...} }
 * ```
 */
export const createKnowledgeSearchTool = (userId: string) => {
  return tool(
    async ({ query }): Promise<string> => {
      try {
        const searchService = getSemanticSearchService();
        const results = await searchService.searchRelevantFiles({
          userId: userId,
          query: query,
          maxFiles: 5,
          threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER, // ~0.6: Broader recall than default
        });

        // No results case - return structured empty response
        if (results.results.length === 0) {
          const emptyResult = createEmptySearchResult(query, results.threshold);
          return JSON.stringify(emptyResult);
        }

        // Map SemanticSearchResult to SearchSource[]
        const sources: SearchSource[] = results.results.map((r) => ({
          fileId: r.fileId,
          fileName: r.fileName,
          sourceType: 'blob_storage' as const, // Current implementation only supports blob
          mimeType: r.mimeType ?? 'application/octet-stream',
          relevanceScore: r.relevanceScore,
          isImage: r.isImage ?? false,
          excerpts: r.topChunks.map((chunk) => ({
            content: chunk.content,
            score: chunk.score,
            chunkIndex: chunk.chunkIndex,
          })),
        }));

        // Build structured result
        const structuredResult: StructuredSearchResult = {
          sources,
          searchMetadata: {
            query,
            totalChunksSearched: results.totalChunksSearched,
            threshold: results.threshold,
          },
        };

        return JSON.stringify(structuredResult);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Return structured error response (still valid JSON)
        const errorResult = createErrorSearchResult(query, message);
        return JSON.stringify(errorResult);
      }
    },
    {
      name: 'search_knowledge_base',
      description:
        'Search the semantic knowledge base for relevant documents. Returns structured JSON with file metadata including fileId, fileName, relevanceScore, and text excerpts.',
      schema: z.object({
        query: z.string().describe('The search query to find relevant information.'),
      }),
    }
  );
};
