/**
 * EmbeddingGenerationWorker
 *
 * Generates embeddings for file chunks and indexes them in Azure AI Search.
 * Integrated with ProcessingRetryManager for robust retry handling.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import { executeQuery } from '@/infrastructure/database/database';
import { getFileEventEmitter } from '@/domains/files/emission';
import {
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE,
} from '@bc-agent/shared';
import type {
  ILoggerMinimal,
  ExecuteQueryFn,
  IEmbeddingServiceMinimal,
  IVectorSearchServiceMinimal,
} from '../IMessageQueueDependencies';
import type { EmbeddingGenerationJob } from '../types';

/**
 * Dependencies for EmbeddingGenerationWorker
 */
export interface EmbeddingGenerationWorkerDependencies {
  logger?: ILoggerMinimal;
  executeQuery?: ExecuteQueryFn;
  /** Embedding service (for testing with mocks) */
  embeddingService?: IEmbeddingServiceMinimal;
  /** Vector search service (for testing with mocks) */
  vectorSearchService?: IVectorSearchServiceMinimal;
}

/**
 * Chunk data loaded from database
 */
interface ChunkFromDB {
  id: string;
  text: string;
  chunkIndex: number;
  tokenCount: number;
}

/**
 * EmbeddingGenerationWorker
 */
export class EmbeddingGenerationWorker {
  private static instance: EmbeddingGenerationWorker | null = null;

  private readonly log: ILoggerMinimal;
  private readonly executeQueryFn: ExecuteQueryFn;
  private readonly embeddingServiceOverride?: IEmbeddingServiceMinimal;
  private readonly vectorSearchServiceOverride?: IVectorSearchServiceMinimal;

  constructor(deps?: EmbeddingGenerationWorkerDependencies) {
    this.log = deps?.logger ?? createChildLogger({ service: 'EmbeddingGenerationWorker' });
    this.executeQueryFn = deps?.executeQuery ?? executeQuery;
    this.embeddingServiceOverride = deps?.embeddingService;
    this.vectorSearchServiceOverride = deps?.vectorSearchService;
  }

  public static getInstance(deps?: EmbeddingGenerationWorkerDependencies): EmbeddingGenerationWorker {
    if (!EmbeddingGenerationWorker.instance) {
      EmbeddingGenerationWorker.instance = new EmbeddingGenerationWorker(deps);
    }
    return EmbeddingGenerationWorker.instance;
  }

  public static resetInstance(): void {
    EmbeddingGenerationWorker.instance = null;
  }

  /**
   * Load chunk data from database
   *
   * OPTIMIZATION: Text is stored in DB, not in Redis job data.
   * This reduces Redis memory usage by ~80% for large file batches.
   */
  private async loadChunksFromDB(chunkIds: string[], userId: string): Promise<ChunkFromDB[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    // Build parameterized query for chunk IDs
    const idParams = chunkIds.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, string> = { userId };
    chunkIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const result = await this.executeQueryFn<{
      id: string;
      chunk_text: string;
      chunk_index: number;
      chunk_tokens: number;
    }>(
      `SELECT id, chunk_text, chunk_index, chunk_tokens
       FROM file_chunks
       WHERE id IN (${idParams}) AND user_id = @userId
       ORDER BY chunk_index`,
      params
    );

    return result.recordset.map(row => ({
      id: row.id,
      text: row.chunk_text,
      chunkIndex: row.chunk_index,
      tokenCount: row.chunk_tokens,
    }));
  }

  /**
   * Process embedding generation job
   *
   * OPTIMIZED: Reads chunk text from database instead of job data.
   * This significantly reduces Redis memory usage.
   */
  async process(job: Job<EmbeddingGenerationJob>): Promise<void> {
    const { fileId, userId, sessionId, chunkIds, correlationId } = job.data;

    // Create job-scoped logger with user context and timestamp
    const jobLogger = this.log.child({
      userId,
      sessionId,
      fileId,
      jobId: job.id,
      jobName: job.name,
      timestamp: new Date().toISOString(),
      correlationId,
    });

    jobLogger.info('Processing embedding generation job (optimized)', {
      chunkCount: chunkIds.length,
      attemptNumber: job.attemptsMade,
    });

    try {
      // 1. Load chunk data from database (OPTIMIZATION)
      const chunks = await this.loadChunksFromDB(chunkIds, userId);

      if (chunks.length !== chunkIds.length) {
        jobLogger.warn({
          expected: chunkIds.length,
          found: chunks.length,
          missingIds: chunkIds.filter(id => !chunks.find(c => c.id === id)),
        }, 'Some chunks not found in database');
      }

      if (chunks.length === 0) {
        throw new Error(`No chunks found for file ${fileId}`);
      }

      // Get services (use injected or dynamic import)
      let embeddingService: IEmbeddingServiceMinimal;
      let vectorSearchService: IVectorSearchServiceMinimal;

      if (this.embeddingServiceOverride && this.vectorSearchServiceOverride) {
        // Use injected mocks (testing)
        embeddingService = this.embeddingServiceOverride;
        vectorSearchService = this.vectorSearchServiceOverride;
      } else {
        // Dynamic imports (production)
        const { EmbeddingService } = await import('@/services/embeddings/EmbeddingService');
        const { VectorSearchService } = await import('@/services/search/VectorSearchService');
        embeddingService = EmbeddingService.getInstance();
        vectorSearchService = VectorSearchService.getInstance();
      }

      // 2. Generate embeddings (pass fileId for proper usage tracking)
      const texts = chunks.map(c => c.text);
      const embeddings = await embeddingService.generateTextEmbeddingsBatch(texts, userId, fileId);

      // 3. Validate embeddings count
      if (embeddings.length !== chunks.length) {
        throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`);
      }

      // 4. Prepare chunks for indexing
      const chunksWithEmbeddings = chunks.map((chunk, i) => {
        const embedding = embeddings[i];
        if (!embedding) {
          throw new Error(`Missing embedding for chunk index ${i}`);
        }
        return {
          chunkId: chunk.id,
          fileId,
          userId,
          content: chunk.text,
          embedding: embedding.embedding,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          embeddingModel: embedding.model,
          createdAt: new Date(),
        };
      });

      // 5. Index in Azure AI Search
      const searchDocIds = await vectorSearchService.indexChunksBatch(chunksWithEmbeddings);

      // 6. Update file_chunks table with search_document_id
      for (let i = 0; i < chunks.length; i++) {
        const searchId = searchDocIds[i];
        const chunkId = chunks[i]?.id;

        if (!chunkId) {
          jobLogger.warn({ fileId, i }, 'Missing chunk ID during update');
          continue;
        }

        await this.executeQueryFn(
          'UPDATE file_chunks SET search_document_id = @searchId WHERE id = @chunkId',
          {
            searchId: searchId || null,
            chunkId: chunkId,
          }
        );
      }

      // 7. Update file status
      await this.executeQueryFn(
        `UPDATE files SET embedding_status = '${EMBEDDING_STATUS.COMPLETED}' WHERE id = @fileId`,
        { fileId }
      );

      // 8. Emit readiness_changed event (file is now ready for RAG)
      const eventEmitter = getFileEventEmitter();
      eventEmitter.emitReadinessChanged(
        { fileId, userId, sessionId },
        {
          previousState: FILE_READINESS_STATE.PROCESSING,
          newState: FILE_READINESS_STATE.READY,
          processingStatus: PROCESSING_STATUS.COMPLETED,
          embeddingStatus: EMBEDDING_STATUS.COMPLETED,
        }
      );

      jobLogger.info('Embedding generation completed', {
        jobId: job.id,
        fileId,
        chunksIndexed: chunks.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      jobLogger.error('Embedding generation job failed', {
        error: errorMessage,
        jobId: job.id,
        fileId,
        userId,
        attemptNumber: job.attemptsMade,
      });

      // Use ProcessingRetryManager for retry decision
      try {
        const { getProcessingRetryManager } = await import('@/domains/files/retry');
        const retryManager = getProcessingRetryManager();

        const decision = await retryManager.shouldRetry(userId, fileId, 'embedding');

        jobLogger.info('Retry decision for embedding generation', {
          jobId: job.id,
          fileId,
          userId,
          shouldRetry: decision.shouldRetry,
          newRetryCount: decision.newRetryCount,
          maxRetries: decision.maxRetries,
          reason: decision.reason,
        });

        if (decision.shouldRetry) {
          // Update embedding_status to 'pending' for retry
          await this.executeQueryFn(
            `UPDATE files SET embedding_status = '${EMBEDDING_STATUS.PENDING}' WHERE id = @fileId`,
            { fileId }
          );
          // Throw to trigger BullMQ retry
          throw error;
        }

        // Max retries exceeded - handle permanent failure
        await retryManager.handlePermanentFailure(userId, fileId, errorMessage, sessionId);
        jobLogger.warn('Embedding generation permanently failed after max retries', {
          jobId: job.id,
          fileId,
          userId,
          retryCount: decision.newRetryCount,
        });
        // Don't throw - job is complete (permanent failure)
        return;
      } catch (retryError) {
        // If retry decision fails, fall back to throwing original error
        if (retryError === error) {
          throw error;
        }
        jobLogger.error('Failed to process embedding retry decision', {
          jobId: job.id,
          fileId,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        // Fall back: mark as failed and throw
        try {
          await this.executeQueryFn(
            `UPDATE files SET embedding_status = '${EMBEDDING_STATUS.FAILED}' WHERE id = @fileId`,
            { fileId }
          );
        } catch (statusError) {
          jobLogger.error('Failed to update embedding_status', {
            fileId,
            error: statusError instanceof Error ? statusError.message : String(statusError),
          });
        }
        throw error;
      }
    }
  }
}

/**
 * Get EmbeddingGenerationWorker singleton
 */
export function getEmbeddingGenerationWorker(deps?: EmbeddingGenerationWorkerDependencies): EmbeddingGenerationWorker {
  return EmbeddingGenerationWorker.getInstance(deps);
}

/**
 * Reset EmbeddingGenerationWorker singleton (for testing)
 */
export function __resetEmbeddingGenerationWorker(): void {
  EmbeddingGenerationWorker.resetInstance();
}
