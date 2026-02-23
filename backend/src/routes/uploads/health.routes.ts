/**
 * Upload Health Route (PRD-01)
 *
 * GET /api/uploads/health
 *
 * Returns the pipeline state machine definition and current file distribution
 * across pipeline states. Useful for monitoring and debugging the upload pipeline.
 *
 * @module routes/uploads/health
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS, PIPELINE_TRANSITIONS } from '@bc-agent/shared';
import { getFileRepository } from '@/services/files/repository/FileRepository';

const router = Router();
const logger = createChildLogger({ service: 'UploadHealthRoutes' });

/**
 * GET /api/uploads/health
 *
 * Returns pipeline state machine definition + current distribution.
 * Requires Microsoft OAuth authentication.
 */
router.get('/', authenticateMicrosoft, async (_req: Request, res: Response): Promise<void> => {
  try {
    const repo = getFileRepository();
    const distribution = await repo.getStatusDistribution();

    const states = Object.values(PIPELINE_STATUS);

    // Convert readonly arrays to plain arrays for JSON serialization
    const transitions: Record<string, string[]> = {};
    for (const [key, targets] of Object.entries(PIPELINE_TRANSITIONS)) {
      transitions[key] = [...targets];
    }

    res.json({
      version: '2.0.0-alpha',
      timestamp: new Date().toISOString(),
      states,
      transitions,
      distribution,
    });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Upload health check failed');
    res.status(503).json({
      error: 'Upload health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
