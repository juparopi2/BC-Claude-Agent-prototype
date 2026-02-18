/**
 * BatchUploadOrchestratorV2 (PRD-03)
 *
 * Unified 3-phase atomic upload pipeline replacing 4 fragmented upload paths.
 *
 * Phase A (createBatch): Client sends manifest → server atomically creates
 *   batch + folders + files + SAS URLs in one Prisma transaction.
 * Phase B (client-side): Client uploads blobs directly to Azure Storage.
 * Phase C (confirmFile): Client confirms each file → server verifies blob,
 *   transitions status registered→queued, enqueues processing job.
 *
 * @module services/files/batch/BatchUploadOrchestratorV2
 */

import { createChildLogger } from '@/shared/utils/logger';
import { prisma as defaultPrisma } from '@/infrastructure/database/prisma';
import { getFileUploadService } from '@/services/files/FileUploadService';
import { getMessageQueue } from '@/infrastructure/queue';
import { DuplicateDetectionServiceV2 } from '@/services/files/DuplicateDetectionServiceV2';
import { BATCH_STATUS, PIPELINE_STATUS } from '@bc-agent/shared';
import type {
  CreateBatchRequest,
  ManifestFolderItem,
  CreateBatchResponse,
  ConfirmFileResponse,
  BatchStatusResponse,
  CancelBatchResponse,
  BatchFileResult,
  BatchFolderResult,
} from '@bc-agent/shared';
import type { DuplicateCheckInputV2, DuplicateCheckResultV2 } from '@bc-agent/shared';
import type { PrismaClient } from '@prisma/client';
import {
  BatchNotFoundError,
  BatchExpiredError,
  BatchCancelledError,
  BatchAlreadyCompleteError,
  FileNotInBatchError,
  FileAlreadyConfirmedError,
  BlobNotFoundError,
  ConcurrentModificationError,
  InvalidTargetFolderError,
  ManifestValidationError,
} from './errors';

const logger = createChildLogger({ service: 'BatchUploadOrchestratorV2' });

// Batch TTL: 4 hours
const BATCH_TTL_MS = 4 * 60 * 60 * 1000;
// SAS URL expiry: 4 hours (matching batch TTL)
const SAS_EXPIRY_MINUTES = 240;

// ============================================================================
// Service
// ============================================================================

export class BatchUploadOrchestratorV2 {
  private readonly prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = (prismaClient ?? defaultPrisma) as PrismaClient;
  }

  // --------------------------------------------------------------------------
  // Phase A: Create Batch
  // --------------------------------------------------------------------------

  async createBatch(
    userId: string,
    request: CreateBatchRequest,
  ): Promise<CreateBatchResponse> {
    // Pre-transaction validation
    this.validateManifest(request);

    // Topological sort folders (parents before children)
    const sortedFolders = request.folders?.length
      ? this.topologicalSortFolders(request.folders)
      : [];

    const skipDuplicateCheck = request.skipDuplicateCheck ?? false;
    const targetFolderId: string | null = request.targetFolderId ?? null;

    // Validate targetFolderId exists and belongs to user
    if (targetFolderId) {
      const targetFolder = await this.prisma.files.findFirst({
        where: {
          id: targetFolderId,
          user_id: userId,
          is_folder: true,
          deletion_status: null,
        },
        select: { id: true },
      });
      if (!targetFolder) {
        throw new InvalidTargetFolderError(targetFolderId);
      }
    }

    logger.info(
      { userId, fileCount: request.files.length, folderCount: sortedFolders.length, skipDuplicateCheck, targetFolderId },
      'Creating batch',
    );

    // Run everything in a single transaction
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Duplicate detection (inside TX for snapshot isolation)
        let duplicates: DuplicateCheckResultV2[] | undefined;
        if (!skipDuplicateCheck) {
          const dupService = new DuplicateDetectionServiceV2(tx as unknown as PrismaClient);
          const dupInputs: DuplicateCheckInputV2[] = request.files.map((f) => ({
            tempId: f.tempId,
            fileName: f.fileName,
            fileSize: f.sizeBytes,
            contentHash: f.contentHash,
          }));
          const dupResult = await dupService.checkDuplicates(dupInputs, userId);
          if (dupResult.summary.totalDuplicates > 0) {
            duplicates = dupResult.results.filter((r) => r.isDuplicate);
          }
        }

        // Create batch record
        const expiresAt = new Date(Date.now() + BATCH_TTL_MS);
        const batch = await (tx as Record<string, unknown> & typeof tx).upload_batches.create({
          data: {
            user_id: userId,
            status: BATCH_STATUS.ACTIVE,
            total_files: request.files.length,
            confirmed_count: 0,
            expires_at: expiresAt,
            metadata: request.metadata ? JSON.stringify(request.metadata) : null,
          },
        });
        const batchId = (batch.id as string).toUpperCase();

        // Create folders (topologically sorted — parents first)
        const tempIdToFolderId = new Map<string, string>();
        const folderResults: BatchFolderResult[] = [];

        for (const folder of sortedFolders) {
          const parentFolderId = folder.parentTempId
            ? tempIdToFolderId.get(folder.parentTempId) ?? null
            : targetFolderId;

          const created = await tx.files.create({
            data: {
              user_id: userId,
              name: folder.folderName,
              is_folder: true,
              mime_type: 'inode/directory',
              size_bytes: BigInt(0),
              blob_path: '',
              source_type: 'blob_storage',
              processing_retry_count: 0,
              embedding_retry_count: 0,
              is_favorite: false,
              parent_folder_id: parentFolderId,
              batch_id: batchId,
            },
          });

          const folderId = created.id.toUpperCase();
          tempIdToFolderId.set(folder.tempId, folderId);
          folderResults.push({ tempId: folder.tempId, folderId });
        }

        // Create files with SAS URLs
        const fileUploadService = getFileUploadService();
        const fileResults: BatchFileResult[] = [];

        for (const file of request.files) {
          // Generate SAS URL
          const { sasUrl, blobPath } = await fileUploadService.generateSasUrlForBulkUpload(
            userId,
            file.fileName,
            file.mimeType,
            file.sizeBytes,
            SAS_EXPIRY_MINUTES,
          );

          // Resolve parent folder
          const parentFolderId = file.parentTempId
            ? tempIdToFolderId.get(file.parentTempId) ?? null
            : targetFolderId;

          // Create file record
          const created = await tx.files.create({
            data: {
              user_id: userId,
              name: file.fileName,
              mime_type: file.mimeType,
              size_bytes: BigInt(file.sizeBytes),
              blob_path: blobPath,
              source_type: 'blob_storage',
              is_folder: false,
              is_favorite: false,
              processing_retry_count: 0,
              embedding_retry_count: 0,
              pipeline_status: PIPELINE_STATUS.REGISTERED,
              parent_folder_id: parentFolderId,
              batch_id: batchId,
              content_hash: file.contentHash ?? null,
            },
          });

          const fileId = created.id.toUpperCase();
          fileResults.push({ tempId: file.tempId, fileId, sasUrl, blobPath });
        }

        return {
          batchId,
          status: BATCH_STATUS.ACTIVE as const,
          files: fileResults,
          folders: folderResults,
          duplicates,
          expiresAt: expiresAt.toISOString(),
        };
      },
      { timeout: 30000 },
    );

    logger.info(
      { userId, batchId: result.batchId, fileCount: result.files.length, folderCount: result.folders.length },
      'Batch created',
    );

    return result;
  }

  // --------------------------------------------------------------------------
  // Phase C: Confirm File
  // --------------------------------------------------------------------------

  async confirmFile(
    userId: string,
    batchId: string,
    fileId: string,
  ): Promise<ConfirmFileResponse> {
    logger.debug({ userId, batchId, fileId }, 'confirmFile: start');

    // 1. Find and validate batch
    const batch = await (this.prisma as Record<string, unknown> & typeof this.prisma).upload_batches.findFirst({
      where: { id: batchId, user_id: userId },
    });

    if (!batch) {
      throw new BatchNotFoundError(batchId);
    }
    if (batch.status === BATCH_STATUS.EXPIRED || new Date() > new Date(batch.expires_at)) {
      throw new BatchExpiredError(batchId);
    }
    if (batch.status === BATCH_STATUS.CANCELLED) {
      throw new BatchCancelledError(batchId);
    }
    if (batch.status === BATCH_STATUS.COMPLETED) {
      throw new BatchAlreadyCompleteError(batchId);
    }
    logger.debug({ batchId, status: batch.status }, 'confirmFile: step 1 OK — batch validated');

    // 2. Find and validate file
    const file = await this.prisma.files.findFirst({
      where: { id: fileId, user_id: userId, batch_id: batchId },
    });

    if (!file) {
      throw new FileNotInBatchError(fileId, batchId);
    }
    if (file.pipeline_status !== PIPELINE_STATUS.REGISTERED) {
      throw new FileAlreadyConfirmedError(fileId, file.pipeline_status ?? 'unknown');
    }
    logger.debug({ fileId, blobPath: file.blob_path }, 'confirmFile: step 2 OK — file validated');

    // 3. Verify blob exists in Azure Storage
    const fileUploadService = getFileUploadService();
    const blobExists = await fileUploadService.blobExists(file.blob_path);
    if (!blobExists) {
      throw new BlobNotFoundError(fileId, file.blob_path);
    }
    logger.debug({ fileId }, 'confirmFile: step 3 OK — blob exists');

    // 4. CAS transition: registered → queued (atomic)
    const updated = await this.prisma.files.updateMany({
      where: {
        id: fileId,
        user_id: userId,
        pipeline_status: PIPELINE_STATUS.REGISTERED,
        deletion_status: null,
      },
      data: {
        pipeline_status: PIPELINE_STATUS.QUEUED,
      },
    });

    if (updated.count === 0) {
      throw new ConcurrentModificationError(fileId);
    }
    logger.debug({ fileId }, 'confirmFile: step 4 OK — CAS transition registered→queued');

    // 5. Atomic counter increment + auto-complete batch
    await this.prisma.$executeRaw`
      UPDATE upload_batches
      SET confirmed_count = confirmed_count + 1,
          status = CASE
            WHEN confirmed_count + 1 >= total_files THEN 'completed'
            ELSE status
          END,
          updated_at = GETUTCDATE()
      WHERE id = ${batchId}
        AND user_id = ${userId}
    `;
    logger.debug({ batchId }, 'confirmFile: step 5 OK — counter incremented');

    // 6. Read back batch for progress
    const updatedBatch = await (this.prisma as Record<string, unknown> & typeof this.prisma).upload_batches.findFirst({
      where: { id: batchId, user_id: userId },
    });

    const confirmed = updatedBatch?.confirmed_count ?? 0;
    const total = updatedBatch?.total_files ?? 0;
    logger.debug({ batchId, confirmed, total }, 'confirmFile: step 6 OK — batch read back');

    // 7. Enqueue V2 processing flow (PRD-04)
    // BullMQ Flow guarantees: extract → chunk → embed → pipeline-complete
    const queue = getMessageQueue();
    await queue.addFileProcessingFlow({
      fileId,
      batchId,
      userId,
      mimeType: file.mime_type,
      blobPath: file.blob_path,
      fileName: file.name,
    });

    logger.info(
      { userId, batchId, fileId, confirmed, total },
      'File confirmed and enqueued (step 7 OK)',
    );

    return {
      fileId,
      pipelineStatus: PIPELINE_STATUS.QUEUED,
      batchProgress: {
        total,
        confirmed,
        isComplete: confirmed >= total,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Get Batch Status
  // --------------------------------------------------------------------------

  async getBatchStatus(
    userId: string,
    batchId: string,
  ): Promise<BatchStatusResponse> {
    const batch = await (this.prisma as Record<string, unknown> & typeof this.prisma).upload_batches.findFirst({
      where: { id: batchId, user_id: userId },
    });

    if (!batch) {
      throw new BatchNotFoundError(batchId);
    }

    const files = await this.prisma.files.findMany({
      where: { batch_id: batchId, is_folder: false },
      select: { id: true, name: true, pipeline_status: true },
    });

    return {
      batchId: (batch.id as string).toUpperCase(),
      status: batch.status as string,
      totalFiles: batch.total_files as number,
      confirmedCount: batch.confirmed_count as number,
      createdAt: new Date(batch.created_at as Date).toISOString(),
      expiresAt: new Date(batch.expires_at as Date).toISOString(),
      files: files.map((f) => ({
        fileId: f.id.toUpperCase(),
        name: f.name,
        pipelineStatus: f.pipeline_status,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Cancel Batch
  // --------------------------------------------------------------------------

  async cancelBatch(
    userId: string,
    batchId: string,
  ): Promise<CancelBatchResponse> {
    const batch = await (this.prisma as Record<string, unknown> & typeof this.prisma).upload_batches.findFirst({
      where: { id: batchId, user_id: userId },
    });

    if (!batch) {
      throw new BatchNotFoundError(batchId);
    }
    if (batch.status === BATCH_STATUS.COMPLETED) {
      throw new BatchAlreadyCompleteError(batchId);
    }
    if (batch.status === BATCH_STATUS.CANCELLED) {
      throw new BatchCancelledError(batchId);
    }

    // Update batch status
    await (this.prisma as Record<string, unknown> & typeof this.prisma).upload_batches.update({
      where: { id: batchId },
      data: { status: BATCH_STATUS.CANCELLED, updated_at: new Date() },
    });

    // Soft-delete unconfirmed files
    const softDeleted = await this.prisma.files.updateMany({
      where: {
        batch_id: batchId,
        pipeline_status: PIPELINE_STATUS.REGISTERED,
        deletion_status: null,
      },
      data: {
        deletion_status: 'pending',
        deleted_at: new Date(),
      },
    });

    logger.info(
      { userId, batchId, filesAffected: softDeleted.count },
      'Batch cancelled',
    );

    return {
      batchId: (batch.id as string).toUpperCase(),
      status: BATCH_STATUS.CANCELLED,
      filesAffected: softDeleted.count,
    };
  }

  // --------------------------------------------------------------------------
  // Manifest Validation (pre-transaction)
  // --------------------------------------------------------------------------

  private validateManifest(request: CreateBatchRequest): void {
    // Collect all tempIds
    const allTempIds = new Set<string>();

    for (const file of request.files) {
      if (allTempIds.has(file.tempId)) {
        throw new ManifestValidationError(`Duplicate tempId in files: ${file.tempId}`);
      }
      allTempIds.add(file.tempId);
    }

    if (request.folders) {
      for (const folder of request.folders) {
        if (allTempIds.has(folder.tempId)) {
          throw new ManifestValidationError(`Duplicate tempId across files/folders: ${folder.tempId}`);
        }
        allTempIds.add(folder.tempId);
      }
    }

    // Validate parentTempId references
    const folderTempIds = new Set(request.folders?.map((f) => f.tempId) ?? []);

    for (const file of request.files) {
      if (file.parentTempId && !folderTempIds.has(file.parentTempId)) {
        throw new ManifestValidationError(
          `File "${file.fileName}" references non-existent folder tempId: ${file.parentTempId}`,
        );
      }
    }

    if (request.folders) {
      for (const folder of request.folders) {
        if (folder.parentTempId && !folderTempIds.has(folder.parentTempId)) {
          throw new ManifestValidationError(
            `Folder "${folder.folderName}" references non-existent parent tempId: ${folder.parentTempId}`,
          );
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Topological Sort (DFS with cycle detection)
  // --------------------------------------------------------------------------

  private topologicalSortFolders(folders: ManifestFolderItem[]): ManifestFolderItem[] {
    const folderMap = new Map(folders.map((f) => [f.tempId, f]));
    const sorted: ManifestFolderItem[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>(); // For cycle detection

    const visit = (tempId: string): void => {
      if (visited.has(tempId)) return;
      if (visiting.has(tempId)) {
        throw new ManifestValidationError(`Circular folder reference detected involving: ${tempId}`);
      }

      visiting.add(tempId);
      const folder = folderMap.get(tempId);

      if (folder?.parentTempId) {
        visit(folder.parentTempId);
      }

      visiting.delete(tempId);
      visited.add(tempId);

      if (folder) {
        sorted.push(folder);
      }
    };

    for (const folder of folders) {
      visit(folder.tempId);
    }

    return sorted;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BatchUploadOrchestratorV2 | undefined;

export function getBatchUploadOrchestratorV2(): BatchUploadOrchestratorV2 {
  if (!instance) {
    instance = new BatchUploadOrchestratorV2();
  }
  return instance;
}

/**
 * Reset the singleton (for tests only).
 * @internal
 */
export function __resetBatchUploadOrchestratorV2(): void {
  instance = undefined;
}
