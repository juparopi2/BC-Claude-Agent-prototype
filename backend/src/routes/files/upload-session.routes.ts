/**
 * Upload Session Routes
 *
 * API endpoints for folder-based batch upload sessions.
 * Provides early file persistence and folder-level progress tracking.
 *
 * @module routes/files/upload-session.routes
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import {
  getUploadSessionManager,
  getFolderEventEmitter,
  getSessionCancellationHandler,
} from '@/domains/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { validateSafe } from '@bc-agent/shared';
import { z } from 'zod';
import { getUserId } from './helpers';
import type {
  InitUploadSessionResponse,
  CreateFolderInSessionResponse,
  RegisterFilesResponse,
  GetSasUrlsResponse,
  MarkFileUploadedResponse,
  CompleteFolderBatchResponse,
  GetUploadSessionResponse,
  GetActiveSessionsResponse,
  CancelSessionResult,
} from '@bc-agent/shared';
import { FOLDER_UPLOAD_CONFIG } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'UploadSessionRoutes' });
const router = Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * Schema for file registration metadata
 */
const fileRegistrationMetadataSchema = z.object({
  tempId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

/**
 * Schema for folder input
 */
const folderInputSchema = z.object({
  tempId: z.string().min(1),
  name: z.string().min(1).max(255),
  parentTempId: z.string().nullable().optional(),
  files: z.array(fileRegistrationMetadataSchema).min(0).max(1000),
});

/**
 * Schema for session initialization
 */
const initUploadSessionSchema = z.object({
  folders: z.array(folderInputSchema).min(1).max(50),
  targetFolderId: z.string().uuid().nullable().optional(),
});

/**
 * Schema for file registration request
 */
const registerFilesSchema = z.object({
  files: z.array(fileRegistrationMetadataSchema).min(1).max(500),
});

/**
 * Schema for get SAS URLs request
 */
const getSasUrlsSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Schema for mark uploaded request
 */
const markUploadedSchema = z.object({
  fileId: z.string().uuid(),
  contentHash: z.string().min(64).max(64), // SHA-256 hex
  blobPath: z.string().min(1), // Required: real blob path from SAS URL generation
});

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * POST /api/files/upload-session/init
 *
 * Initialize a new upload session with folder batches.
 * Creates session in Redis and returns folder batch info.
 *
 * Request body:
 * - folders: Array<{ tempId, name, parentTempId?, files }>
 * - targetFolderId?: string (optional, null for root)
 *
 * Response 200:
 * - sessionId: string
 * - folderBatches: FolderBatch[]
 * - expiresAt: string (ISO 8601)
 */
router.post(
  '/upload-session/init',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);

      // Validate request body
      const validation = validateSafe(initUploadSessionSchema, req.body);
      if (!validation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          validation.error.errors[0]?.message || 'Invalid request body'
        );
        return;
      }

      const { folders, targetFolderId } = validation.data;

      logger.info(
        { userId, folderCount: folders.length, targetFolderId },
        'Initializing upload session'
      );

      const sessionManager = getUploadSessionManager();
      const { session, renamedFolderCount, renamedFolders } = await sessionManager.initializeSession({
        userId,
        folders,
        targetFolderId,
      });

      // Emit session started event
      const folderEmitter = getFolderEventEmitter();
      folderEmitter.emitSessionStarted(
        { sessionId: session.id, userId },
        { totalFolders: session.totalFolders }
      );

      const response: InitUploadSessionResponse = {
        sessionId: session.id,
        folderBatches: session.folderBatches,
        expiresAt: new Date(session.expiresAt).toISOString(),
        renamedFolderCount: renamedFolderCount > 0 ? renamedFolderCount : undefined,
        renamedFolders: renamedFolders.length > 0 ? renamedFolders : undefined,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to initialize upload session'
      );

      if (error instanceof Error && error.message.includes('Maximum concurrent sessions')) {
        sendError(res, ErrorCode.CONFLICT, error.message);
        return;
      }

      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to initialize upload session');
    }
  }
);

/**
 * GET /api/files/upload-session/active
 *
 * Get all active upload sessions for the current user (multi-session support).
 *
 * Response 200:
 * - sessions: UploadSession[]
 * - count: number
 * - maxConcurrent: number
 */
router.get(
  '/upload-session/active',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);

      const sessionManager = getUploadSessionManager();
      const sessions = await sessionManager.getActiveSessions(userId);

      const response: GetActiveSessionsResponse = {
        sessions,
        count: sessions.length,
        maxConcurrent: FOLDER_UPLOAD_CONFIG.MAX_CONCURRENT_SESSIONS,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get active upload sessions'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get active upload sessions');
    }
  }
);

/**
 * GET /api/files/upload-session/:sessionId
 *
 * Get upload session status and progress.
 *
 * Response 200:
 * - session: UploadSession
 * - progress: UploadSessionProgress
 */
router.get(
  '/upload-session/:sessionId',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId } = req.params;

      if (!sessionId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID is required');
        return;
      }

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      // Verify ownership
      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const progress = await sessionManager.getProgress(sessionId);

      const response: GetUploadSessionResponse = {
        session,
        progress,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get upload session'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get upload session');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/folder/:tempId/create
 *
 * Create folder in database for a batch.
 *
 * Response 200:
 * - folderId: string
 * - folderBatch: FolderBatch
 */
router.post(
  '/upload-session/:sessionId/folder/:tempId/create',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId, tempId } = req.params;

      if (!sessionId || !tempId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID and temp ID are required');
        return;
      }

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const result = await sessionManager.createFolder(sessionId, tempId);

      // Emit batch started event
      const folderEmitter = getFolderEventEmitter();
      const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
      folderEmitter.emitBatchStarted(
        { sessionId, userId },
        {
          folderIndex: batchIndex,
          totalFolders: session.totalFolders,
          folderBatch: result.folderBatch,
        }
      );

      const response: CreateFolderInSessionResponse = {
        folderId: result.folderId,
        folderBatch: result.folderBatch,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to create folder in session'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to create folder');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/folder/:tempId/register-files
 *
 * Register files for early persistence (files appear before blob upload).
 *
 * Request body:
 * - files: Array<{ tempId, fileName, mimeType, sizeBytes }>
 *
 * Response 200:
 * - registered: Array<{ tempId, fileId }>
 * - folderBatch: FolderBatch
 */
router.post(
  '/upload-session/:sessionId/folder/:tempId/register-files',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId, tempId } = req.params;

      if (!sessionId || !tempId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID and temp ID are required');
        return;
      }

      // Validate request body
      const validation = validateSafe(registerFilesSchema, req.body);
      if (!validation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          validation.error.errors[0]?.message || 'Invalid request body'
        );
        return;
      }

      const { files } = validation.data;

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const result = await sessionManager.registerFiles(sessionId, tempId, files);

      // Emit batch progress event
      const folderEmitter = getFolderEventEmitter();
      const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
      folderEmitter.emitBatchProgress(
        { sessionId, userId },
        {
          folderIndex: batchIndex,
          totalFolders: session.totalFolders,
          folderBatch: result.folderBatch,
        }
      );

      const response: RegisterFilesResponse = {
        registered: result.registered,
        folderBatch: result.folderBatch,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to register files'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to register files');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/folder/:tempId/get-sas-urls
 *
 * Get SAS URLs for registered files.
 *
 * Request body:
 * - fileIds: string[]
 *
 * Response 200:
 * - files: Array<{ fileId, tempId, sasUrl, blobPath, expiresAt }>
 */
router.post(
  '/upload-session/:sessionId/folder/:tempId/get-sas-urls',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId, tempId } = req.params;

      if (!sessionId || !tempId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID and temp ID are required');
        return;
      }

      // Validate request body
      const validation = validateSafe(getSasUrlsSchema, req.body);
      if (!validation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          validation.error.errors[0]?.message || 'Invalid request body'
        );
        return;
      }

      const { fileIds } = validation.data;

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const sasUrls = await sessionManager.getSasUrls(sessionId, tempId, fileIds);

      const response: GetSasUrlsResponse = {
        files: sasUrls,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get SAS URLs'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to get SAS URLs');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/folder/:tempId/mark-uploaded
 *
 * Mark a file as uploaded (blob upload complete).
 *
 * Request body:
 * - fileId: string
 * - contentHash: string (SHA-256)
 *
 * Response 200:
 * - success: boolean
 * - jobId?: string
 * - folderBatch: FolderBatch
 */
router.post(
  '/upload-session/:sessionId/folder/:tempId/mark-uploaded',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId, tempId } = req.params;

      if (!sessionId || !tempId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID and temp ID are required');
        return;
      }

      // Validate request body
      const validation = validateSafe(markUploadedSchema, req.body);
      if (!validation.success) {
        sendError(
          res,
          ErrorCode.VALIDATION_ERROR,
          validation.error.errors[0]?.message || 'Invalid request body'
        );
        return;
      }

      const { fileId, contentHash, blobPath } = validation.data;

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const result = await sessionManager.markFileUploaded(
        sessionId,
        tempId,
        fileId,
        contentHash,
        blobPath
      );

      // Emit batch progress event
      const folderEmitter = getFolderEventEmitter();
      const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
      folderEmitter.emitBatchProgress(
        { sessionId, userId },
        {
          folderIndex: batchIndex,
          totalFolders: session.totalFolders,
          folderBatch: result.folderBatch,
        }
      );

      const response: MarkFileUploadedResponse = {
        success: result.success,
        jobId: result.jobId,
        folderBatch: result.folderBatch,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to mark file as uploaded'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to mark file as uploaded');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/folder/:tempId/complete
 *
 * Complete a folder batch (all files uploaded).
 *
 * Response 200:
 * - success: boolean
 * - folderBatch: FolderBatch
 * - session: UploadSession
 */
router.post(
  '/upload-session/:sessionId/folder/:tempId/complete',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId, tempId } = req.params;

      if (!sessionId || !tempId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID and temp ID are required');
        return;
      }

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      const result = await sessionManager.completeFolderBatch(sessionId, tempId);

      // Emit batch completed event
      const folderEmitter = getFolderEventEmitter();
      const batchIndex = session.folderBatches.findIndex(b => b.tempId === tempId);
      folderEmitter.emitBatchCompleted(
        { sessionId, userId },
        {
          folderIndex: batchIndex,
          totalFolders: session.totalFolders,
          folderBatch: result.folderBatch,
        }
      );

      // Check if session is complete
      if (!result.hasNextFolder && result.session.completedFolders + result.session.failedFolders >= result.session.totalFolders) {
        // Complete the session
        await sessionManager.completeSession(sessionId);

        folderEmitter.emitSessionCompleted(
          { sessionId, userId },
          {
            completedFolders: result.session.completedFolders,
            failedFolders: result.session.failedFolders,
          }
        );
      }

      const response: CompleteFolderBatchResponse = {
        success: result.success,
        folderBatch: result.folderBatch,
        session: result.session,
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to complete folder batch'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to complete folder batch');
    }
  }
);

/**
 * POST /api/files/upload-session/:sessionId/heartbeat
 *
 * Extend session TTL (keep-alive).
 *
 * Response 200:
 * - success: boolean
 */
router.post(
  '/upload-session/:sessionId/heartbeat',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId } = req.params;

      if (!sessionId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID is required');
        return;
      }

      const sessionManager = getUploadSessionManager();
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        sendError(res, ErrorCode.NOT_FOUND, 'Upload session not found');
        return;
      }

      if (session.userId !== userId) {
        sendError(res, ErrorCode.FORBIDDEN, 'Access denied');
        return;
      }

      await sessionManager.heartbeat(sessionId);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to extend session TTL'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to extend session TTL');
    }
  }
);

/**
 * DELETE /api/files/upload-session/:sessionId
 *
 * Cancel and delete an upload session with intelligent rollback.
 * Cleans up any files, folders, and blobs created during the upload.
 *
 * Response 200:
 * - sessionId: string
 * - filesDeleted: number
 * - blobsDeleted: number (async cleanup)
 * - searchDocsDeleted: number (async cleanup)
 * - foldersDeleted: number
 * - errors: Array<{ fileId, error }> (non-fatal errors)
 */
router.delete(
  '/upload-session/:sessionId',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);
      const { sessionId } = req.params;

      if (!sessionId) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Session ID is required');
        return;
      }

      logger.info({ sessionId, userId }, 'Cancelling upload session with rollback');

      const cancellationHandler = getSessionCancellationHandler();
      const result: CancelSessionResult = await cancellationHandler.cancelSession(sessionId, userId);

      // Emit session failed event for WebSocket clients
      const folderEmitter = getFolderEventEmitter();
      folderEmitter.emitSessionFailed(
        { sessionId, userId },
        {
          error: 'Session cancelled by user',
          completedFolders: 0,
          failedFolders: 0,
        }
      );

      res.status(200).json(result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cancel upload session'
      );

      if (error instanceof Error && error.message.includes('Access denied')) {
        sendError(res, ErrorCode.FORBIDDEN, error.message);
        return;
      }

      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to cancel upload session');
    }
  }
);

/**
 * POST /api/files/upload-session/cancel-active
 *
 * Cancel the user's current active session (if any).
 * Useful for auto-recovery when a previous upload failed.
 *
 * Response 200:
 * - success: boolean
 * - cancelled: boolean (true if there was an active session to cancel)
 */
router.post(
  '/upload-session/cancel-active',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getUserId(req);

      logger.info({ userId }, 'Cancelling active upload session');

      const sessionManager = getUploadSessionManager();
      const cancelled = await sessionManager.cancelActiveSession(userId);

      res.status(200).json({ success: true, cancelled });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cancel active upload session'
      );
      sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to cancel active upload session');
    }
  }
);

export default router;
