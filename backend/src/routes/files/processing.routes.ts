/**
 * Processing Routes
 *
 * Handles file processing retry endpoints.
 *
 * @module routes/files/processing.routes
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { fileIdSchema, retryProcessingSchema } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileProcessingRoutes' });
const router = Router();

/**
 * POST /api/files/:id/retry-processing
 *
 * Retry processing for a failed file.
 *
 * Body:
 * - scope: 'full' (re-process from start) or 'embedding_only' (only re-do embeddings)
 *
 * Responses:
 * - 200: Retry initiated successfully
 * - 400: File is not in failed state
 * - 404: File not found
 * - 429: Rate limit exceeded
 */
router.post(
  '/:id/retry-processing',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);

      // Validate file ID
      const paramsValidation = fileIdSchema.safeParse(req.params);
      if (!paramsValidation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          paramsValidation.error.errors[0]?.message || 'Invalid file ID'
        );
        return;
      }

      const { id } = paramsValidation.data;

      // Validate body
      const bodyValidation = retryProcessingSchema.safeParse(req.body);
      if (!bodyValidation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          bodyValidation.error.errors[0]?.message || 'Invalid request body'
        );
        return;
      }

      const { scope } = bodyValidation.data;

      logger.info({ userId, fileId: id, scope }, 'Processing retry request');

      // Execute retry using ProcessingRetryManager
      const { getProcessingRetryManager } = await import('@/domains/files/retry');
      const retryManager = getProcessingRetryManager();

      const result = await retryManager.executeManualRetry(userId, id, scope);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          sendError(res, ErrorCode.NOT_FOUND, result.error);
          return;
        }
        if (result.error?.includes('not in failed state')) {
          sendError(res, ErrorCode.VALIDATION_ERROR, result.error);
          return;
        }
        sendError(res, ErrorCode.INTERNAL_ERROR, result.error || 'Retry failed');
        return;
      }

      // Enqueue processing job
      const messageQueue = getMessageQueue();
      let jobId: string;

      if (scope === 'full') {
        // Re-process entire file
        jobId = await messageQueue.addFileProcessingJob({
          fileId: id,
          userId,
          mimeType: result.file.mimeType,
          blobPath: result.file.blobPath,
          fileName: result.file.name,
        });
      } else {
        // Only re-do embedding
        jobId = await messageQueue.addFileChunkingJob({
          fileId: id,
          userId,
          mimeType: result.file.mimeType,
        });
      }

      logger.info({ userId, fileId: id, jobId, scope }, 'Retry initiated successfully');

      res.json({
        file: result.file,
        jobId,
        message: 'Processing retry initiated',
      });
    } catch (error) {
      logger.error({ error, userId: req.userId, fileId: req.params.id }, 'Retry processing failed');

      if (error instanceof Error && error.message === 'User not authenticated') {
        sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
        return;
      }

      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to retry processing');
    }
  }
);

export default router;
