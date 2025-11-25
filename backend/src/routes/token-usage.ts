/**
 * Token Usage Routes
 *
 * REST API endpoints for querying token usage analytics.
 * Used for billing dashboards, usage monitoring, and cost analysis.
 *
 * @module routes/token-usage
 */

import { Router } from 'express';
import { getTokenUsageService } from '@/services/token-usage';
import { createChildLogger } from '@/utils/logger';

const router = Router();
const logger = createChildLogger({ route: 'token-usage' });

/**
 * GET /api/token-usage/user/:userId
 *
 * Get token usage totals for a specific user.
 *
 * @param userId - User ID (UUID)
 * @returns UserTokenTotals or 404 if no usage found
 */
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  // Validate userId is provided
  if (!userId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'userId parameter is required',
    });
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const totals = await tokenUsageService.getUserTotals(userId);

    if (!totals) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No token usage found for user ${userId}`,
      });
    }

    return res.json(totals);
  } catch (error) {
    logger.error('Failed to get user token totals', { error, userId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve token usage',
    });
  }
});

/**
 * GET /api/token-usage/session/:sessionId
 *
 * Get token usage totals for a specific session.
 *
 * @param sessionId - Session ID (UUID)
 * @returns SessionTokenTotals or 404 if no usage found
 */
router.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  // Validate sessionId is provided
  if (!sessionId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'sessionId parameter is required',
    });
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const totals = await tokenUsageService.getSessionTotals(sessionId);

    if (!totals) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No token usage found for session ${sessionId}`,
      });
    }

    return res.json(totals);
  } catch (error) {
    logger.error('Failed to get session token totals', { error, sessionId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve token usage',
    });
  }
});

/**
 * GET /api/token-usage/user/:userId/monthly
 *
 * Get monthly token usage breakdown by model for a user.
 *
 * @param userId - User ID (UUID)
 * @query months - Number of months to look back (default: 12, max: 24)
 * @returns Array of MonthlyUsageByModel
 */
router.get('/user/:userId/monthly', async (req, res) => {
  const { userId } = req.params;
  const monthsParam = req.query.months;

  // Validate userId is provided
  if (!userId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'userId parameter is required',
    });
  }

  // Parse and validate months parameter
  let months = 12;
  if (monthsParam) {
    const parsed = parseInt(monthsParam as string, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 24) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'months must be a number between 1 and 24',
      });
    }
    months = parsed;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const usage = await tokenUsageService.getMonthlyUsageByModel(userId, months);

    return res.json({
      userId,
      months,
      usage,
    });
  } catch (error) {
    logger.error('Failed to get monthly token usage', { error, userId, months });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve monthly token usage',
    });
  }
});

/**
 * GET /api/token-usage/user/:userId/top-sessions
 *
 * Get top sessions by token usage for a user.
 *
 * @param userId - User ID (UUID)
 * @query limit - Number of sessions to return (default: 10, max: 50)
 * @returns Array of SessionTokenTotals ordered by total tokens descending
 */
router.get('/user/:userId/top-sessions', async (req, res) => {
  const { userId } = req.params;
  const limitParam = req.query.limit;

  // Validate userId is provided
  if (!userId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'userId parameter is required',
    });
  }

  // Parse and validate limit parameter
  let limit = 10;
  if (limitParam) {
    const parsed = parseInt(limitParam as string, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 50) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'limit must be a number between 1 and 50',
      });
    }
    limit = parsed;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const sessions = await tokenUsageService.getTopSessionsByUsage(userId, limit);

    return res.json({
      userId,
      limit,
      sessions,
    });
  } catch (error) {
    logger.error('Failed to get top sessions', { error, userId, limit });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve top sessions',
    });
  }
});

/**
 * GET /api/token-usage/user/:userId/cache-efficiency
 *
 * Get cache efficiency metrics for a user.
 * Shows how much the user is benefiting from prompt caching.
 *
 * @param userId - User ID (UUID)
 * @returns Cache efficiency metrics
 */
router.get('/user/:userId/cache-efficiency', async (req, res) => {
  const { userId } = req.params;

  // Validate userId is provided
  if (!userId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'userId parameter is required',
    });
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const efficiency = await tokenUsageService.getCacheEfficiency(userId);

    return res.json({
      userId,
      ...efficiency,
    });
  } catch (error) {
    logger.error('Failed to get cache efficiency', { error, userId });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve cache efficiency',
    });
  }
});

export default router;
