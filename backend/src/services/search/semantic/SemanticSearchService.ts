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
      // 1. Generate embedding from query
      const embeddingService = EmbeddingService.getInstance();
      const queryEmbedding = await embeddingService.generateTextEmbedding(
        query,
        userId,
        'semantic-search'
      );

      // 2. Search for relevant chunks
      const vectorSearchService = VectorSearchService.getInstance();
      const searchResults = await vectorSearchService.search({
        embedding: queryEmbedding.embedding,
        userId,
        top: maxFiles * maxChunksPerFile * 2, // Get more to allow filtering
        minScore: threshold,
      });

      // 3. Filter excluded files
      const filteredResults = searchResults.filter(
        result => !excludeFileIds.includes(result.fileId)
      );

      // 4. Group by fileId and aggregate
      const fileMap = new Map<string, SemanticChunk[]>();
      for (const result of filteredResults) {
        const chunks = fileMap.get(result.fileId) || [];
        chunks.push({
          chunkId: result.chunkId,
          content: result.content,
          score: result.score,
          chunkIndex: result.chunkIndex,
        });
        fileMap.set(result.fileId, chunks);
      }

      // 5. Get file names and build results
      const fileService = getFileService();
      const results: SemanticSearchResult[] = [];

      for (const [fileId, chunks] of fileMap) {
        // Sort chunks by score and limit
        const sortedChunks = chunks
          .sort((a, b) => b.score - a.score)
          .slice(0, maxChunksPerFile);

        // Get file name
        let fileName = 'Unknown';
        try {
          const file = await fileService.getFile(userId, fileId);
          fileName = file?.name || 'Unknown';
        } catch {
          // File might be deleted, continue
        }

        results.push({
          fileId,
          fileName,
          relevanceScore: Math.max(...sortedChunks.map(c => c.score)),
          topChunks: sortedChunks,
        });
      }

      // 6. Sort by relevance and limit
      const finalResults = results
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxFiles);

      this.logger.info({
        userId,
        queryLength: query.length,
        threshold,
        totalChunks: searchResults.length,
        matchingFiles: finalResults.length,
      }, 'Semantic search completed');

      return {
        results: finalResults,
        query,
        threshold,
        totalChunksSearched: searchResults.length,
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
