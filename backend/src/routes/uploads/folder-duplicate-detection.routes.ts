/**
 * Folder Duplicate Detection Route
 *
 * POST /api/uploads/check-folder-duplicates
 *
 * Checks root-level manifest folders for name collisions at the target location.
 *
 * @module routes/uploads/folder-duplicate-detection
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { checkFolderDuplicatesRequestSchema } from '@bc-agent/shared';
import { getFolderDuplicateDetectionService } from '@/services/files/FolderDuplicateDetectionService';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'FolderDuplicateDetectionRoutes' });

/**
 * POST /api/uploads/check-folder-duplicates
 *
 * Check a batch of folders for duplicates at the target location.
 * Requires Microsoft OAuth authentication.
 */
router.post('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    const validation = checkFolderDuplicatesRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(
        res,
        ErrorCode.VALIDATION_ERROR,
        validation.error.errors[0]?.message ?? 'Invalid request',
      );
      return;
    }

    const { folders, targetFolderId } = validation.data;

    logger.info(
      { userId, folderCount: folders.length, targetFolderId },
      'Folder duplicate check requested',
    );

    const service = getFolderDuplicateDetectionService();
    const response = await service.checkFolderDuplicates(folders, userId, targetFolderId);

    logger.info(
      { userId, totalChecked: folders.length, totalDuplicates: response.results.filter(r => r.isDuplicate).length },
      'Folder duplicate check completed',
    );

    res.json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Folder duplicate check failed');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check folder duplicates');
  }
});

export default router;
