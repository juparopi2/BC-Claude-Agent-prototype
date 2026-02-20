/**
 * Folder Duplicate Detection Route V2
 *
 * POST /api/v2/uploads/check-folder-duplicates
 *
 * Checks root-level manifest folders for name collisions at the target location.
 *
 * @module routes/v2/uploads/folder-duplicate-detection
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { checkFolderDuplicatesRequestV2Schema } from '@bc-agent/shared';
import { getFolderDuplicateDetectionServiceV2 } from '@/services/files/FolderDuplicateDetectionServiceV2';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'FolderDuplicateDetectionV2Routes' });

/**
 * POST /api/v2/uploads/check-folder-duplicates
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

    const validation = checkFolderDuplicatesRequestV2Schema.safeParse(req.body);
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
      'V2 folder duplicate check requested',
    );

    const service = getFolderDuplicateDetectionServiceV2();
    const response = await service.checkFolderDuplicates(folders, userId, targetFolderId);

    logger.info(
      { userId, totalChecked: folders.length, totalDuplicates: response.results.filter(r => r.isDuplicate).length },
      'V2 folder duplicate check completed',
    );

    res.json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'V2 folder duplicate check failed');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check folder duplicates');
  }
});

export default router;
