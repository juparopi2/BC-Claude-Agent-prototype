/**
 * Admin Routes
 *
 * Administrative endpoints for system maintenance tasks.
 * These endpoints require authentication and should be restricted
 * to admin users in production.
 *
 * Endpoints:
 * - POST /api/admin/jobs/orphan-cleanup - Execute orphan cleanup job
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getOrphanCleanupJob } from '@/jobs/OrphanCleanupJob';
import { sendError, sendInternalError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'AdminRoutes' });
const router = Router();

// ============================================
// Zod Schemas for Validation
// ============================================

const orphanCleanupSchema = z.object({
  userId: z.string().uuid().optional(),
  dryRun: z
    .string()
    .transform((val) => val === 'true')
    .optional()
    .default('false'),
});

// ============================================
// Admin Middleware
// ============================================

/**
 * Simple admin check middleware
 *
 * NOTE: In production, this should check for admin role in database
 * or use a separate admin authentication system.
 * For now, it just ensures the user is authenticated.
 */
async function requireAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  // For now, just ensure user is authenticated
  // TODO: Add proper admin role check in production
  if (!req.userId) {
    sendError(res, ErrorCode.FORBIDDEN, 'Admin access required');
    return;
  }
  next();
}

// ============================================
// Routes
// ============================================

/**
 * POST /api/admin/jobs/orphan-cleanup
 *
 * Execute orphan cleanup job to remove orphaned documents from Azure AI Search.
 *
 * Query params:
 * - userId (optional): Run cleanup for specific user only
 * - dryRun (optional): If 'true', report orphans without deleting
 *
 * Response:
 * - success: boolean
 * - summary: CleanupJobSummary | OrphanCleanupResult
 *
 * @example
 * ```bash
 * # Full cleanup for all users
 * curl -X POST http://localhost:3002/api/admin/jobs/orphan-cleanup
 *
 * # Cleanup for specific user
 * curl -X POST "http://localhost:3002/api/admin/jobs/orphan-cleanup?userId=abc123"
 *
 * # Dry run (report only)
 * curl -X POST "http://localhost:3002/api/admin/jobs/orphan-cleanup?dryRun=true"
 * ```
 */
router.post(
  '/jobs/orphan-cleanup',
  authenticateMicrosoft,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      // Validate query params
      const parseResult = orphanCleanupSchema.safeParse(req.query);

      if (!parseResult.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid query parameters', {
          details: parseResult.error.flatten().fieldErrors,
        });
        return;
      }

      const { userId, dryRun } = parseResult.data;

      logger.info(
        { adminUserId: req.userId, targetUserId: userId, dryRun },
        'Orphan cleanup job initiated'
      );

      const job = getOrphanCleanupJob();

      // Run cleanup
      if (userId) {
        // Single user cleanup
        const result = await job.cleanOrphansForUser(userId);

        logger.info(
          {
            adminUserId: req.userId,
            targetUserId: userId,
            orphansFound: result.totalOrphans,
            deleted: result.deletedOrphans,
            failed: result.failedDeletions,
            durationMs: result.durationMs,
          },
          'Single user orphan cleanup completed'
        );

        res.json({
          success: true,
          summary: result,
          dryRun,
        });
      } else {
        // Full cleanup for all users
        const summary = await job.runFullCleanup();

        logger.info(
          {
            adminUserId: req.userId,
            totalUsers: summary.totalUsers,
            totalOrphans: summary.totalOrphans,
            totalDeleted: summary.totalDeleted,
            totalFailed: summary.totalFailed,
            durationMs: summary.completedAt.getTime() - summary.startedAt.getTime(),
          },
          'Full orphan cleanup completed'
        );

        res.json({
          success: true,
          summary,
          dryRun,
        });
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
          adminUserId: req.userId,
        },
        'Orphan cleanup job failed'
      );

      sendInternalError(res, 'Orphan cleanup job failed');
    }
  }
);

export default router;
