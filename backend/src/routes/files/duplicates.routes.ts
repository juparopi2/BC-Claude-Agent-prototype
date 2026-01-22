/**
 * Duplicates Check Routes
 *
 * Handles content-based duplicate detection.
 *
 * @module routes/files/duplicates.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService } from '@services/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { checkDuplicatesSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileDuplicatesRoutes' });
const router = Router();

/**
 * POST /api/files/check-duplicates
 * Check if files with given content hashes already exist in user's repository
 *
 * Used before upload to detect duplicate content regardless of filename.
 * Returns which files are duplicates and their existing file info.
 */
router.post('/check-duplicates', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = checkDuplicatesSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request');
      return;
    }

    const { files } = validation.data;

    logger.info({ userId, fileCount: files.length }, 'Checking for duplicate files by content hash');

    const fileService = getFileService();
    const results = await fileService.checkDuplicatesByHash(userId, files);

    logger.info(
      { userId, total: files.length, duplicates: results.filter(r => r.isDuplicate).length },
      'Duplicate check completed'
    );

    res.json({ results });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Check duplicates failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check duplicates');
  }
});

export default router;
