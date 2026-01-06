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
    } = options;

    try {
      const embeddingService = EmbeddingService.getInstance();
      const vectorSearchService = VectorSearchService.getInstance();

      // 1. Generate BOTH embeddings in parallel:
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

      // 2. Execute BOTH searches in parallel
      const searchPromises: [
        Promise<{ chunkId: string; fileId: string; content: string; score: number; chunkIndex: number }[]>,
        Promise<{ fileId: string; fileName: string; score: number; isImage: true }[]>
      ] = [
        vectorSearchService.search({
          embedding: textEmbedding.embedding,
          userId,
          top: maxFiles * maxChunksPerFile * 2,
          minScore: threshold,
        }),
        imageQueryEmbedding
          ? vectorSearchService.searchImages({
              embedding: imageQueryEmbedding.embedding,
              userId,
              top: maxFiles,
              minScore: threshold,
            })
          : Promise.resolve([]),
      ];

      const [textResults, imageResults] = await Promise.all(searchPromises);

      // 3. Filter excluded files from text results
      const filteredTextResults = textResults.filter(
        result => !excludeFileIds.includes(result.fileId)
      );

      // 4. Group text results by fileId
      const fileMap = new Map<string, SemanticChunk[]>();
      for (const result of filteredTextResults) {
        const chunks = fileMap.get(result.fileId) || [];
        chunks.push({
          chunkId: result.chunkId,
          content: result.content,
          score: result.score,
          chunkIndex: result.chunkIndex,
        });
        fileMap.set(result.fileId, chunks);
      }

      // 5. Build text results
      const fileService = getFileService();
      const results: SemanticSearchResult[] = [];

      for (const [fileId, chunks] of fileMap) {
        const sortedChunks = chunks
          .sort((a, b) => b.score - a.score)
          .slice(0, maxChunksPerFile);

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
          relevanceScore: Math.max(...sortedChunks.map(c => c.score)),
          topChunks: sortedChunks,
          isImage: false,
          mimeType,
        });
      }

      // 6. Add image results (filtered by excluded files)
      const filteredImageResults = imageResults.filter(
        result => !excludeFileIds.includes(result.fileId)
      );

      for (const imageResult of filteredImageResults) {
        // Avoid duplicate if same file already in text results
        if (fileMap.has(imageResult.fileId)) {
          continue;
        }

        // Get mimeType from file service
        let mimeType: string | undefined;
        try {
          const file = await fileService.getFile(userId, imageResult.fileId);
          mimeType = file?.mimeType;
        } catch {
          // File might be deleted, continue
        }

        results.push({
          fileId: imageResult.fileId,
          fileName: imageResult.fileName,
          relevanceScore: imageResult.score,
          topChunks: [], // Images don't have text chunks
          isImage: true,
          mimeType,
        });
      }

      // 7. Sort by relevance and limit
      const finalResults = results
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxFiles);

      const imageCount = finalResults.filter(r => r.isImage).length;
      const textCount = finalResults.length - imageCount;

      this.logger.info({
        userId,
        queryLength: query.length,
        threshold,
        totalChunks: textResults.length,
        totalImages: imageResults.length,
        matchingFiles: finalResults.length,
        textResults: textCount,
        imageResults: imageCount,
      }, 'Unified semantic search completed');

      return {
        results: finalResults,
        query,
        threshold,
        totalChunksSearched: textResults.length + imageResults.length,
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
