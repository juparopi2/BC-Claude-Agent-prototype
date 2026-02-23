/**
 * Duplicate Detection Route (PRD-02)
 *
 * POST /api/uploads/check-duplicates
 *
 * Batch-optimized duplicate detection across 3 scopes (storage, pipeline, upload).
 * Replaces the legacy POST /api/files/check-duplicates endpoint.
 *
 * @module routes/uploads/duplicate-detection
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { checkDuplicatesRequestSchema } from '@bc-agent/shared';
import { getDuplicateDetectionService } from '@/services/files/DuplicateDetectionService';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'DuplicateDetectionRoutes' });

/**
 * POST /api/uploads/check-duplicates
 *
 * Check a batch of files for duplicates across storage, pipeline, and upload scopes.
 * Requires Microsoft OAuth authentication.
 */
router.post('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Validate request body
    const validation = checkDuplicatesRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(
        res,
        ErrorCode.VALIDATION_ERROR,
        validation.error.errors[0]?.message ?? 'Invalid request',
      );
      return;
    }

    const { files, targetFolderId } = validation.data;

    logger.info(
      { userId, fileCount: files.length, targetFolderId },
      'Duplicate check requested',
    );

    const service = getDuplicateDetectionService();
    const { results, summary, targetFolderPath } = await service.checkDuplicates(files, userId, targetFolderId);

    logger.info(
      { userId, totalChecked: summary.totalChecked, totalDuplicates: summary.totalDuplicates },
      'Duplicate check completed',
    );

    res.json({ results, summary, targetFolderPath });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Duplicate check failed');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check duplicates');
  }
});

export default router;
