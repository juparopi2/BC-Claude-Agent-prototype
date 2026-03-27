/**
 * Sync Health Routes (PRD-300)
 *
 * REST API endpoints for sync health monitoring and recovery operations.
 *
 * Endpoints:
 * - POST /api/sync/health/recover → trigger a recovery action
 *
 * @module routes/sync-health
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import {
  getSyncRecoveryService,
  getSyncHealthCheckService,
  getSyncReconciliationService,
  ReconciliationCooldownError,
  ReconciliationInProgressError,
} from '@/services/sync/health';
import { prisma } from '@/infrastructure/database/prisma';
import { getSocketIO, isSocketServiceInitialized } from '@/services/websocket/SocketService';
import { SYNC_WS_EVENTS } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'SyncHealthRoutes' });
const router = Router();

/**
 * GET /api/sync/health
 * Returns a health report for the authenticated user's sync scopes.
 */
router.get(
  '/health',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const service = getSyncHealthCheckService();
      const report = await service.getHealthForUser(userId);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sync/health/recover
 * Trigger a recovery action for stuck or errored sync scopes/files.
 *
 * Body:
 *   action   - One of: reset_stuck | retry_errors | retry_files | full_recovery
 *   scopeId  - (Optional) Scope to target; required when action === 'retry_files'
 */
router.post(
  '/health/recover',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { action, scopeId } = req.body as { action?: string; scopeId?: string };

      // Validate action
      const validActions = ['reset_stuck', 'retry_errors', 'retry_files', 'full_recovery'];
      if (!action || !validActions.includes(action)) {
        res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
        return;
      }

      // retry_files requires scopeId
      if (action === 'retry_files' && !scopeId) {
        res.status(400).json({ error: 'scopeId is required for retry_files action' });
        return;
      }

      // Scope ownership validation (multi-tenant isolation)
      if (scopeId) {
        const scope = await prisma.connection_scopes.findFirst({
          where: { id: scopeId },
          include: { connections: { select: { user_id: true } } },
        });

        if (!scope || scope.connections.user_id.toUpperCase() !== userId.toUpperCase()) {
          res.status(403).json({ error: 'Scope not found or not owned by user' });
          return;
        }
      }

      const service = getSyncRecoveryService();
      let result;

      switch (action) {
        case 'reset_stuck':
          result = await service.resetStuckScopes(scopeId ? [scopeId] : undefined);
          break;
        case 'retry_errors':
          result = await service.retryErrorScopes(scopeId ? [scopeId] : undefined, userId);
          break;
        case 'retry_files':
          result = await service.retryFailedFiles(scopeId!, userId);
          break;
        case 'full_recovery':
          result = await service.runFullRecovery(userId);
          break;
      }

      logger.info({ userId, action, scopeId, result }, 'Recovery action completed');

      // Notify the user via WebSocket
      if (isSocketServiceInitialized()) {
        getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.SYNC_RECOVERY_COMPLETED, {
          userId,
          action,
          result,
        });
      }

      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sync/health/reconcile
 * On-demand per-user file health reconciliation.
 *
 * Diagnoses 7 drift conditions between DB and AI Search, then repairs them.
 * Rate-limited to once per 5 minutes per user (Redis cooldown).
 *
 * Body:
 *   trigger - (Optional) 'login' | 'manual' — for logging/analytics. Defaults to 'manual'.
 */
router.post(
  '/health/reconcile',
  authenticateMicrosoft,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { trigger = 'manual' } = req.body as { trigger?: 'login' | 'manual' };

      logger.info({ userId, trigger }, 'On-demand reconciliation requested');

      const service = getSyncReconciliationService();
      const report = await service.reconcileUserOnDemand(userId);

      // Notify the user via WebSocket
      if (isSocketServiceInitialized()) {
        getSocketIO().to(`user:${userId}`).emit(SYNC_WS_EVENTS.SYNC_RECONCILIATION_COMPLETED, {
          userId,
          triggeredBy: trigger,
          report: {
            dryRun: report.dryRun,
            dbReadyFiles: report.dbReadyFiles,
            searchIndexedFiles: report.searchIndexedFiles,
            missingFromSearchCount: report.missingFromSearch.length,
            orphanedInSearchCount: report.orphanedInSearch.length,
            failedRetriableCount: report.failedRetriable.length,
            stuckFilesCount: report.stuckFiles.length,
            imagesMissingEmbeddingsCount: report.imagesMissingEmbeddings.length,
            disconnectedConnectionFilesCount: report.disconnectedConnectionFiles.length,
            folderHierarchy: {
              orphanedChildrenCount: report.folderHierarchyIssues.orphanedChildren.length,
              missingScopeRootsCount: report.folderHierarchyIssues.missingScopeRoots.length,
              scopesToResyncCount: report.folderHierarchyIssues.scopeIdsToResync.length,
            },
            repairs: report.repairs,
          },
        });
      }

      res.json({
        success: true,
        report: {
          dryRun: report.dryRun,
          dbReadyFiles: report.dbReadyFiles,
          searchIndexedFiles: report.searchIndexedFiles,
          missingFromSearchCount: report.missingFromSearch.length,
          orphanedInSearchCount: report.orphanedInSearch.length,
          failedRetriableCount: report.failedRetriable.length,
          stuckFilesCount: report.stuckFiles.length,
          imagesMissingEmbeddingsCount: report.imagesMissingEmbeddings.length,
          folderHierarchy: {
            orphanedChildrenCount: report.folderHierarchyIssues.orphanedChildren.length,
            missingScopeRootsCount: report.folderHierarchyIssues.missingScopeRoots.length,
            scopesToResyncCount: report.folderHierarchyIssues.scopeIdsToResync.length,
          },
          repairs: report.repairs,
        },
      });
    } catch (error) {
      if (error instanceof ReconciliationCooldownError) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Reconciliation recently ran',
          code: 'RECONCILIATION_COOLDOWN',
          details: { retryAfterSeconds: error.retryAfterSeconds },
        });
        return;
      }
      if (error instanceof ReconciliationInProgressError) {
        res.status(409).json({
          error: 'Conflict',
          message: 'Reconciliation already in progress',
          code: 'RECONCILIATION_IN_PROGRESS',
        });
        return;
      }
      next(error);
    }
  }
);

export default router;
