/**
 * FileEmbedWorkerV2 (PRD-04)
 *
 * V2 embedding generation worker using BullMQ Flows for guaranteed sequencing.
 *
 * Pipeline: extract → chunk → [embed] → pipeline-complete
 *
 * Note: The chunk worker already transitioned the file to 'embedding' state.
 * This worker verifies state, generates embeddings, indexes in Azure AI Search,
 * and transitions to 'ready'.
 *
 * @module infrastructure/queue/workers/v2
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import {
  PIPELINE_STATUS,
  PROCESSING_STATUS,
  EMBEDDING_STATUS,
  FILE_READINESS_STATE,
} from '@bc-agent/shared';
import type { ILoggerMinimal } from '../../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileEmbedWorkerV2' });

/** Job data for V2 embed stage */
export interface V2EmbedJobData {
  fileId: string;
  batchId: string;
  userId: string;
}

export interface FileEmbedWorkerV2Dependencies {
  logger?: ILoggerMinimal;
}

export class FileEmbedWorkerV2 {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileEmbedWorkerV2Dependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<V2EmbedJobData>): Promise<void> {
    const { fileId, batchId, userId } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'embed',
    });

    jobLogger.info('V2 embed worker started');

    // 1. Verify file is in 'embedding' state (set by chunk worker)
    const { getFileRepositoryV2 } = await import(
      '@/services/files/repository/FileRepositoryV2'
    );
    const repo = getFileRepositoryV2();

    const currentStatus = await repo.getPipelineStatus(fileId, userId);
    if (currentStatus !== PIPELINE_STATUS.EMBEDDING) {
      jobLogger.warn(
        { expectedStatus: PIPELINE_STATUS.EMBEDDING, actualStatus: currentStatus },
        'File not in expected embedding state — skipping',
      );
      return;
    }

    try {
      // 2. Load chunks from DB
      const { executeQuery } = await import('@/infrastructure/database/database');
      const chunksResult = await executeQuery<{
        id: string;
        chunk_text: string;
        chunk_index: number;
        chunk_tokens: number;
      }>(
        `SELECT id, chunk_text, chunk_index, chunk_tokens
         FROM file_chunks
         WHERE file_id = @fileId AND user_id = @userId
         ORDER BY chunk_index`,
        { fileId, userId },
      );

      const chunks = chunksResult.recordset;

      if (chunks.length === 0) {
        // Check if this is an image file (images skip chunking, have 0 chunks)
        // Image embedding is handled by FileChunkingService.indexImageEmbedding()
        // which was called in the chunk stage. Just advance to ready.
        jobLogger.info('No text chunks found — advancing to ready (may be image file)');

        const advanceResult = await repo.transitionStatus(
          fileId, userId,
          PIPELINE_STATUS.EMBEDDING,
          PIPELINE_STATUS.READY,
        );

        if (!advanceResult.success) {
          throw new Error(`State advance to ready failed: ${advanceResult.error}`);
        }

        // Dual-write legacy columns
        await executeQuery(
          `UPDATE files SET embedding_status = @status WHERE id = @fileId`,
          { fileId, status: EMBEDDING_STATUS.COMPLETED },
        );

        this.emitReadinessChanged(fileId, userId);
        return;
      }

      // 3. Generate embeddings
      const { EmbeddingService } = await import('@/services/embeddings/EmbeddingService');
      const embeddingService = EmbeddingService.getInstance();
      const texts = chunks.map((c) => c.chunk_text);
      const embeddings = await embeddingService.generateTextEmbeddingsBatch(texts, userId, fileId);

      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`,
        );
      }

      // 4. Get file mimeType for search indexing
      const fileResult = await executeQuery<{ mime_type: string }>(
        `SELECT mime_type FROM files WHERE id = @fileId AND user_id = @userId`,
        { fileId, userId },
      );
      const mimeType = fileResult.recordset[0]?.mime_type;

      // 5. Index in Azure AI Search
      const { VectorSearchService } = await import('@/services/search/VectorSearchService');
      const vectorSearchService = VectorSearchService.getInstance();

      const chunksWithEmbeddings = chunks.map((chunk, i) => ({
        chunkId: chunk.id,
        fileId,
        userId,
        content: chunk.chunk_text,
        embedding: embeddings[i]!.embedding,
        chunkIndex: chunk.chunk_index,
        tokenCount: chunk.chunk_tokens,
        embeddingModel: embeddings[i]!.model,
        createdAt: new Date(),
        mimeType,
      }));

      const searchDocIds = await vectorSearchService.indexChunksBatch(chunksWithEmbeddings);

      // 6. Update file_chunks with search_document_id
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const searchId = searchDocIds[i];
        if (chunk) {
          await executeQuery(
            'UPDATE file_chunks SET search_document_id = @searchId WHERE id = @chunkId',
            { searchId: searchId || null, chunkId: chunk.id },
          );
        }
      }

      // 7. CAS transition: embedding → ready
      const advanceResult = await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

      if (!advanceResult.success) {
        throw new Error(`State advance to ready failed: ${advanceResult.error}`);
      }

      // 8. Dual-write legacy column
      await executeQuery(
        `UPDATE files SET embedding_status = @status WHERE id = @fileId`,
        { fileId, status: EMBEDDING_STATUS.COMPLETED },
      );

      // 9. Emit readiness changed event
      this.emitReadinessChanged(fileId, userId);

      jobLogger.info(
        { chunksIndexed: chunks.length },
        'V2 embed completed successfully',
      );
    } catch (error) {
      // Transition to failed state
      await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.FAILED,
      ).catch((transErr) => {
        jobLogger.error(
          { error: transErr instanceof Error ? transErr.message : String(transErr) },
          'Failed to transition to FAILED state',
        );
      });

      // Dual-write legacy failure
      try {
        const { executeQuery: execQuery } = await import('@/infrastructure/database/database');
        await execQuery(
          `UPDATE files SET embedding_status = @status WHERE id = @fileId`,
          { fileId, status: EMBEDDING_STATUS.FAILED },
        );
      } catch { /* best-effort */ }

      this.log.warn(
        { fileId, stage: 'embed', attempts: job.attemptsMade },
        'File embedding permanently failed — DLQ entry pending',
      );

      throw error;
    }
  }

  private emitReadinessChanged(fileId: string, userId: string): void {
    import('@/domains/files/emission').then(({ getFileEventEmitter }) => {
      const emitter = getFileEventEmitter();
      emitter.emitReadinessChanged(
        { fileId, userId },
        {
          previousState: FILE_READINESS_STATE.PROCESSING,
          newState: FILE_READINESS_STATE.READY,
          processingStatus: PROCESSING_STATUS.COMPLETED,
          embeddingStatus: EMBEDDING_STATUS.COMPLETED,
        },
      );
    }).catch(() => { /* fire-and-forget */ });
  }
}

/** Factory function */
export function getFileEmbedWorkerV2(deps?: FileEmbedWorkerV2Dependencies): FileEmbedWorkerV2 {
  return new FileEmbedWorkerV2(deps);
}
