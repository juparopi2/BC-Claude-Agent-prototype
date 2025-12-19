/**
 * Token Usage Routes
 *
 * REST API endpoints for querying token usage analytics.
 * Used for billing dashboards, usage monitoring, and cost analysis.
 *
 * Security: All endpoints require Microsoft OAuth authentication and
 * validate that users can only access their own data (multi-tenant safety).
 *
 * @module routes/token-usage
 */

import { Router, Request, Response } from 'express';
import { getTokenUsageService } from '@/services/token-usage';
import { createChildLogger } from '@/shared/utils/logger';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import {
  validateSessionOwnership,
  validateUserIdMatch,
} from '@/shared/utils/session-ownership';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';

const router = Router();
const logger = createChildLogger({ route: 'token-usage' });

/**
 * GET /api/token-usage/user/:userId
 *
 * Get token usage totals for a specific user.
 *
 * Security: Requires authentication. Users can only access their own data.
 *
 * @param userId - User ID (UUID) - must match authenticated user
 * @returns UserTokenTotals or 404 if no usage found
 */
router.get('/user/:userId', authenticateMicrosoft, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const authenticatedUserId = req.userId;

  // Validate userId is provided
  if (!userId) {
    sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'userId parameter is required');
    return;
  }

  // Multi-tenant validation: User can only access their own data
  if (!validateUserIdMatch(userId, authenticatedUserId)) {
    logger.warn('Unauthorized token usage access attempt', {
      requestedUserId: userId,
      authenticatedUserId,
      endpoint: '/user/:userId',
    });
    sendError(res, ErrorCode.OWN_DATA_ONLY);
    return;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const totals = await tokenUsageService.getUserTotals(userId);

    if (!totals) {
      sendError(res, ErrorCode.TOKEN_USAGE_NOT_FOUND);
      return;
    }

    res.json(totals);
  } catch (error) {
    logger.error('Failed to get user token totals', { error, userId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve token usage');
  }
});

/**
 * GET /api/token-usage/session/:sessionId
 *
 * Get token usage totals for a specific session.
 *
 * Security: Requires authentication. Validates user owns the session.
 *
 * @param sessionId - Session ID (UUID) - user must own this session
 * @returns SessionTokenTotals or 404 if no usage found
 */
router.get('/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const userId = req.userId;

  // Validate sessionId is provided
  if (!sessionId) {
    sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'sessionId parameter is required');
    return;
  }

  // Multi-tenant validation: User must own the session
  const ownershipResult = await validateSessionOwnership(sessionId, userId ?? '');
  if (!ownershipResult.isOwner) {
    if (ownershipResult.error === 'SESSION_NOT_FOUND') {
      sendError(res, ErrorCode.SESSION_NOT_FOUND);
      return;
    }

    logger.warn('Unauthorized session token usage access attempt', {
      sessionId,
      attemptedByUserId: userId,
      error: ownershipResult.error,
    });

    sendError(res, ErrorCode.SESSION_ACCESS_DENIED);
    return;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const totals = await tokenUsageService.getSessionTotals(sessionId);

    if (!totals) {
      sendError(res, ErrorCode.TOKEN_USAGE_NOT_FOUND);
      return;
    }

    res.json(totals);
  } catch (error) {
    logger.error('Failed to get session token totals', { error, sessionId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve token usage');
  }
});

/**
 * GET /api/token-usage/user/:userId/monthly
 *
 * Get monthly token usage breakdown by model for a user.
 *
 * Security: Requires authentication. Users can only access their own data.
 *
 * @param userId - User ID (UUID) - must match authenticated user
 * @query months - Number of months to look back (default: 12, max: 24)
 * @returns Array of MonthlyUsageByModel
 */
router.get('/user/:userId/monthly', authenticateMicrosoft, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const authenticatedUserId = req.userId;
  const monthsParam = req.query.months;

  // Validate userId is provided
  if (!userId) {
    sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'userId parameter is required');
    return;
  }

  // Multi-tenant validation: User can only access their own data
  if (!validateUserIdMatch(userId, authenticatedUserId)) {
    logger.warn('Unauthorized monthly token usage access attempt', {
      requestedUserId: userId,
      authenticatedUserId,
      endpoint: '/user/:userId/monthly',
    });
    sendError(res, ErrorCode.OWN_DATA_ONLY);
    return;
  }

  // Parse and validate months parameter
  let months = 12;
  if (monthsParam) {
    const parsed = parseInt(monthsParam as string, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 24) {
      sendError(res, ErrorCode.PARAMETER_OUT_OF_RANGE, 'months must be a number between 1 and 24', {
        field: 'months',
        min: 1,
        max: 24,
      });
      return;
    }
    months = parsed;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const usage = await tokenUsageService.getMonthlyUsageByModel(userId, months);

    res.json({
      userId,
      months,
      usage,
    });
  } catch (error) {
    logger.error('Failed to get monthly token usage', { error, userId, months });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve monthly token usage');
  }
});

/**
 * GET /api/token-usage/user/:userId/top-sessions
 *
 * Get top sessions by token usage for a user.
 *
 * Security: Requires authentication. Users can only access their own data.
 *
 * @param userId - User ID (UUID) - must match authenticated user
 * @query limit - Number of sessions to return (default: 10, max: 50)
 * @returns Array of SessionTokenTotals ordered by total tokens descending
 */
router.get('/user/:userId/top-sessions', authenticateMicrosoft, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const authenticatedUserId = req.userId;
  const limitParam = req.query.limit;

  // Validate userId is provided
  if (!userId) {
    sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'userId parameter is required');
    return;
  }

  // Multi-tenant validation: User can only access their own data
  if (!validateUserIdMatch(userId, authenticatedUserId)) {
    logger.warn('Unauthorized top-sessions access attempt', {
      requestedUserId: userId,
      authenticatedUserId,
      endpoint: '/user/:userId/top-sessions',
    });
    sendError(res, ErrorCode.OWN_DATA_ONLY);
    return;
  }

  // Parse and validate limit parameter
  let limit = 10;
  if (limitParam) {
    const parsed = parseInt(limitParam as string, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 50) {
      sendError(res, ErrorCode.PARAMETER_OUT_OF_RANGE, 'limit must be a number between 1 and 50', {
        field: 'limit',
        min: 1,
        max: 50,
      });
      return;
    }
    limit = parsed;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const sessions = await tokenUsageService.getTopSessionsByUsage(userId, limit);

    res.json({
      userId,
      limit,
      sessions,
    });
  } catch (error) {
    logger.error('Failed to get top sessions', { error, userId, limit });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve top sessions');
  }
});

/**
 * GET /api/token-usage/user/:userId/cache-efficiency
 *
 * Get cache efficiency metrics for a user.
 * Shows how much the user is benefiting from prompt caching.
 *
 * Security: Requires authentication. Users can only access their own data.
 *
 * @param userId - User ID (UUID) - must match authenticated user
 * @returns Cache efficiency metrics
 */
router.get('/user/:userId/cache-efficiency', authenticateMicrosoft, async (req: Request, res: Response) => {
  const { userId } = req.params;
  const authenticatedUserId = req.userId;

  // Validate userId is provided
  if (!userId) {
    sendError(res, ErrorCode.MISSING_REQUIRED_FIELD, 'userId parameter is required');
    return;
  }

  // Multi-tenant validation: User can only access their own data
  if (!validateUserIdMatch(userId, authenticatedUserId)) {
    logger.warn('Unauthorized cache-efficiency access attempt', {
      requestedUserId: userId,
      authenticatedUserId,
      endpoint: '/user/:userId/cache-efficiency',
    });
    sendError(res, ErrorCode.OWN_DATA_ONLY);
    return;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const efficiency = await tokenUsageService.getCacheEfficiency(userId);

    res.json({
      userId,
      ...efficiency,
    });
  } catch (error) {
    logger.error('Failed to get cache efficiency', { error, userId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve cache efficiency');
  }
});

/**
 * GET /api/token-usage/me
 *
 * Get token usage totals for the authenticated user.
 * Convenience endpoint that doesn't require userId parameter.
 *
 * Security: Requires authentication. Returns data for authenticated user only.
 *
 * @returns UserTokenTotals or 404 if no usage found
 */
router.get('/me', authenticateMicrosoft, async (req: Request, res: Response) => {
  const userId = req.userId;

  if (!userId) {
    sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
    return;
  }

  try {
    const tokenUsageService = getTokenUsageService();
    const totals = await tokenUsageService.getUserTotals(userId);

    if (!totals) {
      sendError(res, ErrorCode.TOKEN_USAGE_NOT_FOUND, 'No token usage found for your account');
      return;
    }

    res.json(totals);
  } catch (error) {
    logger.error('Failed to get user token totals (me)', { error, userId });
    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve token usage');
  }
});

export default router;
