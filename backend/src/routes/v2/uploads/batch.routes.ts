/**
 * Batch Upload Routes V2 (PRD-03)
 *
 * Unified 3-phase upload pipeline replacing 4 fragmented upload paths.
 *
 * Endpoints:
 * - POST   /                              → createBatch    → 201
 * - POST   /:batchId/files/:fileId/confirm → confirmFile   → 200
 * - GET    /:batchId                       → getBatchStatus → 200
 * - DELETE /:batchId                       → cancelBatch   → 200
 *
 * @module routes/v2/uploads/batch
 */

import { Router, type Request, type Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { createChildLogger } from '@/shared/utils/logger';
import { createBatchRequestSchema } from '@bc-agent/shared';
import { getBatchUploadOrchestratorV2 } from '@/services/files/batch';
import {
  BatchNotFoundError,
  BatchExpiredError,
  BatchCancelledError,
  BatchAlreadyCompleteError,
  FileNotInBatchError,
  FileAlreadyConfirmedError,
  BlobNotFoundError,
  ConcurrentModificationError,
  InvalidTargetFolderError,
  ManifestValidationError,
} from '@/services/files/batch';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';

const router = Router();
const logger = createChildLogger({ service: 'BatchUploadV2Routes' });

// ============================================================================
// Error Mapping
// ============================================================================

function handleDomainError(res: Response, error: unknown): void {
  if (error instanceof BatchNotFoundError || error instanceof FileNotInBatchError) {
    sendError(res, ErrorCode.NOT_FOUND, error.message);
    return;
  }
  if (error instanceof BatchExpiredError) {
    sendError(res, ErrorCode.EXPIRED, error.message);
    return;
  }
  if (
    error instanceof BatchCancelledError ||
    error instanceof BatchAlreadyCompleteError ||
    error instanceof FileAlreadyConfirmedError ||
    error instanceof ConcurrentModificationError
  ) {
    sendError(res, ErrorCode.STATE_CONFLICT, error.message);
    return;
  }
  if (error instanceof BlobNotFoundError || error instanceof ManifestValidationError || error instanceof InvalidTargetFolderError) {
    sendError(res, ErrorCode.VALIDATION_ERROR, error.message);
    return;
  }

  // Unknown error
  const errorInfo = error instanceof Error
    ? { message: error.message, stack: error.stack, name: error.name }
    : { value: String(error) };
  logger.error({ error: errorInfo }, 'Batch upload operation failed');
  sendError(res, ErrorCode.INTERNAL_ERROR, 'An internal error occurred');
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/v2/uploads/batches
 *
 * Create a new upload batch with manifest of files and folders.
 * Returns SAS URLs for direct blob upload.
 */
router.post('/', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    // Validate request body
    const validation = createBatchRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(
        res,
        ErrorCode.VALIDATION_ERROR,
        validation.error.errors[0]?.message ?? 'Invalid request',
      );
      return;
    }

    logger.info(
      { userId, fileCount: validation.data.files.length, folderCount: validation.data.folders?.length ?? 0 },
      'Batch creation requested',
    );

    const orchestrator = getBatchUploadOrchestratorV2();
    const result = await orchestrator.createBatch(userId, validation.data);

    logger.info(
      { userId, batchId: result.batchId },
      'Batch created successfully',
    );

    res.status(201).json(result);
  } catch (error) {
    handleDomainError(res, error);
  }
});

/**
 * POST /api/v2/uploads/batches/:batchId/files/:fileId/confirm
 *
 * Confirm a single file upload after blob has been uploaded to Azure Storage.
 * Verifies blob existence, transitions status, and enqueues processing.
 */
router.post('/:batchId/files/:fileId/confirm', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    const { batchId, fileId } = req.params;

    logger.info(
      { userId, batchId, fileId },
      'File confirmation requested',
    );

    const orchestrator = getBatchUploadOrchestratorV2();
    const result = await orchestrator.confirmFile(userId, batchId, fileId);

    logger.info(
      { userId, batchId, fileId, pipelineStatus: result.pipelineStatus, progress: result.batchProgress },
      'File confirmed',
    );

    res.json(result);
  } catch (error) {
    handleDomainError(res, error);
  }
});

/**
 * GET /api/v2/uploads/batches/:batchId
 *
 * Get the status of a batch and all its files.
 */
router.get('/:batchId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    const { batchId } = req.params;

    const orchestrator = getBatchUploadOrchestratorV2();
    const result = await orchestrator.getBatchStatus(userId, batchId);

    res.json(result);
  } catch (error) {
    handleDomainError(res, error);
  }
});

/**
 * DELETE /api/v2/uploads/batches/:batchId
 *
 * Cancel a batch, soft-deleting all unconfirmed files.
 */
router.delete('/:batchId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    const { batchId } = req.params;

    logger.info(
      { userId, batchId },
      'Batch cancellation requested',
    );

    const orchestrator = getBatchUploadOrchestratorV2();
    const result = await orchestrator.cancelBatch(userId, batchId);

    logger.info(
      { userId, batchId, filesAffected: result.filesAffected },
      'Batch cancelled',
    );

    res.json(result);
  } catch (error) {
    handleDomainError(res, error);
  }
});

export default router;
