import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { createChildLogger } from '@/shared/utils/logger';
import { env } from '@/infrastructure/config/environment';
import type {
  SemanticSearchOptions,
  SemanticSearchResult,
  SemanticSearchResponse,
  SemanticChunk,
  SearchType,
  SortBy,
} from './types';
import {
  SEMANTIC_THRESHOLD,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_CHUNKS_PER_FILE,
} from './types';

/**
 * Resolve LLM-facing sortBy into Azure AI Search orderBy clause.
 */
function resolveOrderBy(sortBy?: SortBy): string | undefined {
  switch (sortBy) {
    case 'newest': return 'fileModifiedAt desc';
    case 'oldest': return 'fileModifiedAt asc';
    default: return undefined; // relevance (default Azure AI Search ordering)
  }
}

/**
 * Resolve effective search type from new searchType or legacy searchMode.
 * searchType takes precedence when provided.
 */
function resolveEffectiveSearchType(
  searchType?: SearchType,
  _searchMode?: import('@/services/search/types').SearchMode,
): SearchType {
  if (searchType) return searchType;
  // Legacy: both 'text' and 'image' modes use hybrid (keyword + vector + reranker)
  return 'hybrid';
}

export class SemanticSearchService {
  private static instance: SemanticSearchService;
  private readonly logger = createChildLogger({ service: 'SemanticSearchService' });

  static getInstance(): SemanticSearchService {
    if (!SemanticSearchService.instance) {
      SemanticSearchService.instance = new SemanticSearchService();
    }
    return SemanticSearchService.instance;
  }

  async searchRelevantFiles(options: SemanticSearchOptions): Promise<SemanticSearchResponse> {
    const {
      userId,
      query,
      threshold = SEMANTIC_THRESHOLD,
      maxFiles = DEFAULT_MAX_FILES,
      maxChunksPerFile = DEFAULT_MAX_CHUNKS_PER_FILE,
      excludeFileIds = [],
      filterMimeTypes,
      searchMode = 'text',
      searchType: explicitSearchType,
      sortBy,
      dateFilter,
      additionalFilter: callerAdditionalFilter,
    } = options;

    const vectorSearchService = VectorSearchService.getInstance();
    const effectiveSearchType = resolveEffectiveSearchType(explicitSearchType, searchMode);
    const isImageMode = searchMode === 'image';

    // Build additional OData filters
    const filterParts: string[] = [];

    // Caller-supplied filter (e.g., @mention scope)
    if (callerAdditionalFilter) {
      filterParts.push(callerAdditionalFilter);
    }

    // mimeType filtering (RAG filtered search)
    if (filterMimeTypes && filterMimeTypes.length > 0) {
      filterParts.push(`search.in(mimeType, '${filterMimeTypes.join(',')}', ',')`);
    }

    // Date range filtering on fileModifiedAt
    if (dateFilter?.from) {
      filterParts.push(`fileModifiedAt ge ${dateFilter.from}T00:00:00Z`);
    }
    if (dateFilter?.to) {
      filterParts.push(`fileModifiedAt le ${dateFilter.to}T23:59:59Z`);
    }

    const additionalFilter = filterParts.length > 0 ? filterParts.join(' and ') : undefined;

    // PRD-200: Resolve sortBy → Azure orderBy
    const orderBy = resolveOrderBy(sortBy);

    // PRD-200: Route by effective search type (keyword / semantic / hybrid)
    // PRD-203: Destructure SemanticSearchFullResult to capture extractive answers
    let semanticResults: import('@/services/search/types').SemanticSearchResult[];
    let extractiveAnswers: import('@/services/search/types').ExtractiveSearchAnswer[] = [];

    try {

    if (effectiveSearchType === 'keyword') {
      // Keyword mode: BM25 text matching only — skip ALL embedding generation
      const fullResult = await vectorSearchService.semanticSearch({
        text: query,
        // No embeddings — pure keyword
        userId,
        fetchTopK: maxFiles * maxChunksPerFile * env.SEARCH_FETCH_MULTIPLIER,
        finalTopK: maxFiles * maxChunksPerFile * 2,
        minScore: threshold,
        additionalFilter: isImageMode
          ? (additionalFilter ? `isImage eq true and ${additionalFilter}` : 'isImage eq true')
          : additionalFilter,
        queryType: 'simple',
        useVectorSearch: false,
        useSemanticRanker: false,
        orderBy,
      });
      semanticResults = fullResult.results;
      extractiveAnswers = fullResult.extractiveAnswers;
    } else {
      // Azure AI Search generates embeddings at query time via native Cohere vectorizer
      const fullResult = await vectorSearchService.semanticSearch({
        text: query,
        userId,
        fetchTopK: maxFiles * maxChunksPerFile * env.SEARCH_FETCH_MULTIPLIER,
        finalTopK: maxFiles * maxChunksPerFile * 2,
        minScore: threshold,
        additionalFilter: isImageMode
          ? (additionalFilter ? `isImage eq true and ${additionalFilter}` : 'isImage eq true')
          : additionalFilter,
        useVectorSearch: true,
        useSemanticRanker: true,
        orderBy,
      });
      semanticResults = fullResult.results;
      extractiveAnswers = fullResult.extractiveAnswers;
    }

    } catch (error: unknown) {
      // Graceful degradation: embedding or search failures return empty results
      // The RAG tool (searchKnowledgeTool) also wraps this call, but catching here
      // ensures the service is safe to call directly from any context.
      const errorInfo = error instanceof Error
        ? { message: error.message, name: error.name }
        : { value: String(error) };
      this.logger.error(
        { error: errorInfo, userId, query: query.slice(0, 100), effectiveSearchType, searchMode },
        'Search execution failed — returning empty results'
      );
      return { results: [], query, threshold, totalChunksSearched: 0 };
    }

    // 3. Filter excluded files
    const filteredResults = semanticResults.filter(
      result => !excludeFileIds.includes(result.fileId)
    );

    // PRD-203: Build chunkId→fileId map for resolving extractive answer sources
    const chunkToFileMap = new Map<string, string>();
    for (const result of filteredResults) {
      chunkToFileMap.set(result.chunkId, result.fileId);
    }

    // 4. Group results by fileId (separate text chunks from images)
    const fileMap = new Map<string, {
      chunks: SemanticChunk[];
      isImage: boolean;
      maxScore: number;
    }>();

    for (const result of filteredResults) {
      const existing = fileMap.get(result.fileId);
      // PRD-203: Propagate highlighted caption from Semantic Ranker
      const highlightedCaption = result.captionHighlights ?? result.captionText;

      if (result.isImage) {
        // Images: store as single entry with their caption in content
        if (!existing) {
          fileMap.set(result.fileId, {
            chunks: [{
              chunkId: result.chunkId,
              content: result.content,
              score: result.score,
              chunkIndex: result.chunkIndex,
              highlightedCaption,
            }],
            isImage: true,
            maxScore: result.score,
          });
        } else if (result.score > existing.maxScore) {
          existing.maxScore = result.score;
        }
      } else {
        // Text: accumulate chunks
        if (!existing) {
          fileMap.set(result.fileId, {
            chunks: [{
              chunkId: result.chunkId,
              content: result.content,
              score: result.score,
              chunkIndex: result.chunkIndex,
              highlightedCaption,
            }],
            isImage: false,
            maxScore: result.score,
          });
        } else {
          existing.chunks.push({
            chunkId: result.chunkId,
            content: result.content,
            score: result.score,
            chunkIndex: result.chunkIndex,
            highlightedCaption,
          });
          if (result.score > existing.maxScore) {
            existing.maxScore = result.score;
          }
        }
      }
    }

    // 5. Build final results
    const fileService = getFileService();
    const results: SemanticSearchResult[] = [];

    for (const [fileId, data] of fileMap) {
      // Sort chunks by score and limit
      const sortedChunks = data.chunks
        .sort((a, b) => b.score - a.score)
        .slice(0, data.isImage ? 1 : maxChunksPerFile);

      // Get file metadata
      let fileName = 'Unknown';
      let mimeType: string | undefined;
      try {
        const file = await fileService.getFile(userId, fileId);
        fileName = file?.name || 'Unknown';
        mimeType = file?.mimeType;
      } catch {
        // File might be deleted, continue
      }

      results.push({
        fileId,
        fileName,
        relevanceScore: data.maxScore,
        topChunks: sortedChunks,
        isImage: data.isImage,
        mimeType,
      });
    }

    // 6. Sort and limit results
    // PRD-200: When sortBy is date-based, preserve Azure AI Search ordering (already sorted by orderBy)
    // When sortBy is 'relevance' (default), sort by score
    const sortedResults = (!sortBy || sortBy === 'relevance')
      ? results.sort((a, b) => b.relevanceScore - a.relevanceScore)
      : results; // Preserve Azure AI Search ordering for newest/oldest
    const finalResults = sortedResults.slice(0, maxFiles);

    const imageCount = finalResults.filter(r => r.isImage).length;
    const textCount = finalResults.length - imageCount;

    this.logger.info({
      userId,
      queryLength: query.length,
      threshold,
      totalCandidates: semanticResults.length,
      matchingFiles: finalResults.length,
      textResults: textCount,
      imageResults: imageCount,
      effectiveSearchType,
      searchMode,
      sortBy: sortBy ?? 'relevance',
      extractiveAnswerCount: extractiveAnswers.length,
    }, 'PRD-200/PRD-203: Semantic search completed');

    // PRD-203: Resolve extractive answers with file context
    const resolvedAnswers = extractiveAnswers.length > 0
      ? extractiveAnswers.map(a => ({
          text: a.text,
          score: a.score,
          highlights: a.highlights,
          sourceChunkId: a.key,
          sourceFileId: chunkToFileMap.get(a.key),
        }))
      : undefined;

    return {
      results: finalResults,
      query,
      threshold,
      totalChunksSearched: semanticResults.length,
      extractiveAnswers: resolvedAnswers,
    };
  }
}

export function getSemanticSearchService(): SemanticSearchService {
  return SemanticSearchService.getInstance();
}
