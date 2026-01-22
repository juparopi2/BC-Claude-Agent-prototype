/**
 * Download Routes
 *
 * Handles file download and content preview endpoints.
 *
 * @module routes/files/download.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService, getFileUploadService } from '@services/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { fileIdSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileDownloadRoutes' });
const router = Router();

/**
 * GET /api/files/:id/download
 * Download file blob
 */
router.get('/:id/download', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const validation = fileIdSchema.safeParse(req.params);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = validation.data;

    logger.info({ userId, fileId: id }, 'Downloading file');

    // Get file metadata (ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Check if it's a folder (folders cannot be downloaded)
    if (file.isFolder) {
      logger.warn({ userId, fileId: id }, 'Cannot download folder');
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Cannot download a folder');
      return;
    }

    // Download blob from storage
    const fileUploadService = getFileUploadService();
    const buffer = await fileUploadService.downloadFromBlob(file.blobPath);

    logger.info({ userId, fileId: id, size: buffer.length }, 'File downloaded successfully');

    // Set Content-Type and Content-Disposition headers
    res.setHeader('Content-Type', file.mimeType);

    // RFC 5987 encoding for filename with UTF-8 support (for international characters)
    // Format: filename*=UTF-8''encoded_filename
    const encodedFilename = encodeURIComponent(file.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"; filename*=UTF-8''${encodedFilename}`);

    res.setHeader('Content-Length', buffer.length.toString());

    // Send buffer
    res.send(buffer);
  } catch (error) {
    logger.error({
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      userId: req.userId,
      fileId: req.params.id
    }, 'Download file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Pass through specific blob storage errors if safe
    if (error instanceof Error && error.message.includes('BlobNotFound')) {
      sendError(res, ErrorCode.NOT_FOUND, 'File content not found in storage');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to download file');
  }
});

/**
 * GET /api/files/:id/content
 * Stream file content for inline preview (images, PDFs, text)
 *
 * Similar to /download but with Content-Disposition: inline for browser preview.
 * Used by FilePreviewModal to display files without triggering a download.
 */
router.get('/:id/content', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const validation = fileIdSchema.safeParse(req.params);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = validation.data;

    logger.info({ userId, fileId: id }, 'Serving file content for preview');

    // Get file metadata (ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Check if it's a folder (folders cannot be previewed)
    if (file.isFolder) {
      logger.warn({ userId, fileId: id }, 'Cannot preview folder');
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Cannot preview a folder');
      return;
    }

    // Download blob from storage
    const fileUploadService = getFileUploadService();
    const buffer = await fileUploadService.downloadFromBlob(file.blobPath);

    logger.info({ userId, fileId: id, size: buffer.length }, 'File content served successfully');

    // Set Content-Type header
    res.setHeader('Content-Type', file.mimeType);

    // Set Content-Disposition: inline (for preview, not download)
    // This tells the browser to display the content inline if possible
    const encodedFilename = encodeURIComponent(file.name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"; filename*=UTF-8''${encodedFilename}`);

    res.setHeader('Content-Length', buffer.length.toString());

    // Enable CORS for image preview (some browsers require this)
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

    // Send buffer
    res.send(buffer);
  } catch (error) {
    logger.error({
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      userId: req.userId,
      fileId: req.params.id
    }, 'Serve file content failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Pass through specific blob storage errors if safe
    if (error instanceof Error && error.message.includes('BlobNotFound')) {
      sendError(res, ErrorCode.NOT_FOUND, 'File content not found in storage');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to serve file content');
  }
});

export default router;
