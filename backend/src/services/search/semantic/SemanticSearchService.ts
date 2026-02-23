import { EmbeddingService } from '@/services/embeddings/EmbeddingService';
import { VectorSearchService } from '@/services/search/VectorSearchService';
import { getFileService } from '@/services/files/FileService';
import { createChildLogger } from '@/shared/utils/logger';
import type {
  SemanticSearchOptions,
  SemanticSearchResult,
  SemanticSearchResponse,
  SemanticChunk,
} from './types';
import {
  SEMANTIC_THRESHOLD,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_CHUNKS_PER_FILE,
} from './types';

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
      dateFilter,
    } = options;

    try {
      const embeddingService = EmbeddingService.getInstance();
      const vectorSearchService = VectorSearchService.getInstance();

      // Build additional OData filters
      const filterParts: string[] = [];

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

      let semanticResults: import('@/services/search/types').SemanticSearchResult[];

      if (searchMode === 'image') {
        // Image mode: only generate image query embedding (1024d)
        // Visual similarity is the primary signal — no text embedding needed
        const imageQueryEmbedding = await embeddingService.generateImageQueryEmbedding(query, userId, 'visual-search');

        semanticResults = await vectorSearchService.semanticSearch({
          text: query,
          imageEmbedding: imageQueryEmbedding.embedding,
          // textEmbedding omitted intentionally — visual similarity is primary
          userId,
          fetchTopK: maxFiles * maxChunksPerFile * 3,
          finalTopK: maxFiles * maxChunksPerFile * 2,
          minScore: threshold,
          additionalFilter: additionalFilter
            ? `isImage eq true and ${additionalFilter}`
            : 'isImage eq true',
          searchMode: 'image',
        });
      } else {
        // Text mode: generate BOTH embeddings in parallel
        //    - Text embedding (1536d) for text chunk search
        //    - Image query embedding (1024d) for image search
        const [textEmbedding, imageQueryEmbedding] = await Promise.all([
          embeddingService.generateTextEmbedding(query, userId, 'semantic-search'),
          embeddingService.generateImageQueryEmbedding(query, userId, 'semantic-search').catch(err => {
            // Image search is optional - don't fail if Vision API is unavailable
            this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Image query embedding failed, skipping image search');
            return null;
          }),
        ]);

        semanticResults = await vectorSearchService.semanticSearch({
          text: query,
          textEmbedding: textEmbedding.embedding,
          imageEmbedding: imageQueryEmbedding?.embedding,
          userId,
          fetchTopK: maxFiles * maxChunksPerFile * 3,
          finalTopK: maxFiles * maxChunksPerFile * 2,
          minScore: threshold,
          additionalFilter,
        });
      }

      // 3. Filter excluded files
      const filteredResults = semanticResults.filter(
        result => !excludeFileIds.includes(result.fileId)
      );

      // 4. Group results by fileId (separate text chunks from images)
      const fileMap = new Map<string, {
        chunks: SemanticChunk[];
        isImage: boolean;
        maxScore: number;
      }>();

      for (const result of filteredResults) {
        const existing = fileMap.get(result.fileId);

        if (result.isImage) {
          // Images: store as single entry with their caption in content
          if (!existing) {
            fileMap.set(result.fileId, {
              chunks: [{
                chunkId: result.chunkId,
                content: result.content, // D26: Now contains AI-generated caption
                score: result.score,
                chunkIndex: result.chunkIndex,
              }],
              isImage: true,
              maxScore: result.score,
            });
          } else if (result.score > existing.maxScore) {
            // Update if better score found
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
          topChunks: sortedChunks, // Include caption chunk for images (limited to 1 at line 143)
          isImage: data.isImage,
          mimeType,
        });
      }

      // 6. Sort by relevance score (already normalized by Semantic Ranker) and limit
      const finalResults = results
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxFiles);

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
        useSemanticReranking: searchMode !== 'image',
        searchMode,
      }, 'D26: Unified semantic search with reranking completed');

      return {
        results: finalResults,
        query,
        threshold,
        totalChunksSearched: semanticResults.length,
      };

    } catch (error) {
      this.logger.error({ error, userId, queryLength: query.length }, 'Semantic search failed');
      return {
        results: [],
        query,
        threshold,
        totalChunksSearched: 0,
      };
    }
  }
}

export function getSemanticSearchService(): SemanticSearchService {
  return SemanticSearchService.getInstance();
}
