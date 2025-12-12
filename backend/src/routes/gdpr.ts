/**
 * GDPR Compliance Routes
 *
 * Endpoints for GDPR data subject requests and compliance reporting:
 * - GET /api/gdpr/deletion-audit - Get deletion history for authenticated user
 * - GET /api/gdpr/deletion-audit/stats - Get deletion statistics
 * - GET /api/gdpr/data-inventory - Get all data locations for user
 *
 * @module routes/gdpr
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createChildLogger } from '@/utils/logger';
import { authenticateMicrosoft } from '@middleware/auth-oauth';
import { getDeletionAuditService } from '@services/files/DeletionAuditService';
import { executeQuery } from '@/config/database';
import { sendError } from '@/utils/error-response';
import { ErrorCode } from '@/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'GDPRRoutes' });

/**
 * Helper to get userId from authenticated request
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
 * Query parameter schema for pagination
 */
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Query parameter schema for date range
 */
const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * GET /api/gdpr/deletion-audit
 *
 * Get deletion history for the authenticated user.
 * GDPR Article 17 - Right to Erasure audit trail.
 */
router.get('/deletion-audit', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Parse pagination params
    const pagination = paginationSchema.safeParse(req.query);
    if (!pagination.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid pagination parameters');
      return;
    }

    const { limit, offset } = pagination.data;

    logger.info({ userId, limit, offset }, 'Getting deletion audit history');

    const auditService = getDeletionAuditService();
    const records = await auditService.getDeletionHistory(userId, limit, offset);

    res.json({
      success: true,
      data: {
        records,
        pagination: {
          limit,
          offset,
          hasMore: records.length === limit,
        },
      },
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Failed to get deletion audit history');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve deletion history');
  }
});

/**
 * GET /api/gdpr/deletion-audit/stats
 *
 * Get deletion statistics for compliance reporting.
 * GDPR Article 30 - Records of Processing Activities.
 */
router.get('/deletion-audit/stats', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    // Parse date range params
    const dateRange = dateRangeSchema.safeParse(req.query);
    const startDate = dateRange.success && dateRange.data.startDate
      ? new Date(dateRange.data.startDate)
      : undefined;
    const endDate = dateRange.success && dateRange.data.endDate
      ? new Date(dateRange.data.endDate)
      : undefined;

    logger.info({ userId, startDate, endDate }, 'Getting deletion statistics');

    const auditService = getDeletionAuditService();
    const stats = await auditService.getDeletionStats(userId, startDate, endDate);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Failed to get deletion statistics');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve deletion statistics');
  }
});

/**
 * GET /api/gdpr/data-inventory
 *
 * Get complete data inventory for user - lists all data locations.
 * GDPR Article 15 - Right of Access.
 */
router.get('/data-inventory', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);

    logger.info({ userId }, 'Getting data inventory');

    // 1. Count files
    const filesResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE user_id = @userId`,
      { userId }
    );
    const totalFiles = filesResult.recordset[0]?.count ?? 0;

    // 2. Count folders
    const foldersResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE user_id = @userId AND is_folder = 1`,
      { userId }
    );
    const totalFolders = foldersResult.recordset[0]?.count ?? 0;

    // 3. Count file chunks
    const chunksResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM file_chunks WHERE user_id = @userId`,
      { userId }
    );
    const totalChunks = chunksResult.recordset[0]?.count ?? 0;

    // 4. Count sessions
    const sessionsResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions WHERE user_id = @userId`,
      { userId }
    );
    const totalSessions = sessionsResult.recordset[0]?.count ?? 0;

    // 5. Count messages
    const messagesResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages m
       INNER JOIN sessions s ON m.session_id = s.id
       WHERE s.user_id = @userId`,
      { userId }
    );
    const totalMessages = messagesResult.recordset[0]?.count ?? 0;

    // 6. Get total storage used (blob storage)
    const storageResult = await executeQuery<{ total_bytes: number }>(
      `SELECT COALESCE(SUM(size_bytes), 0) as total_bytes FROM files WHERE user_id = @userId AND is_folder = 0`,
      { userId }
    );
    const totalStorageBytes = storageResult.recordset[0]?.total_bytes ?? 0;

    // 7. Check for deletion audit records
    const auditResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM deletion_audit_log WHERE user_id = @userId`,
      { userId }
    );
    const totalDeletionRecords = auditResult.recordset[0]?.count ?? 0;

    const dataInventory = {
      userId,
      generatedAt: new Date().toISOString(),
      dataLocations: {
        database: {
          files: totalFiles - totalFolders,  // Actual files (not folders)
          folders: totalFolders,
          fileChunks: totalChunks,
          sessions: totalSessions,
          messages: totalMessages,
          deletionAuditRecords: totalDeletionRecords,
        },
        blobStorage: {
          totalFiles: totalFiles - totalFolders,
          totalBytes: totalStorageBytes,
          totalBytesFormatted: formatBytes(totalStorageBytes),
          containerPath: `users/${userId}/files/`,
        },
        aiSearch: {
          estimatedDocuments: totalChunks,  // Each chunk has a corresponding AI Search document
          indexName: 'file-chunks-index',
        },
        redisCache: {
          sessionData: totalSessions > 0,
          embeddingCache: totalChunks > 0,
          cacheKeyPattern: `embedding:*`, // SHA256 hashes, not directly tied to userId
          note: 'Embedding cache uses content hashes, expires in 7 days',
        },
      },
      summary: {
        totalRecords: totalFiles + totalChunks + totalSessions + totalMessages,
        totalStorageBytes,
        hasActiveData: totalFiles > 0 || totalSessions > 0,
      },
    };

    res.json({
      success: true,
      data: dataInventory,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Failed to get data inventory');

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retrieve data inventory');
  }
});

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default router;
