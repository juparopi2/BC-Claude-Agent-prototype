/**
 * Duplicate Detection Route V2 (PRD-02)
 *
 * POST /api/v2/uploads/check-duplicates
 *
 * Batch-optimized duplicate detection across 3 scopes (storage, pipeline, upload).
 * Replaces the legacy POST /api/files/check-duplicates endpoint.
 *
 * @module routes/v2/uploads/duplicate-detection
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { checkDuplicatesRequestV2Schema } from '@bc-agent/shared';
import { getDuplicateDetectionServiceV2 } from '@/services/files/DuplicateDetectionServiceV2';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'DuplicateDetectionV2Routes' });

/**
 * POST /api/v2/uploads/check-duplicates
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
    const validation = checkDuplicatesRequestV2Schema.safeParse(req.body);
    if (!validation.success) {
      sendError(
        res,
        ErrorCode.VALIDATION_ERROR,
        validation.error.errors[0]?.message ?? 'Invalid request',
      );
      return;
    }

    const { files } = validation.data;

    logger.info(
      { userId, fileCount: files.length },
      'V2 duplicate check requested',
    );

    const service = getDuplicateDetectionServiceV2();
    const { results, summary } = await service.checkDuplicates(files, userId);

    logger.info(
      { userId, totalChecked: summary.totalChecked, totalDuplicates: summary.totalDuplicates },
      'V2 duplicate check completed',
    );

    res.json({ results, summary });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'V2 duplicate check failed');
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to check duplicates');
  }
});

export default router;
