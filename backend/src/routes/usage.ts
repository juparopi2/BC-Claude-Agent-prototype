/**
 * Usage Tracking Routes
 *
 * REST API endpoints for usage tracking and quota management.
 * Provides real-time usage data to users for billing transparency.
 *
 * Endpoints:
 * - GET /api/usage/current - Current billing period usage
 * - GET /api/usage/history - Historical usage data
 * - GET /api/usage/quotas - User's quota limits and current usage
 * - GET /api/usage/breakdown - Detailed usage breakdown by category
 *
 * Architecture:
 * - All endpoints require authentication (Microsoft OAuth)
 * - Uses QuotaValidatorService for quota data
 * - Uses parameterized SQL queries for historical data
 * - Returns JSON responses with proper error handling
 *
 * @module routes/usage
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateMicrosoft } from '@middleware/auth-oauth';
import { getQuotaValidatorService } from '@services/tracking/QuotaValidatorService';
import { sendError } from '@/utils/error-response';
import { ErrorCode } from '@/constants/errors';
import { createChildLogger } from '@/utils/logger';
import { executeQuery } from '@config/database';
import type { PeriodType } from '@/types/usage.types';

const router = Router();
const logger = createChildLogger({ service: 'UsageRoutes' });

// ============================================
// Zod Schemas for Validation
// ============================================

const historyQuerySchema = z.object({
  period: z.enum(['monthly', 'daily', 'weekly']).optional().default('monthly'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
});

const breakdownQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM format
});

// ============================================
// Helper Functions
// ============================================

/**
 * Extract userId from authenticated request
 *
 * @param req - Express request with auth
 * @returns User ID
 * @throws Error if not authenticated
 */
function getUserId(req: Request): string {
  if (!req.userId) {
    throw new Error('User not authenticated');
  }
  return req.userId;
}

/**
 * Calculate current billing period dates
 *
 * @returns Object with period start and end dates
 */
function getCurrentBillingPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  // Start: First day of current month at 00:00:00 UTC
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  // End: Last day of current month at 23:59:59 UTC
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  return { start, end };
}

/**
 * Calculate billing period dates for a specific month
 *
 * @param monthStr - Month string in YYYY-MM format
 * @returns Object with period start and end dates
 */
function getBillingPeriodForMonth(monthStr: string): { start: Date; end: Date } {
  const [yearStr, monthStr2] = monthStr.split('-');
  const year = parseInt(yearStr ?? '0', 10);
  const month = parseInt(monthStr2 ?? '0', 10) - 1; // Month is 0-indexed

  // Start: First day of specified month at 00:00:00 UTC
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  // End: Last day of specified month at 23:59:59 UTC
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  return { start, end };
}

// ============================================
// Routes
// ============================================

/**
 * GET /api/usage/current
 * Get current billing period usage with quota status
 */
router.get('/current', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Getting current usage');

    const quotaValidator = getQuotaValidatorService();

    // Get current period dates
    const period = getCurrentBillingPeriod();

    // Get quota limits and current usage
    const quotaLimits = await quotaValidator.getQuotaLimits(userId);

    if (!quotaLimits) {
      sendError(res, ErrorCode.NOT_FOUND, 'User quota record not found');
      return;
    }

    // Get current usage for each quota type
    const tokenUsage = await quotaValidator.getCurrentUsage(userId, 'tokens');
    const apiCallUsage = await quotaValidator.getCurrentUsage(userId, 'api_calls');
    const storageUsage = await quotaValidator.getCurrentUsage(userId, 'storage');

    // Calculate percentages
    const tokenPercentage = quotaLimits.monthly_token_limit > 0
      ? Math.round((tokenUsage / quotaLimits.monthly_token_limit) * 100)
      : 0;

    const apiCallPercentage = quotaLimits.monthly_api_call_limit > 0
      ? Math.round((apiCallUsage / quotaLimits.monthly_api_call_limit) * 100)
      : 0;

    const storagePercentage = quotaLimits.storage_limit_bytes > 0
      ? Math.round((storageUsage / quotaLimits.storage_limit_bytes) * 100)
      : 0;

    // Query costs from usage_events for current period
    const costQuery = `
      SELECT
        SUM(CASE WHEN category = 'ai' THEN cost ELSE 0 END) as ai_cost,
        SUM(CASE WHEN category = 'storage' THEN cost ELSE 0 END) as storage_cost,
        SUM(cost) as total_cost
      FROM usage_events
      WHERE user_id = @userId
        AND created_at >= @periodStart
        AND created_at < @periodEnd
    `;

    const costResult = await executeQuery<{
      ai_cost: number;
      storage_cost: number;
      total_cost: number;
    }>(costQuery, {
      userId,
      periodStart: period.start,
      periodEnd: period.end,
    });

    const costs = costResult.recordset?.[0] ?? {
      ai_cost: 0,
      storage_cost: 0,
      total_cost: 0,
    };

    logger.info({ userId }, 'Current usage retrieved successfully');

    res.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      quotas: {
        tokens: {
          used: tokenUsage,
          limit: quotaLimits.monthly_token_limit,
          percentage: tokenPercentage,
          unit: 'tokens',
        },
        api_calls: {
          used: apiCallUsage,
          limit: quotaLimits.monthly_api_call_limit,
          percentage: apiCallPercentage,
          unit: 'calls',
        },
        storage: {
          used: storageUsage,
          limit: quotaLimits.storage_limit_bytes,
          percentage: storagePercentage,
          unit: 'bytes',
        },
      },
      costs: {
        ai: costs.ai_cost,
        storage: costs.storage_cost,
        total: costs.total_cost,
      },
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get current usage failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get current usage');
  }
});

/**
 * GET /api/usage/history
 * Get historical usage data (aggregated by period)
 */
router.get('/history', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate query params
    const validation = historyQuerySchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { period, limit } = validation.data;

    logger.info({ userId, period, limit }, 'Getting usage history');

    // Query usage_aggregates table
    const query = `
      SELECT TOP (@limit)
        period_start,
        period_end,
        total_tokens,
        total_api_calls,
        total_cost
      FROM (
        SELECT
          period_start,
          DATEADD(
            ${period === 'monthly' ? 'MONTH' : period === 'weekly' ? 'WEEK' : 'DAY'},
            1,
            period_start
          ) as period_end,
          total_tokens,
          total_api_calls,
          total_cost
        FROM usage_aggregates
        WHERE user_id = @userId
          AND period_type = @periodType
      ) AS aggregates
      ORDER BY period_start DESC
    `;

    const result = await executeQuery<{
      period_start: Date;
      period_end: Date;
      total_tokens: number;
      total_api_calls: number;
      total_cost: number;
    }>(query, {
      userId,
      periodType: period as PeriodType,
      limit,
    });

    const data = (result.recordset || []).map((row) => ({
      periodStart: row.period_start.toISOString(),
      periodEnd: row.period_end.toISOString(),
      totalTokens: row.total_tokens,
      totalApiCalls: row.total_api_calls,
      totalCost: row.total_cost,
    }));

    logger.info({ userId, period, recordCount: data.length }, 'Usage history retrieved successfully');

    res.json({
      period,
      data,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get usage history failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get usage history');
  }
});

/**
 * GET /api/usage/quotas
 * Get user's quota configuration with current usage
 */
router.get('/quotas', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Getting user quotas');

    const quotaValidator = getQuotaValidatorService();

    // Get quota limits
    const quotaLimits = await quotaValidator.getQuotaLimits(userId);

    if (!quotaLimits) {
      sendError(res, ErrorCode.NOT_FOUND, 'User quota record not found');
      return;
    }

    // Get current usage for each quota type
    const tokenUsage = await quotaValidator.getCurrentUsage(userId, 'tokens');
    const apiCallUsage = await quotaValidator.getCurrentUsage(userId, 'api_calls');
    const storageUsage = await quotaValidator.getCurrentUsage(userId, 'storage');

    // Calculate remaining and percent used for each quota
    const tokenRemaining = Math.max(0, quotaLimits.monthly_token_limit - tokenUsage);
    const tokenPercentUsed = quotaLimits.monthly_token_limit > 0
      ? Math.round((tokenUsage / quotaLimits.monthly_token_limit) * 100)
      : 0;

    const apiCallRemaining = Math.max(0, quotaLimits.monthly_api_call_limit - apiCallUsage);
    const apiCallPercentUsed = quotaLimits.monthly_api_call_limit > 0
      ? Math.round((apiCallUsage / quotaLimits.monthly_api_call_limit) * 100)
      : 0;

    const storageRemaining = Math.max(0, quotaLimits.storage_limit_bytes - storageUsage);
    const storagePercentUsed = quotaLimits.storage_limit_bytes > 0
      ? Math.round((storageUsage / quotaLimits.storage_limit_bytes) * 100)
      : 0;

    logger.info({ userId }, 'User quotas retrieved successfully');

    res.json({
      userId,
      planTier: quotaLimits.plan_tier,
      quotas: {
        tokens: {
          limit: quotaLimits.monthly_token_limit,
          used: tokenUsage,
          remaining: tokenRemaining,
          percentUsed: tokenPercentUsed,
        },
        api_calls: {
          limit: quotaLimits.monthly_api_call_limit,
          used: apiCallUsage,
          remaining: apiCallRemaining,
          percentUsed: apiCallPercentUsed,
        },
        storage: {
          limit: quotaLimits.storage_limit_bytes,
          used: storageUsage,
          remaining: storageRemaining,
          percentUsed: storagePercentUsed,
        },
      },
      paygEnabled: quotaLimits.allow_overage,
      quotaResetAt: quotaLimits.quota_reset_at.toISOString(),
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get user quotas failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get user quotas');
  }
});

/**
 * GET /api/usage/breakdown
 * Get detailed usage breakdown by category for a specific month
 */
router.get('/breakdown', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate query params
    const validation = breakdownQuerySchema.safeParse(req.query);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid query parameters');
      return;
    }

    const { month } = validation.data;

    // Calculate period dates (default to current month if not specified)
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const targetMonth = month || currentMonth;
    const period = getBillingPeriodForMonth(targetMonth);

    logger.info({ userId, month: targetMonth }, 'Getting usage breakdown');

    // Query usage_events for detailed breakdown
    const query = `
      SELECT
        category,
        SUM(CASE WHEN event_type = 'claude_input_tokens' THEN quantity ELSE 0 END) as input_tokens,
        SUM(CASE WHEN event_type = 'claude_output_tokens' THEN quantity ELSE 0 END) as output_tokens,
        SUM(CASE WHEN event_type = 'cache_read_tokens' THEN quantity ELSE 0 END) as cache_read,
        SUM(CASE WHEN event_type = 'cache_write_tokens' THEN quantity ELSE 0 END) as cache_write,
        SUM(CASE WHEN category = 'storage' AND event_type = 'file_upload' THEN quantity ELSE 0 END) as bytes_uploaded,
        SUM(CASE WHEN category = 'storage' THEN quantity ELSE 0 END) as bytes_stored,
        SUM(CASE WHEN category = 'processing' THEN 1 ELSE 0 END) as documents_processed,
        SUM(cost) as total_cost
      FROM usage_events
      WHERE user_id = @userId
        AND created_at >= @periodStart
        AND created_at < @periodEnd
      GROUP BY category
    `;

    const result = await executeQuery<{
      category: string;
      input_tokens: number;
      output_tokens: number;
      cache_read: number;
      cache_write: number;
      bytes_uploaded: number;
      bytes_stored: number;
      documents_processed: number;
      total_cost: number;
    }>(query, {
      userId,
      periodStart: period.start,
      periodEnd: period.end,
    });

    // Initialize breakdown structure
    const breakdown = {
      ai: {
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
      },
      storage: {
        bytesUploaded: 0,
        bytesStored: 0,
        cost: 0,
      },
      processing: {
        documentsProcessed: 0,
        cost: 0,
      },
    };

    let totalCost = 0;

    // Populate breakdown from query results
    (result.recordset || []).forEach((row) => {
      if (row.category === 'ai') {
        breakdown.ai.inputTokens = row.input_tokens;
        breakdown.ai.outputTokens = row.output_tokens;
        breakdown.ai.cacheRead = row.cache_read;
        breakdown.ai.cacheWrite = row.cache_write;
        breakdown.ai.cost = row.total_cost;
      } else if (row.category === 'storage') {
        breakdown.storage.bytesUploaded = row.bytes_uploaded;
        breakdown.storage.bytesStored = row.bytes_stored;
        breakdown.storage.cost = row.total_cost;
      } else if (row.category === 'processing') {
        breakdown.processing.documentsProcessed = row.documents_processed;
        breakdown.processing.cost = row.total_cost;
      }

      totalCost += row.total_cost;
    });

    logger.info({ userId, month: targetMonth, totalCost }, 'Usage breakdown retrieved successfully');

    res.json({
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        month: targetMonth,
      },
      breakdown,
      totalCost,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get usage breakdown failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get usage breakdown');
  }
});

/**
 * POST /api/usage/feedback
 * Submit user feedback to extend free trial
 *
 * Allows free_trial users to submit feedback in exchange for 1 month trial extension.
 * Each user can only extend trial ONCE.
 */
router.post('/feedback', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate feedback body
    const feedbackSchema = z.object({
      whatTheyLike: z.string().min(10).max(5000).optional(),
      improvementOpportunities: z.string().min(10).max(5000).optional(),
      neededFeatures: z.string().min(10).max(5000).optional(),
      additionalComments: z.string().min(10).max(5000).optional(),
    }).refine(
      (data) => {
        // At least one field must be filled
        return (
          data.whatTheyLike ||
          data.improvementOpportunities ||
          data.neededFeatures ||
          data.additionalComments
        );
      },
      { message: 'At least one feedback field is required' }
    );

    const validation = feedbackSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid feedback');
      return;
    }

    const feedback = validation.data;

    logger.info({ userId }, 'Processing feedback submission');

    // Get user's quota record to verify free_trial status
    const quotaValidator = getQuotaValidatorService();
    const quotaLimits = await quotaValidator.getQuotaLimits(userId);

    if (!quotaLimits) {
      sendError(res, ErrorCode.NOT_FOUND, 'User quota record not found');
      return;
    }

    // Verify user is on free_trial plan
    if (quotaLimits.plan_tier !== 'free_trial') {
      sendError(res, ErrorCode.BAD_REQUEST, 'Trial extension is only available for free_trial users');
      return;
    }

    // Check if trial has already been extended
    if (quotaLimits.trial_extended === 1) {
      sendError(res, ErrorCode.BAD_REQUEST, 'Trial has already been extended. Only one extension is allowed.');
      return;
    }

    // Insert feedback record
    const insertFeedbackQuery = `
      INSERT INTO user_feedback (
        user_id,
        what_they_like,
        improvement_opportunities,
        needed_features,
        additional_comments,
        feedback_source,
        trial_extended
      )
      VALUES (
        @userId,
        @whatTheyLike,
        @improvementOpportunities,
        @neededFeatures,
        @additionalComments,
        'trial_extension',
        1
      )
    `;

    await executeQuery(insertFeedbackQuery, {
      userId,
      whatTheyLike: feedback.whatTheyLike ?? null,
      improvementOpportunities: feedback.improvementOpportunities ?? null,
      neededFeatures: feedback.neededFeatures ?? null,
      additionalComments: feedback.additionalComments ?? null,
    });

    // Extend trial by 30 days and mark as extended
    const extendTrialQuery = `
      UPDATE user_quotas
      SET
        trial_expires_at = DATEADD(DAY, 30, trial_expires_at),
        trial_extended = 1,
        updated_at = GETUTCDATE()
      WHERE user_id = @userId
        AND plan_tier = 'free_trial'
        AND trial_extended = 0
    `;

    const updateResult = await executeQuery(extendTrialQuery, { userId });

    if (updateResult.rowsAffected && updateResult.rowsAffected[0] === 0) {
      sendError(res, ErrorCode.BAD_REQUEST, 'Trial extension failed. Trial may have already been extended.');
      return;
    }

    // Get updated expiration date
    const getExpiryQuery = `
      SELECT trial_expires_at
      FROM user_quotas
      WHERE user_id = @userId
    `;

    const expiryResult = await executeQuery<{ trial_expires_at: Date }>(getExpiryQuery, { userId });
    const newExpiryDate = expiryResult.recordset?.[0]?.trial_expires_at;

    logger.info({ userId, newExpiryDate }, 'Trial extended successfully');

    res.json({
      success: true,
      message: 'Thank you for your feedback! Your trial has been extended by 30 days.',
      newExpiryDate: newExpiryDate?.toISOString(),
    });

  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Feedback submission failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to submit feedback');
  }
});

export default router;
