/**
 * Folder Routes
 *
 * Handles folder creation endpoints.
 *
 * @module routes/files/folder.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService } from '@services/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { createFolderSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileFolderRoutes' });
const router = Router();

/**
 * POST /api/files/folders
 * Create a new folder
 */
router.post('/folders', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate request body
    const validation = createFolderSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Validation failed');
      return;
    }

    const { name, parentFolderId } = validation.data;

    logger.info({ userId, name, parentFolderId }, 'Creating folder');

    // Create folder with FileService
    const fileService = getFileService();
    const folderId = await fileService.createFolder(userId, name, parentFolderId);

    // Get created folder metadata
    const folder = await fileService.getFile(userId, folderId);

    if (!folder) {
      logger.error({ userId, folderId }, 'Failed to retrieve created folder');
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve created folder');
      return;
    }

    logger.info({ userId, folderId }, 'Folder created successfully');

    res.status(201).json({
      folder,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Create folder failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to create folder');
  }
});

export default router;
