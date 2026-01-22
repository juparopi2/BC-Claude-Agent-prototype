/**
 * CRUD Routes
 *
 * Handles basic file CRUD operations: list, get, update, delete.
 *
 * @module routes/files/crud.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService, getFileUploadService } from '@services/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { getFilesSchema, fileIdSchema, updateFileSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileCrudRoutes' });
const router = Router();

/**
 * GET /api/files
 * List files with filtering, sorting, and pagination
 */
router.get('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate query params
    const validation = getFilesSchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { folderId, sortBy, favoritesFirst, limit, offset } = validation.data;

    logger.info({ userId, folderId, sortBy, favoritesFirst, limit, offset }, 'Getting files');

    // Get files with FileService
    const fileService = getFileService();
    const files = await fileService.getFiles({
      userId,
      folderId,
      sortBy,
      favoritesFirst,
      limit,
      offset,
    });

    // Get total count for pagination
    const total = await fileService.getFileCount(userId, folderId, { favoritesFirst });

    logger.info({ userId, fileCount: files.length, total }, 'Files retrieved successfully');

    res.json({
      files,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get files failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get files');
  }
});

/**
 * GET /api/files/:id
 * Get file metadata (with ownership check)
 */
router.get('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
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

    logger.info({ userId, fileId: id }, 'Getting file metadata');

    // Get file with FileService (includes ownership check)
    const fileService = getFileService();
    const file = await fileService.getFile(userId, id);

    if (!file) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    logger.info({ userId, fileId: id }, 'File metadata retrieved');

    res.json({
      file,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Get file metadata failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get file metadata');
  }
});

/**
 * PATCH /api/files/:id
 * Update file metadata (name, folder, favorite)
 */
router.patch('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate params
    const paramsValidation = fileIdSchema.safeParse(req.params);
    if (!paramsValidation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, paramsValidation.error.errors[0]?.message || 'Invalid file ID');
      return;
    }

    const { id } = paramsValidation.data;

    // Validate body
    const bodyValidation = updateFileSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, bodyValidation.error.errors[0]?.message || 'Validation failed');
      return;
    }

    const updates = bodyValidation.data;

    logger.info({ userId, fileId: id, updates }, 'Updating file');

    // Check file exists and is owned by user
    const fileService = getFileService();
    const existingFile = await fileService.getFile(userId, id);

    if (!existingFile) {
      logger.info({ userId, fileId: id }, 'File not found or access denied');
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    // Update file with FileService
    await fileService.updateFile(userId, id, updates);

    // Get updated file metadata
    const updatedFile = await fileService.getFile(userId, id);

    if (!updatedFile) {
      logger.error({ userId, fileId: id }, 'Failed to retrieve updated file');
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve updated file');
      return;
    }

    logger.info({ userId, fileId: id }, 'File updated successfully');

    res.json({
      file: updatedFile,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Update file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message === 'File not found or unauthorized') {
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to update file');
  }
});

/**
 * DELETE /api/files/:id
 * Delete file or folder (CASCADE deletes related records)
 */
router.delete('/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
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

    logger.info({ userId, fileId: id }, 'Starting file deletion cascade');

    // Delete file from database (returns list of blob_paths for cleanup)
    const fileService = getFileService();
    const blobPaths = await fileService.deleteFile(userId, id);

    logger.info(
      { userId, fileId: id, blobCount: blobPaths.length },
      'DB + AI Search deletion completed, starting blob cleanup'
    );

    // Helper to delete a single blob safely
    const deleteBlobSafely = async (path: string) => {
      try {
        const fileUploadService = getFileUploadService();
        await fileUploadService.deleteFromBlob(path);
        logger.info({ userId, blobPath: path }, 'File deleted from blob storage');
      } catch (blobError) {
        // Log error but don't fail the request (DB record already deleted)
        logger.error({ error: blobError, userId, blobPath: path }, 'Failed to delete blob (DB record already deleted)');
      }
    };

    // Delete all blobs in parallel
    if (blobPaths.length > 0) {
      await Promise.all(blobPaths.map(path => deleteBlobSafely(path)));
    }

    logger.info({ userId, fileId: id }, 'File deleted successfully');

    res.status(204).send();
  } catch (error) {
    logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Delete file failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    if (error instanceof Error && error.message === 'File not found or unauthorized') {
      sendError(res, ErrorCode.NOT_FOUND, 'File not found or access denied');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to delete file');
  }
});

export default router;
