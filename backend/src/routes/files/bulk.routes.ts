/**
 * Bulk Operations Routes
 *
 * Handles bulk upload initialization/completion and bulk delete.
 *
 * @module routes/files/bulk.routes
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileUploadService } from '@services/files';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import {
  bulkDeleteRequestSchema,
  bulkUploadInitRequestSchema,
  bulkUploadCompleteRequestSchema,
  renewSasRequestSchema,
  validateSafe,
  FILE_BULK_UPLOAD_CONFIG,
  type SoftDeleteResult,
  type BulkUploadInitResponse,
  type BulkUploadAcceptedResponse,
  type BulkUploadFileSasInfo,
  type RenewSasResponse,
} from '@bc-agent/shared';
import { getSoftDeleteService } from '@services/files/operations';
import { getUserId } from './helpers';
import { getBulkUploadBatchStore } from './state/BulkUploadBatchStore';

const logger = createChildLogger({ service: 'FileBulkRoutes' });
const router = Router();

/**
 * POST /api/files/bulk-upload/init
 *
 * Initialize bulk upload batch. Generates SAS URLs for direct-to-blob uploads.
 * Returns 202 Accepted with batchId and SAS URLs for each file.
 *
 * Request body:
 * - files: Array<{ tempId, fileName, mimeType, sizeBytes }> (1-500 files)
 * - parentFolderId?: string (optional)
 * - sessionId?: string (optional, for WebSocket events)
 *
 * Response 202:
 * - batchId: string (for tracking)
 * - files: Array<{ tempId, sasUrl, blobPath, expiresAt }>
 */
router.post('/bulk-upload/init', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = validateSafe(bulkUploadInitRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    // Note: parentFolderId is passed but only used in /complete endpoint
    const { files, parentFolderId: _parentFolderId, sessionId } = validation.data;

    // Generate batch ID (UPPERCASE per CLAUDE.md)
    const batchId = crypto.randomUUID().toUpperCase();

    logger.info({ userId, fileCount: files.length, batchId }, 'Initializing bulk upload');

    // Generate SAS URLs for each file
    const fileUploadService = getFileUploadService();
    const sasFiles: BulkUploadFileSasInfo[] = [];
    const batchFiles: Array<{
      tempId: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      blobPath: string;
    }> = [];

    for (const file of files) {
      try {
        const sasInfo = await fileUploadService.generateSasUrlForBulkUpload(
          userId,
          file.fileName,
          file.mimeType,
          file.sizeBytes,
          FILE_BULK_UPLOAD_CONFIG.SAS_EXPIRY_MINUTES
        );

        sasFiles.push({
          tempId: file.tempId,
          sasUrl: sasInfo.sasUrl,
          blobPath: sasInfo.blobPath,
          expiresAt: sasInfo.expiresAt,
        });

        batchFiles.push({
          tempId: file.tempId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          blobPath: sasInfo.blobPath,
        });
      } catch (fileError) {
        // If validation fails for a file (bad mime type, size), skip it
        logger.warn({
          userId,
          tempId: file.tempId,
          fileName: file.fileName,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        }, 'Failed to generate SAS URL for file');
      }
    }

    if (sasFiles.length === 0) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'No valid files in request');
      return;
    }

    // Store batch metadata for later validation
    const batchStore = getBulkUploadBatchStore();
    batchStore.set(batchId, {
      userId,
      files: batchFiles,
      sessionId,
      createdAt: new Date(),
    });

    logger.info({
      userId,
      batchId,
      filesRequested: files.length,
      sasUrlsGenerated: sasFiles.length,
    }, 'Bulk upload initialized');

    // Return 202 Accepted with SAS URLs
    const response: BulkUploadInitResponse = {
      batchId,
      files: sasFiles,
    };

    res.status(202).json(response);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Bulk upload init failed');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to initialize bulk upload');
  }
});

/**
 * POST /api/files/bulk-upload/complete
 *
 * Complete bulk upload batch. Enqueues jobs to create database records.
 * Returns 202 Accepted with job IDs for tracking.
 *
 * Request body:
 * - batchId: string
 * - uploads: Array<{ tempId, success, contentHash?, error? }>
 * - parentFolderId?: string | null
 *
 * Response 202:
 * - batchId: string
 * - jobsEnqueued: number
 * - jobIds: string[]
 */
router.post('/bulk-upload/complete', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = validateSafe(bulkUploadCompleteRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { batchId, uploads, parentFolderId } = validation.data;

    // Validate batch exists and belongs to user
    const batchStore = getBulkUploadBatchStore();
    const batch = batchStore.get(batchId);
    if (!batch) {
      sendError(res, ErrorCode.NOT_FOUND, 'Batch not found or expired');
      return;
    }

    if (batch.userId !== userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'Batch belongs to another user');
      return;
    }

    logger.info({
      userId,
      batchId,
      uploadCount: uploads.length,
      successCount: uploads.filter((u: { success: boolean }) => u.success).length,
    }, 'Completing bulk upload');

    // Enqueue jobs for successful uploads
    const messageQueue = getMessageQueue();
    const jobIds: string[] = [];

    for (const upload of uploads.filter((u: { success: boolean }) => u.success)) {
      const fileMetadata = batch.files.find(f => f.tempId === upload.tempId);
      if (!fileMetadata) {
        logger.warn({ userId, batchId, tempId: upload.tempId }, 'File metadata not found for tempId');
        continue;
      }

      const jobId = await messageQueue.addFileBulkUploadJob({
        tempId: upload.tempId,
        userId,
        batchId,
        fileName: fileMetadata.fileName,
        mimeType: fileMetadata.mimeType,
        sizeBytes: fileMetadata.sizeBytes,
        blobPath: fileMetadata.blobPath,
        contentHash: upload.contentHash,
        // Use per-file parentFolderId if provided, otherwise fall back to batch-level parentFolderId
        parentFolderId: upload.parentFolderId ?? parentFolderId ?? null,
        sessionId: batch.sessionId,
      });
      jobIds.push(jobId);
    }

    // Clean up batch metadata
    batchStore.delete(batchId);

    logger.info({
      userId,
      batchId,
      jobsEnqueued: jobIds.length,
    }, 'Bulk upload jobs enqueued');

    // Return 202 Accepted with job tracking info
    const response: BulkUploadAcceptedResponse = {
      batchId,
      jobsEnqueued: jobIds.length,
      jobIds,
    };

    res.status(202).json(response);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Bulk upload complete failed');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to complete bulk upload');
  }
});

/**
 * POST /api/files/bulk-upload/renew-sas
 *
 * Renew expired SAS URLs for pending file uploads.
 * Used when resuming an interrupted upload after a pause.
 * Returns 200 OK with new SAS URLs for the requested tempIds.
 *
 * Request body:
 * - batchId: string (UUID from original init)
 * - tempIds: string[] (files that need new SAS URLs)
 *
 * Response 200:
 * - batchId: string
 * - files: Array<{ tempId, sasUrl, blobPath, expiresAt }>
 */
router.post('/bulk-upload/renew-sas', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = validateSafe(renewSasRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { batchId, tempIds } = validation.data;

    // Validate batch exists and belongs to user
    const batchStore = getBulkUploadBatchStore();
    const batch = batchStore.get(batchId);
    if (!batch) {
      sendError(res, ErrorCode.NOT_FOUND, 'Batch not found or expired');
      return;
    }

    if (batch.userId !== userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'Batch belongs to another user');
      return;
    }

    logger.info({ userId, batchId, tempIdsCount: tempIds.length }, 'Renewing SAS URLs');

    // Generate new SAS URLs for requested tempIds
    const fileUploadService = getFileUploadService();
    const renewedFiles: BulkUploadFileSasInfo[] = [];

    for (const tempId of tempIds) {
      const fileMetadata = batch.files.find(f => f.tempId === tempId);
      if (!fileMetadata) {
        logger.warn({ userId, batchId, tempId }, 'tempId not found in batch');
        continue;
      }

      try {
        const sasInfo = await fileUploadService.generateSasUrlForBulkUpload(
          userId,
          fileMetadata.fileName,
          fileMetadata.mimeType,
          fileMetadata.sizeBytes,
          FILE_BULK_UPLOAD_CONFIG.SAS_EXPIRY_MINUTES
        );

        // Update stored blobPath if it changed (shouldn't, but be safe)
        fileMetadata.blobPath = sasInfo.blobPath;

        renewedFiles.push({
          tempId,
          sasUrl: sasInfo.sasUrl,
          blobPath: sasInfo.blobPath,
          expiresAt: sasInfo.expiresAt,
        });
      } catch (fileError) {
        logger.warn({
          userId,
          batchId,
          tempId,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        }, 'Failed to renew SAS URL for file');
      }
    }

    if (renewedFiles.length === 0) {
      sendError(res, ErrorCode.NOT_FOUND, 'No valid tempIds found in batch');
      return;
    }

    logger.info({
      userId,
      batchId,
      requestedCount: tempIds.length,
      renewedCount: renewedFiles.length,
    }, 'SAS URLs renewed');

    // Return renewed SAS URLs
    const response: RenewSasResponse = {
      batchId,
      files: renewedFiles,
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Renew SAS failed');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to renew SAS URLs');
  }
});

/**
 * DELETE /api/files (Bulk Delete)
 *
 * Two-phase soft delete workflow:
 *
 * Phase 1 (Synchronous, ~50ms):
 * - Marks files in DB with deletion_status='pending'
 * - Files immediately hidden from all queries
 * - Returns 200 OK with count of marked files
 *
 * Phase 2 (Async, fire-and-forget):
 * - Updates AI Search to exclude from RAG searches
 * - Enqueues physical deletion jobs
 * - Physical deletion emits WebSocket events (FILE_WS_EVENTS.DELETED)
 *
 * This workflow eliminates the race condition where files reappear after refresh.
 *
 * Request body:
 * - fileIds: string[] (1-100 UUIDs)
 * - deletionReason?: 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action'
 *
 * Response 200:
 * - markedForDeletion: number (files successfully marked)
 * - notFoundIds: string[] (files not found or already deleted)
 * - batchId: string (for tracking physical deletion)
 */
router.delete('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body using shared schema
    const validation = validateSafe(bulkDeleteRequestSchema, req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { fileIds, deletionReason } = validation.data;

    logger.info({ userId, fileCount: fileIds.length, deletionReason }, 'Starting soft delete');

    // Use SoftDeleteService for two-phase deletion
    const softDeleteService = getSoftDeleteService();
    const result: SoftDeleteResult = await softDeleteService.markForDeletion(
      userId,
      fileIds,
      { deletionReason }
    );

    // If no files were marked, return 404
    if (result.markedForDeletion === 0) {
      sendError(res, ErrorCode.NOT_FOUND, 'No files found or access denied');
      return;
    }

    logger.info({
      userId,
      batchId: result.batchId,
      markedForDeletion: result.markedForDeletion,
      notFoundCount: result.notFoundIds.length,
      requestedCount: fileIds.length,
    }, 'Soft delete Phase 1 complete');

    // Return 200 OK (not 202) - Phase 1 is complete, files are already hidden
    res.status(200).json(result);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo, userId: req.userId }, 'Soft delete failed');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to mark files for deletion');
  }
});

export default router;
