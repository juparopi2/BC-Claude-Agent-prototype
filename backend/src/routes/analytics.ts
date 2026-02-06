/**
 * Analytics Routes
 *
 * REST API endpoints for agent usage analytics.
 *
 * Endpoints:
 * - GET /api/analytics/agents - Get usage summary for all agents
 * - GET /api/analytics/agents/:id/daily - Get daily usage for a specific agent
 *
 * @module routes/analytics
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getAgentAnalyticsService } from '@/domains/analytics';
import { createChildLogger } from '@/shared/utils/logger';
import { sendBadRequest, sendInternalError } from '@/shared/utils/error-response';

const logger = createChildLogger({ service: 'AnalyticsRoutes' });
const router = Router();

/**
 * GET /api/analytics/agents
 * Returns usage summary aggregated by agent for a date range.
 *
 * Query params:
 * - startDate: ISO date string (required)
 * - endDate: ISO date string (required)
 */
router.get('/agents', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      sendBadRequest(res, 'startDate and endDate query parameters are required', 'query');
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      sendBadRequest(res, 'startDate and endDate must be valid ISO date strings', 'query');
      return;
    }

    const analytics = getAgentAnalyticsService();
    const summary = await analytics.getUsageSummary(start, end);

    logger.info(
      { userId: req.userId, startDate, endDate, resultCount: summary.length },
      'Agent usage summary requested'
    );

    res.json({ summary });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to get agent usage summary');
    sendInternalError(res);
  }
});

/**
 * GET /api/analytics/agents/:id/daily
 * Returns daily usage data for a specific agent.
 *
 * Query params:
 * - days: Number of days to look back (default: 30)
 */
router.get('/agents/:id/daily', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.id;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

    if (isNaN(days) || days < 1 || days > 365) {
      sendBadRequest(res, 'days must be a number between 1 and 365', 'days');
      return;
    }

    const analytics = getAgentAnalyticsService();
    const usage = await analytics.getDailyUsage(agentId, days);

    logger.info(
      { userId: req.userId, agentId, days, resultCount: usage.length },
      'Agent daily usage requested'
    );

    res.json({ agentId, usage });
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to get agent daily usage');
    sendInternalError(res);
  }
});

export default router;
