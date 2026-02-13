/**
 * RAG Knowledge Tools
 *
 * Tools for semantic search and knowledge retrieval.
 * Returns structured JSON with file metadata for citation extraction.
 *
 * Uses config.configurable.userId for user-scoped queries,
 * enabling compile-once agents (createReactAgent pattern).
 *
 * @module modules/agents/rag-knowledge/tools
 */

import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { CitationResult, CitedDocument, CitationPassage, FileTypeCategory } from '@bc-agent/shared';
import { getMimeTypesForCategory, getValidCategories } from '@bc-agent/shared';
import { getSemanticSearchService, SEMANTIC_THRESHOLD } from '@/services/search/semantic';
import {
  createEmptySearchResult,
  createErrorSearchResult,
} from './schemas';

/**
 * RAG tool threshold multiplier for broader recall.
 * Applied to SEMANTIC_THRESHOLD (0.7) to get ~0.6.
 */
const RAG_THRESHOLD_MULTIPLIER = 0.85;

/**
 * Static knowledge search tool that reads userId from config.configurable.
 *
 * This tool is compiled once at startup and bound to createReactAgent.
 * The userId is provided at runtime via LangGraph's config propagation:
 *   supervisor.invoke(messages, { configurable: { userId } })
 *   → LangGraph propagates configurable to all child agents
 *   → tool receives config.configurable.userId
 *
 * @example
 * ```typescript
 * const result = await knowledgeSearchTool.invoke(
 *   { query: 'invoice workflow' },
 *   { configurable: { userId: 'USER-123' } }
 * );
 * ```
 */
export const knowledgeSearchTool = tool(
  async ({ query }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult(query, 'No user context available for knowledge search');
      return JSON.stringify(errorResult);
    }

    try {
      const searchService = getSemanticSearchService();
      const results = await searchService.searchRelevantFiles({
        userId,
        query,
        maxFiles: 5,
        threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER, // ~0.6: Broader recall than default
      });

      // No results case - return structured empty response
      if (results.results.length === 0) {
        const emptyResult = createEmptySearchResult(query, results.threshold);
        return JSON.stringify(emptyResult);
      }

      // Build CitationResult for rich rendering (PRD-071)
      const documents: CitedDocument[] = results.results.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: r.mimeType ?? 'application/octet-stream',
        sourceType: 'blob_storage' as const,
        isImage: r.isImage ?? false,
        documentRelevance: r.relevanceScore,
        passages: r.topChunks.map((chunk, idx): CitationPassage => ({
          citationId: `${r.fileId}-${idx}`,
          excerpt: chunk.content.slice(0, 500),
          relevanceScore: chunk.score,
        })),
      }));

      const citationResult: CitationResult = {
        _type: 'citation_result',
        documents,
        summary: `Found ${results.results.length} relevant document${results.results.length !== 1 ? 's' : ''} for "${query}"`,
        totalResults: results.results.length,
        query,
      };

      return JSON.stringify(citationResult);
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

/**
 * Filtered knowledge search tool that searches by file type category.
 *
 * Allows the RAG agent to narrow searches to specific file types:
 * - images: JPEG, PNG, GIF, WebP, SVG
 * - documents: PDF, DOCX, TXT, Markdown
 * - spreadsheets: XLSX, CSV
 * - code: JSON, JS, HTML, CSS
 *
 * Uses the same runtime config pattern as knowledgeSearchTool.
 */
export const filteredKnowledgeSearchTool = tool(
  async ({ query, fileTypeCategory }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult(query, 'No user context available for knowledge search');
      return JSON.stringify(errorResult);
    }

    // Validate category
    const validCategories = getValidCategories();
    if (!validCategories.includes(fileTypeCategory as FileTypeCategory)) {
      const errorResult = createErrorSearchResult(
        query,
        `Invalid file type category: "${fileTypeCategory}". Valid categories: ${validCategories.join(', ')}`
      );
      return JSON.stringify(errorResult);
    }

    const mimeTypes = getMimeTypesForCategory(fileTypeCategory as FileTypeCategory);

    try {
      const searchService = getSemanticSearchService();
      const results = await searchService.searchRelevantFiles({
        userId,
        query,
        maxFiles: 5,
        threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER,
        filterMimeTypes: [...mimeTypes],
      });

      // No results case
      if (results.results.length === 0) {
        const emptyResult = createEmptySearchResult(query, results.threshold);
        return JSON.stringify(emptyResult);
      }

      // Build CitationResult for rich rendering (PRD-071)
      const documents: CitedDocument[] = results.results.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: r.mimeType ?? 'application/octet-stream',
        sourceType: 'blob_storage' as const,
        isImage: r.isImage ?? false,
        documentRelevance: r.relevanceScore,
        passages: r.topChunks.map((chunk, idx): CitationPassage => ({
          citationId: `${r.fileId}-${idx}`,
          excerpt: chunk.content.slice(0, 500),
          relevanceScore: chunk.score,
        })),
      }));

      const citationResult: CitationResult = {
        _type: 'citation_result',
        documents,
        summary: `Found ${results.results.length} ${fileTypeCategory} file(s) for "${query}"`,
        totalResults: results.results.length,
        query,
        fileTypeCategory: fileTypeCategory as FileTypeCategory,
      };

      return JSON.stringify(citationResult);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorResult = createErrorSearchResult(query, message);
      return JSON.stringify(errorResult);
    }
  },
  {
    name: 'filtered_knowledge_search',
    description:
      'Search the knowledge base filtered by file type category. Use when the user wants specific types of files (images, documents, spreadsheets, code). Returns structured JSON with citations.',
    schema: z.object({
      query: z.string().describe('The search query to find relevant information.'),
      fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code'])
        .describe('Category of files to search: images (JPEG/PNG/GIF/WebP), documents (PDF/DOCX/TXT/MD), spreadsheets (XLSX/CSV), or code (JSON/JS/HTML/CSS).'),
    }),
  }
);

/**
 * @deprecated Use knowledgeSearchTool (static) instead.
 * Kept temporarily for backward compatibility during migration.
 */
export const createKnowledgeSearchTool = (userId: string) => {
  return tool(
    async ({ query }): Promise<string> => {
      return knowledgeSearchTool.invoke({ query }, { configurable: { userId } });
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
