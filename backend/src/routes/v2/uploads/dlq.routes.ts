/**
 * DLQ Routes (PRD-04)
 *
 * API endpoints for managing the V2 dead letter queue.
 *
 * All endpoints require authentication via the auth middleware.
 *
 * @module routes/v2/uploads/dlq
 */

import { Router } from 'express';
import { getDLQService } from '@/services/queue/DLQService';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'DLQRoutes' });
const router = Router();

/**
 * GET /api/v2/uploads/dlq
 * List failed files (paginated, authenticated).
 */
router.get('/', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const dlqService = getDLQService();
    const result = await dlqService.listEntries(userId, page, pageSize);

    res.json(result);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to list DLQ entries');
    res.status(500).json({ error: 'Failed to list DLQ entries' });
  }
});

/**
 * POST /api/v2/uploads/dlq/:fileId/retry
 * Retry a single failed file.
 */
router.post('/:fileId/retry', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const { fileId } = req.params;

    const dlqService = getDLQService();
    const result = await dlqService.retryFile(fileId!, userId);

    if (!result.success) {
      res.status(409).json({ error: result.error });
      return;
    }

    res.json({ fileId, status: 'retrying' });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to retry file');
    res.status(500).json({ error: 'Failed to retry file' });
  }
});

/**
 * POST /api/v2/uploads/dlq/retry-all
 * Retry all failed files for the authenticated user.
 */
router.post('/retry-all', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;

    const dlqService = getDLQService();
    const result = await dlqService.retryAll(userId);

    res.json(result);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to retry all files');
    res.status(500).json({ error: 'Failed to retry all files' });
  }
});

export default router;
