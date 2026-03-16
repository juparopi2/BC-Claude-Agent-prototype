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
import { createChildLogger } from '@/shared/utils/logger';
import {
  createEmptySearchResult,
  createErrorSearchResult,
} from './schemas';

const logger = createChildLogger({ service: 'RagTools' });

/**
 * RAG tool threshold multiplier for broader recall.
 * Applied to SEMANTIC_THRESHOLD (0.55) to get ~0.47.
 */
const RAG_THRESHOLD_MULTIPLIER = 0.85;

/**
 * Build an OData scope filter from the LangGraph config.
 *
 * Preferred path: use the pre-built `scopeFilter` string from MentionScopeResolver
 * (set on config.configurable.scopeFilter by MessageContextBuilder).
 *
 * Legacy fallback: if only `scopeFileIds` is present, build a simple fileId filter.
 * This keeps backward compatibility with any callers that still pass raw IDs.
 *
 * Returns undefined if no scope is active (tools search globally).
 */
function buildScopeFilter(config: RunnableConfig): string | undefined {
  // Preferred: pre-built OData filter from MentionScopeResolver
  const scopeFilter = config?.configurable?.scopeFilter as string | undefined;
  if (scopeFilter) {
    logger.info({ filter: scopeFilter.slice(0, 200) }, 'Using pre-built scope filter');
    return scopeFilter;
  }

  // Legacy fallback: build from raw scopeFileIds
  const scopeFileIds = config?.configurable?.scopeFileIds as string[] | undefined;
  if (!scopeFileIds?.length) {
    logger.debug('No scopeFilter or scopeFileIds — searching globally');
    return undefined;
  }
  const normalized = scopeFileIds.map(id => id.toUpperCase());
  const filter = `search.in(fileId, '${normalized.join(',')}', ',')`;
  logger.info({ scopeCount: normalized.length, filter: filter.slice(0, 200) }, 'Scope filter built from legacy scopeFileIds');
  return filter;
}

/**
 * Build an OData date range filter.
 * Returns undefined if no date parameters are provided.
 */
function buildDateFilter(dateFrom?: string, dateTo?: string): string | undefined {
  const parts: string[] = [];
  if (dateFrom) parts.push(`fileModifiedAt ge ${dateFrom}T00:00:00Z`);
  if (dateTo) parts.push(`fileModifiedAt le ${dateTo}T23:59:59Z`);
  return parts.length > 0 ? parts.join(' and ') : undefined;
}

/**
 * Build a combined OData filter merging scope + date range.
 * Returns undefined if neither scope nor date filters apply.
 */
function buildCombinedFilter(config: RunnableConfig, dateFrom?: string, dateTo?: string): string | undefined {
  const parts: string[] = [];
  const scope = buildScopeFilter(config);
  if (scope) parts.push(scope);
  const date = buildDateFilter(dateFrom, dateTo);
  if (date) parts.push(date);
  return parts.length > 0 ? parts.join(' and ') : undefined;
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
        additionalFilter: buildCombinedFilter(config, dateFrom, dateTo),
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
        additionalFilter: buildCombinedFilter(config, dateFrom, dateTo),
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
  async ({ fileId, chatAttachmentId, maxResults = 5, dateFrom, dateTo }, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult('similar images', 'No user context available for image search');
      return JSON.stringify(errorResult);
    }

    try {
      let sourceEmbedding: { embedding: number[] };
      let fileName: string;
      // Track resolved file ID for self-filtering (hoisted for use outside if/else)
      let resolvedFileId: string | undefined;

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
        resolvedFileId = fileId as string;

        // Check if LLM passed a filename instead of UUID — attempt resolution
        const UUID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
        if (!UUID_REGEX.test(resolvedFileId)) {
          const fileService = getFileService();
          const resolved = await fileService.findByNameGlobal(userId, resolvedFileId);
          if (resolved) {
            logger.info({ inputName: resolvedFileId, resolvedId: resolved.id }, 'Resolved filename to fileId');
            resolvedFileId = resolved.id;
          } else {
            return JSON.stringify(createErrorSearchResult(
              'similar images',
              `Could not resolve "${resolvedFileId}" to a file. Use the UUID from the mention's id attribute.`
            ));
          }
        }

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
        additionalFilter: buildCombinedFilter(config, dateFrom, dateTo),
      });

      // 4. Exclude the source KB image from results (not applicable for chat attachments)
      // Use resolvedFileId (UUID) for filtering, not original fileId (which might be a filename)
      const filtered = resolvedFileId
        ? results.filter(r => r.fileId.toUpperCase() !== resolvedFileId.toUpperCase())
        : results;
      const finalResults = filtered.slice(0, maxResults);

      if (finalResults.length === 0) {
        const emptyResult = createEmptySearchResult('similar images', 0);
        return JSON.stringify(emptyResult);
      }

      const documents: CitedDocument[] = finalResults.map((r) => {
        // Clamp score to [0, 1] range for Zod schema compliance
        const score = Math.min(1, Math.max(0, r.score));
        return {
          fileId: r.fileId,
          fileName: r.fileName,
          mimeType: 'image/jpeg', // searchImages doesn't return mimeType
          sourceType: 'blob_storage' as const,
          isImage: true,
          documentRelevance: score,
          passages: [{
            citationId: `${r.fileId}-0`,
            excerpt: `Similar image: ${r.fileName} (similarity: ${(r.score * 100).toFixed(1)}%)`,
            relevanceScore: score,
          }],
        };
      });

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
      dateFrom: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return images from this date onward.'),
      dateTo: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return images up to this date.'),
    }).refine(
      (data) => !!(data.fileId || data.chatAttachmentId),
      { message: 'Either fileId or chatAttachmentId must be provided' }
    ),
  }
);

