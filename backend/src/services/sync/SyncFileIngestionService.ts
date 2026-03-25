/**
 * SyncFileIngestionService (PRD-117)
 *
 * Extracts the file upsert + queue dispatch logic shared by InitialSyncService
 * and DeltaSyncService. Provides atomic batch ingestion with transactional DB
 * writes and post-commit queue dispatch.
 *
 * @module services/sync
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/utils/logger';
import { prisma } from '@/infrastructure/database/prisma';
import type { PrismaClientLike } from '@/infrastructure/database/prisma';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import type { ExternalFileItem } from '@bc-agent/shared';
import { resolveParentFolderId } from '@/services/sync/FolderHierarchyResolver';
import { getMessageQueue } from '@/infrastructure/queue';

const logger = createChildLogger({ service: 'SyncFileIngestionService' });

/** Maximum files per transaction batch. Kept small for Azure SQL dev tier latency (25 files × 2 queries × ~600ms ≈ 30s). */
export const INGESTION_BATCH_SIZE = 25;

/** Transaction timeout in ms. Safety margin over worst-case batch duration. */
export const INGESTION_TX_TIMEOUT = 60_000;

/** Context required for file ingestion */
export interface IngestionContext {
  connectionId: string;
  scopeId: string;
  userId: string;
  effectiveDriveId: string;
  provider: string;
  isShared: boolean;
  folderMap: Map<string, string>;
}

/** Result of a batch ingestion */
export interface IngestionResult {
  created: number;
  updated: number;
  errors: number;
}

/** File info collected during transaction for post-commit queue dispatch */
interface CreatedFileInfo {
  fileId: string;
  mimeType: string;
  fileName: string;
}

export class SyncFileIngestionService {
  /**
   * Ingest a batch of external file items atomically AND dispatch to queue.
   *
   * Phase A: All DB writes happen inside a Prisma transaction.
   * Phase B: Queue dispatch happens after the transaction commits.
   *
   * Use this for small/standalone batches. For bulk ingestion (e.g. initial sync),
   * use ingestAll() which defers queue dispatch until ALL batches complete to
   * prevent connection pool exhaustion from concurrent pipeline workers.
   */
  async ingestBatch(
    items: ExternalFileItem[],
    ctx: IngestionContext
  ): Promise<IngestionResult> {
    const { result, createdFiles } = await this._ingestBatchCore(items, ctx);

    // Phase B: Queue dispatch after commit
    await this._dispatchToQueue(createdFiles, ctx);

    return result;
  }

  /**
   * Ingest all items by splitting into batches of INGESTION_BATCH_SIZE.
   *
   * IMPORTANT: Queue dispatch is deferred until ALL batches complete.
   * This prevents connection pool exhaustion — pipeline workers (extract/chunk/embed)
   * consume DB connections concurrently, and dispatching mid-ingestion can starve
   * subsequent batch transactions of connections.
   */
  async ingestAll(
    items: ExternalFileItem[],
    ctx: IngestionContext,
    onBatchComplete?: (processed: number, total: number) => void,
  ): Promise<IngestionResult> {
    const totalResult: IngestionResult = { created: 0, updated: 0, errors: 0 };
    const allCreatedFiles: CreatedFileInfo[] = [];
    let processed = 0;

    // Phase A: All DB ingestion first (no queue dispatch)
    for (let i = 0; i < items.length; i += INGESTION_BATCH_SIZE) {
      const batch = items.slice(i, i + INGESTION_BATCH_SIZE);
      const { result, createdFiles } = await this._ingestBatchCore(batch, ctx);

      totalResult.created += result.created;
      totalResult.updated += result.updated;
      totalResult.errors += result.errors;
      allCreatedFiles.push(...createdFiles);
      processed += batch.length;

      onBatchComplete?.(processed, items.length);
    }

    // Phase B: Queue dispatch AFTER all batches complete
    await this._dispatchToQueue(allCreatedFiles, ctx);

    return totalResult;
  }

  /**
   * Core batch ingestion: transaction only, no queue dispatch.
   * Used internally by both ingestBatch() and ingestAll().
   */
  private async _ingestBatchCore(
    items: ExternalFileItem[],
    ctx: IngestionContext
  ): Promise<{ result: IngestionResult; createdFiles: CreatedFileInfo[] }> {
    const result: IngestionResult = { created: 0, updated: 0, errors: 0 };

    // Wrapped in try/catch to prevent MSSQL adapter's EREQINPROG error from
    // becoming an unhandled rejection that crashes the server.
    let createdFiles: CreatedFileInfo[];
    try {
      createdFiles = await prisma.$transaction(async (tx) => {
        const newFiles: CreatedFileInfo[] = [];

        for (const item of items) {
          try {
            await this.upsertFile(tx, item, ctx, newFiles);
          } catch (err) {
            const errorInfo = err instanceof Error
              ? { message: err.message, name: err.name }
              : { value: String(err) };
            logger.warn(
              { error: errorInfo, externalId: item.id, fileName: item.name, connectionId: ctx.connectionId, scopeId: ctx.scopeId },
              'Skipping file due to ingestion error'
            );
            result.errors++;
          }
        }

        return newFiles;
      }, { timeout: INGESTION_TX_TIMEOUT });
    } catch (txErr) {
      const errorInfo = txErr instanceof Error
        ? { message: txErr.message, name: txErr.name, stack: txErr.stack }
        : { value: String(txErr) };
      const msg = txErr instanceof Error ? txErr.message : String(txErr);
      const isTransient = msg.includes('EREQINPROG') || msg.includes('request in progress') || msg.includes('expired transaction');

      logger.error(
        { error: errorInfo, connectionId: ctx.connectionId, scopeId: ctx.scopeId, batchSize: items.length, isTransient },
        'Transaction failed during file ingestion batch'
      );

      throw txErr;
    }

    result.created = createdFiles.length;
    result.updated = items.length - createdFiles.length - result.errors;

    return { result, createdFiles };
  }

  /** Dispatch created files to the processing queue. */
  private async _dispatchToQueue(files: CreatedFileInfo[], ctx: IngestionContext): Promise<void> {
    const messageQueue = getMessageQueue();
    for (const file of files) {
      await messageQueue.addFileProcessingFlow({
        fileId: file.fileId,
        batchId: ctx.scopeId,
        userId: ctx.userId,
        mimeType: file.mimeType,
        fileName: file.fileName,
      });
    }
  }

  /**
   * Upsert a single file inside a transaction.
   * If the file is new, pushes its info to `newFiles` for post-commit queue dispatch.
   */
  private async upsertFile(
    tx: PrismaClientLike,
    item: ExternalFileItem,
    ctx: IngestionContext,
    newFiles: CreatedFileInfo[]
  ): Promise<void> {
    const existing = await tx.files.findFirst({
      where: { connection_id: ctx.connectionId, external_id: item.id },
      select: { id: true, pipeline_status: true },
    });

    const parentFolderId = resolveParentFolderId(item.parentId, ctx.folderMap);

    if (existing) {
      await tx.files.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          mime_type: item.mimeType ?? 'application/octet-stream',
          size_bytes: BigInt(item.sizeBytes ?? 0),
          external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
          file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
          content_hash_external: item.eTag ?? null,
          parent_folder_id: parentFolderId,
          connection_scope_id: ctx.scopeId,
          last_synced_at: new Date(),
        },
      });
    } else {
      const fileId = randomUUID().toUpperCase();

      await tx.files.create({
        data: {
          id: fileId,
          user_id: ctx.userId,
          name: item.name,
          mime_type: item.mimeType ?? 'application/octet-stream',
          size_bytes: BigInt(item.sizeBytes ?? 0),
          blob_path: null,
          is_folder: false,
          source_type: ctx.provider === 'sharepoint'
            ? FILE_SOURCE_TYPE.SHAREPOINT
            : FILE_SOURCE_TYPE.ONEDRIVE,
          external_id: item.id,
          external_drive_id: ctx.effectiveDriveId,
          connection_id: ctx.connectionId,
          connection_scope_id: ctx.scopeId,
          external_url: item.webUrl || null,
          external_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
          file_modified_at: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
          content_hash_external: item.eTag ?? null,
          parent_folder_id: parentFolderId,
          pipeline_status: 'queued',
          processing_retry_count: 0,
          embedding_retry_count: 0,
          is_favorite: false,
          is_shared: ctx.isShared,
        },
      });

      newFiles.push({
        fileId,
        mimeType: item.mimeType ?? 'application/octet-stream',
        fileName: item.name,
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SyncFileIngestionService | undefined;

export function getSyncFileIngestionService(): SyncFileIngestionService {
  if (!instance) {
    instance = new SyncFileIngestionService();
  }
  return instance;
}
