/**
 * FileEmbedWorker (PRD-04)
 *
 * Embedding generation worker using BullMQ Flows for guaranteed sequencing.
 *
 * Pipeline: extract → chunk → [embed] → pipeline-complete
 *
 * Note: The chunk worker already transitioned the file to 'embedding' state.
 * This worker verifies state, generates embeddings, indexes in Azure AI Search,
 * and transitions to 'ready'.
 *
 * @module infrastructure/queue/workers
 */

import type { Job } from 'bullmq';
import { createChildLogger } from '@/shared/utils/logger';
import {
  PIPELINE_STATUS,
  FILE_READINESS_STATE,
} from '@bc-agent/shared';
import type { ILoggerMinimal } from '../IMessageQueueDependencies';

const DEFAULT_LOGGER = createChildLogger({ service: 'FileEmbedWorker' });

/** Job data for embed stage */
export interface EmbedJobData {
  fileId: string;
  batchId: string;
  userId: string;
}

export interface FileEmbedWorkerDependencies {
  logger?: ILoggerMinimal;
}

export class FileEmbedWorker {
  private readonly log: ILoggerMinimal;

  constructor(deps?: FileEmbedWorkerDependencies) {
    this.log = deps?.logger ?? DEFAULT_LOGGER;
  }

  async process(job: Job<EmbedJobData>): Promise<void> {
    const { fileId, batchId, userId } = job.data;

    const jobLogger = this.log.child({
      fileId, batchId, userId, jobId: job.id,
      stage: 'embed',
    });

    jobLogger.info('Embed worker started');

    // 1. Verify file is in 'embedding' state (set by chunk worker)
    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

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
      const { getFileChunkRepository } = await import(
        '@/services/files/repository/FileChunkRepository'
      );
      const chunkRepo = getFileChunkRepository();
      const chunks = await chunkRepo.findByFileId(fileId, userId);

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

      // 4. Get file mimeType, file_modified_at, name, size_bytes, source metadata for search indexing
      const fileMeta = await repo.getFileWithScopeMetadata(fileId, userId);
      const mimeType = fileMeta?.mime_type;
      const fileModifiedAtRaw = fileMeta?.file_modified_at;
      const fileModifiedAt = fileModifiedAtRaw ? fileModifiedAtRaw.toISOString() : undefined;
      const fileName = fileMeta?.name;
      const sizeBytes = fileMeta?.size_bytes ?? undefined;

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
        fileModifiedAt,
        fileName,
        sizeBytes,
        siteId: fileMeta?.scope_site_id ?? undefined,
        sourceType: fileMeta?.source_type ?? 'local',
        parentFolderId: fileMeta?.parent_folder_id ?? undefined,
      }));

      const searchDocIds = await vectorSearchService.indexChunksBatch(chunksWithEmbeddings);

      // 6. Update file_chunks with search_document_id
      const updates = chunks.map((chunk, i) => ({
        chunkId: chunk.id,
        searchDocumentId: searchDocIds[i] || null,
      }));
      await chunkRepo.updateSearchDocumentIds(updates);

      // 7. CAS transition: embedding → ready
      const advanceResult = await repo.transitionStatus(
        fileId, userId,
        PIPELINE_STATUS.EMBEDDING,
        PIPELINE_STATUS.READY,
      );

      if (!advanceResult.success) {
        throw new Error(`State advance to ready failed: ${advanceResult.error}`);
      }

      // 8. Emit readiness changed event
      this.emitReadinessChanged(fileId, userId);

      jobLogger.info(
        { chunksIndexed: chunks.length },
        'Embed completed successfully',
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
        },
      );
    }).catch(() => { /* fire-and-forget */ });
  }
}

/** Factory function */
export function getFileEmbedWorker(deps?: FileEmbedWorkerDependencies): FileEmbedWorker {
  return new FileEmbedWorker(deps);
}
