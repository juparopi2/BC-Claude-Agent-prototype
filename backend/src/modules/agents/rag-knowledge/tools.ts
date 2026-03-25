/**
 * RAG Knowledge Tools (PRD-200: Power Search)
 *
 * Two tools for semantic search and knowledge retrieval:
 * 1. search_knowledge — Power search tool with LLM-controlled parameters
 * 2. find_similar_images — Image-to-image similarity search
 *
 * Decision rule (zero ambiguity):
 *   User has a reference image (fileId, attachment) → find_similar_images
 *   Everything else                                → search_knowledge
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
import { getMimeTypesForCategory } from '@bc-agent/shared';
import { getSemanticSearchService } from '@/services/search/semantic';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getImageEmbeddingRepository } from '@/repositories/ImageEmbeddingRepository';
import { getFileService } from '@/services/files/FileService';
import { createChildLogger } from '@/shared/utils/logger';
import {
  createEmptySearchResult,
  createErrorSearchResult,
} from './schemas';
import { validateSearchInput } from './validation';
import type { ValidatedSearchInput } from './validation';
import { classifySearchError, formatNoResultsGuidance } from './error-handler';

const logger = createChildLogger({ service: 'RagTools' });

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

// ===== Tool 1: search_knowledge (Power Search) =====

/**
 * Power search tool — PRD-200.
 *
 * Exposes Azure AI Search capabilities directly to the LLM with 8 controllable
 * parameters. A validation pipeline clamps, defaults, and overrides bad states
 * before execution. Errors are classified and returned with actionable guidance.
 */
export const searchKnowledgeTool = tool(
  async (rawInput, config: RunnableConfig): Promise<string> => {
    const userId = config?.configurable?.userId as string | undefined;

    if (!userId) {
      const errorResult = createErrorSearchResult(rawInput.query, 'No user context available for knowledge search');
      return JSON.stringify(errorResult);
    }

    // 1. Validate input through the pipeline (clamp → defaults → overrides → dates)
    const validated = validateSearchInput(rawInput);
    if ('is_error' in validated) {
      return JSON.stringify(validated);
    }

    // 2. Resolve MIME types from fileTypeCategory
    const mimeTypes = validated.fileTypeCategory
      ? getMimeTypesForCategory(validated.fileTypeCategory as FileTypeCategory)
      : undefined;

    // 3. Determine internal searchMode for image vector weight selection
    const isImageSearch = validated.fileTypeCategory === 'images';
    const searchMode = (isImageSearch && validated.searchType !== 'keyword') ? 'image' as const : 'text' as const;

    try {
      // 4. Execute search via SemanticSearchService
      const searchService = getSemanticSearchService();
      const results = await searchService.searchRelevantFiles({
        userId,
        query: validated.query,
        maxFiles: validated.top,
        threshold: validated.minRelevanceScore,
        filterMimeTypes: mimeTypes ? [...mimeTypes] : undefined,
        searchMode,
        searchType: validated.searchType,
        sortBy: validated.sortBy,
        dateFilter: (validated.dateFrom || validated.dateTo)
          ? { from: validated.dateFrom, to: validated.dateTo }
          : undefined,
        additionalFilter: buildCombinedFilter(config, validated.dateFrom, validated.dateTo),
      });

      // 5. Handle empty results with guidance
      if (results.results.length === 0) {
        const guidance = formatNoResultsGuidance(validated);
        const emptyResult = createEmptySearchResult(validated.query, results.threshold);
        return JSON.stringify({ ...emptyResult, guidance });
      }

      // 6. Build CitationResult for rich rendering
      // PRD-203: responseDetail controls passage verbosity
      const isConcise = validated.responseDetail === 'concise';
      const documents: CitedDocument[] = results.results.map((r) => ({
        fileId: r.fileId,
        fileName: r.fileName,
        mimeType: r.mimeType ?? (isImageSearch ? 'image/jpeg' : 'application/octet-stream'),
        sourceType: 'blob_storage' as const,
        isImage: r.isImage ?? false,
        documentRelevance: r.relevanceScore,
        passages: isConcise
          ? r.topChunks.slice(0, 1).map((chunk, idx): CitationPassage => ({
              citationId: `${r.fileId}-${idx}`,
              excerpt: chunk.highlightedCaption ?? chunk.content.slice(0, 100),
              relevanceScore: chunk.score,
              highlightedCaption: chunk.highlightedCaption,
            }))
          : r.topChunks.map((chunk, idx): CitationPassage => ({
              citationId: `${r.fileId}-${idx}`,
              excerpt: chunk.content.slice(0, 500),
              relevanceScore: chunk.score,
              highlightedCaption: chunk.highlightedCaption,
            })),
      }));

      const summaryLabel = validated.fileTypeCategory
        ? `${results.results.length} ${validated.fileTypeCategory} file(s)`
        : `${results.results.length} relevant document${results.results.length !== 1 ? 's' : ''}`;

      const citationResult: CitationResult = {
        _type: 'citation_result',
        documents,
        summary: `Found ${summaryLabel} for "${validated.query}"`,
        totalResults: results.results.length,
        query: validated.query,
        ...(validated.fileTypeCategory ? { fileTypeCategory: validated.fileTypeCategory as FileTypeCategory } : {}),
        // PRD-203: Include extractive answers when available
        ...(results.extractiveAnswers?.length ? {
          extractiveAnswers: results.extractiveAnswers.map(a => ({
            text: a.text,
            score: a.score,
            highlights: a.highlights,
            sourceChunkId: a.sourceChunkId,
            sourceFileId: a.sourceFileId,
          })),
        } : {}),
      };

      return JSON.stringify(citationResult);
    } catch (error: unknown) {
      // 7. Error passthrough with classification
      return classifySearchError(error, validated as ValidatedSearchInput);
    }
  },
  {
    name: 'search_knowledge',
    description:
      'Search the user\'s knowledge base using Azure AI Search. Supports keyword search, ' +
      'semantic (AI-powered) search, and hybrid search (keyword + vector + semantic reranking). ' +
      'Returns matching files with relevance scores, citations, and excerpts.\n\n' +
      'SEARCH TYPES:\n' +
      '- "hybrid" (default): Best general-purpose search. Combines exact term matching with ' +
      'conceptual understanding. Use for most queries.\n' +
      '- "semantic": Pure conceptual search with AI reranking. Use when the user asks a question ' +
      'in natural language and exact terms may not appear in documents.\n' +
      '- "keyword": Exact BM25 text matching. Use for product codes, identifiers, filenames, ' +
      'or when the user wants literal string matches.\n\n' +
      'FILTERING:\n' +
      '- Use fileTypeCategory to narrow by file type (documents, images, spreadsheets, code, presentations)\n' +
      '- Use dateFrom/dateTo for date range filtering\n' +
      '- Combine both for targeted searches (e.g., "all spreadsheets from January")\n' +
      '- Use query "*" with filters for pure browsing (no semantic matching)\n\n' +
      'TUNING:\n' +
      '- Adjust "top" based on query breadth (3-5 for specific, 15-30 for exploratory)\n' +
      '- Adjust "minRelevanceScore" based on precision needs (0.6+ for precise, 0.2-0.3 for broad)\n' +
      '- Use "sortBy" for chronological browsing vs relevance ranking',
    schema: z.object({
      query: z.string().describe(
        'Search query text. Use specific terms for keyword search, natural language for semantic/hybrid. ' +
        'Use "*" for filter-only searches (e.g., all images, all files from a date range). ' +
        'For images, describe visual content (e.g., "red truck in parking lot", "organizational chart"). ' +
        'For documents, describe the information needed (e.g., "Q3 revenue forecast", "return policy").'
      ),
      searchType: z.enum(['hybrid', 'semantic', 'keyword']).optional().describe(
        'Search strategy to use. ' +
        '"hybrid" (DEFAULT): keyword matching + vector similarity + semantic reranking. Best for most queries. ' +
        '"semantic": vector similarity with semantic reranking. Best for natural language questions and conceptual searches. ' +
        '"keyword": BM25 text matching only. Best for exact terms, product codes, identifiers, or filenames. ' +
        'When fileTypeCategory is "images", hybrid and semantic use visual similarity matching automatically.'
      ),
      fileTypeCategory: z.enum(['images', 'documents', 'spreadsheets', 'code', 'presentations']).optional()
        .describe(
          'Filter results to a specific file type category. ' +
          'When set to "images", search prioritizes visual similarity matching (image embeddings). ' +
          'Omit to search across all file types.'
        ),
      top: z.number().int().min(1).max(50).optional().describe(
        'Maximum number of files to return (1-50). ' +
        'Default: 5 for documents/spreadsheets/code, 10 for images, 10 for cross-type searches. ' +
        'Use higher values (15-30) for broad research queries or when exploring a topic. ' +
        'Use lower values (3-5) for specific, targeted lookups.'
      ),
      minRelevanceScore: z.number().min(0).max(1).optional().describe(
        'Minimum relevance score threshold (0.0 to 1.0). Default: 0.47. ' +
        'Increase to 0.6-0.8 when high precision is needed (user wants only the most relevant results). ' +
        'Decrease to 0.2-0.3 for broad exploratory searches when recall matters more than precision. ' +
        'Set to 0.0 to return all results regardless of relevance (use with date/type filters).'
      ),
      dateFrom: z.string().optional().describe(
        'ISO date (YYYY-MM-DD). Only return files modified from this date onward. ' +
        'Example: "2026-01-01" for files from January 2026 onward.'
      ),
      dateTo: z.string().optional().describe(
        'ISO date (YYYY-MM-DD). Only return files modified up to this date. ' +
        'Example: "2026-03-31" for files up to end of March 2026.'
      ),
      sortBy: z.enum(['relevance', 'newest', 'oldest']).optional().describe(
        'Result ordering. Default: "relevance" (highest score first). ' +
        '"newest": most recently modified first. "oldest": least recently modified first. ' +
        'Use "newest"/"oldest" when the user wants to browse by date rather than by relevance.'
      ),
      responseDetail: z.enum(['concise', 'detailed']).optional().describe(
        'Controls response verbosity. Default: "detailed". ' +
        '"concise": returns file names, relevance scores, and extractive answers only (fewer tokens). ' +
        '"detailed": returns full passages with excerpts (current behavior). ' +
        'Use "concise" for initial exploration or when you just need to know which files are relevant.'
      ),
    }),
  }
);

// ===== Tool 2: find_similar_images (unchanged schema) =====

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

        // Data integrity guard: embedding dimensions must match the 1536d Cohere vector space.
        // Images indexed before migration may have 1024d (Azure Vision) embeddings.
        // Querying with mismatched dimensions will fail.
        if (dbEmbedding.dimensions !== 1536) {
          return JSON.stringify(createErrorSearchResult(
            'similar images',
            'This image embedding dimensions do not match the expected 1536d. ' +
              'Please use search_knowledge with fileTypeCategory "images" and describe what you see in the image instead.',
          ));
        }
      }

      // 3. Use searchImages() — pure vector on embeddingVector, no Semantic Ranker
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
        ? results.filter(r => r.fileId.toUpperCase() !== resolvedFileId!.toUpperCase())
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
      'Find images visually similar to a SPECIFIC reference image that the user has pointed to. ' +
      'Use ONLY when the user references an existing image and wants to find similar ones.\n\n' +
      'WHEN TO USE:\n' +
      '- User says "find images similar to @photo.jpg" → use fileId from <mention id="..."> attribute\n' +
      '- User says "find images like the one I attached" → use chatAttachmentId from the attachment\n\n' +
      'WHEN NOT TO USE:\n' +
      '- User describes what they want in text (e.g., "find photos of cats") → use search_knowledge with fileTypeCategory "images" instead\n' +
      '- User asks a question about documents → use search_knowledge\n\n' +
      'Requires either fileId (from @mention or previous search results) OR chatAttachmentId (from chat attachment). ' +
      'Returns images ranked by visual similarity percentage.',
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
