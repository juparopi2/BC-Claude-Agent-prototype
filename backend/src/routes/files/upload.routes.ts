/**
 * Upload Routes
 *
 * Handles file upload endpoints.
 *
 * @module routes/files/upload.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService, getFileUploadService } from '@services/files';
import { getUsageTrackingService } from '@/domains/billing/tracking/UsageTrackingService';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { computeSha256 } from '@/shared/utils/hash';
import type { ParsedFile } from '@/types/file.types';
import { getUserId, fixFilenameMojibake } from './helpers';
import { uploadWithErrorHandling } from './middleware/upload.middleware';
import { uploadFileSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileUploadRoutes' });
const router = Router();

/**
 * POST /api/files/upload
 * Upload one or more files
 */
router.post(
  '/upload',
  authenticateMicrosoft,
  uploadWithErrorHandling, // Multer with proper error handling (413 for size limit)
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get userId from authenticated request
      const userId = getUserId(req);

      // Validate body params (Multer puts non-file FormData fields in req.body)
      const validation = uploadFileSchema.safeParse(req.body);
      if (!validation.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid body parameters');
        return;
      }

      const { parentFolderId, sessionId } = validation.data;

      // Get services
      const fileService = getFileService();
      const fileUploadService = getFileUploadService();

      // Validate parent folder if provided
      if (parentFolderId) {
        const parentFolder = await fileService.getFile(userId, parentFolderId);
        if (!parentFolder) {
          sendError(res, ErrorCode.NOT_FOUND, 'Parent folder not found');
          return;
        }
        if (!parentFolder.isFolder) {
          sendError(res, ErrorCode.VALIDATION_ERROR, 'Parent must be a folder');
          return;
        }
      }

      // Validate files array exists and not empty
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'No files provided');
        return;
      }

      logger.info({ userId, fileCount: files.length, parentFolderId }, 'Uploading files');
      const uploadedFiles: ParsedFile[] = [];

      // Loop through files and upload each one
      for (const file of files) {
        // Track blob upload for rollback on SQL failure
        let blobUploaded = false;
        let blobPath = '';

        try {
          // Validate file type
          fileUploadService.validateFileType(file.mimetype);

          // Validate file size
          fileUploadService.validateFileSize(file.size, file.mimetype);

          // Generate blob path
          blobPath = fileUploadService.generateBlobPath(userId, file.originalname);

          // Upload to blob storage
          await fileUploadService.uploadToBlob(file.buffer, blobPath, file.mimetype);
          blobUploaded = true; // Mark blob as uploaded for potential rollback

          // Fix mojibake in filename before storing
          const fixedFilename = fixFilenameMojibake(file.originalname);

          // Compute content hash for duplicate detection
          const contentHash = computeSha256(file.buffer);

          // Create file record in database
          const fileId = await fileService.createFileRecord({
            userId,
            name: fixedFilename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            blobPath,
            parentFolderId,
            contentHash,
          });

          // Track file upload usage (fire-and-forget)
          const usageTrackingService = getUsageTrackingService();
          usageTrackingService.trackFileUpload(userId, fileId, file.size, {
            mimeType: file.mimetype,
            fileName: file.originalname,
            blobPath
          }).catch((err) => {
            // Fire-and-forget: log but don't fail the upload
            logger.warn({ err, userId, fileId, fileName: file.originalname }, 'Failed to track file upload');
          });

          // Enqueue file processing job (fire-and-forget)
          // This triggers text extraction via BullMQ worker
          const messageQueue = getMessageQueue();
          messageQueue.addFileProcessingJob({
            fileId,
            userId,
            sessionId,
            mimeType: file.mimetype,
            blobPath,
            fileName: fixedFilename,
          }).catch((err) => {
            // Fire-and-forget: log but don't fail the upload
            logger.warn({ err, userId, fileId, fileName: file.originalname }, 'Failed to enqueue file processing job');
          });

          // Get created file metadata
          const createdFile = await fileService.getFile(userId, fileId);
          if (createdFile) {
            uploadedFiles.push(createdFile);
          }

          logger.info({
            userId,
            fileId,
            originalName: file.originalname,
            fixedName: fixedFilename,
            fileName: file.originalname
          }, 'File uploaded successfully');
        } catch (fileError) {
          // D20-D24: Rollback blob if it was uploaded but subsequent operations failed
          if (blobUploaded && blobPath) {
            logger.warn({ userId, blobPath, fileName: file.originalname }, 'Rolling back blob after SQL failure');
            fileUploadService.deleteFromBlob(blobPath).catch((rollbackError) => {
              logger.error({
                error: rollbackError,
                userId,
                blobPath,
                fileName: file.originalname
              }, 'Failed to rollback blob after SQL error - orphan blob created');
            });
          }

          // Log error but continue with other files
          logger.error({ error: fileError, userId, fileName: file.originalname }, 'Failed to upload file');

          // If this is a validation error, we should still fail the whole request
          if (fileError instanceof Error && (
            fileError.message.includes('File type not allowed') ||
            fileError.message.includes('File size exceeds')
          )) {
            sendError(res, ErrorCode.VALIDATION_ERROR, fileError.message);
            return;
          }
        }
      }

      if (uploadedFiles.length === 0) {
        sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to upload any files');
        return;
      }

      logger.info({ userId, uploadedCount: uploadedFiles.length }, 'File upload complete');

      res.status(201).json({
        files: uploadedFiles,
      });
    } catch (error) {
      logger.error({ error, userId: req.userId }, 'Upload files failed');

      if (error instanceof ZodError) {
        sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
        return;
      }

      if (error instanceof Error && error.message === 'User not authenticated') {
        sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
        return;
      }

      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to upload files');
    }
  }
);

export default router;
