/**
 * Billing Routes
 *
 * REST API endpoints for billing management and PAYG configuration.
 *
 * Endpoints:
 * - GET /api/billing/current - Current period invoice preview
 * - GET /api/billing/history - Historical invoices
 * - GET /api/billing/invoice/:id - Specific invoice
 * - GET /api/billing/payg - Get PAYG settings
 * - POST /api/billing/payg/enable - Enable PAYG
 * - POST /api/billing/payg/disable - Disable PAYG
 * - PUT /api/billing/payg/limit - Update PAYG limit
 *
 * @module routes/billing
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateMicrosoft } from '@middleware/auth-oauth';
import { getBillingService } from '@services/billing';
import { sendError } from '@/utils/error-response';
import { ErrorCode } from '@/constants/errors';
import { createChildLogger } from '@/utils/logger';

const router = Router();
const logger = createChildLogger({ service: 'BillingRoutes' });

// ============================================
// Zod Schemas for Validation
// ============================================

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
});

const invoiceIdSchema = z.string().uuid();

const enablePaygSchema = z.object({
  spendingLimit: z.number().min(1).max(10000),
});

const updatePaygLimitSchema = z.object({
  newLimit: z.number().min(1).max(10000),
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

// ============================================
// Routes
// ============================================

/**
 * GET /api/billing/current
 * Get current billing period invoice preview
 */
router.get('/current', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Getting current period invoice preview');

    const billingService = getBillingService();
    const preview = await billingService.getCurrentPeriodPreview(userId);

    logger.info({ userId, totalCost: preview.totalCost }, 'Current period preview retrieved successfully');

    res.json(preview);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get current period preview failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get current period preview');
  }
});

/**
 * GET /api/billing/history
 * Get historical invoices for the user
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

    const { limit } = validation.data;

    logger.info({ userId, limit }, 'Getting invoice history');

    const billingService = getBillingService();
    const invoices = await billingService.getInvoiceHistory(userId, limit);

    logger.info({ userId, invoiceCount: invoices.length }, 'Invoice history retrieved successfully');

    res.json({
      invoices,
      count: invoices.length,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get invoice history failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get invoice history');
  }
});

/**
 * GET /api/billing/invoice/:id
 * Get a specific invoice by ID
 */
router.get('/invoice/:id', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate invoice ID
    const validation = invoiceIdSchema.safeParse(req.params.id);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid invoice ID format');
      return;
    }

    const invoiceId = validation.data;

    logger.info({ userId, invoiceId }, 'Getting specific invoice');

    const billingService = getBillingService();
    const invoice = await billingService.getInvoice(invoiceId, userId);

    if (!invoice) {
      sendError(res, ErrorCode.NOT_FOUND, 'Invoice not found');
      return;
    }

    logger.info({ userId, invoiceId }, 'Invoice retrieved successfully');

    res.json(invoice);
  } catch (error) {
    logger.error({ error, userId: req.userId, invoiceId: req.params.id }, 'Get invoice failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get invoice');
  }
});

/**
 * GET /api/billing/payg
 * Get Pay-As-You-Go settings for the user
 */
router.get('/payg', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Getting PAYG settings');

    const billingService = getBillingService();
    const settings = await billingService.getPaygSettings(userId);

    logger.info({ userId, enabled: settings.enabled }, 'PAYG settings retrieved successfully');

    res.json(settings);
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Get PAYG settings failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get PAYG settings');
  }
});

/**
 * POST /api/billing/payg/enable
 * Enable Pay-As-You-Go billing with a spending limit
 */
router.post('/payg/enable', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = enablePaygSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { spendingLimit } = validation.data;

    logger.info({ userId, spendingLimit }, 'Enabling PAYG');

    const billingService = getBillingService();
    await billingService.enablePayg(userId, spendingLimit);

    logger.info({ userId, spendingLimit }, 'PAYG enabled successfully');

    res.json({
      success: true,
      message: 'Pay-As-You-Go billing enabled successfully',
      spendingLimit,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Enable PAYG failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to enable PAYG');
  }
});

/**
 * POST /api/billing/payg/disable
 * Disable Pay-As-You-Go billing
 */
router.post('/payg/disable', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Disabling PAYG');

    const billingService = getBillingService();
    await billingService.disablePayg(userId);

    logger.info({ userId }, 'PAYG disabled successfully');

    res.json({
      success: true,
      message: 'Pay-As-You-Go billing disabled successfully',
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Disable PAYG failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to disable PAYG');
  }
});

/**
 * PUT /api/billing/payg/limit
 * Update Pay-As-You-Go spending limit
 */
router.put('/payg/limit', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Validate request body
    const validation = updatePaygLimitSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Invalid request body');
      return;
    }

    const { newLimit } = validation.data;

    logger.info({ userId, newLimit }, 'Updating PAYG limit');

    const billingService = getBillingService();
    await billingService.updatePaygLimit(userId, newLimit);

    logger.info({ userId, newLimit }, 'PAYG limit updated successfully');

    res.json({
      success: true,
      message: 'Pay-As-You-Go spending limit updated successfully',
      newLimit,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Update PAYG limit failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to update PAYG limit');
  }
});

export default router;
