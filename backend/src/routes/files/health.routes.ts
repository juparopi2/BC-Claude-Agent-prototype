/**
 * File Health Routes
 *
 * Diagnostic endpoint for surfacing problematic files (failed, stuck, blob-missing)
 * to the FileHealthWarning UI component.
 *
 * @module routes/files/health
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { getFileHealthService } from '@/services/files/FileHealthService';

const logger = createChildLogger({ service: 'FileHealthRoutes' });
const router = Router();

/**
 * GET /api/files/health/issues
 *
 * Returns all problematic files for the authenticated user:
 * - Failed with retries exhausted
 * - Failed with missing blob
 * - Failed but retriable
 * - Stuck in intermediate pipeline state > 30 min
 *
 * Each issue includes classification metadata so the frontend can
 * render appropriate actions (retry, delete, accept & navigate).
 */
router.get(
  '/issues',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      logger.debug({ userId }, 'File health issues requested');

      const service = getFileHealthService();
      const result = await service.getHealthIssues(userId);

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
