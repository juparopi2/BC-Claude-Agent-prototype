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
   * Process embedding generation job
   */
  async process(job: Job<EmbeddingGenerationJob>): Promise<void> {
    const { fileId, userId, sessionId, chunks, correlationId } = job.data;

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

    jobLogger.info('Processing embedding generation job', {
      chunkCount: chunks.length,
      attemptNumber: job.attemptsMade,
    });

    try {
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

      // 1. Generate embeddings
      const texts = chunks.map(c => c.text);
      const embeddings = await embeddingService.generateTextEmbeddingsBatch(texts, userId);

      // 2. Validate embeddings count
      if (embeddings.length !== chunks.length) {
        throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`);
      }

      // 3. Prepare chunks for indexing
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

      // 4. Index in Azure AI Search
      const searchDocIds = await vectorSearchService.indexChunksBatch(chunksWithEmbeddings);

      // 5. Update file_chunks table with search_document_id
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

      // 6. Update file status
      await this.executeQueryFn(
        `UPDATE files SET embedding_status = '${EMBEDDING_STATUS.COMPLETED}' WHERE id = @fileId`,
        { fileId }
      );

      // 7. Emit readiness_changed event (file is now ready for RAG)
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
