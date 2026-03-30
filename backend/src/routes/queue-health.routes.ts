/**
 * Queue Health Routes (PRD-305)
 *
 * Exposes per-queue job counts for operational monitoring.
 * Iterates all BullMQ queues and returns waiting/active/failed/delayed counts.
 *
 * @module routes/queue-health
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { QueueName } from '@/infrastructure/queue/constants';

const logger = createChildLogger({ service: 'QueueHealthRoutes' });
const router = Router();

/**
 * GET /api/queue/health
 *
 * Returns per-queue job counts for all BullMQ queues.
 * Each queue reports waiting, active, failed, and delayed counts.
 * Individual queue failures are isolated — one unavailable queue
 * does not fail the entire response.
 */
router.get(
  '/health',
  authenticateMicrosoft,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { getMessageQueue } = await import('@/infrastructure/queue');
      const messageQueue = getMessageQueue();

      const queueNames = Object.values(QueueName);
      const queues: Record<string, { waiting: number; active: number; failed: number; delayed: number }> = {};

      const results = await Promise.allSettled(
        queueNames.map(async (name) => {
          const stats = await messageQueue.getQueueStats(name);
          return { name, stats };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { name, stats } = result.value;
          queues[name] = {
            waiting: stats.waiting,
            active: stats.active,
            failed: stats.failed,
            delayed: stats.delayed,
          };
        } else {
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.warn({ error: reason }, 'Failed to get stats for a queue');
        }
      }

      res.json({ queues, timestamp: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
