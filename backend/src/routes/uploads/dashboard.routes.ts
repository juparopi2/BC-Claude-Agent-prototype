/**
 * Upload Dashboard Routes (PRD-05)
 *
 * API endpoints for observability and error recovery of the upload pipeline.
 *
 * Endpoints:
 * - GET  /                   — Dashboard overview (status distribution, stuck count, queue depths)
 * - GET  /stuck              — List stuck files with details
 * - GET  /orphans            — Orphan report (abandoned uploads, old failures count)
 * - POST /stuck/:fileId/retry — Manual retry single stuck file
 * - POST /stuck/retry-all    — Bulk retry all stuck files
 *
 * All endpoints require authentication and enforce user_id isolation.
 *
 * @module routes/uploads/dashboard
 */

import { Router } from 'express';
import { createChildLogger } from '@/shared/utils/logger';
import { PIPELINE_STATUS } from '@bc-agent/shared';
import type {
  UploadDashboard,
  StuckFilesResponse,
  OrphanReport,
  RetryResponse,
  BulkRetryResponse,
} from '@bc-agent/shared';

const logger = createChildLogger({ service: 'DashboardRoutes' });
const router = Router();

const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * GET /api/uploads/dashboard
 * Dashboard overview with status distribution, stuck count, and queue depths.
 */
router.get('/', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;

    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

    const [statusDistribution, stuckFiles] = await Promise.all([
      repo.getStatusDistribution(),
      repo.findStuckFiles(STUCK_THRESHOLD_MS, userId),
    ]);

    // Get queue depths for pipeline queues
    const queueDepths: Record<string, { waiting: number; active: number; failed: number; delayed: number }> = {};
    try {
      const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
      const { QueueName } = await import('@/infrastructure/queue/constants');
      const mq = getMessageQueue();

      const v2Queues = [
        QueueName.FILE_EXTRACT,
        QueueName.FILE_CHUNK,
        QueueName.FILE_EMBED,
        QueueName.FILE_PIPELINE_COMPLETE,
        QueueName.DLQ,
        QueueName.FILE_MAINTENANCE,
      ];

      for (const queueName of v2Queues) {
        try {
          const stats = await mq.getQueueStats(queueName);
          queueDepths[queueName] = {
            waiting: stats.waiting,
            active: stats.active,
            failed: stats.failed,
            delayed: stats.delayed,
          };
        } catch {
          // Queue may not be initialized yet
        }
      }
    } catch {
      // MessageQueue may not be initialized
    }

    // Count 24h metrics from DB
    const { prisma } = await import('@/infrastructure/database/prisma');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const last24hCounts = await prisma.files.groupBy({
      by: ['pipeline_status'],
      _count: { id: true },
      where: {
        user_id: userId,
        pipeline_status: { in: [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED] },
        updated_at: { gte: oneDayAgo },
        deletion_status: null,
      },
    });

    const last24h = { uploaded: 0, completed: 0, failed: 0 };
    for (const group of last24hCounts) {
      if (group.pipeline_status === PIPELINE_STATUS.UPLOADED) last24h.uploaded = group._count.id;
      if (group.pipeline_status === PIPELINE_STATUS.READY) last24h.completed = group._count.id;
      if (group.pipeline_status === PIPELINE_STATUS.FAILED) last24h.failed = group._count.id;
    }

    const dashboard: UploadDashboard = {
      statusDistribution,
      stuckCount: stuckFiles.length,
      queueDepths,
      last24h,
    };

    res.json(dashboard);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to get dashboard overview');
    res.status(500).json({ error: 'Failed to get dashboard overview' });
  }
});

/**
 * GET /api/uploads/dashboard/stuck
 * List stuck files with details.
 */
router.get('/stuck', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;

    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const repo = getFileRepository();

    const stuckFiles = await repo.findStuckFiles(STUCK_THRESHOLD_MS, userId);
    const now = Date.now();

    const response: StuckFilesResponse = {
      files: stuckFiles.map((f) => ({
        fileId: f.id.toUpperCase(),
        userId: f.user_id.toUpperCase(),
        name: f.name,
        pipelineStatus: f.pipeline_status,
        stuckSinceMs: f.updated_at ? now - new Date(f.updated_at).getTime() : 0,
        pipelineRetryCount: f.pipeline_retry_count,
        updatedAt: f.updated_at ? new Date(f.updated_at).toISOString() : '',
        createdAt: f.created_at ? new Date(f.created_at).toISOString() : '',
      })),
      total: stuckFiles.length,
    };

    res.json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to list stuck files');
    res.status(500).json({ error: 'Failed to list stuck files' });
  }
});

/**
 * GET /api/uploads/dashboard/orphans
 * Orphan report: abandoned uploads count, old failures count.
 */
router.get('/orphans', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;

    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const { prisma } = await import('@/infrastructure/database/prisma');
    const repo = getFileRepository();

    const abandonedThresholdMs = 24 * 60 * 60 * 1000; // 24 hours
    const failRetentionDays = 30;
    const failCutoff = new Date(Date.now() - failRetentionDays * 24 * 60 * 60 * 1000);

    const [abandonedFiles, oldFailuresCount] = await Promise.all([
      repo.findAbandonedFiles(abandonedThresholdMs, userId),
      prisma.files.count({
        where: {
          user_id: userId,
          pipeline_status: PIPELINE_STATUS.FAILED,
          deletion_status: null,
          updated_at: { lt: failCutoff },
        },
      }),
    ]);

    const report: OrphanReport = {
      abandonedUploads: abandonedFiles.length,
      oldFailures: oldFailuresCount,
      lastScanAt: null, // Populated after first scheduled scan runs
    };

    res.json(report);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to get orphan report');
    res.status(500).json({ error: 'Failed to get orphan report' });
  }
});

/**
 * POST /api/uploads/dashboard/stuck/:fileId/retry
 * Manual retry a single stuck file.
 */
router.post('/stuck/:fileId/retry', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const { fileId } = req.params;

    if (!fileId) {
      res.status(400).json({ error: 'fileId is required' });
      return;
    }

    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const { prisma } = await import('@/infrastructure/database/prisma');
    const repo = getFileRepository();

    // Read file to verify ownership and get current status
    const file = await prisma.files.findFirst({
      where: { id: fileId, user_id: userId, deletion_status: null },
      select: {
        id: true,
        name: true,
        mime_type: true,
        blob_path: true,
        batch_id: true,
        pipeline_status: true,
      },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Transition to failed first, then to queued
    const currentStatus = file.pipeline_status;
    if (currentStatus && currentStatus !== PIPELINE_STATUS.FAILED) {
      const failResult = await repo.forceStatus(fileId, userId, PIPELINE_STATUS.FAILED);
      if (!failResult.success) {
        const response: RetryResponse = { fileId, success: false, error: failResult.error };
        res.status(409).json(response);
        return;
      }
    }

    // Transition failed → queued
    const queueResult = await repo.transitionStatusWithRetry(
      fileId, userId,
      PIPELINE_STATUS.FAILED,
      PIPELINE_STATUS.QUEUED,
      1,
    );

    if (!queueResult.success) {
      const response: RetryResponse = { fileId, success: false, error: queueResult.error };
      res.status(409).json(response);
      return;
    }

    // Create new processing flow
    const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
    const mq = getMessageQueue();
    await mq.addFileProcessingFlow({
      fileId,
      userId,
      batchId: (file.batch_id ?? '').toUpperCase(),
      mimeType: file.mime_type,
      blobPath: file.blob_path ?? undefined,
      fileName: file.name,
    });

    logger.info({ fileId, userId }, 'Manual retry initiated for stuck file');
    const response: RetryResponse = { fileId, success: true };
    res.json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to retry stuck file');
    res.status(500).json({ error: 'Failed to retry stuck file' });
  }
});

/**
 * POST /api/uploads/dashboard/stuck/retry-all
 * Bulk retry all stuck files for the authenticated user.
 */
router.post('/stuck/retry-all', async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;

    const { getFileRepository } = await import(
      '@/services/files/repository/FileRepository'
    );
    const { prisma } = await import('@/infrastructure/database/prisma');
    const repo = getFileRepository();

    const stuckFiles = await repo.findStuckFiles(STUCK_THRESHOLD_MS, userId);

    const response: BulkRetryResponse = { retried: 0, failed: 0, errors: [] };

    for (const file of stuckFiles) {
      try {
        // Force to failed, then queue
        await repo.forceStatus(file.id, file.user_id, PIPELINE_STATUS.FAILED);
        const queueResult = await repo.transitionStatusWithRetry(
          file.id, file.user_id,
          PIPELINE_STATUS.FAILED,
          PIPELINE_STATUS.QUEUED,
          1,
        );

        if (!queueResult.success) {
          response.failed++;
          response.errors.push({ fileId: file.id, error: queueResult.error ?? 'Transition failed' });
          continue;
        }

        // Read file details for the flow
        const fileDetails = await prisma.files.findFirst({
          where: { id: file.id, user_id: file.user_id },
          select: { mime_type: true, blob_path: true, batch_id: true, name: true },
        });

        if (!fileDetails) {
          response.failed++;
          response.errors.push({ fileId: file.id, error: 'File not found' });
          continue;
        }

        const { getMessageQueue } = await import('@/infrastructure/queue/MessageQueue');
        const mq = getMessageQueue();
        await mq.addFileProcessingFlow({
          fileId: file.id,
          userId: file.user_id,
          batchId: (fileDetails.batch_id ?? '').toUpperCase(),
          mimeType: fileDetails.mime_type,
          blobPath: fileDetails.blob_path ?? undefined,
          fileName: fileDetails.name,
        });

        response.retried++;
      } catch (error) {
        response.failed++;
        response.errors.push({
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info({ userId, retried: response.retried, failed: response.failed }, 'Bulk retry completed');
    res.json(response);
  } catch (error) {
    const errorInfo = error instanceof Error
      ? { message: error.message, name: error.name }
      : { value: String(error) };
    logger.error({ error: errorInfo }, 'Failed to bulk retry stuck files');
    res.status(500).json({ error: 'Failed to bulk retry stuck files' });
  }
});

export default router;
