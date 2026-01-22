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
import { getFileService, getFileUploadService } from '@services/files';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import {
  bulkDeleteRequestSchema,
  bulkUploadInitRequestSchema,
  bulkUploadCompleteRequestSchema,
  validateSafe,
  FILE_BULK_UPLOAD_CONFIG,
  type BulkDeleteAcceptedResponse,
  type BulkUploadInitResponse,
  type BulkUploadAcceptedResponse,
  type BulkUploadFileSasInfo,
} from '@bc-agent/shared';
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
        parentFolderId: parentFolderId ?? null,
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
 * DELETE /api/files (Bulk Delete)
 *
 * Asynchronously deletes multiple files via BullMQ queue.
 * Returns 202 Accepted immediately with batchId for tracking.
 * Deletion status is emitted via WebSocket (FILE_WS_EVENTS.DELETED).
 *
 * Request body:
 * - fileIds: string[] (1-100 UUIDs)
 * - deletionReason?: 'user_request' | 'gdpr_erasure' | 'retention_policy' | 'admin_action'
 *
 * Response 202:
 * - batchId: string (for tracking)
 * - jobsEnqueued: number
 * - jobIds: string[]
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

    // Generate batch ID for tracking (UPPERCASE per CLAUDE.md)
    const batchId = crypto.randomUUID().toUpperCase();

    logger.info({ userId, fileCount: fileIds.length, batchId, deletionReason }, 'Starting bulk delete');

    // Verify ownership before enqueueing jobs
    const fileService = getFileService();
    const ownedFiles = await fileService.verifyOwnership(userId, fileIds);

    if (ownedFiles.length === 0) {
      sendError(res, ErrorCode.NOT_FOUND, 'No files found or access denied');
      return;
    }

    // Enqueue deletion jobs (sequential processing avoids deadlocks)
    const messageQueue = getMessageQueue();
    const jobIds: string[] = [];

    for (const fileId of ownedFiles) {
      const jobId = await messageQueue.addFileDeletionJob({
        fileId,
        userId,
        deletionReason,
        batchId,
      });
      jobIds.push(jobId);
    }

    logger.info({
      userId,
      batchId,
      jobsEnqueued: jobIds.length,
      requestedCount: fileIds.length,
      ownedCount: ownedFiles.length,
    }, 'Bulk delete jobs enqueued');

    // Return 202 Accepted with tracking info
    const response: BulkDeleteAcceptedResponse = {
      batchId,
      jobsEnqueued: jobIds.length,
      jobIds,
    };

    res.status(202).json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo, userId: req.userId }, 'Bulk delete failed');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to enqueue deletion jobs');
  }
});

export default router;
