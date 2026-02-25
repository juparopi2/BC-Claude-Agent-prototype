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
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getImageEmbeddingRepository } from '@/repositories/ImageEmbeddingRepository';
import { getFileService } from '@/services/files/FileService';
import {
  createEmptySearchResult,
  createErrorSearchResult,
} from './schemas';

/**
 * RAG tool threshold multiplier for broader recall.
 * Applied to SEMANTIC_THRESHOLD (0.55) to get ~0.47.
 */
const RAG_THRESHOLD_MULTIPLIER = 0.85;

/**
 * Build an OData scope filter from @mention scopeFileIds in LangGraph config.
 * Returns undefined if no scope is active (tools search globally).
 */
function buildScopeFilter(config: RunnableConfig): string | undefined {
  const scopeFileIds = config?.configurable?.scopeFileIds as string[] | undefined;
  if (!scopeFileIds?.length) return undefined;
  return `search.in(fileId, '${scopeFileIds.join(',')}', ',')`;
}

/**
 * Unified knowledge search tool that reads userId from config.configurable.
 *
 * Merges the former knowledgeSearchTool and filteredKnowledgeSearchTool into
 * a single tool. When fileTypeCategory is omitted, it behaves like the basic
 * search (no MIME-type filter). When provided, it narrows the search to that
 * file type category.
 *
 * This tool is compiled once at startup and bound to createReactAgent.
 * The userId is provided at runtime via LangGraph's config propagation:
 *   supervisor.invoke(messages, { configurable: { userId } })
 *   → LangGraph propagates configurable to all child agents
 *   → tool receives config.configurable.userId
 *
 * @example
 * ```typescript
 * const result = await searchKnowledgeTool.invoke(
 *   { query: 'invoice workflow' },
 *   { configurable: { userId: 'USER-123' } }
 * );
 * ```
 */
export const searchKnowledgeTool = tool(
  async ({ query, fileTypeCategory, dateFrom, dateTo }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult(query, 'No user context available for knowledge search');
      return JSON.stringify(errorResult);
    }

    // Validate category if provided
    if (fileTypeCategory) {
      const validCategories = getValidCategories();
      if (!validCategories.includes(fileTypeCategory as FileTypeCategory)) {
        const errorResult = createErrorSearchResult(
          query,
          `Invalid file type category: "${fileTypeCategory}". Valid categories: ${validCategories.join(', ')}`
        );
        return JSON.stringify(errorResult);
      }
    }

    const mimeTypes = fileTypeCategory ? getMimeTypesForCategory(fileTypeCategory as FileTypeCategory) : undefined;

    try {
      const searchService = getSemanticSearchService();
      const results = await searchService.searchRelevantFiles({
        userId,
        query,
        maxFiles: 5,
        threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER,
        filterMimeTypes: mimeTypes ? [...mimeTypes] : undefined,
        dateFilter: (dateFrom || dateTo) ? { from: dateFrom, to: dateTo } : undefined,
        additionalFilter: buildScopeFilter(config),
      });

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

      const summaryLabel = fileTypeCategory
        ? `${results.results.length} ${fileTypeCategory} file(s)`
        : `${results.results.length} relevant document${results.results.length !== 1 ? 's' : ''}`;

      const citationResult: CitationResult = {
        _type: 'citation_result',
        documents,
        summary: `Found ${summaryLabel} for "${query}"`,
        totalResults: results.results.length,
        query,
        ...(fileTypeCategory ? { fileTypeCategory: fileTypeCategory as FileTypeCategory } : {}),
      };

      return JSON.stringify(citationResult);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorResult = createErrorSearchResult(query, message);
      return JSON.stringify(errorResult);
    }
  },
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge base for relevant documents. Optionally filter by file type category and date range. Returns structured JSON with file metadata and citations.',
    schema: z.object({
      query: z.string().describe('The search query to find relevant information.'),
      fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code']).optional()
        .describe('Optional category to filter: images (JPEG/PNG/GIF/WebP), documents (PDF/DOCX/TXT/MD), spreadsheets (XLSX/CSV), or code (JSON/JS/HTML/CSS).'),
      dateFrom: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return files from this date onward.'),
      dateTo: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return files up to this date.'),
    }),
  }
);

/**
 * Visual image search tool — searches images by visual similarity.
 *
 * Uses image mode to prioritize imageVector (1024d) over caption text.
 * This is the tool for "images with red color", "photos of trucks", etc.
 */
export const visualImageSearchTool = tool(
  async ({ query, dateFrom, dateTo }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult(query, 'No user context available for visual search');
      return JSON.stringify(errorResult);
    }

    try {
      const searchService = getSemanticSearchService();
      const results = await searchService.searchRelevantFiles({
        userId,
        query,
        maxFiles: 10, // Images: show more results
        threshold: SEMANTIC_THRESHOLD * RAG_THRESHOLD_MULTIPLIER,
        searchMode: 'image',
        dateFilter: (dateFrom || dateTo) ? { from: dateFrom, to: dateTo } : undefined,
        additionalFilter: buildScopeFilter(config),
      });

      if (results.results.length === 0) {
        const emptyResult = createEmptySearchResult(query, results.threshold);
        return JSON.stringify(emptyResult);
      }

      const documents: CitedDocument[] = results.results.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: r.mimeType ?? 'image/jpeg',
        sourceType: 'blob_storage' as const,
        isImage: r.isImage ?? true,
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
        summary: `Found ${results.results.length} image(s) matching "${query}" by visual similarity`,
        totalResults: results.results.length,
        query,
      };

      return JSON.stringify(citationResult);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorResult = createErrorSearchResult(query, message);
      return JSON.stringify(errorResult);
    }
  },
  {
    name: 'visual_image_search',
    description:
      'Search images by visual similarity. Use when the user describes WHAT images look like ' +
      '(colors, objects, scenes, visual properties). This searches by visual content, not just file names or descriptions. ' +
      'Also supports date range filtering.',
    schema: z.object({
      query: z.string().describe('Visual description: colors, objects, scenes. Examples: "red truck", "sunset", "damaged parts".'),
      dateFrom: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return images from this date onward.'),
      dateTo: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return images up to this date.'),
    }),
  }
);

/**
 * Find similar images tool — image-to-image similarity search.
 *
 * Uses the source image's stored embedding to find visually similar images.
 * Supports two input paths:
 *   - fileId: a Knowledge Base image identified by its file ID
 *   - chatAttachmentId: an ephemeral chat attachment whose embedding is provided
 *     via config.configurable.chatImageEmbeddings at runtime
 *
 * User says "find images similar to [this file/attachment]".
 */
export const findSimilarImagesTool = tool(
  async ({ fileId, chatAttachmentId, maxResults = 5 }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult('similar images', 'No user context available for image search');
      return JSON.stringify(errorResult);
    }

    try {
      let sourceEmbedding: { embedding: number[] };
      let fileName: string;

      // Path A: Chat attachment (ephemeral image) — use pre-computed embedding from context
      const chatImageEmbeddings = config?.configurable?.chatImageEmbeddings as Array<{
        attachmentId: string;
        name: string;
        embedding: number[];
      }> | undefined;

      if (chatAttachmentId) {
        const match = chatImageEmbeddings?.find(e => e.attachmentId === chatAttachmentId);
        if (!match) {
          return JSON.stringify(
            createErrorSearchResult('similar images', `Chat attachment embedding not found for ID: ${chatAttachmentId}`)
          );
        }
        sourceEmbedding = { embedding: match.embedding };
        fileName = match.name;
      } else {
        // Path B: KB file — look up embedding from DB
        // fileId is guaranteed non-undefined here because the schema .refine() ensures
        // at least one of fileId or chatAttachmentId is present.
        const resolvedFileId = fileId as string;

        // 1. Look up source file name for user-friendly display
        const fileService = getFileService();
        const sourceFile = await fileService.getFile(userId, resolvedFileId.toUpperCase());
        fileName = sourceFile?.name ?? resolvedFileId;

        // 2. Get the source image's embedding from DB
        const repo = getImageEmbeddingRepository();
        const dbEmbedding = await repo.getByFileId(resolvedFileId.toUpperCase(), userId);
        if (!dbEmbedding) {
          const errorResult = createErrorSearchResult(
            'similar images',
            `Source image embedding not found for fileId: ${resolvedFileId}`
          );
          return JSON.stringify(errorResult);
        }
        sourceEmbedding = dbEmbedding;
      }

      // 3. Use searchImages() — pure vector on imageVector, no Semantic Ranker
      const vectorSearchService = VectorSearchService.getInstance();
      const results = await vectorSearchService.searchImages({
        embedding: sourceEmbedding.embedding,
        userId,
        top: maxResults + 1, // +1 to exclude self when searching by KB file
        additionalFilter: buildScopeFilter(config),
      });

      // 4. Exclude the source KB image from results (not applicable for chat attachments)
      const filtered = fileId
        ? results.filter(r => r.fileId.toUpperCase() !== fileId.toUpperCase())
        : results;
      const finalResults = filtered.slice(0, maxResults);

      if (finalResults.length === 0) {
        const emptyResult = createEmptySearchResult('similar images', 0);
        return JSON.stringify(emptyResult);
      }

      const documents: CitedDocument[] = finalResults.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: 'image/jpeg', // searchImages doesn't return mimeType
        sourceType: 'blob_storage' as const,
        isImage: true,
        documentRelevance: r.score,
        passages: [{
          citationId: `${r.fileId}-0`,
          excerpt: `Similar image: ${r.fileName} (similarity: ${(r.score * 100).toFixed(1)}%)`,
          relevanceScore: r.score,
        }],
      }));

      const citationResult: CitationResult = {
        _type: 'citation_result',
        documents,
        summary: `Found ${finalResults.length} image(s) similar to "${fileName}"`,
        totalResults: finalResults.length,
        query: `similar to ${fileName}`,
      };

      return JSON.stringify(citationResult);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorResult = createErrorSearchResult('similar images', message);
      return JSON.stringify(errorResult);
    }
  },
  {
    name: 'find_similar_images',
    description:
      'Find images visually similar to a specific reference image. Use when the user points to ' +
      'a specific image and wants to find similar ones in their collection.',
    schema: z.object({
      fileId: z.string().optional().describe('File ID of a Knowledge Base image to find similar images for.'),
      chatAttachmentId: z.string().optional().describe('Chat attachment ID of an ephemeral image to find similar images for.'),
      maxResults: z.number().int().min(1).max(20).optional()
        .describe('Maximum number of similar images to return. Default: 5.'),
    }).refine(
      (data) => !!(data.fileId || data.chatAttachmentId),
      { message: 'Either fileId or chatAttachmentId must be provided' }
    ),
  }
);

