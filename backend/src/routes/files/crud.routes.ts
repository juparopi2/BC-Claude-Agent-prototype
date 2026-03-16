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
import { getSoftDeleteService } from '@services/files/operations';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { getFilesSchema, fileIdSchema, updateFileSchema, bulkDeleteSchema } from './schemas/file.schemas';

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

    const { folderId, sortBy, favoritesOnly, limit, offset, search, sourceType, siteId, connectionScopeId } = validation.data;

    // If search parameter provided, use search endpoint
    if (search) {
      logger.info({ userId, search, limit }, 'Searching files by name');
      const fileService = getFileService();
      const results = await fileService.searchByName(userId, search, { limit });
      res.json({ files: results, total: results.length });
      return;
    }

    logger.info({ userId, folderId, sortBy, favoritesOnly, limit, offset, siteId }, 'Getting files');

    // Get files with FileService
    const fileService = getFileService();
    const files = await fileService.getFiles({
      userId,
      folderId,
      sortBy,
      favoritesOnly,
      sourceType,
      siteId,
      connectionScopeId,
      limit,
      offset,
    });

    // Get total count for pagination
    const total = await fileService.getFileCount(userId, folderId, { favoritesOnly, sourceType });

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
 * DELETE /api/files
 * Bulk delete files (soft delete via SoftDeleteService)
 */
router.delete('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    const validation = bulkDeleteSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { fileIds, deletionReason } = validation.data;

    logger.info({ userId, fileCount: fileIds.length, deletionReason }, 'Bulk delete requested');

    const softDeleteService = getSoftDeleteService();
    const result = await softDeleteService.markForDeletion(userId, fileIds, { deletionReason });

    logger.info(
      { userId, markedForDeletion: result.markedForDeletion, notFoundIds: result.notFoundIds, batchId: result.batchId },
      'Bulk delete completed (Phase 1)'
    );

    res.status(200).json(result);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Bulk delete failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to delete files');
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
